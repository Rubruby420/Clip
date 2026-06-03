import SettingsClient from "./_client";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ firstRun?: string }>;
}) {
  const params = await searchParams;
  return <SettingsClient firstRun={params.firstRun === "true"} />;
}
