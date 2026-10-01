import { Shell } from "@/components/Shell";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return <Shell user={user}>{children}</Shell>;
}
