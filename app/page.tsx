import { getChatGPTUser, chatGPTSignInPath } from "./chatgpt-auth";
import FinanceApp from "./finance-app";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) return <main className="sign-in"><div className="brand"><span className="brand-symbol">s</span> sure<span className="brand-dot">.</span></div><h1>A little clarity.<br />A lot more possibility.</h1><p>Your accounts, spending, and plans. One private place to see the whole picture.</p><a className="button primary" href={chatGPTSignInPath("/")} target="_top">Continue with ChatGPT <span>↗</span></a><p className="fine-print">Independent Sites port of Sure · Personal finance, thoughtfully organized.</p></main>;
  return <FinanceApp displayName={user.displayName} />;
}
