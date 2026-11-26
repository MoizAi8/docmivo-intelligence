"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, BookmarkPlus, FileText, Search, X } from "lucide-react";
import { api, locationLabel, mimeLabels, send, type Filter, type Item, type SearchHit } from "@/components/workspace/client";

export function FilterFields({ filters,onChange,folders,tags,search=false }:{filters:Filter;onChange:(filters:Filter)=>void;folders:Item[];tags:Item[];search?:boolean}) {
  return <div className="filter-row">
    <select aria-label="File format" value={filters.type ?? ""} onChange={e=>onChange({...filters,type:e.target.value||undefined})}><option value="">All formats</option>{Object.entries(mimeLabels).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
    <select aria-label="Filter by folder" value={filters.folder ?? ""} onChange={e=>onChange({...filters,folder:e.target.value||undefined})}><option value="">All folders</option>{folders.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
    <select aria-label="Filter by tag" value={filters.tag ?? ""} onChange={e=>onChange({...filters,tag:e.target.value||undefined})}><option value="">All tags</option>{tags.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
    {search&&<><label className="filter-date">From <input type="date" aria-label="Uploaded on or after" value={filters.after ?? ""} onChange={e=>onChange({...filters,after:e.target.value||undefined})} /></label>
    <label className="filter-check"><input type="checkbox" checked={!!filters.favorite} onChange={e=>onChange({...filters,favorite:e.target.checked})} /> Favorites</label></>}
  </div>;
}

export function SearchPalette({ close, navigate, folders, tags, initialQuery, initialFilters, saved }:{
  close:()=>void; navigate:(hit:SearchHit,query:string)=>void; folders:Item[];tags:Item[];initialQuery:string;initialFilters:Filter;saved:()=>void
}) {
  const [query,setQuery]=useState(initialQuery);
  const [filters,setFilters]=useState(initialFilters);
  const [rows,setRows]=useState<SearchHit[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [active,setActive]=useState(0);
  const [feedback,setFeedback]=useState("");
  const [completed,setCompleted]=useState("");
  const dialog=useRef<HTMLDialogElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const controller=useRef<AbortController>(null);
  const payload=JSON.stringify({query:query.trim(),filters});
  const busy=!!query.trim() && completed!==payload;
  useEffect(()=>{
    const element=dialog.current;
    const trigger=document.activeElement as HTMLElement | null;
    element?.showModal();
    input.current?.focus();
    return ()=>{element?.close();trigger?.focus();controller.current?.abort();};
  },[]);
  useEffect(()=>{
    if (!query.trim()) return;
    const pending=new AbortController();
    controller.current=pending;
    const timer=setTimeout(()=>{
      api<{results:SearchHit[];nextCursor:string|null}>("search",{signal:pending.signal,method:"POST",headers:{"Content-Type":"application/json"},body:payload}).then(data=>{
        if (pending.signal.aborted) return;
        setRows(data.results);setCursor(data.nextCursor);setActive(0);setCompleted(payload);setFeedback("");
      },error=>{if (!pending.signal.aborted) {setRows([]);setFeedback(error.message);setCompleted(payload);}});
    },180);
    return ()=>{clearTimeout(timer);pending.abort();};
  },[payload,query]);
  async function more() {
    try {
      const data=await send<{results:SearchHit[];nextCursor:string|null}>("search","POST",{query:query.trim(),filters,cursor});
      setRows(previous=>[...previous,...data.results]);setCursor(data.nextCursor);
    } catch (error) {setFeedback((error as Error).message);}
  }
  async function save() {
    try {await send("saved-searches","POST",{query:query.trim(),filters});setFeedback("Search saved.");saved();}
    catch (error) {setFeedback((error as Error).message);}
  }
  const shown=busy || !query.trim() ? []:rows;
  return <dialog className="search-dialog" ref={dialog} onCancel={event=>{event.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}} aria-label="Search your workspace">
    <div className="search-card">
      <div className="search-field"><Search size={21} /><input ref={input} aria-label="Search documents and notes" maxLength={160} placeholder="Search documents, passages, and notes…" value={query} onChange={e=>setQuery(e.target.value)}
        onKeyDown={e=>{
          if (!shown.length) return;
          if (e.key==="Enter") {e.preventDefault();navigate(shown[active],query);}
          if (e.key==="ArrowDown"||e.key==="ArrowUp") {
            e.preventDefault();const index=(active+(e.key==="ArrowDown"?1:shown.length-1))%shown.length;
            setActive(index);document.getElementById("search-result-"+index)?.scrollIntoView({block:"nearest"});
          }
        }} /><button className="icon-btn" onClick={close} aria-label="Close search"><X size={20}/></button></div>
      <FilterFields filters={filters} onChange={setFilters} folders={folders} tags={tags} search/>
      <div className="search-result-list">
        {!query.trim()&&<p className="search-state">Search a title, phrase, tag, or passage.</p>}
        {busy&&<p className="search-state" role="status">Searching…</p>}
        {!busy&&query.trim()&&!shown.length&&!feedback&&<p className="search-state">No matching documents or notes.</p>}
        {shown.map((hit,index)=><button id={"search-result-"+index} className={"search-result "+(index===active?"selected":"")} key={hit.key} onMouseEnter={()=>setActive(index)} onClick={()=>navigate(hit,query)}>
          <span className="file-icon"><FileText size={18}/></span><span><strong>{hit.title}</strong><small>{locationLabel(hit,hit.kind==="note"?"Note":hit.kind==="document"?"Document":"Indexed passage")}</small>
          <span className="snippet">{hit.snippetSegments.map((segment,i)=>segment.match?<mark key={i}>{segment.text}</mark>:<span key={i}>{segment.text}</span>)}</span></span><ArrowUpRight size={16}/>
        </button>)}
        {cursor&&shown.length>0&&<button className="btn quiet" onClick={more}>More results <ArrowDown size={15}/></button>}
      </div>
      <div className="search-foot"><span role="status">{feedback || "↑ ↓ to move · Enter to open · Esc to close"}</span><button className="btn quiet" onClick={save} disabled={!query.trim()}><BookmarkPlus size={16}/> Save search</button></div>
    </div>
  </dialog>;
}
