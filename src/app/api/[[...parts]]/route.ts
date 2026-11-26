import { randomUUID } from "node:crypto";
import { z } from "zod";
import { answer, aiAvailable, askInput, citation, companion, history } from "@/server/ai/service";
import { body, headers, HttpError, invalid, json, notFound, prepareWorkspace, respond, route, session, verifyOrigin } from "@/server/db/http";
import { transaction } from "@/server/db/pool";
import { database } from "@/server/db/pool";
import { sample } from "@/server/documents/sample";
import { getDocument, listDocuments, processDocument, removeDocument, updateDocument, upload } from "@/server/documents/service";
import { activity, bookmark, catalog, deleteAccount, download, getChunks, records, workspaceStats } from "@/server/documents/workspace";
import { limit } from "@/server/quotas/usage";
import { filtersSchema, search } from "@/server/search/service";

export const runtime = "nodejs";
export const maxDuration = 45;
const idSchema = z.uuid();
const title = z.string().trim().min(1).max(180);
const label = z.object({ name:z.string().trim().min(1).max(80) }).strict();
const note = z.object({ title,text:z.string().trim().min(1).max(8000),sourceMessageId:idSchema.optional() }).strict();
const docChange = z.object({ title:title.optional(),folderId:idSchema.nullable().optional(),tagIds:z.array(idSchema).max(20).optional(),favorite:z.boolean().optional(),viewed:z.boolean().optional() }).strict();
const searchText = z.string().trim().max(160);
const status = z.enum(["UPLOADED","PARSING","READY","FAILED"]);
const uploadLimit = 2_162_688;
const methodNotAllowed = () => new HttpError(405,"METHOD","This operation is unavailable.");

