import "server-only";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { folders, tags } from "../../../db/schema/catalog";
import { notFound } from "@/server/db/http";
import { transaction } from "@/server/db/pool";
import { audit } from "./service";

export async function catalog(workspace: string, type: "folders" | "tags", input?: { name: string }, id?: string) {
  const table = type === "folders" ? folders : tags;
  return transaction(async db => {
    const orm = drizzle({ client:db });
    if (input) {
      const item = id
        ? await orm.update(table).set(input).where(and(eq(table.workspaceId,workspace),eq(table.id,id))).returning({id:table.id,name:table.name})
        : await orm.insert(table).values({workspaceId:workspace,name:input.name}).returning({id:table.id,name:table.name});
      if (!item.length) throw notFound();
      await audit(db,workspace,type+".saved");
      return item[0];
    }
    if (id) {
      const item = await orm.delete(table).where(and(eq(table.workspaceId,workspace),eq(table.id,id))).returning({id:table.id});
      if (!item.length) throw notFound();
      return item[0];
    }
    return orm.select({id:table.id,name:table.name}).from(table).where(eq(table.workspaceId,workspace)).orderBy(table.name).limit(100);
  },workspace);
}

export async function getChunks(workspace: string, document: string, focus?: string, after = -1) {
  return transaction(async db => {
    const owner = await db.query("SELECT status FROM documents WHERE workspace_id=$1 AND id=$2",[workspace,document]);
    if (!owner.rowCount) throw notFound();
    let start = after;
    if (focus) {
      const row = await db.query("SELECT ordinal FROM document_chunks WHERE workspace_id=$1 AND document_id=$2 AND id=$3",[workspace,document,focus]);
      if (!row.rowCount) throw notFound();
      start = Math.max(-1,row.rows[0].ordinal-3);
    }
    const chunks = await db.query(`SELECT id,ordinal,page,section,start_offset,end_offset,text,
      EXISTS(SELECT 1 FROM bookmarks b WHERE b.workspace_id=c.workspace_id AND b.chunk_id=c.id) AS bookmarked
      FROM document_chunks c WHERE c.workspace_id=$1 AND c.document_id=$2 AND c.ordinal>$3 ORDER BY c.ordinal LIMIT 17`,[workspace,document,start]);
    return { chunks:chunks.rows.slice(0,16), next:chunks.rows[16] ? chunks.rows[15].ordinal : null };
  },workspace);
}

export async function download(workspace: string, id: string) {
  return transaction(async db => {
    const result = await db.query(`SELECT d.title,d.mime,f.bytes FROM documents d JOIN document_files f
      ON f.workspace_id=d.workspace_id AND f.document_id=d.id WHERE d.workspace_id=$1 AND d.id=$2 AND d.status='READY'`,[workspace,id]);
    if (!result.rowCount) throw notFound();
    return result.rows[0] as { title:string;mime:string;bytes:Buffer };
  },workspace);
}

export async function bookmark(workspace: string, chunk?: string, remove = false) {
  return transaction(async db => {
    if (chunk) {
      const source = await db.query("SELECT document_id FROM document_chunks WHERE workspace_id=$1 AND id=$2",[workspace,chunk]);
      if (!source.rowCount) throw notFound();
      if (remove) await db.query("DELETE FROM bookmarks WHERE workspace_id=$1 AND chunk_id=$2",[workspace,chunk]);
      else await db.query("INSERT INTO bookmarks(workspace_id,document_id,chunk_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",[workspace,source.rows[0].document_id,chunk]);
      return { bookmarked:!remove };
    }
    const result = await db.query(`SELECT b.chunk_id,b.document_id,d.title,c.page,c.section,left(c.text,220) AS preview FROM bookmarks b
      JOIN documents d ON d.workspace_id=b.workspace_id AND d.id=b.document_id
      JOIN document_chunks c ON c.workspace_id=b.workspace_id AND c.id=b.chunk_id
      WHERE b.workspace_id=$1 ORDER BY b.created_at DESC LIMIT 100`,[workspace]);
    return result.rows;
  },workspace);
}

const fields = {
  notes: "id,title,text,source_message_id,created_at,updated_at",
  saved_searches: "id,query,filters,created_at"
} as const;
type Collection = keyof typeof fields;
export async function records(workspace:string, table:Collection, id?:string, input?: { title:string;text:string;sourceMessageId?:string } | { query:string;filters:unknown }, remove=false) {
  return transaction(async db => {
    if (remove && id) {
      if (!(await db.query(`DELETE FROM ${table} WHERE workspace_id=$1 AND id=$2 RETURNING id`,[workspace,id])).rowCount) throw notFound();
      return { id };
    }
    if (input && "title" in input) {
      if (input.sourceMessageId) {
        const source = await db.query("SELECT answer FROM messages WHERE workspace_id=$1 AND id=$2 AND state='ANSWERED'",[workspace,input.sourceMessageId]);
        if (!source.rowCount) throw notFound();
        input = { ...input, text:source.rows[0].answer };
      }
      const result = id
        ? await db.query(`UPDATE notes SET title=$3,text=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${fields.notes}`,
            [workspace,id,input.title,input.text])
        : await db.query(`INSERT INTO notes(workspace_id,title,text,source_message_id) VALUES ($1,$2,$3,$4)
            ON CONFLICT (workspace_id,source_message_id) DO UPDATE SET updated_at=now() RETURNING ${fields.notes}`,
            [workspace,input.title,input.text,input.sourceMessageId]);
      if (!result.rowCount) throw notFound();
      return result.rows[0];
    }
    if (input && "query" in input) {
      const result = await db.query(`INSERT INTO saved_searches(workspace_id,query,filters) VALUES ($1,$2,$3)
        ON CONFLICT (workspace_id,query,filters) DO UPDATE SET query=EXCLUDED.query RETURNING ${fields.saved_searches}`,
        [workspace,input.query,JSON.stringify(input.filters)]);
      return result.rows[0];
    }
    const result = await db.query(`SELECT ${fields[table]} FROM ${table} WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY created_at DESC LIMIT 100`,[workspace,id]);
    if (id && !result.rowCount) throw notFound();
    return id ? result.rows[0] : result.rows;
  },workspace);
}

export async function activity(workspace:string) {
  return transaction(async db => (await db.query("SELECT id,action,created_at FROM audit_events WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 50",[workspace])).rows,workspace);
}

export async function workspaceStats(workspace:string) {
  return transaction(async db => {
    const result = await db.query(`SELECT (SELECT count(*)::int FROM documents WHERE workspace_id=$1) AS documents,
      (SELECT coalesce(sum(size),0)::int FROM documents WHERE workspace_id=$1) AS bytes,
      (SELECT coalesce(max(count),0)::int FROM usage_buckets WHERE scope_key=$1 AND kind='ai' AND period_start=date_trunc('day',now(),'UTC')) AS ai_today`,[workspace]);
    return result.rows[0];
  },workspace);
}

export async function deleteAccount(workspace:string) {
  await transaction(async db => {
    await db.query("DELETE FROM usage_buckets WHERE scope_key=$1",[workspace]);
    await db.query('DELETE FROM "user" WHERE id=$1',[workspace]);
  },workspace);
}
