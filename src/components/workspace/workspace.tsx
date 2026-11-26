"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowDownToLine, ArrowUpRight, Bookmark, ChevronDown, Clock3, FileText, Folder, Grid2X2, LibraryBig, List, LogOut, Menu, MessageSquare, Plus, Search, Settings2, ShieldCheck, Star, StickyNote, Tag, UploadCloud, X } from "lucide-react";
import { FilterFields, SearchPalette } from "@/components/search/palette";
import { AnswerCard, Reader } from "@/components/reader/reader";
import { api, dateLabel, locationLabel, mimeLabels, queryString, send, sizeLabel, useData, type Conversation, type DocumentItem, type DocumentList, type Filter, type Item, type Message, type Note, type SavedSearch, type SearchHit, type Settings } from "./client";

type Nav = "library"|"recent"|"favorites"|"bookmarks"|"notes"|"saved"|"history"|"settings";
const sections = [
  ["library","Library",LibraryBig],["recent","Recent",Clock3],["favorites","Favorites",Star],["bookmarks","Bookmarks",Bookmark],
  ["notes","Notes",StickyNote],["saved","Saved searches",Search],["history","Conversations",MessageSquare],["settings","Settings",Settings2]
] as const;
const labels = Object.fromEntries(sections.map(([key,text])=>[key,text])) as Record<Nav,string>;

function Dialog({ title,close,children }:{title:string;close:()=>void;children:ReactNode}) {
  const element=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=element.current, previous=document.activeElement as HTMLElement|null;
    dialog?.showModal();
    return ()=>{dialog?.close();previous?.focus();};
  },[]);
  return <dialog ref={element} className="edit-dialog" aria-label={title} onCancel={event=>{event.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}>
    <div className="edit-dialog-content"><header><h2>{title}</h2><button type="button" className="icon-btn" aria-label="Close dialog" onClick={close}><X size={20}/></button></header>{children}</div>
  </dialog>;
}

type Mode = {kind:"upload"}|{kind:"document";doc:DocumentItem}|{kind:"catalog";type:"folders"|"tags";item?:Item}|{kind:"note";note?:Note}|{kind:"samples"}|{kind:"deleteAccount"}|{kind:"conversation";item:Conversation};
type SavedBookmark={chunk_id:string;document_id:string;title:string;page:number|null;section:string|null;preview:string};
const failureText:Record<string,string>={NO_TEXT:"No searchable text",PARSE_TIMEOUT:"Processing timed out",INVALID_TEXT:"Invalid text encoding",INVALID_DOCX:"Unsupported Word file",PDF_PAGE_LIMIT:"Page limit exceeded"};
const docIcon=(item:DocumentItem)=> <span className={"file-icon "+(item.mime==="application/pdf"?"file-pdf":"")}><FileText size={19}/></span>;

