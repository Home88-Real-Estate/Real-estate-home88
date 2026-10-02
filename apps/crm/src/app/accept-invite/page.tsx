import type { Metadata } from "next";
import Link from "next/link";

import { AcceptInviteForm } from "@/components/AcceptInviteForm";

export const metadata: Metadata = { title: "Ενεργοποίηση λογαριασμού" };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const token = first(sp.token);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">HOME88</div>
        <p className="sub">Ενεργοποίηση λογαριασμού συνεργάτη</p>

        {token ? (
          <AcceptInviteForm token={token} />
        ) : (
          <div className="notice notice--danger">
            Ο σύνδεσμος πρόσκλησης δεν είναι έγκυρος. Ζητήστε νέα πρόσκληση από τον διαχειριστή.
          </div>
        )}

        <p className="sub" style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
          <Link href="/login">Επιστροφή στη σύνδεση</Link>
        </p>
      </div>
    </div>
  );
}
