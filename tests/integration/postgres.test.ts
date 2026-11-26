import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { database,transaction } from "@/server/db/pool";
import { prepareWorkspace } from "@/server/db/http";
import { getDocument,removeDocument,updateDocument,upload } from "@/server/documents/service";
import { bookmark,catalog,getChunks,download,records,deleteAccount } from "@/server/documents/workspace";
import { reserve } from "@/server/quotas/usage";
import { search,searchQuery } from "@/server/search/service";

const testUrl=process.env.TEST_DATABASE_URL;
const a=randomUUID(),b=randomUUID();
const term="velvetwhistle";
let primary:string,chunk:string,folder:string,tag:string,bookmarkId:string;
const add=(id:string,title:string,body:string,key=randomUUID())=>upload(id,title,Buffer.from(body),key);
function anyDoc(workspace:string,id:string) {
  return transaction(db=>db.query("SELECT id FROM documents WHERE id=$1",[id]),workspace);
}

beforeAll(async()=>{
  const url=new URL(testUrl ?? "");
  if (!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||!/\/\w+_test$/.test(url.pathname)) throw Error("Expected disposable test database");
  const bootstrap=spawnSync(process.execPath,["scripts/prepare-tests.mjs"],{env:process.env,encoding:"utf8"});
  if (bootstrap.status!==0)throw Error("Isolated migration failed");
  url.username="docmivo_runtime";url.password="docmivo-local-test-runtime-password";
  process.env.DATABASE_URL=url.href;
  await database().query('INSERT INTO "user"(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',[a,"Reader A",a+"@example.test",b,"Reader B",b+"@example.test"]);
  await prepareWorkspace(a);await prepareWorkspace(b);
  primary=(await add(a,"Observatory Notebook.md","# Reading room\nThe fictional "+term+" opens on Tuesday.")).id;
  chunk=(await getChunks(a,primary)).chunks[0].id;
  folder=(await catalog(a,"folders",{name:"Fictional archive"} ) as {id:string}).id;
  tag=(await catalog(a,"tags",{name:"Juniper catalog"} ) as {id:string}).id;
  await updateDocument(a,primary,{folderId:folder,tagIds:[tag],favorite:true});
});

afterAll(async()=>{
  if (!testUrl || !process.env.DATABASE_URL) return;
  await Promise.all([deleteAccount(a),deleteAccount(b)]);
  await database().end();
});