export function Workspace({ name }:{name:string}) {
  const router=useRouter(),params=useSearchParams();
  const [view,setView]=useState<Nav>("library");
  const [filters,setFilters]=useState<Filter>({});
  const [epoch,setEpoch]=useState(0);
  const [dialog,setDialog]=useState<Mode|null>(null);
  const [search,setSearch]=useState<{query:string;filters:Filter}|null>(null);
  const [notification,setNotification]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [moreDocs,setMoreDocs]=useState<{path:string;docs:DocumentItem[];cursor:string|null}|null>(null);
  const [layout,setLayout]=useState("list");
  const [mobileNav,setMobileNav]=useState(false);
  const [file,setFile]=useState<File|null>(null);
  const [uploadKey,setUploadKey]=useState("");
  const [highlight,setHighlight]=useState("");
  const [thread,setThread]=useState<string|null>(null);
  const [expandedFolder,setExpandedFolder]=useState(true);
  const [pendingNote,setPendingNote]=useState<string|null>(null);
  const docId=params.get("doc");
  const focus=params.get("source") ?? "";
  const folderList=useData<Item[]>("folders",epoch)?.data ?? [];
  const tagList=useData<Item[]>("tags",epoch)?.data ?? [];
  const account=useData<Settings>("settings",epoch);
  const path="documents?"+queryString({...filters,...(view==="favorites"?{favorite:true}:{})}).toString()+(view==="recent"?"&recent=true":"");
  const documentList=useData<DocumentList>(["library","recent","favorites"].includes(view)&&!docId?path:null,epoch);
  const noteList=useData<Note[]>(view==="notes"?"notes":null,epoch);
  const bookmarked=useData<SavedBookmark[]>(view==="bookmarks"?"bookmarks":null,epoch);
  const saved=useData<SavedSearch[]>(view==="saved"?"saved-searches":null,epoch);
  const history=useData<Conversation[]>(view==="history"?"conversations":null,epoch);
  const conversation=useData<Conversation>(thread&&view==="history"?"conversations/"+thread:null,epoch);
  const samples=useData<DocumentList>(docId&&account?.data?.ai?"documents?type=text%2Fmarkdown":null,epoch)?.data?.documents.filter(item=>item.classification==="SYNTHETIC"&&item.status==="READY") ?? [];
  const activity=useData<{id:string;action:string;created_at:string}[]>(view==="settings"?"activity":null,epoch);
  const admin=useData<{database:string;analysisToday:number}>(view==="settings"&&account?.data?.admin?"admin/health":null,epoch);
  const activeAdditional=moreDocs?.path===path ? moreDocs : null;
  const visibleDocs=[...(documentList?.data?.documents??[]),...(activeAdditional?.docs??[])];
  const next=activeAdditional ? activeAdditional.cursor:documentList?.data?.nextCursor;
  const refresh=()=>{setMoreDocs(null);setEpoch(value=>value+1);};
  function launch(mode:Mode) {setError("");setFile(null);setUploadKey(crypto.randomUUID());setDialog(mode);}
  function closeDialog() {setDialog(null);setError("");}
  function changeFilters(next:Filter) {setMoreDocs(null);setFilters(next);}
  function choose(tab:Nav) {
    setView(tab);setMobileNav(false);changeFilters({});setError("");if(docId)router.push("/workspace");
  }
  function openDocument(id:string,chunk="",quote="") {
    setHighlight(quote);
    router.push("/workspace?"+new URLSearchParams({doc:id,...(chunk?{source:chunk}:{})}).toString(),{scroll:false});
  }
  useEffect(()=>{
    function shortcut(event:KeyboardEvent) {
      if ((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"&&!dialog) {
        event.preventDefault();setSearch(current=>current?null:{query:"",filters});
      }
    }
    window.addEventListener("keydown",shortcut);
    return ()=>window.removeEventListener("keydown",shortcut);
  },[dialog,filters]);
  useEffect(()=>{
    if (!pendingNote) return;
    const target=noteList?.data?.find(note=>note.id===pendingNote);
    if (!target) return;
    const timer=setTimeout(()=>setDialog({kind:"note",note:target}),0);
    return ()=>clearTimeout(timer);
  },[pendingNote,noteList?.data]);
  async function action(run:()=>Promise<void>,success?:string,extend=false) {
    setBusy(true);setError("");setNotification("");
    try {await run(); if (success)setNotification(success);if (!extend)refresh();}
    catch (problem) {setError((problem as Error).message);}
    finally {setBusy(false);}
  }
  function openHit(hit:SearchHit,query:string) {
    setSearch(null);
    if (hit.documentId) openDocument(hit.documentId,hit.chunkId??"",query.trim());
    else {choose("notes");setPendingNote(hit.key);}
  }
  async function saveAnswer(message:Message) {
    await send("notes","POST",{title:message.question,text:message.answer,sourceMessageId:message.id});
    refresh();setNotification("Answer saved to Notes.");
  }
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    const data=new FormData(event.currentTarget);
    void action(async()=>{
      if (dialog.kind==="upload") {
        if (!file) throw new Error("Choose a file to upload.");
        const form=new FormData();form.set("file",file);
        const item=await api<{id:string;status:string}>("documents",{method:"POST",headers:{"Idempotency-Key":uploadKey},body:form});
        openDocument(item.id);setNotification(item.status==="READY"?"Document indexed.":"The document was saved. Open it to check indexing status.");
      } else if (dialog.kind==="document") {
        await send("documents/"+dialog.doc.id,"PATCH",{title:data.get("title"),folderId:data.get("folder")||null,tagIds:data.getAll("tag")});
      } else if (dialog.kind==="catalog") {
        await send(dialog.type+(dialog.item?"/"+dialog.item.id:""),dialog.item?"PATCH":"POST",{name:data.get("name")});
      } else if (dialog.kind==="note") {
        await send("notes"+(dialog.note?"/"+dialog.note.id:""),dialog.note?"PATCH":"POST",{title:data.get("title"),text:data.get("text")});
        setPendingNote(null);
      } else if (dialog.kind==="samples") {
        const item=await send<{id:string}>("samples","POST",{key:data.get("sample")});
        openDocument(item.id);
      } else if (dialog.kind==="deleteAccount") {
        await send("account","DELETE",{confirmation:data.get("confirmation")});
        router.replace("/");
        router.refresh();
      } else if (dialog.kind==="conversation") {
        await send("conversations/"+dialog.item.id,"PATCH",{title:data.get("title")});
      }
      closeDialog();
    });
  }
  function remove() {
    if (!dialog) return;
    let endpoint="";
    if (dialog.kind==="document") endpoint="documents/"+dialog.doc.id;
    if (dialog.kind==="catalog"&&dialog.item) endpoint=dialog.type+"/"+dialog.item.id;
    if (dialog.kind==="note"&&dialog.note) endpoint="notes/"+dialog.note.id;
    if (dialog.kind==="conversation") endpoint="conversations/"+dialog.item.id;
    if (!endpoint || !window.confirm("Delete this item from your workspace?")) return;
    void action(async()=>{
      await send(endpoint,"DELETE");
      if(dialog.kind==="document"&&docId===dialog.doc.id)router.push("/workspace");
      if(dialog.kind==="note")setPendingNote(null);
      if(dialog.kind==="conversation")setThread(null);
      closeDialog();
    },"Item deleted.");
  }
  function exportNote(note:Note) {
    const href=URL.createObjectURL(new Blob(["# "+note.title+"\n\n"+note.text+"\n"],{type:"text/markdown"}));
    const anchor=document.createElement("a");anchor.href=href;anchor.download="docmivo-note.md";anchor.click();
    setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  async function signOut() {
    setError("");
    try {
      const response=await fetch("/api/auth/sign-out",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      if (!response.ok) throw Error("Sign-out did not finish. Please try again.");
      router.replace("/sign-in");
      router.refresh();
    } catch (failure) {setError((failure as Error).message);}
  }
  const collection=(key:"folders"|"tags",items:Item[])=> <div className="side-collection">
    <div className="side-group"><button className="side-heading" onClick={()=>key==="folders"&&setExpandedFolder(!expandedFolder)} disabled={key==="tags"}>{key==="folders"&&<ChevronDown size={12}/>} {key==="folders"?"FOLDERS":"TAGS"}</button><button className="icon-btn" aria-label={"Create "+(key==="folders"?"folder":"tag")} onClick={()=>launch({kind:"catalog",type:key})}><Plus size={16}/></button></div>
    {(key==="tags"||expandedFolder)&&items.map(item=><div className="category-row" key={item.id}>
      <button className="side-link" aria-pressed={filters[key==="folders"?"folder":"tag"]===item.id} onClick={()=>{choose("library");changeFilters({[key==="folders"?"folder":"tag"]:item.id});}}>
        {key==="folders"?<Folder size={17}/>:<Tag size={16}/>}<span>{item.name}</span></button><button className="icon-btn edit-category" aria-label={"Manage "+item.name} onClick={()=>launch({kind:"catalog",type:key,item})}>···</button></div>)}
  </div>;
  const isLibrary=["library","favorites","recent"].includes(view);
  const alert=error&&!dialog?error:documentList?.error||noteList?.error||bookmarked?.error||saved?.error||history?.error||conversation?.error||(view==="settings"?account?.error||activity?.error:null);
  return <div className="workspace">
    <aside className={"workspace-side "+(mobileNav?"visible":"")}>
      <div className="workspace-brand"><Link href="/" className="brand"><Image alt="" src="/brand/mark.svg" width={30} height={30}/><span>docmivo<span>.</span></span></Link><button className="icon-btn mobile-menu" aria-label="Close menu" onClick={()=>setMobileNav(false)}><X size={20}/></button></div>
      <div className="side-workspace"><div className="workspace-initial">{name.trim().slice(0,1).toUpperCase()}</div><div><strong>My workspace</strong><small>Personal library</small></div></div>
      <nav aria-label="Workspace navigation"><div className="side-nav-title">WORKSPACE</div>{sections.map(([key,title,Icon])=><button key={key} className="side-link" aria-current={!docId&&view===key?"page":undefined} onClick={()=>choose(key)}><Icon size={17}/><span>{title}</span></button>)}</nav>
      {collection("folders",folderList)}{collection("tags",tagList)}
      <div className="side-account"><div><strong>{name}</strong><small>Signed in</small></div><button className="icon-btn" aria-label="Sign out" onClick={()=>void signOut()}><LogOut size={18}/></button></div>
    </aside>
    {mobileNav&&<button aria-label="Close navigation" className="nav-backdrop" onClick={()=>setMobileNav(false)}/>}
    <div className="workspace-body">
      <header className="workspace-top"><div><button className="icon-btn mobile-menu" aria-label="Open navigation" onClick={()=>setMobileNav(true)}><Menu size={23}/></button><span className="workspace-breadcrumb">Workspace <span>/</span> {docId?"Reader":labels[view]}</span></div>
        <button className="workspace-search" onClick={()=>setSearch({query:"",filters})}><Search size={18}/><span>Search workspace</span><kbd>Ctrl / ⌘ K</kbd></button>
        <button className="btn primary" onClick={()=>launch({kind:"upload"})}><Plus size={17}/><span>Upload</span></button>
      </header>
      <main id="main" className={docId?"workspace-main reader-main":"workspace-main"}>
        {alert&&<p className="status-error" role="alert">{alert}</p>}
        {notification&&<div className="notice" role="status">{notification}<button className="icon-btn" aria-label="Dismiss notification" onClick={()=>setNotification("")}><X size={15}/></button></div>}
        {docId?<Reader key={docId} id={docId} focus={focus} highlight={highlight} revision={epoch} settings={account?.data} samples={samples} back={()=>choose("library")} go={openDocument} changed={refresh} save={saveAnswer} edit={doc=>launch({kind:"document",doc})}/>
        :<>
          <div className="workspace-heading"><div><span className="section-label">MY WORKSPACE</span><h1>{labels[view]}</h1><p>{
            view==="library"?"Upload, organize, and search your documents.":view==="recent"?"Documents you’ve opened recently.":view==="favorites"?"Keep frequently used documents close.":view==="settings"?"Manage your data, privacy, and account.":view==="history"?"Review and manage saved analysis threads.":view==="saved"?"Rerun the searches you come back to.":view==="notes"?"Keep your research notes and saved answers.":"Return to the passages you’ve marked."}</p></div>
          {view==="notes"&&<button className="btn primary" onClick={()=>launch({kind:"note"})}><Plus size={17}/> New note</button>}
          {isLibrary&&<button className="btn" onClick={()=>launch({kind:"samples"})}><FileText size={16}/> Import a fictional guide</button>}</div>
          {isLibrary&&<>
            <div className="library-tools"><FilterFields filters={filters} folders={folderList} tags={tagList} onChange={changeFilters}/><div className="view-switch"><button className="icon-btn" aria-label="List view" aria-pressed={layout==="list"} onClick={()=>setLayout("list")}><List size={18}/></button><button className="icon-btn" aria-label="Grid view" aria-pressed={layout==="grid"} onClick={()=>setLayout("grid")}><Grid2X2 size={17}/></button></div></div>
            {!documentList&&!alert&&<p role="status" className="workspace-wait">Loading documents…</p>}
            {documentList?.data&&!visibleDocs.length&&<div className="empty-panel library-empty"><div className="empty-mark"><LibraryBig size={32} strokeWidth={1.35}/></div><h2>{view==="library"?"No documents here yet.":view==="favorites"?"No favorites yet.":"No recently opened documents."}</h2>
              <p>{Object.values(filters).some(Boolean)?"Clear a filter to see more files.":view==="library"?"Upload a document to make its text searchable.":"Open or star a document from your library."}</p>
              {view==="library"&&<button className="btn primary" onClick={()=>launch({kind:"upload"})}><UploadCloud size={17}/> Upload a document</button>}</div>}
            {!!visibleDocs.length&&<div className={"document-list "+(layout==="grid"?"document-grid":"")}>
              {layout==="list"&&<div className="doc-columns" aria-hidden="true"><span>Document</span><span>Status</span><span>Updated</span><span /></div>}
              {visibleDocs.map(doc=><article className="doc-row" key={doc.id}><button className="doc-name" onClick={()=>openDocument(doc.id)}>{docIcon(doc)}<span><strong>{doc.title}</strong><small>{mimeLabels[doc.mime]} · {sizeLabel(doc.size)} · {doc.classification==="SYNTHETIC"?"Fictional guide":"Private"}</small>{!!doc.tags.length&&<small>{doc.tags.map(tag=>tag.name).join(" · ")}</small>}</span></button>
                <span className={"doc-status "+doc.status.toLowerCase()} title={failureText[doc.error_code??""]}>{doc.status==="READY"?"Indexed":doc.status==="FAILED"?"Failed":doc.status==="PARSING"?"Indexing":"Queued"}</span>
                <span className="doc-date">{dateLabel(doc.updated_at)}</span>
                <div className="doc-actions"><button className={"icon-btn "+(doc.favorite?"marked":"")} aria-label={doc.favorite?"Remove favorite":"Add favorite"} aria-pressed={doc.favorite} disabled={busy} onClick={()=>void action(async()=>{await send("documents/"+doc.id,"PATCH",{favorite:!doc.favorite});})}><Star size={18}/></button><button className="icon-btn" aria-label={"Manage "+doc.title} onClick={()=>launch({kind:"document",doc})}>···</button></div></article>)}
            </div>}
            {next&&<button className="btn more-docs" disabled={busy} onClick={()=>void action(async()=>{const data=await api<DocumentList>(path+"&cursor="+next);setMoreDocs({path,docs:[...(activeAdditional?.docs??[]),...data.documents],cursor:data.nextCursor});},undefined,true)}>More documents <ArrowDown size={16}/></button>}
          </>}
          {view==="bookmarks"&&<div className="record-list">{bookmarked?.data?.length===0&&<p className="record-empty">Bookmark a passage in the reader to see it here.</p>}{bookmarked?.data?.map(item=><article key={item.chunk_id}><Bookmark size={19}/><button onClick={()=>openDocument(item.document_id,item.chunk_id)}><strong>{item.title}</strong><small>{locationLabel(item)} · {item.preview}</small></button><button className="icon-btn" aria-label="Remove bookmark" onClick={()=>void action(async()=>{await send("bookmarks/"+item.chunk_id,"DELETE");})}><X size={17}/></button></article>)}</div>}
          {view==="saved"&&<div className="record-list">{saved?.data?.length===0&&<p className="record-empty">Save a query from the search window.</p>}{saved?.data?.map(item=><article key={item.id}><Search size={19}/><button onClick={()=>setSearch({query:item.query,filters:item.filters})}><strong>{item.query}</strong><small>Run saved search</small></button><button className="icon-btn" aria-label="Delete saved search" onClick={()=>void action(async()=>{await send("saved-searches/"+item.id,"DELETE");})}><X size={17}/></button></article>)}</div>}
          {view==="notes"&&<div className="record-list">{noteList?.data?.length===0&&<p className="record-empty">Your notes and saved answers will appear here.</p>}{noteList?.data?.map(note=><article key={note.id}><StickyNote size={19}/><button onClick={()=>{setPendingNote(null);launch({kind:"note",note});}}><strong>{note.title}</strong><small>{note.source_message_id?"Saved analysis · ":""}{note.text.slice(0,132)}</small></button><button className="icon-btn" aria-label={"Export "+note.title} onClick={()=>exportNote(note)}><ArrowDownToLine size={17}/></button></article>)}</div>}
          {view==="history"&&<div className="history-columns"><div className="record-list">{history?.data?.length===0&&<p className="record-empty">Completed fictional guide analysis will appear here.</p>}{history?.data?.map(item=><article key={item.id}><MessageSquare size={19}/><button onClick={()=>setThread(item.id)} aria-pressed={thread===item.id}><strong>{item.title}</strong><small>{dateLabel(item.created_at)}</small></button><button className="icon-btn" aria-label={"Manage "+item.title} onClick={()=>launch({kind:"conversation",item})}>···</button></article>)}</div>
            {conversation?.data&&<div className="history-detail"><h2>{conversation.data.title}</h2>{conversation.data.messages?.map(message=><AnswerCard key={message.id} message={message} open={openDocument} save={saveAnswer}/>)}</div>}</div>}
          {view==="settings"&&<div className="settings-grid">
            <section><h2><ShieldCheck size={22}/> Privacy & usage</h2><p>Uploaded files remain private. External analysis uses only the built-in fictional guides when the current account is eligible.</p>
              {account?.data&&<dl><div><dt>Storage</dt><dd>{account.data.bytes?sizeLabel(account.data.bytes):"0 B"} / {sizeLabel(account.data.maxBytes)}</dd></div><div><dt>Documents</dt><dd>{account.data.documents}</dd></div><div><dt>Analysis today</dt><dd>{account.data.ai?account.data.ai_today+" / "+account.data.quota:"Unavailable for this account"}</dd></div></dl>}</section>
            <section><h2><Settings2 size={22}/> Account</h2><p>{account?.data?.user.email ?? name}</p><div className="settings-actions"><button className="btn" onClick={()=>void signOut()}><LogOut size={16}/> Sign out</button><button className="btn danger" onClick={()=>launch({kind:"deleteAccount"})}>Delete account</button></div></section>
            <section><h2><Clock3 size={22}/> Recent activity</h2>{activity?.data?.length===0&&<p>No activity yet.</p>}{activity?.data&&<ul>{activity.data.map(item=><li key={item.id}>{item.action.replaceAll("."," ").replaceAll("_"," ")} <small>{dateLabel(item.created_at)}</small></li>)}</ul>}</section>
            {admin?.data&&<section><h2>Service health</h2><p>Database reachable. {admin.data.analysisToday} analysis requests reserved today.</p></section>}
          </div>}
        </>}
      </main>
    </div>
    {search&&<SearchPalette close={()=>setSearch(null)} navigate={openHit} folders={folderList} tags={tagList} initialQuery={search.query} initialFilters={search.filters} saved={refresh}/>}
    {dialog&&<Dialog title={dialog.kind==="upload"?"Upload a document":dialog.kind==="document"?"Document details":dialog.kind==="catalog"?(dialog.item?"Manage ":"New ")+(dialog.type==="folders"?"folder":"tag"):dialog.kind==="note"?(dialog.note?"Edit note":"New note"):dialog.kind==="samples"?"Import a fictional guide":dialog.kind==="conversation"?"Manage conversation":"Delete account"} close={()=>{if(!busy){setPendingNote(null);closeDialog();}}}>
      <form onSubmit={submit} className="edit-form">
        {dialog.kind==="upload"&&<><label className="drop-zone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();setFile(e.dataTransfer.files[0]??null);setUploadKey(crypto.randomUUID());}}><UploadCloud size={29}/><strong>{file?file.name:"Choose a file or drop it here"}</strong><small>PDF, DOCX, Markdown, or TXT · Up to 2 MiB</small><input aria-label="Document file" type="file" accept=".pdf,.docx,.md,.txt" onChange={e=>{setFile(e.target.files?.[0]??null);setUploadKey(crypto.randomUUID());}}/></label><p className="privacy-note"><ShieldCheck size={17}/> New uploads are private.</p></>}
        {dialog.kind==="document"&&<><label>Title<input name="title" required maxLength={180} defaultValue={dialog.doc.title}/></label><label>Folder<select name="folder" defaultValue={dialog.doc.folder_id??""}><option value="">No folder</option>{folderList.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{!!tagList.length&&<fieldset><legend>Tags</legend>{tagList.map(item=><label className="consent" key={item.id}><input type="checkbox" name="tag" value={item.id} defaultChecked={dialog.doc.tags.some(tag=>tag.id===item.id)}/>{item.name}</label>)}</fieldset>}</>}
        {dialog.kind==="catalog"&&<label>Name<input name="name" required maxLength={80} defaultValue={dialog.item?.name}/></label>}
        {dialog.kind==="note"&&<><label>Title<input name="title" required maxLength={180} defaultValue={dialog.note?.title}/></label><label>Note<textarea name="text" required maxLength={8000} rows={7} defaultValue={dialog.note?.text}/></label></>}
        {dialog.kind==="samples"&&<><label>Guide<select name="sample"><option value="field-guide-01">The Alder Observatory</option><option value="field-guide-02">Juniper Archive</option></select></label><p className="muted">These guides contain fictional data for exploring search and source navigation.</p></>}
        {dialog.kind==="conversation"&&<label>Title<input name="title" maxLength={180} defaultValue={dialog.item.title} required/></label>}
        {dialog.kind==="deleteAccount"&&<><p>This permanently deletes your account, files, notes, and saved analysis from the workspace.</p><label>Type DELETE to confirm<input name="confirmation" required pattern="DELETE" autoComplete="off"/></label></>}
        {error&&<p className="status-error" role="alert">{error}</p>}
        <div className="edit-footer">
          {(dialog.kind==="document"||dialog.kind==="catalog"&&dialog.item||dialog.kind==="note"&&dialog.note||dialog.kind==="conversation")&&<button type="button" className="btn quiet danger" onClick={remove} disabled={busy}>Delete</button>}
          <button type="submit" className="btn primary" disabled={busy||dialog.kind==="upload"&&!file}>{busy?"Working…":dialog.kind==="upload"?"Upload and index":dialog.kind==="samples"?"Import guide":dialog.kind==="deleteAccount"?"Delete account":"Save"}</button>
        </div>
      </form>
    </Dialog>}
    <a className="sr-only" href="/security">Security and privacy <ArrowUpRight size={12}/></a>
  </div>;
}
