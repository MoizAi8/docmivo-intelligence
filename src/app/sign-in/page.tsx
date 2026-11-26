import { AuthAside, Logo } from "@/components/marketing/site";
import { AuthForm } from "@/components/workspace/auth-form";
export const metadata = { title:"Sign in" };

export default function SignIn() {
  return <main id="main" className="auth-layout"><header><Logo /></header><div className="auth-inner"><AuthForm /><AuthAside /></div></main>;
}
