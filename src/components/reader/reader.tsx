"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Bookmark, Download, FileText, RotateCw, Sparkles } from "lucide-react";
import { api, locationLabel, mimeLabels, send, useData, type Chunk, type DocumentItem, type Message, type Settings } from "@/components/workspace/client";

export function AnswerCard({ message, open, save }:{message:Message;open:(id:string,chunk:string,quote:string)=>void;save:(message:Message)=>Promise<void>}) {
  const [saved,setSaved]=useState(false);
  const [error,setError]=useState("");
  if (message.state!=="ANSWERED") return <p className="reader-message" role="status">{message.state==="INSUFFICIENT"?"The retrieved passages did not support a verifiable answer.":message.state==="PENDING"?"This request is still running.":"The assistant could not complete this request. Please try again."}</p>;
  return <article className="answer-card"><div className="answer-label"><Sparkles size={15}/> Gemini analysis</div><p>{message.answer}</p>
    {!!message.findings.length&&<ul className="findings">{message.findings.map((item,index)=>{
      const source=message.citations.find(entry=>entry.chunk_id===item.chunkId);
      return <li key={index}><strong>{item.label}</strong> {item.value}{source&&<button onClick={()=>open(source.document_id,source.chunk_id,item.quote)} className="source-link">Open source</button>}</li>;
    })}</ul>}
    <div className="citation-list">{message.citations.map((item,index)=><button key={item.id} onClick={()=>open(item.document_id,item.chunk_id,item.quote)} className="citation-chip">
      <span>{index+1}</span><span><strong>{locationLabel(item)}</strong><small>“{item.quote}”</small></span></button>)}</div>
    {error&&<p role="alert" className="status-error">{error}</p>}
    <button className="btn quiet" onClick={()=>void save(message).then(()=>setSaved(true),error=>setError(error.message))} disabled={saved}><Bookmark size={16}/>{saved?"Answer saved":"Save as note"}</button>
  </article>;
}

function Highlight({text,focus}:{text:string;focus:string}) {
  if (!focus) return <>{text}</>;
  const normalized=focus.trim().split(/\s+/).filter(Boolean);
  const escaped=(word:string)=>Array.from(word).map(letter=>"\\^$.*+?()[]{}|".includes(letter)?"\\"+letter:letter).join("");
  const phrase=normalized.map(escaped).join("\\s+");
  const terms=normalized.flatMap(word=>word.match(/[\p{L}\p{N}]+/gu)??[]).sort((a,b)=>b.length-a.length).slice(0,12).map(escaped).join("|");
  const pattern=phrase && new RegExp(phrase,"iu").test(text) ? phrase:terms;
  if (!pattern) return <>{text}</>;
  let cursor=0;
  const parts=[];
  for (const match of text.matchAll(new RegExp(pattern,"giu"))) {
    parts.push(<span key={"t"+match.index}>{text.slice(cursor,match.index)}</span>,<mark key={"m"+match.index}>{match[0]}</mark>);
    cursor=match.index+match[0].length;
  }
  return <>{parts}{text.slice(cursor)}</>;
}

