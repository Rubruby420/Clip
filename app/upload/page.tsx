import { redirect } from "next/navigation";
import UploadPage from "./_upload";

export const dynamic = "force-dynamic";

export default function Page() {
  if (!process.env.OPENAI_API_KEY) redirect("/settings?firstRun=true");
  return <UploadPage />;
}
