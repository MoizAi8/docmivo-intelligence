"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, LockKeyhole } from "lucide-react";

export function AuthForm() {
  const router=useRouter();
  const [register,setRegister] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/auth/"+(register?"sign-up":"sign-in")+"/email",{
        method:"POST",headers:{"Content-Type":"application/json",...(register?{"x-docmivo-invite":String(form.get("invite"))}:{})},
        body:JSON.stringify({email:form.get("email"),password:form.get("password"),...(register?{name:form.get("name")}:{})})
      });
      if (!response.ok) {
        if (response.status===403 && register) throw new Error("Enter a valid workspace invite.");
        if (response.status===429) throw new Error("Too many attempts. Try again in a minute.");
        if (response.status>=500) throw new Error("Sign-in is temporarily unavailable.");
        throw new Error(register?"We couldn’t create the account. Check your details or sign in.":"The email or password is incorrect.");
      }
      router.replace("/workspace");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please try again.");
      setBusy(false);
    }
  }
  return <section className="auth-form">
    <div className="auth-sign"><LockKeyhole size={20} /></div>
    <h1>{register?"Create your account.":"Welcome back."}</h1>
    <p>{register?"Use your Docmivo invite to open a private workspace.":"Sign in to your private document workspace."}</p>
    <form onSubmit={submit} key={Number(register)}>
      {register&&<label>Name<input name="name" required maxLength={80} autoComplete="name" /></label>}
      <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
      <label>Password<input name="password" type="password" autoComplete={register?"new-password":"current-password"} minLength={register?12:1} maxLength={128} required /></label>
      {register&&<label>Workspace invite<input name="invite" type="password" required maxLength={160} autoComplete="off" /><small>Use at least 12 characters for your password.</small></label>}
      {error&&<p className="status-error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy?"Please wait…":register?"Create account":"Sign in"} <ArrowUpRight size={17} /></button>
    </form>
    <button className="auth-toggle" type="button" onClick={()=>{setRegister(!register);setError("");}}>{register?"Already have an account? Sign in":"Have an invite? Create an account"}</button>
  </section>;
}
