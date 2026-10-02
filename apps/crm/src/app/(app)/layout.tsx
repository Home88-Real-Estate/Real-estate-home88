import { cookies } from "next/headers";

import { Shell, type NavCounters } from "@/components/Shell";
import { apiFetch } from "@/lib/api";
import { hasRole, requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, store] = await Promise.all([requireUser(), cookies()]);

  // Sidebar numbers come from the database; a failure only hides them.
  const counters = hasRole(user.role, "AGENT")
    ? await apiFetch<NonNullable<NavCounters>>("/api/dashboard/counters")
    : null;

  // Public website origin for the "Ιστότοπος" link (server env, not secret).
  const siteUrl = process.env.SITE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || null;

  return (
    <Shell
      user={user}
      counters={counters?.ok ? counters.data : null}
      collapsed={store.get("h88_nav")?.value === "collapsed"}
      siteUrl={siteUrl}
    >
      {children}
    </Shell>
  );
}
