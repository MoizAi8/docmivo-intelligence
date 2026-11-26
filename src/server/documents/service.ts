import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { transaction } from "@/server/db/pool";
import { HttpError, notFound } from "@/server/db/http";
import { limit, reserve } from "@/server/quotas/usage";
import { chunkSpans, extract, kindFromMime, validateFile } from "@/server/ingestion/parser";

export async function audit(db: PoolClient, workspace: string, action: string) {
  await db.query("INSERT INTO audit_events(workspace_id,action) VALUES ($1,$2)",[workspace,action]);
}

const selection = `d.id,d.title,d.mime,d.size,d.classification,d.status,d.error_code,d.folder_id,d.favorite,d.created_at,d.updated_at,d.viewed_at,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) ORDER BY t.name),'[]'::jsonb) FROM document_tags dt
   JOIN tags t ON t.workspace_id=dt.workspace_id AND t.id=dt.tag_id WHERE dt.workspace_id=d.workspace_id AND dt.document_id=d.id) AS tags`;

export async function listDocuments(workspace: string, filters: { folder?: string; tag?: string; type?: string; status?: string; favorite?: boolean; recent?: boolean; cursor?: string }) {
  return transaction(async db => {
    const documents = await db.query(`SELECT ${selection} FROM documents d WHERE d.workspace_id=$1
      AND ($2::uuid IS NULL OR d.folder_id=$2) AND ($3::uuid IS NULL OR EXISTS
        (SELECT 1 FROM document_tags dt WHERE dt.workspace_id=d.workspace_id AND dt.document_id=d.id AND dt.tag_id=$3))
      AND ($4::text IS NULL OR d.mime=$4) AND ($5::text IS NULL OR d.status=$5)
      AND (NOT $6::boolean OR d.favorite) AND (NOT $7::boolean OR d.viewed_at IS NOT NULL)
      AND ($8::uuid IS NULL OR ((CASE WHEN $7 THEN d.viewed_at ELSE d.updated_at END),d.id) <
        (SELECT CASE WHEN $7 THEN p.viewed_at ELSE p.updated_at END,p.id FROM documents p WHERE p.workspace_id=$1 AND p.id=$8))
      ORDER BY CASE WHEN $7 THEN d.viewed_at ELSE d.updated_at END DESC,d.id DESC LIMIT 41`,
      [workspace,filters.folder,filters.tag,filters.type,filters.status,!!filters.favorite,!!filters.recent,filters.cursor]);
    return { documents: documents.rows.slice(0,40), nextCursor: documents.rows[40] ? documents.rows[39].id : null };
  }, workspace);
}

export async function getDocument(workspace: string, id: string) {
  return transaction(async db => {
    const item = await db.query(`SELECT ${selection}, j.id AS job_id,j.attempts FROM documents d
        JOIN ingestion_jobs j ON j.workspace_id=d.workspace_id AND j.document_id=d.id
        WHERE d.workspace_id=$1 AND d.id=$2`,[workspace,id]);
    if (!item.rowCount) throw notFound();
    return item.rows[0];
  }, workspace);
}

