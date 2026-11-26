"use client";
import { useEffect, useState } from "react";

export async function api<T>(path:string, init?:RequestInit):Promise<T> {
  const response=await fetch("/api/"+path,{...init,cache:"no-store"});
  const result=await response.json().catch(()=>null);
  if (!response.ok || !result) throw new Error(result?.error?.message || "Docmivo couldn’t complete this request.");
  return result.data as T;
}
export function send<T>(path:string,method:string,data?:unknown) {
  return api<T>(path,{method,...(data!==undefined?{headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}:{})});
}
export function useData<T>(path:string|null, epoch=0) {
  const [record,setRecord]=useState<{path:string;epoch:number;data?:T;error?:string}>();
  useEffect(()=>{
    if (!path) return;
    const pending=new AbortController();
    api<T>(path,{signal:pending.signal}).then(data=>{
      if (!pending.signal.aborted) setRecord({path,epoch,data});
    },error=>{if (!pending.signal.aborted) setRecord({path,epoch,error:error.message});});
    return ()=>pending.abort();
  },[path,epoch]);
  return record?.path===path ? record : undefined;
}

export const mimeLabels:Record<string,string> = {
  "application/pdf":"PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":"DOCX",
  "text/markdown":"Markdown",
  "text/plain":"TXT"
};
export type Item={id:string;name:string};
export type DocumentItem={
  id:string;title:string;classification:"PRIVATE"|"SYNTHETIC";mime:string;status:"READY"|"FAILED"|"UPLOADED"|"PARSING";
  size:number;error_code?:string;updated_at:string;folder_id:string|null;favorite:boolean;tags:Item[];attempts?:number;job_id?:string
};
export type DocumentList={documents:DocumentItem[];nextCursor:string|null};
export type Filter={folder?:string;tag?:string;type?:string;favorite?:boolean;after?:string};
export type SavedSearch={id:string;query:string;filters:Filter};
export type SearchHit={
  key:string; documentId:string|null; chunkId:string|null; title:string; page:number|null;section:string|null;
  kind:"note"|"source"|"document";snippetSegments:{text:string;match:boolean}[]
};
export type Settings={user:{name:string;email:string};ai:boolean;quota:number;maxBytes:number;documents:number;bytes:number;ai_today:number;admin:boolean};
export type Chunk={id:string;ordinal:number;page:number|null;section:string|null;start_offset:number;end_offset:number;text:string;bookmarked:boolean};
export type Citation={id:string;document_id:string;chunk_id:string;title:string;page:number|null;section:string|null;quote:string};
export type Note={id:string;title:string;text:string;source_message_id:string|null;updated_at:string};
export type Message={id:string;conversation_id:string;question:string;answer:string|null;state:"PENDING"|"ANSWERED"|"FAILED"|"INSUFFICIENT";citations:Citation[];findings:{label:string;value:string;chunkId:string;quote:string}[]};
export type Conversation={id:string;title:string;created_at:string;messages?:Message[]};
export const locationLabel=(item:{page:number|null;section:string|null},fallback="Document text")=>item.page ? "Page "+item.page : item.section || fallback;
export const sizeLabel=(bytes:number)=>bytes>=1048576 ? (bytes/1048576).toFixed(1)+" MiB" : Math.max(1,Math.ceil(bytes/1024))+" KB";
const showDate=new Intl.DateTimeFormat("en",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
export const dateLabel=(value:string)=>showDate.format(new Date(value));

export function queryString(filters:Filter) {
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(filters)) if (value) params.set(key,String(value));
  return params;
}
