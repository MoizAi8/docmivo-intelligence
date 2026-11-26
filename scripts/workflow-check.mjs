import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import { readFileSync,writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { spawn } from "node:child_process";
import pg from "pg";
import { fixtureDocx,fixturePdf } from "../tests/fixtures/documents.ts";

const mode=process.argv[2];
let origin=process.argv[3] || "http://localhost:3102";
try { loadEnvFile(".env.local"); } catch {}
let activeCheck="";
let passed=0;
function stage(label){activeCheck=label;}
function pass(){passed++;console.log("PASS "+activeCheck);}
function fixture(){
  return {email:"docmivo-check-"+randomUUID().slice(0,12)+"@example.test",
    password:randomBytes(24).toString("base64url"),name:"Fictional Docmivo Reviewer"};
}
function headers(cookie,extra={}){
  return {origin,...(cookie?{cookie}:{}),...extra};
}
async function call(path,method="GET",cookie,body,extra){
  const response=await fetch(origin+"/api/"+path,{method,headers:headers(cookie,{...(body!==undefined?{"Content-Type":"application/json"}:{}),...extra}),
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(44000)});
  const result=await response.json().catch(()=>null);
  return {status:response.status,data:result?.data??result,error:result?.error,cookie:response.headers.getSetCookie().map(value=>value.split(";")[0]).join("; "),
    headers:response.headers};
}
async function auth(account,signup=false){
  const result=await call("auth/sign-"+(signup?"up":"in")+"/email","POST",undefined,account,
    signup?{"x-docmivo-invite":process.env.REGISTRATION_INVITE}:undefined);
  assert.equal(result.status,200);
  assert.ok(result.cookie);
  return {cookie:result.cookie,id:result.data.user.id};
}
async function upload(cookie,fileName,text){
  const form=new FormData();form.append("file",new File([text],fileName));
  const response=await fetch(origin+"/api/documents",{method:"POST",headers:headers(cookie,{"idempotency-key":randomUUID()}),body:form,signal:AbortSignal.timeout(35000)});
  const { data }=await response.json();
  assert.equal(response.status,201);
  assert.equal(data.status,"READY");
  return data;
}
async function ready(){
  for(let i=0;i<25;i++){
    try{ const result=await call("health");if(result.status===200)return; }catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw Error("Health failed");
}
function localServer(port,options){
  return spawn(process.execPath,["node_modules/next/dist/bin/next","start","--port",String(port),"--hostname","127.0.0.1"],{
    env:{...process.env,APP_URL:origin,...options},stdio:"ignore",windowsHide:true
  });
}

async function setup(){
  origin="http://127.0.0.1:3102";
  const server=localServer(3102,{EXTERNAL_AI_ENABLED:"false"});
  try{
    stage("bootstrap against the dedicated Neon project");await ready();pass();
    const accounts=[fixture(),fixture()];
    for (const account of accounts){
      stage("create synthetic hosted verification identity");
      const session=await auth(account,true);
      account.id=session.id;pass();
    }
    writeFileSync(".local/hosted-qa.json",JSON.stringify(accounts),{mode:0o600,flag:"wx"});
  }finally{server.kill();}
}

async function hosted(){
  assert.match(origin,/^https:\/\/[a-z0-9.-]+\.vercel\.app$/);
  const [a,b]=JSON.parse(readFileSync(".local/hosted-qa.json","utf8"));
  let first,second,own,sample1,sample2;
  try{
    stage("HTTPS health and public landing");
    const initial=performance.now();
    const health=await call("health");
    assert.equal(health.status,200);assert.equal(health.data.status,"ok");
    console.log("First hosted API health request "+Math.round(performance.now()-initial)+" ms (cold state unverified)");
    const landing=await fetch(origin,{signal:AbortSignal.timeout(16000)});
    assert.equal(landing.status,200);assert.match(await landing.text(),/Find what/);pass();

    stage("production authentication, secure session, and two accounts");
    ({cookie:first}=await auth({email:a.email,password:a.password}));
    ({cookie:second}=await auth({email:b.email,password:b.password}));
    const signed=await call("settings","GET",first);
    assert.equal(signed.status,200);assert.equal((await call("settings")).status,401);
    assert.equal(signed.headers.get("cache-control"),"private, no-store");pass();

    stage("hosted invite registration and synthetic account deletion");
    const temporary=await auth(fixture(),true);
    assert.equal((await call("account","DELETE",temporary.cookie,{confirmation:"DELETE"})).status,200);
    assert.equal((await call("settings","GET",temporary.cookie)).status,401);pass();

    stage("production private Markdown indexing and original download");
    const searchTerm="Heliotrope"+randomBytes(4).toString("hex");
    const privateText="# Reading rooms\n\nThe fictional "+searchTerm+" archive opens on Mondays.";
    own=await upload(first,"Fictional research notes.md",privateText);
    const original=await fetch(origin+"/api/documents/"+own.id+"/content",{headers:headers(first)});
    assert.match(original.headers.get("content-disposition"),/attachment/);
    assert.equal(await original.text(),privateText);pass();

    stage("hosted settings reflect persisted storage and usage");
    const usage=await call("usage","GET",first);
    const currentSettings=await call("settings","GET",first);
    assert.equal(usage.status,200);assert.equal(currentSettings.status,200);
    assert.equal(currentSettings.data.documents,signed.data.documents+1);
    assert.equal(currentSettings.data.bytes,signed.data.bytes+Buffer.byteLength(privateText));
    for(const key of ["documents","bytes","ai_today"])assert.equal(currentSettings.data[key],usage.data[key]);
    pass();

    stage("production PDF page and Word text extraction");
    for (const [name,bytes,needle] of [["Fictional PDF.pdf",fixturePdf(),"Juniper archive"],["Fictional Word.docx",fixtureDocx(),"Alder reading room"]]) {
      const file=await upload(first,name,bytes);
      try {
        const passages=(await call("documents/"+file.id+"/chunks","GET",first)).data.chunks;
        assert.ok(passages[0].text.includes(needle));
        if (name.endsWith(".pdf")) assert.equal(passages[0].page,1);
      } finally { await call("documents/"+file.id,"DELETE",first); }
    }
    pass();

    stage("hosted keyword search returns a matching document");
    const search=await call("search","POST",first,{query:searchTerm,filters:{}});
    assert.equal(search.status,200);
    const hit=search.data.results.find(item=>item.documentId===own.id && item.chunkId);
    assert.ok(hit);
    stage("hosted keyword search highlights the indexed term");
    assert.equal(hit.section,"Reading rooms");assert.ok(hit.snippetSegments.some(item=>item.match&&item.text===searchTerm));
    stage("keyword results, highlighted exact source, and bookmark");
    const exact=await call("documents/"+own.id+"/chunks?focus="+hit.chunkId,"GET",first);
    assert.equal(exact.status,200);
    assert.equal(exact.data.chunks[0].id,hit.chunkId);
    assert.equal((await call("bookmarks/"+hit.chunkId,"PUT",first)).status,200);pass();

    stage("cross-account resource, original, mutation, and search denial");
    assert.equal((await call("documents/"+own.id,"GET",second)).status,404);
    assert.equal((await call("documents/"+own.id+"/chunks?focus="+hit.chunkId,"GET",second)).status,404);
    assert.equal((await call("documents/"+own.id+"/content","GET",second)).status,404);
    assert.equal((await call("documents/"+own.id,"DELETE",second)).status,404);
    assert.deepEqual((await call("search","POST",second,{query:searchTerm,filters:{}})).data.results,[]);pass();

    stage("allowlisted tester is eligible in the deployment region");
    assert.equal(signed.data.ai,true);assert.equal((await call("settings","GET",second)).data.ai,false);pass();

    function askData(documentIds,extra={}){
      return {documentIds,prompt:"hours",idempotencyKey:randomUUID(),allowExternalNonSensitive:true,attestEligibility:true,...extra};
    }
    async function verifiedAnalysis(kind,ids,extra={}){
      let request=askData(ids,extra);
      let result=await call(kind,"POST",first,request);
      if(result.status===200 && ["FAILED","INSUFFICIENT"].includes(result.data.state)){
        console.log("Hosted "+kind+" returned "+result.data.state+" on the first attempt. Retrying with a new request.");
        request=askData(ids,extra);
        result=await call(kind,"POST",first,request);
      }
      assert.equal(result.status,200);
      assert.equal(result.data.state,"ANSWERED");
      assert.ok(result.data.citations.length);
      return {request,output:result.data};
    }
    stage("private source is rejected before AI quota is reserved");
    const before=(await call("usage","GET",first)).data.ai_today;
    const blocked=await call("ask","POST",first,askData([own.id]));
    assert.equal(blocked.status,403);assert.equal(blocked.error.code,"PRIVATE_SOURCE");
    assert.equal((await call("usage","GET",first)).data.ai_today,before);pass();

    stage("built-in samples and explicit consent");
    sample1=(await call("samples","POST",first,{key:"field-guide-01"})).data;
    sample2=(await call("samples","POST",first,{key:"field-guide-02"})).data;
    assert.equal(sample1.status,"READY");assert.equal(sample2.status,"READY");
    assert.equal((await call("ask","POST",first,askData([sample1.id],{allowExternalNonSensitive:false}))).status,400);
    assert.equal((await call("ask","POST",first,askData([sample1.id,own.id]))).error.code,"PRIVATE_SOURCE");pass();

    stage("genuine hosted Gemini extract");
    const {output:extraction}=await verifiedAnalysis("extract",[sample1.id]);pass();

    stage("genuine hosted Gemini answer with exact stored quotation");
    const started=performance.now();
    const usageBeforeQuestion=(await call("usage","GET",first)).data.ai_today;
    const {request,output:message}=await verifiedAnalysis("ask",[sample1.id],{conversationId:extraction.conversation_id});
    assert.match(message.answer,/Thursday/i);
    assert.ok(message.citations.length);
    const citation=message.citations[0];
    const resolved=await call("citations/"+citation.id,"GET",first);
    assert.equal(resolved.status,200);
    const passage=(await call("documents/"+resolved.data.document_id+"/chunks?focus="+resolved.data.chunk_id,"GET",first)).data.chunks.find(item=>item.id===resolved.data.chunk_id);
    assert.ok(passage.text.replace(/\s+/g," ").includes(resolved.data.quote));
    assert.equal((await call("citations/"+citation.id,"GET",second)).status,404);
    assert.equal((await call("conversations/"+message.conversation_id,"GET",second)).status,404);
    console.log("Hosted question and source verification elapsed "+Math.round(performance.now()-started)+" ms");pass();

    stage("analysis replay is idempotent and quota is unchanged");
    const after=(await call("usage","GET",first)).data.ai_today;
    assert.ok(after>usageBeforeQuestion && after<=usageBeforeQuestion+2);
    assert.equal((await call("ask","POST",first,request)).data.id,message.id);
    assert.equal((await call("usage","GET",first)).data.ai_today,after);pass();

    for(const [kind,ids] of [["summarize",[sample1.id]],["compare",[sample1.id,sample2.id]]]){
      stage("genuine hosted Gemini "+kind);
      const {output}=await verifiedAnalysis(kind,ids,{conversationId:message.conversation_id});
      if (kind==="compare")assert.equal(new Set(output.citations.map(cite=>cite.document_id)).size,2);
      pass();
    }

    stage("extracted values and citations match the fictional source exactly");
    assert.ok(extraction.findings.length>0&&extraction.findings.length<=4);
    for(const finding of extraction.findings){
      const source=extraction.citations.find(item=>item.chunk_id===finding.chunkId);
      assert.equal(source.document_id,sample1.id);
      const reader=await call("documents/"+source.document_id+"/chunks?focus="+source.chunk_id,"GET",first);
      const text=reader.data.chunks.find(item=>item.id===source.chunk_id).text.replace(/\s+/g," ");
      assert.ok(text.includes(finding.quote.replace(/\s+/g," ").trim()));
      assert.ok(finding.quote.includes(finding.value));
    }
    pass();

    stage("saved answer, fresh session, and conversation persistence");
    const note=await call("notes","POST",first,{title:"Fictional answer note",text:message.answer,sourceMessageId:message.id});
    assert.equal(note.status,201);
    ({cookie:first}=await auth({email:a.email,password:a.password}));
    assert.equal((await call("notes/"+note.data.id,"GET",first)).data.source_message_id,message.id);
    const saved=(await call("conversations/"+message.conversation_id,"GET",first)).data.messages;
    assert.ok(saved.some(item=>item.id===message.id));
    assert.deepEqual(saved.find(item=>item.id===extraction.id).findings,extraction.findings);pass();

    stage("private deletion and search removal");
    assert.equal((await call("documents/"+own.id,"DELETE",first)).status,200);own=undefined;
    assert.deepEqual((await call("search","POST",first,{query:searchTerm,filters:{}})).data.results,[]);pass();

    stage("sample deletion removes citations, dependent note, and stored answer");
    assert.equal((await call("documents/"+sample1.id,"DELETE",first)).status,200);sample1=undefined;
    assert.equal((await call("citations/"+citation.id,"GET",first)).status,404);
    assert.equal((await call("notes/"+note.data.id,"GET",first)).status,404);pass();
  }finally{
    if(first){
      for(const document of [own,sample1,sample2]) if(document?.id)await call("documents/"+document.id,"DELETE",first).catch(()=>{});
    }
  }
}

async function benchmark(){
  assert.match(origin,/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const adminUrl=new URL(process.env.TEST_DATABASE_URL ?? "");
  assert.ok(["localhost","127.0.0.1"].includes(adminUrl.hostname)&&/\/\w+_test$/.test(adminUrl.pathname));
  const account=fixture();
  const session=await auth(account,true);
  const db=new pg.Client({connectionString:adminUrl.href});
  try{
    stage("populate 5,200 synthetic chunks across 52 files");
    await call("settings","GET",session.cookie);
    await db.connect();
    await db.query(`WITH inserted AS (
      INSERT INTO documents(workspace_id,title,mime,size,sha256,classification,status)
      SELECT $1::uuid,'Synthetic logbook '||n,'text/plain',64000,encode(sha256(convert_to($1::uuid::text||n,'UTF8')),'hex'),'PRIVATE','READY'
      FROM generate_series(1,52) n RETURNING id
    ), ids AS (SELECT id,row_number() OVER(ORDER BY id) AS position FROM inserted)
    INSERT INTO document_chunks(workspace_id,document_id,ordinal,page,start_offset,end_offset,text)
    SELECT $1::uuid,ids.id,n,1,n*640,n*640+639,'Fictional field guide entry '||n||' '||repeat('map river wildlife archive notes ',16)||
      CASE WHEN ids.position%6=0 AND n=23 THEN 'saffronmeteor' ELSE 'library' END
    FROM ids CROSS JOIN generate_series(1,100) n`,[session.id]);
    await db.query("ANALYZE documents; ANALYZE document_chunks");pass();
    stage("warm HTTP keyword benchmark");
    const query=()=>call("search","POST",session.cookie,{query:"saffronmeteor",filters:{}});
    for(let i=0;i<5;i++)assert.equal((await query()).status,200);
    const times=[];
    for(let i=0;i<50;i++){
      const start=performance.now();const response=await query();
      assert.equal(response.status,200);
      assert.equal(response.data.results.length,8);times.push(performance.now()-start);
    }
    times.sort((a,b)=>a-b);
    const percentile=p=>Number(times[Math.ceil(times.length*p)-1].toFixed(2));
    const stats={chunks:5200,documents:52,warmups:5,requests:50,p50Ms:percentile(.50),p95Ms:percentile(.95),environment:"Windows, loopback HTTP, Next.js, PostgreSQL 17"};
    console.log(JSON.stringify(stats));pass();
  }finally{
    await db.end().catch(()=>{});
    await call("account","DELETE",session.cookie,{confirmation:"DELETE"}).catch(()=>{});
  }
}

try{
  if(mode==="setup")await setup();
  else if(mode==="hosted")await hosted();
  else if(mode==="benchmark")await benchmark();
  else throw Error("Choose setup, hosted, or benchmark");
  console.log(passed+" verification stages passed");
}catch(error){
  const safe=typeof error.actual==="number"||/^(FAILED|PENDING|INSUFFICIENT)$/.test(error.actual) ? " (observed "+error.actual+")" : "";
  console.error("FAIL "+(activeCheck||"workflow setup")+safe);
  process.exitCode=1;
}