describe("PostgreSQL schema and isolation",()=>{
  it("runs genuine PostgreSQL with non-bypass runtime and denies DDL",async()=>{
    const db=database();
    const row=(await db.query("SELECT current_setting('server_version_num')::int AS v,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    expect(row.v).toBeGreaterThanOrEqual(170000);
    expect(row.rolsuper).toBe(false);expect(row.rolbypassrls).toBe(false);
    await expect(db.query("CREATE TABLE docmivo_test_denied(x int)")).rejects.toMatchObject({code:"42501"});
  });
  it("resets RLS tenant scope on pooled connections",async()=>{
    expect((await anyDoc(a,primary)).rowCount).toBe(1);
    expect((await anyDoc(b,primary)).rowCount).toBe(0);
    expect((await database().query("SELECT id FROM documents WHERE id=$1",[primary])).rowCount).toBe(0);
  });
  it("verifies policies, physical text indexes and both applied checksums",async()=>{
    const admin=new pg.Client({connectionString:testUrl});
    await admin.connect();
    try{
      const guards=(await admin.query("SELECT relname FROM pg_class WHERE relforcerowsecurity AND relname=ANY($1)",[["documents","document_files","document_chunks","notes","citations","workspaces"]])).rows;
      const indexes=(await admin.query("SELECT indexname,indexdef FROM pg_indexes WHERE indexname=ANY($1)",[["document_chunks_fts_idx","documents_title_trgm_idx","notes_fts_idx"]])).rows;
      const migrations=(await admin.query("SELECT count(*)::int AS count FROM docmivo_migrations")).rows[0].count;
      expect(guards).toHaveLength(6);expect(indexes).toHaveLength(3);expect(migrations).toBeGreaterThanOrEqual(3);
      expect(indexes.every(row=>row.indexdef.includes("USING gin"))).toBe(true);
    }finally{await admin.end();}
  });
  it("rejects foreign folder and tag assignments and rolls back",async()=>{
    const foreign=(await catalog(b,"folders",{name:"Other folders"}) as {id:string}).id;
    const foreignTag=(await catalog(b,"tags",{name:"Other tags"}) as {id:string}).id;
    await expect(updateDocument(a,primary,{folderId:foreign})).rejects.toMatchObject({code:"23503"});
    await expect(updateDocument(a,primary,{tagIds:[foreignTag]})).rejects.toMatchObject({code:"23503"});
    expect((await getDocument(a,primary)).folder_id).toBe(folder);
    expect((await getDocument(a,primary)).tags.map((item:{id:string})=>item.id)).toEqual([tag]);
  });
  it.each(["record","chunks","source","original","rename","delete","bookmark"] as const)("denies cross-tenant %s",async operation=>{
    const calls={
      record:()=>getDocument(b,primary),chunks:()=>getChunks(b,primary),source:()=>getChunks(b,primary,chunk),
      original:()=>download(b,primary),rename:()=>updateDocument(b,primary,{title:"Unwanted change"}),
      delete:()=>removeDocument(b,primary),bookmark:()=>bookmark(b,chunk)
    };
    await expect(calls[operation]()).rejects.toMatchObject({status:404});
  });
  it("supports same content in different tenant accounts",async()=>{
    const other=await add(b,"Ordinary title.md","# Reading room\nThe fictional "+term+" opens on Tuesday.");
    expect(other.id).not.toBe(primary);
    const found=await search(b,term,{});
    expect(found.results.map(item=>item.documentId)).toEqual([other.id]);
  });
  it("reserves quotas atomically under concurrent requests",async()=>{
    const kind="quota-test-"+randomUUID();
    const outcomes=await Promise.allSettled(Array.from({length:12},()=>transaction(db=>reserve(db,a,kind,4),a)));
    expect(outcomes.filter(row=>row.status==="fulfilled").map(row=>(row as PromiseFulfilledResult<number>).value).sort()).toEqual([1,2,3,4]);
    expect(outcomes.filter(row=>row.status==="rejected").every(row=>(row as PromiseRejectedResult).reason.status===429)).toBe(true);
  });
  it("coalesces identical concurrent uploads and prevents request-key reuse",async()=>{
    const key=randomUUID();
    const outcomes=await Promise.all([
      add(a,"idempotent.txt","The fictional harvester.",key),add(a,"idempotent.txt","The fictional harvester.",key)
    ]);
    expect(outcomes[0].id).toBe(outcomes[1].id);
    expect(outcomes.filter(item=>item.stored)).toHaveLength(1);
    await expect(add(a,"different.txt","Different content",key)).rejects.toMatchObject({status:409});
  });
  it("stores true bookmark ownership",async()=>{
    await bookmark(a,chunk);await bookmark(a,chunk);
    expect(await bookmark(b)).toHaveLength(0);
    const list=await bookmark(a);
    expect(list).toHaveLength(1);
    bookmarkId=chunk;
  });
  it("removes files, chunks, bookmarks, and search visibility in one deletion",async()=>{
    const temporary=await add(a,"Deletion cleanup.md","# Index\nquartzdeletedfixture");
    const delChunk=(await getChunks(a,temporary.id)).chunks[0].id;
    await bookmark(a,delChunk);
    await removeDocument(a,temporary.id);
    await expect(download(a,temporary.id)).rejects.toMatchObject({status:404});
    expect((await search(a,"quartzdeletedfixture",{})).results).toHaveLength(0);
    expect((await bookmark(a) as {chunk_id:string}[]).map(item=>item.chunk_id)).toEqual([bookmarkId]);
  });
});

describe("PostgreSQL retrieval",()=>{
  it.each(["source","format","folder","tag","favorites","date","folder-name","tag-name","title-typo"] as const)("finds requested result by %s",async mode=>{
    const choices={
      source:[term,{}],
      format:[term,{type:"text/markdown"}],
      folder:[term,{folder}],
      tag:[term,{tag}],
      favorites:[term,{favorite:true}],
      date:[term,{after:"2000-01-01"}],
      "folder-name":["Fictional archive",{}],
      "tag-name":["Juniper catalog",{}],
      "title-typo":["Observatry",{}]
    } as const;
    const [query,filters]=choices[mode];
    const result=await search(a,query,filters);
    expect(result.results.some(row=>row.documentId===primary)).toBe(true);
  });
  it.each(["future","mime","folder","tag"] as const)("respects excluding filter %s",async mode=>{
    const choices={future:{after:"2099-01-01"},mime:{type:"text/plain"},folder:{folder:randomUUID()},tag:{tag:randomUUID()}};
    expect((await search(a,term,choices[mode])).results).toHaveLength(0);
  });
  it("finds own saved note and keeps its type distinct",async()=>{
    const note=await records(a,"notes",undefined,{title:"Notebook context",text:"Local synthetic catacomb atlas."});
    const result=await search(a,"catacomb",{});
    expect(result.results[0]).toMatchObject({key:note.id,kind:"note"});
    expect((await search(b,"catacomb",{})).results).toHaveLength(0);
  });
  it("returns literal snippets and safe empty or punctuation queries",async()=>{
    const result=await search(a,term,{});
    expect(result.results[0].chunkId).toBe(chunk);
    expect(result.results[0].snippetSegments).toContainEqual({text:term,match:true});
    expect((await search(a,"' OR 1=1; --",{})).results).toHaveLength(0);
    expect((await search(a,"  - ",{})).results).toHaveLength(0);
  });
  it("executes indexed lexical retrieval at 5,200 synthetic chunks",async()=>{
    const ids=await transaction(async db=>{
      const ids=(await db.query<{id:string}>(`INSERT INTO documents(workspace_id,title,mime,size,sha256,classification,status)
        SELECT $1::uuid,'Synthetic volume '||n,'text/plain',100,encode(sha256(convert_to($1::uuid::text||n,'UTF8')),'hex'),'PRIVATE','READY' FROM generate_series(1,52) n RETURNING id`,[a])).rows.map(row=>row.id);
      await db.query(`INSERT INTO document_chunks(workspace_id,document_id,ordinal,page,start_offset,end_offset,text)
        SELECT $1,m.id,n,1,n*300,n*300+295,'Fictional volume '||m.position||' indexes weather field notes archive catalog map cartography '||repeat('context ',16)||CASE WHEN m.position%6=0 AND n=23 THEN 'waxenmeteor' ELSE 'paper' END
        FROM unnest($2::uuid[]) WITH ORDINALITY AS m(id,position) CROSS JOIN generate_series(1,100) n`,[a,ids]);
      return ids;
    },a);
    const control=new pg.Client({connectionString:testUrl});
    await control.connect();
    try {
      await control.query("VACUUM (ANALYZE) document_chunks");
      const source=(await control.query("SELECT prosrc FROM pg_proc WHERE oid='search_candidates(text)'::regprocedure")).rows[0].prosrc;
      await control.query("SELECT set_config('docmivo.workspace',$1,false)",[a]);
      const plan=(await control.query("EXPLAIN "+source.replace(/\braw\b/g,"$1"),["waxenmeteor"])).rows.map(row=>row["QUERY PLAN"]).join("\n");
      expect(plan).toContain("document_chunks_fts_idx");
    } finally {await control.end();}
    const outerPlan=await transaction(async db=>(await db.query("EXPLAIN "+searchQuery,[a,"waxenmeteor",null,null,null,false,null,null,null])).rows.map(row=>row["QUERY PLAN"]).join("\n"),a);
    expect(outerPlan).toContain("Function Scan on search_candidates");
    expect((await database().query("SELECT * FROM search_candidates($1)",["waxenmeteor"])).rowCount).toBe(0);
    expect((await transaction(db=>db.query("SELECT * FROM search_candidates($1)",["waxenmeteor"]),b)).rowCount).toBe(0);
    const result=await search(a,"waxenmeteor",{});
    expect(result.results).toHaveLength(8);expect(result.results.every(row=>ids.includes(row.documentId))).toBe(true);
  });
  it("pages ties deterministically without duplicated result IDs",async()=>{
    const first=await search(a,"field notes",{});
    const second=await search(a,"field notes",{},first.nextCursor??undefined);
    expect(first.results).toHaveLength(20);expect(second.results).toHaveLength(20);
    expect(new Set([...first.results,...second.results].map(row=>row.key)).size).toBe(40);
  });
});
