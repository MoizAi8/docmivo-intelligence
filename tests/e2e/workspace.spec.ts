import { expect,test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fixtureDocx, fixturePdf } from "../fixtures/documents";

const origin="http://127.0.0.1:3101";
const invite="docmivo-fixture-registration-invite-at-least-32";
const password="test-disposable-browser-pass-01";
const account=()=>({name:"Synthetic Researcher",email:"reader-"+randomUUID().slice(0,10)+"@example.test",password});
const antiCsrf={origin};
async function register(request:APIRequestContext, details=account()) {
  const response=await request.post("/api/auth/sign-up/email",{headers:{origin,"x-docmivo-invite":invite},data:details});
  expect(response.status()).toBe(200);
  return details;
}
async function upload(request:APIRequestContext,name:string,bytes:Buffer,key=randomUUID()) {
  return request.post("/api/documents",{headers:{origin,"idempotency-key":key},multipart:{file:{name,mimeType:"application/octet-stream",buffer:bytes}}});
}
async function removeAccount(context:APIRequestContext) {
  return context.delete("/api/account",{headers:antiCsrf,data:{confirmation:"DELETE"}});
}
async function screenshot(page:Page,name:string) {
  await page.screenshot({path:"artifacts/visual-qa/"+name+".png",fullPage:true,animations:"disabled"});
}

for (const width of [360,390,768,1280,1440,1920]) {
  test("landing responsive at "+width,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.goto("/");
    await expect(page.getByRole("heading",{level:1})).toHaveText(/Find what\s*matters/);
    await expect(page.getByRole("link",{name:"Launch workspace"})).toBeVisible();
    await expect(page.getByText("Illustration · Fictional field guide")).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width===1440||width===390) await screenshot(page,"landing-"+width);
  });
}

test("marketing pages, security headers, accessible entry",async({page,request})=>{
  const response=await page.goto("/");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.getByRole("link",{name:"Skip to content"})).toBeAttached();
  const axe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();
  expect(axe.violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)}))).toEqual([]);
  await page.getByRole("navigation",{name:"Main navigation"}).getByText("Product").click();
  await expect(page.getByRole("heading",{level:1})).toContainText("leads to the source");
  await page.getByRole("navigation",{name:"Main navigation"}).getByText("Security").click();
  await expect(page.getByRole("heading",{level:1})).toContainText("under your control");
  const data=await request.get("/api/documents");
  expect(data.status()).toBe(401);
  expect(data.headers()["cache-control"]).toContain("no-store");
  expect(await (await request.get("/api/health")).json()).toMatchObject({data:{status:"ok"}});
});

test("invite and origin checks deny unsafe entry",async({request})=>{
  const bad=await request.post("/api/auth/sign-up/email",{headers:{origin,"x-docmivo-invite":"invalid"},data:account()});
  expect(bad.status()).toBe(403);
  const foreign=await request.post("/api/auth/sign-up/email",{headers:{origin:"https://example.test","x-docmivo-invite":invite},data:account()});
  expect(foreign.status()).toBe(403);
  const oversized=await request.post("/api/auth/sign-up/email",{headers:{origin,"x-docmivo-invite":invite},data:{name:"a".repeat(20000)}});
  expect(oversized.status()).toBe(413);
  const result=await request.get("/workspace",{maxRedirects:0});
  expect(result.status()).toBe(307);
});