export function Reader({id,focus,highlight,revision,settings,samples,back,go,changed,save,edit}:{
  id:string;focus:string;highlight:string;revision:number;settings?:Settings;samples:DocumentItem[];back:()=>void;go:(id:string,chunk:string,quote:string)=>void;changed:()=>void;
  save:(message:Message)=>Promise<void>;edit:(doc:DocumentItem)=>void
}) {
  const [version,setVersion]=useState(0);
  const [extra,setExtra]=useState<{focus:string;chunks:Chunk[];next:number|null}|null>(null);
  const [message,setMessage]=useState<Message|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [operation,setOperation]=useState("ask");
  const [pane,setPane]=useState("source");
  const [marks,setMarks]=useState<Record<string,boolean>>({});
  const [conversation,setConversation]=useState("");
  const main=useRef<HTMLElement>(null);
  const item=useData<DocumentItem>("documents/"+id,version+revision);
  const parts=useData<{chunks:Chunk[];next:number|null}>("documents/"+id+"/chunks"+(focus?"?focus="+encodeURIComponent(focus):""),version);
  const doc=item?.data;
  const currentExtra=extra?.focus===focus ? extra:null;
  const list=[...(parts?.data?.chunks??[]),...(currentExtra?.chunks??[])];
  const next=currentExtra ? currentExtra.next:parts?.data?.next;
  const ready=parts?.data;
  useEffect(()=>{void send("documents/"+id,"PATCH",{viewed:true}).catch(()=>{});},[id]);
  useEffect(()=>{
    if (focus && ready) {
      const node=document.getElementById("passage-"+focus);
      node?.scrollIntoView({block:"start"});
      node?.focus({preventScroll:true});
    }
  },[focus,ready]);
  const noteError=item?.error || parts?.error;
  async function run(action:()=>Promise<void>) {
    setBusy(true);setNotice("");
    try {await action();} catch (error) {setNotice((error as Error).message);} finally {setBusy(false);}
  }
  function analyze(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    void run(async()=>{
      const other=data.get("other");
      const result=await send<Message>(operation,"POST",{documentIds:other?[id,other]:[id],prompt:data.get("prompt")??"hours",
        ...(conversation?{conversationId:conversation}:{}),idempotencyKey:crypto.randomUUID(),allowExternalNonSensitive:data.has("allow"),attestEligibility:data.has("attest")});
      setMessage(result);setConversation(result.conversation_id);changed();
    });
  }
  return <div className="reader">
    <div className="reader-top"><button className="btn quiet" onClick={back}><ArrowLeft size={17}/> Library</button>
      <div>{doc&&<><button className="btn quiet" onClick={()=>edit(doc)}>Details</button>{doc.status==="READY"&&<a className="btn" href={"/api/documents/"+id+"/content"}><Download size={16}/> Original</a>}</>}</div></div>
    {noteError&&<p role="alert" className="status-error">{noteError}</p>}
    {notice&&<p role="status" className="status-error">{notice}</p>}
    {!doc&&!noteError&&<p role="status">Opening document…</p>}
    {doc&&<>
      <header className="reader-title"><span className="file-icon"><FileText size={21}/></span><div><p>{mimeLabels[doc.mime]} · {doc.classification==="SYNTHETIC"?"Fictional guide":"Private file"}</p><h1>{doc.title}</h1></div></header>
      {doc.status!=="READY" ? <div className="empty-panel"><h2>{doc.status==="FAILED"?"Indexing couldn’t finish":"Waiting to index"}</h2>
        <p>{doc.error_code==="NO_TEXT"?"No searchable text was found. Scanned files need OCR before upload.":doc.error_code?"This file could not be read within Docmivo’s processing limits.":"Use Retry indexing to continue processing."}</p>
        {(doc.attempts??0)<3&&<button disabled={busy} className="btn primary" onClick={()=>void run(async()=>{await send("documents/"+id+"/retry","POST");setVersion(v=>v+1);changed();})}><RotateCw size={16}/> Retry indexing</button>}</div>
        :<><div className="reader-tabs"><button className={pane==="source"?"active":""} onClick={()=>setPane("source")}>Source</button><button className={pane==="analysis"?"active":""} onClick={()=>setPane("analysis")}>Analysis</button></div>
        <div className="reader-layout" data-pane={pane}>
          <nav className="reader-outline" aria-label="Document outline"><h2>In this view</h2>{list.filter((chunk,index)=>index===0||locationLabel(chunk)!==locationLabel(list[index-1])).map(chunk=><a key={chunk.id} href={"#passage-"+chunk.id}>{locationLabel(chunk)}</a>)}</nav>
          <section className="reader-paper" aria-label="Extracted document text" ref={main}>
            {!list.length&&<p role="status">Loading indexed passages…</p>}
            {list.map(chunk=>{
              const bookmarked=marks[chunk.id]??chunk.bookmarked;
              return <article id={"passage-"+chunk.id} key={chunk.id} tabIndex={-1} className={chunk.id===focus?"passage target":"passage"}>
                <header><span>{locationLabel(chunk)} <span className="muted">· Passage {chunk.ordinal+1}</span></span>
                  <button className={bookmarked?"icon-btn marked":"icon-btn"} aria-label={bookmarked?"Remove bookmark":"Bookmark passage"} aria-pressed={bookmarked} disabled={busy}
                    onClick={()=>void run(async()=>{await send("bookmarks/"+chunk.id,bookmarked?"DELETE":"PUT");setMarks(previous=>({...previous,[chunk.id]:!bookmarked}));changed();})}><Bookmark size={17}/></button></header>
                <p><Highlight text={chunk.text} focus={chunk.id===focus?highlight:""} /></p>
              </article>;
            })}
            {focus&&<button className="btn quiet" onClick={()=>go(id,"","")}>Start of document</button>}
            {next!==undefined&&next!==null&&<button className="btn quiet" disabled={busy} onClick={()=>void run(async()=>{const data=await api<{chunks:Chunk[];next:number|null}>("documents/"+id+"/chunks?after="+next);setExtra({focus,chunks:[...(currentExtra?.chunks??[]),...data.chunks],next:data.next});})}>Load more passages</button>}
          </section>
          <aside className="analysis-panel">
            <h2><Sparkles size={18}/> Analysis</h2>
            {doc.classification==="PRIVATE"?<p>Private documents use indexed search. Only built-in fictional guides can be analyzed with external AI.</p>
            :!settings?.ai?<p>Gemini analysis is available to authorized, eligible testers.</p>
            :<form className="analysis-form" onSubmit={analyze}>
              <label>Task<select value={operation} onChange={e=>setOperation(e.target.value)}><option value="ask">Ask a question</option><option value="summarize">Summarize</option><option value="extract">Extract dates and actions</option><option value="compare" disabled={!samples.some(item=>item.id!==id)}>Compare two guides</option></select></label>
              {operation==="ask"&&<label>Question<select name="prompt"><option value="hours">When is the reading room open?</option><option value="policy">What are the collection rules?</option><option value="dates">What dates and actions are listed?</option></select></label>}
              {operation==="compare"&&<label>Second guide<select name="other" required>{samples.filter(item=>item.id!==id).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
              <p>Google may review unpaid requests and use them to improve its services.</p>
              <label className="consent"><input type="checkbox" name="allow" required/> Send the fictional excerpts and preset question to Gemini for this request.</label>
              <label className="consent"><input type="checkbox" name="attest" required/> I’m 18 or older and testing for a professional purpose in an eligible region.</label>
              <button className="btn primary" disabled={busy}><Sparkles size={16}/>{busy?"Requesting…":"Run analysis"}</button>
            </form>}
            {message&&<AnswerCard key={message.id} message={message} open={(id,chunk,quote)=>{setPane("source");go(id,chunk,quote);}} save={save}/>}
          </aside>
        </div></>}
    </>}
  </div>;
}
