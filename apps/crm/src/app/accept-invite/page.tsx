import type { Metadata } from "next";
import Link from "next/link";

import { AcceptInviteForm } from "@/components/AcceptInviteForm";
import { AuthLayout } from "@/components/AuthLayout";

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
    <AuthLayout
      title="Ενεργοποίηση λογαριασμού"
      subtitle="Ορίστε τον κωδικό σας για να ολοκληρώσετε την πρόσκληση στο HOME88 CRM."
      footer={
        <p className="auth__foot">
          <Link href="/login">← Επιστροφή στη σύνδεση</Link>
        </p>
      }
    >
      {token ? (
        <AcceptInviteForm token={token} />
      ) : (
        <div className="notice notice--danger">
          Ο σύνδεσμος πρόσκλησης δεν είναι έγκυρος. Ζητήστε νέα πρόσκληση από τον διαχειριστή.
        </div>
      )}
    </AuthLayout>
  );
}
