import { describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { allowedTester, canonicalQuote, validateCitations } from "@/server/ai/policy";
import { inviteMatches } from "@/server/auth/config";
import { chunkSpans, extract, validateFile } from "@/server/ingestion/parser";
import { filtersSchema, segments } from "@/server/search/service";
import { fixtureDocx,fixturePdf } from "../fixtures/documents";

describe("auth invite",()=>{
  const valid="docmivo-test-invite".repeat(3);
  it.each([[null,false],["",false],["wrong",false],[valid,true],[valid+" ",false],[valid.toUpperCase(),false],["a".repeat(161),false]])("validates input # %s",(input,validity)=>{
    expect(inviteMatches(input,valid)).toBe(validity);
  });
  it("rejects short or unconfigured secrets",()=>{
    expect(inviteMatches("tiny","tiny")).toBe(false);
  });
});

describe("provider and citations",()=>{
  const base={email:"writer@example.test",country:"PK",production:true,enabled:true,testers:["writer@example.test"],regions:["PK"]};
  it("allows an enrolled account in an allowlisted eligible region",()=>expect(allowedTester(base)).toBe(true));
  it.each(["AT","BE","BG","HR","CY","CZ","DE","DK","EE","ES","FI","FR","GR","HU","IE","IS","IT","LI","LT","LU","LV","MT","NL","NO","PL","PT","RO","SE","SI","SK","CH","GB","UK"])("blocks unpaid service in %s even if listed",country=>{
    expect(allowedTester({...base,country,regions:[country]})).toBe(false);
  });
  it.each([null,"","pk","US","??","PK,US"])("denies invalid or unlisted country %s",country=>expect(allowedTester({...base,country})).toBe(false));
  it("denies disabled and uninvited accounts",()=>{
    expect(allowedTester({...base,enabled:false})).toBe(false);
    expect(allowedTester({...base,email:"other@example.test"})).toBe(false);
  });
  const a=randomUUID(),b=randomUUID();
  const source=new Map([[a,"The room opens\n every Tuesday."],[b,"The archive opens every Thursday."]]);
  const docs=new Map([[a,"doc-a"],[b,"doc-b"]]);
  const one={chunkId:a,quote:"room opens every Tuesday"};
  const two={chunkId:b,quote:"archive opens every Thursday"};
  it.each([
    [[one],1,true],[[one,two],2,true],[[one],2,false],[[one,one],1,false],
    [[{...one,quote:"The room opens every Thursday"}],1,false],
    [[{...one,quote:"every"}],1,false],[[{...one,chunkId:randomUUID()}],1,false],
    [[{...two,quote:"archive opens every thursday"}],1,false],[[],1,false]
  ] as const)("requires authentic citations and coverage (%#)",(cites,count,validity)=>{
    expect(validateCitations([...cites],source,count,docs)).toBe(validity);
  });
  it("canonicalizes whitespace without changing text",()=>expect(canonicalQuote(" a\t\n   B ")).toBe("a B"));
});

describe("parser and offsets",()=>{
  it.each([
    ["fixture.txt",Buffer.from("plain"),"txt"],["fixture.MD",Buffer.from("# Header"),"md"],
    ["fixture.pdf",fixturePdf(),"pdf"],["fixture.docx",fixtureDocx(),"docx"]
  ] as const)("checks signature for %s",(name,bytes,kind)=>expect(validateFile(name,bytes).kind).toBe(kind));
  it.each(["unknown.exe","unsafe.html","no-extension","../a.txt","a\\b.md","bad\n.txt","bad\u202E.txt","a".repeat(182)+".md"])("refuses invalid name %s",name=>expect(()=>validateFile(name,Buffer.from("text"))).toThrow());
  it.each(["spoof.pdf","spoof.docx"])("rejects renamed plain text %s",name=>expect(()=>validateFile(name,Buffer.from("text"))).toThrow());
  it("preserves Markdown headings and fenced lines",async()=>{
    const parts=await extract(Buffer.from("# One\nHello\n\n~~~\n# Code\n~~~\n\n## Two\nWorld"),"md");
    expect(parts.map(part=>part.section)).toEqual(["One","Two"]);
    expect(parts[0].text).toContain("# Code");
  });
  it("extracts exact PDF page text",async()=>{
    expect(await extract(fixturePdf(),"pdf")).toEqual([{page:1,section:null,text:"The fictional Juniper archive opens on Tuesday."}]);
  });
  it("extracts genuine Word plaintext",async()=>{
    expect((await extract(fixtureDocx(),"docx"))[0].text).toBe("The fictional Alder reading room needs a reservation.");
  });
  it.each([
    ["invalid UTF-8",Buffer.from([0xc3,0x28]),"txt"],
    ["zero byte",Buffer.from([9,0,10]),"txt"],
    ["blank",Buffer.from(" \n\t"),"md"],
    ["malformed PDF",Buffer.from("%PDF-not-a-document"),"pdf"],
    ["malformed archive",Buffer.from([80,75,3,4]),"docx"],
    ["external relationship",fixtureDocx("synthetic",[["word/_rels/document.xml.rels",'<Relationship TargetMode="External" />']]),"docx"],
    ["macro project",fixtureDocx("synthetic",[["word/vbaProject.bin","placeholder"]]),"docx"],
    ["path traversal",fixtureDocx("synthetic",[["../outside.xml","placeholder"]]),"docx"],
    ["XML document type",fixtureDocx("synthetic",[["word/styles.xml","<!DOCTYPE fixture>"]]),"docx"]
  ] as const)("rejects %s",async(_name,bytes,kind)=>await expect(extract(bytes,kind)).rejects.toThrow());
  it("creates overlapping stable offsets without cutting unicode pairs",()=>{
    const text="a🙂 alpha term ".repeat(500);
    const chunks=chunkSpans([{text,page:4,section:null},{text:"Second",page:5,section:null}]);
    expect(chunks.length).toBeGreaterThan(3);
    chunks.slice(0,-1).forEach(chunk=>{
      expect(text.slice(chunk.start,chunk.end)).toBe(chunk.text);
      expect(chunk.page).toBe(4);
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    });
    expect(chunks[1].start).toBeLessThan(chunks[0].end);
    expect(chunks.at(-1)?.start).toBe(text.length+1);
  });
});

describe("search helpers",()=>{
  it.each([
    ["words with needle and rest","needle","needle"],
    ["Um café e um chá","CAFÉ","café"],
    ["<script>Fictional</script>","script","script"],
    ["日本の資料","資料","資料"],
    ["the value is 12345","12345","12345"],
    ["capital alpha and ALPHA","alpha","alpha"]
  ])("highlights literal matched text in %s",(text,query,needle)=>expect(segments(text,query).find(segment=>segment.match)?.text).toBe(needle));
  it("returns plain text when no term matches",()=>expect(segments("Literal <b>text</b>","[ ]")).toEqual([{text:"Literal <b>text</b>",match:false}]));
  it.each([{tag:"not-id"},{folder:"not-id"},{type:"x".repeat(121)},{favorite:"true"},{after:"2026-02-31"},{unrelated:true}])("rejects malformed filter %#",input=>expect(filtersSchema.safeParse(input).success).toBe(false));
});
