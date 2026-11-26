import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { authentication } from "@/server/auth/config";
import { Workspace } from "@/components/workspace/workspace";
export const metadata = { title:"Workspace" };
export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const requestHeaders=await headers();
  const current=await authentication().api.getSession({headers:requestHeaders}).catch(()=>null);
  if (!current) redirect("/sign-in");
  return <Suspense fallback={<main id="main" className="workspace-wait">Opening your workspace…</main>}><Workspace name={current.user.name} /></Suspense>;
}