async function handler(request:Request,{ params }:{ params:Promise<{parts?:string[]}> }) {
  return route(async () => {
    const [resource,id,child,...extra] = (await params).parts ?? [];
    if (extra.length) throw notFound();
    const method = request.method;
    if (resource==="health" && !id && method==="GET") {
      await database().query("SELECT id FROM workspaces LIMIT 0");
      return respond({ status:"ok" });
    }
    verifyOrigin(request);
    const user = await session(request);
    const workspace = user.id;
    const qs = new URL(request.url).searchParams;
    const value = (name:string) => qs.get(name) ?? undefined;
    if (resource==="settings" && !child && !id && method==="GET") {
      await prepareWorkspace(workspace);
      return respond({ user:{name:user.name,email:user.email}, ai:aiAvailable(user,request), quota:limit("AI_USER_DAILY_LIMIT",10,30),
        maxBytes:limit("MAX_WORKSPACE_BYTES",20971520,20971520),
        admin:(process.env.ADMIN_EMAILS ?? "").split(",").map(email => email.trim()).includes(user.email),...await workspaceStats(workspace) });
    }
    if (resource==="documents") {
      if (!id && method==="GET") {
        const filters = filtersSchema.parse({ folder:value("folder"),tag:value("tag"),type:value("type"),favorite:value("favorite")==="true" });
        return respond(await listDocuments(workspace,{...filters,status:status.optional().parse(value("status")),recent:value("recent")==="true",cursor:idSchema.optional().parse(value("cursor"))}));
      }
      if (!id && method==="POST") {
        await prepareWorkspace(workspace);
        const type=request.headers.get("content-type") ?? "";
        if (!type.startsWith("multipart/form-data;")) throw invalid("Choose a document to upload.");
        let form:FormData;
        try { form=await new Response(new Uint8Array(await body(request,uploadLimit)),{headers:{"Content-Type":type}}).formData(); }
        catch (error) { if (error instanceof HttpError) throw error; throw invalid("The upload could not be read."); }
        const file=form.get("file");
        if (!(file instanceof File)) throw invalid("Choose a document to upload.");
        return respond(await upload(workspace,file.name,Buffer.from(await file.arrayBuffer()),idSchema.parse(request.headers.get("idempotency-key"))),201);
      }
      if (!id) throw methodNotAllowed();
      const document = idSchema.parse(id);
      if (!child && method==="GET") return respond(await getDocument(workspace,document));
      if (!child && method==="PATCH") return respond(await updateDocument(workspace,document,docChange.parse(await json(request))));
      if (!child && method==="DELETE") { await removeDocument(workspace,document); return respond({ deleted:true }); }
      if (child==="chunks" && method==="GET") return respond(await getChunks(workspace,document,idSchema.optional().parse(value("focus")),z.coerce.number().int().min(-1).max(2000).default(-1).parse(value("after"))));
      if (child==="retry" && method==="POST") {
        await getDocument(workspace,document);
        await processDocument(workspace,document);
        return respond(await getDocument(workspace,document));
      }
      if (child==="content" && method==="GET") {
        const file=await download(workspace,document);
        const encoded=encodeURIComponent(file.title).replace(/['()*]/g,c=>"%"+c.charCodeAt(0).toString(16));
        return new Response(new Uint8Array(file.bytes),{ headers:{...headers,"Content-Type":file.mime,"Content-Disposition":"attachment; filename*=UTF-8''"+encoded,"Content-Length":String(file.bytes.length)} });
      }
      throw methodNotAllowed();
    }
    if (resource==="samples" && !id && method==="POST") {
      await prepareWorkspace(workspace);
      const data=await json(request);
      const key=z.object({key:z.enum(["field-guide-01","field-guide-02"])}).strict().parse(data).key;
      const item=key===sample.key ? sample : companion;
      return respond(await upload(workspace,item.title,Buffer.from(item.text),randomUUID(),item.key),201);
    }
    if (resource==="search" && !id && (method==="GET" || method==="POST")) {
      const cursor=z.string().max(160).optional();
      const data=method==="POST" ? z.object({query:searchText,filters:filtersSchema,cursor}).strict().parse(await json(request)) : {
        query:searchText.parse(value("q") ?? ""),
        filters:filtersSchema.parse({folder:value("folder"),tag:value("tag"),type:value("type"),favorite:value("favorite")==="true",after:value("after")}),
        cursor:cursor.parse(value("cursor"))
      };
      return respond(await search(workspace,data.query,data.filters,data.cursor));
    }
    if (resource==="jobs" && id && !child && method==="GET") {
      const job = await transaction(db=>db.query("SELECT id,document_id,state,attempts,updated_at FROM ingestion_jobs WHERE workspace_id=$1 AND id=$2",[workspace,idSchema.parse(id)]),workspace);
      if (!job.rowCount) throw notFound();
      return respond(job.rows[0]);
    }
    if (["folders","tags","notes","saved-searches"].includes(resource) && !child) {
      const key=idSchema.optional().parse(id);
      if (method==="POST") await prepareWorkspace(workspace);
      if (resource==="folders" || resource==="tags") {
        if (method==="GET" && !key) return respond(await catalog(workspace,resource));
        if (method==="POST" && !key || method==="PATCH" && key) return respond(await catalog(workspace,resource,label.parse(await json(request)),key),method==="POST"?201:200);
        if (method==="DELETE" && key) return respond(await catalog(workspace,resource,undefined,key));
      }
      if (resource==="notes" || resource==="saved-searches") {
        const table=resource==="notes" ? "notes" : "saved_searches";
        if (method==="GET") return respond(await records(workspace,table,key));
        if (method==="DELETE" && key) return respond(await records(workspace,table,key,undefined,true));
        if (resource==="notes" && (method==="POST" && !key || method==="PATCH" && key)) return respond(await records(workspace,table,key,note.parse(await json(request))),method==="POST"?201:200);
        if (resource==="saved-searches" && method==="POST" && !key) {
          const values=z.object({query:searchText.min(1),filters:filtersSchema}).strict().parse(await json(request));
          return respond(await records(workspace,table,undefined,values),201);
        }
      }
      throw methodNotAllowed();
    }
    if (resource==="bookmarks" && !child) {
      if (method==="GET" && !id) return respond(await bookmark(workspace));
      if (id && (method==="PUT" || method==="DELETE")) return respond(await bookmark(workspace,idSchema.parse(id),method==="DELETE"));
    }
    if ((resource==="ask" || resource==="summarize" || resource==="extract" || resource==="compare") && !id && method==="POST") {
      return respond(await answer(user,request,resource,askInput.parse(await json(request))));
    }
    if (resource==="conversations" && !child) {
      const key=idSchema.optional().parse(id);
      if (method==="GET") return respond(await history(workspace,key));
      if (key && method==="PATCH") return respond(await history(workspace,key,z.object({title}).strict().parse(await json(request))));
      if (key && method==="DELETE") return respond(await history(workspace,key,true));
    }
    if (resource==="citations" && id && !child && method==="GET") return respond(await citation(workspace,idSchema.parse(id)));
    if (resource==="usage" && !id && method==="GET") return respond(await workspaceStats(workspace));
    if (resource==="activity" && !id && method==="GET") return respond(await activity(workspace));
    if (resource==="admin" && id==="health" && !child && method==="GET") {
      const admins=(process.env.ADMIN_EMAILS ?? "").split(",").map(email=>email.trim());
      if (!admins.includes(user.email)) throw notFound();
      const result=await database().query("SELECT coalesce(sum(count),0)::int AS requests FROM usage_buckets WHERE kind='ai' AND scope_key='global' AND period_start=date_trunc('day',now(),'UTC')");
      return respond({ database:"ok",analysisToday:result.rows[0].requests });
    }
    if (resource==="account" && !id && method==="DELETE") {
      const verified=z.object({confirmation:z.literal("DELETE")}).strict().parse(await json(request));
      if (verified.confirmation==="DELETE") await deleteAccount(workspace);
      return respond({ deleted:true });
    }
    throw notFound();
  });
}

export const GET=handler;
export const POST=handler;
export const PATCH=handler;
export const PUT=handler;
export const DELETE=handler;
