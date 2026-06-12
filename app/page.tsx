import { redirect } from "next/navigation";
import Dashboard from "./_dashboard";

export const dynamic = "force-dynamic";

export default function Page() {
  if (!process.env.OPENAI_API_KEY) redirect("/settings?firstRun=true");
  return <Dashboard />;
}