export async function upload(workspace: string, filename: string, bytes: Buffer, idempotencyKey: string, sampleKey?: string) {
  const maxSize = limit("MAX_UPLOAD_BYTES",2097152,2097152);
  if (bytes.length > maxSize) throw new HttpError(413,"TOO_LARGE","Files must be 2 MiB or smaller.");
  if (!bytes.length) throw new HttpError(400,"EMPTY_FILE","Choose a file with text or document data.");
  const info = validateFile(filename,bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const item = await transaction(async db => {
    await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE",[workspace]);
    const existing = await db.query(`SELECT d.id,d.sha256,j.id AS job_id,j.idempotency_key
      FROM documents d JOIN ingestion_jobs j ON j.workspace_id=d.workspace_id AND j.document_id=d.id
      WHERE d.workspace_id=$1 AND (j.idempotency_key=$2 OR d.sha256=$3)
      ORDER BY (j.idempotency_key=$2) DESC LIMIT 1`,[workspace,idempotencyKey,hash]);
    if (existing.rowCount) {
      if (existing.rows[0].sha256 !== hash) throw new HttpError(409,"IDEMPOTENCY_CONFLICT","The upload identifier was already used for a different file.");
      return { id: existing.rows[0].id as string, jobId: existing.rows[0].job_id as string, stored: false };
    }
    await reserve(db,workspace,"upload",8,"minute");
    const totals = (await db.query("SELECT coalesce(sum(size),0)::integer AS bytes,count(*)::integer AS files FROM documents WHERE workspace_id=$1",[workspace])).rows[0];
    if (totals.files >= 100 || totals.bytes + bytes.length > limit("MAX_WORKSPACE_BYTES",20971520,20971520)) {
      throw new HttpError(429,"STORAGE_LIMIT","Your workspace storage is full. Remove a file to make room.");
    }
    const id = randomUUID();
    const jobId = randomUUID();
    await db.query(`INSERT INTO documents(id,workspace_id,title,mime,size,sha256,classification,sample_key,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UPLOADED')`,[id,workspace,info.title,info.mime,bytes.length,hash,sampleKey?"SYNTHETIC":"PRIVATE",sampleKey]);
    await db.query("INSERT INTO document_files(workspace_id,document_id,bytes) VALUES ($1,$2,$3)",[workspace,id,bytes]);
    await db.query("INSERT INTO ingestion_jobs(id,workspace_id,document_id,idempotency_key,state) VALUES ($1,$2,$3,$4,'UPLOADED')",[jobId,workspace,id,idempotencyKey]);
    await audit(db,workspace,"document.uploaded");
    return { id, jobId, stored:true };
  },workspace);
  if (item.stored) await processDocument(workspace,item.id);
  const doc = await getDocument(workspace,item.id);
  return { ...item, status:doc.status, errorCode:doc.error_code };
}

export async function processDocument(workspace: string, id: string) {
  const claim = await transaction(async db => {
    await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE",[workspace]);
    const concurrent = await db.query("SELECT 1 FROM ingestion_jobs WHERE workspace_id=$1 AND state='PARSING' AND lease_until>now() AND document_id<>$2",[workspace,id]);
    if (concurrent.rowCount) return null;
    const job = await db.query(`UPDATE ingestion_jobs SET state='PARSING',attempts=attempts+1,lease_until=now()+interval '26 seconds',updated_at=now()
      WHERE workspace_id=$1 AND document_id=$2 AND attempts<3
        AND (state IN ('UPLOADED','FAILED') OR (state='PARSING' AND lease_until<now()))
      RETURNING attempts`,[workspace,id]);
    if (!job.rowCount) {
      const expired = await db.query(`UPDATE ingestion_jobs SET state='FAILED',lease_until=NULL,updated_at=now()
        WHERE workspace_id=$1 AND document_id=$2 AND attempts=3 AND state='PARSING' AND lease_until<now() RETURNING id`,[workspace,id]);
      if (expired.rowCount) await db.query("UPDATE documents SET status='FAILED',error_code='PARSE_TIMEOUT' WHERE workspace_id=$1 AND id=$2",[workspace,id]);
      return null;
    }
    const doc = await db.query("UPDATE documents SET status='PARSING',error_code=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING mime",[workspace,id]);
    const file = await db.query("SELECT bytes FROM document_files WHERE workspace_id=$1 AND document_id=$2",[workspace,id]);
    return { mime:doc.rows[0].mime as string, bytes:file.rows[0].bytes as Buffer, attempt:job.rows[0].attempts as number };
  },workspace);
  if (!claim) return;
  let chunks;
  let failure: string | null = null;
  try { chunks = chunkSpans(await extract(claim.bytes,kindFromMime(claim.mime))); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    failure = ["PARSE_TIMEOUT","PARSE_FAILED","NO_TEXT","TEXT_LIMIT","PDF_PAGE_LIMIT","INVALID_DOCX","INVALID_TEXT"].includes(code) ? code : "PARSE_FAILED";
  }
  await transaction(async db => {
    const state = failure ? "FAILED" : "READY";
    const job = await db.query(`UPDATE ingestion_jobs SET state=$4,lease_until=NULL,updated_at=now()
      WHERE workspace_id=$1 AND document_id=$2 AND attempts=$3 AND state='PARSING' RETURNING id`,[workspace,id,claim.attempt,state]);
    if (!job.rowCount) return;
    if (chunks?.length) {
      await db.query(`INSERT INTO document_chunks(workspace_id,document_id,ordinal,page,section,start_offset,end_offset,text)
        SELECT $1,$2,x.ordinal,x.page,x.section,x.start,x.end,x.text
        FROM jsonb_to_recordset($3::jsonb) AS x(ordinal integer,page integer,section text,start integer,"end" integer,text text)`,
        [workspace,id,JSON.stringify(chunks)]);
    }
    await db.query("UPDATE documents SET status=$3,error_code=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2",[workspace,id,state,failure]);
    await audit(db,workspace,failure?"document.parse_failed":"document.indexed");
  },workspace);
}

export async function updateDocument(workspace: string, id: string, update: { title?: string; folderId?: string|null; tagIds?: string[]; favorite?: boolean; viewed?: boolean }) {
  return transaction(async db => {
    const related = await db.query(`UPDATE documents SET title=coalesce($3,title),favorite=coalesce($4,favorite),
      folder_id=CASE WHEN $5 THEN $6::uuid ELSE folder_id END,
      updated_at=CASE WHEN $7 THEN updated_at ELSE now() END,viewed_at=CASE WHEN $8 THEN now() ELSE viewed_at END
      WHERE workspace_id=$1 AND id=$2 RETURNING id`,[workspace,id,update.title,update.favorite,update.folderId!==undefined,update.folderId,
      update.viewed === true && Object.keys(update).length===1,update.viewed === true]);
    if (!related.rowCount) throw notFound();
    if (update.tagIds) {
      await db.query("DELETE FROM document_tags WHERE workspace_id=$1 AND document_id=$2",[workspace,id]);
      await db.query("INSERT INTO document_tags(workspace_id,document_id,tag_id) SELECT $1,$2,id FROM unnest($3::uuid[]) AS id ON CONFLICT DO NOTHING",[workspace,id,update.tagIds]);
    }
    if (update.viewed !== true) await audit(db,workspace,"document.updated");
  },workspace);
}

export async function removeDocument(workspace: string, id: string) {
  return transaction(async db => {
    await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE",[workspace]);
    await db.query(`DELETE FROM messages WHERE workspace_id=$1 AND id IN
      (SELECT c.message_id FROM citations c JOIN document_chunks dc ON dc.workspace_id=c.workspace_id AND dc.id=c.chunk_id
       WHERE c.workspace_id=$1 AND dc.document_id=$2)`,[workspace,id]);
    const removed = await db.query("DELETE FROM documents WHERE workspace_id=$1 AND id=$2 RETURNING id",[workspace,id]);
    if (!removed.rowCount) throw notFound();
    await db.query("DELETE FROM conversations c WHERE workspace_id=$1 AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id)",[workspace]);
    await audit(db,workspace,"document.deleted");
  },workspace);
}