test("keyboard upload, exact source, bookmark, notes, and refresh from desktop and mobile",async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const user=account();
  await page.goto("/sign-in");
  await page.getByRole("button",{name:/Have an invite/}).click();
  await page.getByLabel("Name",{exact:true}).fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password",{exact:true}).fill(user.password);
  await page.getByLabel("Workspace invite").fill(invite);
  await page.getByRole("button",{name:"Create account"}).click();
  await expect(page.getByRole("heading",{name:"Library"})).toBeVisible();
  await expect(page.getByText("No documents here yet.")).toBeVisible();
  await page.getByRole("button",{name:"Upload a document"}).click();
  const fileName="Fictional reading schedule.md";
  await page.getByLabel("Document file").setInputFiles({name:fileName,mimeType:"text/markdown",buffer:Buffer.from("# Visitor details\n\nThe fictional Moonstone archive opens every Tuesday.")});
  await page.getByRole("button",{name:"Upload and index"}).click();
  await expect(page.getByRole("heading",{name:fileName})).toBeVisible();
  await expect(page.getByText("New uploads are private.")).not.toBeVisible();
  await page.getByRole("button",{name:"Library",exact:true}).last().click();
  await expect(page.getByText("Indexed",{exact:true})).toBeVisible();
  await screenshot(page,"library-1440");
  const axe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();
  expect(axe.violations.map(item=>item.id)).toEqual([]);
  await page.keyboard.press("Control+k");
  const field=page.getByLabel("Search documents and notes");
  await expect(field).toBeFocused();
  await field.fill("Moonstone");
  await expect(page.getByRole("dialog").getByRole("button",{name:/Visitor details/})).toBeVisible();
  await page.getByRole("button",{name:"Save search"}).click();
  await expect(page.getByText("Search saved.",{exact:true})).toBeVisible();
  await screenshot(page,"search-1440");
  await field.press("Enter");
  await expect(page.locator(".passage.target mark")).toHaveText("Moonstone");
  await expect(page.locator(".passage.target")).toBeFocused();
  await page.getByRole("button",{name:"Bookmark passage"}).click();
  await expect(page.getByRole("button",{name:"Remove bookmark"})).toBeVisible();
  await screenshot(page,"reader-1440");
  await page.reload();
  await expect(page.getByRole("button",{name:"Remove bookmark"})).toBeVisible();
  await expect(page.getByRole("link",{name:"Original"})).toBeVisible();
  await page.getByRole("button",{name:"Notes",exact:true}).click();
  await page.getByRole("button",{name:"New note"}).click();
  await page.getByLabel("Title",{exact:true}).fill("Synthetic note");
  await page.getByLabel("Note",{exact:true}).fill("Use the Tuesday schedule.");
  await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect(page.getByText("Synthetic note")).toBeVisible();
  await page.getByRole("button",{name:"Saved searches",exact:true}).click();
  await expect(page.getByText("Moonstone",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Bookmarks",exact:true}).click();
  await expect(page.getByRole("button",{name:/Fictional reading schedule/})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:/Fictional reading schedule/}).click();
  await expect(page.getByRole("heading",{name:fileName})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screenshot(page,"reader-390");
  await page.getByRole("button",{name:"Analysis",exact:true}).click();
  await expect(page.getByText(/Private documents use indexed search/)).toBeVisible();
  await page.getByRole("button",{name:"Open navigation"}).click();
  await expect(page.getByRole("navigation",{name:"Workspace navigation"})).toBeVisible();
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Privacy & usage"})).toBeVisible();
  await screenshot(page,"settings-390");
  expect((await removeAccount(page.request)).status()).toBe(200);
  await page.reload();
  await expect(page).toHaveURL(/sign-in/);
});

test("supports genuine PDF and DOCX parsing and keeps Markdown plaintext safe",async({request})=>{
  await register(request);
  try {
    for(const [name,bytes,expected] of [
      ["fixture.pdf",fixturePdf(),"Juniper archive"],
      ["fixture.docx",fixtureDocx(),"Alder reading room"],
      ["literal.md",Buffer.from("# Heading\n<script>fictional text</script>"),"<script>fictional text</script>"],
      ["plain.txt",Buffer.from("Fictional archipelago content."),"archipelago"]
    ] as const) {
      const response=await upload(request,name,bytes);
      expect(response.status()).toBe(201);
      const item=(await response.json()).data;
      expect(item.status,name+" "+(item.errorCode??"")).toBe("READY");
      const passages=(await (await request.get("/api/documents/"+item.id+"/chunks")).json()).data.chunks;
      expect(passages[0].text).toContain(expected);
      if(name.endsWith(".pdf"))expect(passages[0].page).toBe(1);
      if(name.endsWith(".md"))expect(passages[0].section).toBe("Heading");
      const original=await request.get("/api/documents/"+item.id+"/content");
      expect(original.headers()["content-disposition"]).toContain("attachment");
      expect(await original.body()).toEqual(bytes);
    }
  } finally {await removeAccount(request);}
});

test("invalid content is refused or quarantined and search remains independent",async({request})=>{
  await register(request);
  try {
    expect((await upload(request,"not-word.docx",Buffer.from("plain"))).status()).toBe(415);
    expect((await upload(request,"binary.exe",Buffer.from("plain"))).status()).toBe(415);
    expect((await upload(request,"empty.txt",Buffer.alloc(0))).status()).toBe(400);
    expect((await upload(request,"oversized.txt",Buffer.alloc(2_100_000,65))).status()).toBe(413);
    const unreadable=await upload(request,"broken.pdf",Buffer.from("%PDF-not valid"));
    const quarantine=(await unreadable.json()).data;
    expect(quarantine.status).toBe("FAILED");
    expect((await request.get("/api/documents/"+quarantine.id+"/content")).status()).toBe(404);
    const retry=await request.post("/api/documents/"+quarantine.id+"/retry",{headers:antiCsrf});
    expect((await retry.json()).data.attempts).toBe(2);
    const response=await upload(request,"lookup.txt",Buffer.from("Synthetic onyx topic."));
    const item=(await response.json()).data;
    const analysis=await request.post("/api/ask",{headers:antiCsrf,data:{documentIds:[item.id],prompt:"hours",idempotencyKey:randomUUID(),allowExternalNonSensitive:true,attestEligibility:true}});
    expect(analysis.status()).toBe(403);
    expect((await analysis.json()).error.code).toBe("AI_RESTRICTED");
    const result=await request.post("/api/search",{headers:antiCsrf,data:{query:"onyx",filters:{}}});
    expect((await result.json()).data.results[0].documentId).toBe(item.id);
    expect((await request.post("/api/search",{headers:{origin:"https://example.test"},data:{query:"onyx",filters:{}}})).status()).toBe(403);
  } finally {await removeAccount(request);}
});

test("two authenticated accounts cannot read or mutate each other’s resources",async({playwright,request})=>{
  const second=await playwright.request.newContext({baseURL:origin});
  await register(request);await register(second);
  try {
    const raw=await upload(request,"Isolated-owned.md",Buffer.from("# Fictional\nemeraldgate"));
    const document=(await raw.json()).data;
    const content=await request.get("/api/documents/"+document.id+"/chunks");
    const chunk=(await content.json()).data.chunks[0].id;
    const post=(path:string,data:unknown)=>request.post("/api/"+path,{headers:antiCsrf,data:data as object});
    const folder=(await (await post("folders",{name:"Synthetic folder"})).json()).data.id;
    const tag=(await (await post("tags",{name:"Synthetic tag"})).json()).data.id;
    const note=(await (await post("notes",{title:"Owned note",text:"Hidden fictional content."})).json()).data.id;
    const saved=(await (await post("saved-searches",{query:"emeraldgate",filters:{}})).json()).data.id;
    await request.put("/api/bookmarks/"+chunk,{headers:antiCsrf});
    const tryPrivate=[
      ["GET","documents/"+document.id],["GET","documents/"+document.id+"/chunks?focus="+chunk],
      ["GET","documents/"+document.id+"/content"],["GET","jobs/"+document.jobId],
      ["PATCH","documents/"+document.id,{title:"Unauthorized"}],["DELETE","documents/"+document.id],
      ["POST","documents/"+document.id+"/retry"],["PUT","bookmarks/"+chunk],["DELETE","bookmarks/"+chunk],
      ["GET","notes/"+note],["PATCH","notes/"+note,{title:"Unauthorized",text:"Other"}],["DELETE","notes/"+note],
      ["GET","saved-searches/"+saved],["DELETE","saved-searches/"+saved],
      ["PATCH","folders/"+folder,{name:"Unauthorized"}],["DELETE","folders/"+folder],["PATCH","tags/"+tag,{name:"Unauthorized"}],["DELETE","tags/"+tag]
    ] as const;
    for(const [method,path,data] of tryPrivate) {
      const attempt=await second.fetch("/api/"+path,{method,headers:antiCsrf,data});
      expect(attempt.status(),path).toBe(404);
    }
    for (const path of ["bookmarks","notes","folders","tags","saved-searches","conversations"]) {
      expect((await (await second.get("/api/"+path)).json()).data).toEqual([]);
    }
    const search=await second.get("/api/search?q=emeraldgate");
    expect((await search.json()).data.results).toEqual([]);
    expect((await request.get("/api/documents/"+document.id)).status()).toBe(200);
    expect((await request.delete("/api/documents/"+document.id,{headers:antiCsrf})).status()).toBe(200);
    expect((await request.get("/api/documents/"+document.id+"/content")).status()).toBe(404);
  } finally {await removeAccount(second);await removeAccount(request);await second.dispose();}
});

test("warm indexed HTTP search on 5,200 synthetic chunks",()=>{
  const measured=spawnSync(process.execPath,["scripts/workflow-check.mjs","benchmark",origin],{
    env:{...process.env,REGISTRATION_INVITE:invite},encoding:"utf8",timeout:35_000
  });
  expect(measured.status,measured.stderr).toBe(0);
  const line=measured.stdout.split(/\r?\n/).find(value=>value.startsWith("{"));
  expect(line).toBeTruthy();
  const data=JSON.parse(line!);
  expect(data).toMatchObject({chunks:5200,documents:52,warmups:5,requests:50});
  expect(data.p95Ms).toBeGreaterThan(0);
  console.log(line);
});
