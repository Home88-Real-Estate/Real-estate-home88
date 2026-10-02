import type { Metadata } from "next";
import Link from "next/link";

import { AuthLayout } from "@/components/AuthLayout";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export const metadata: Metadata = { title: "Ορισμός νέου κωδικού" };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const token = first(sp.token);

  return (
    <AuthLayout
      title="Ορισμός νέου κωδικού"
      subtitle="Επιλέξτε έναν ισχυρό κωδικό που δεν χρησιμοποιείτε αλλού."
      footer={
        <p className="auth__foot">
          <Link href="/forgot-password">Ζητήστε νέο σύνδεσμο</Link>
        </p>
      }
    >
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="notice notice--danger">
          Ο σύνδεσμος δεν είναι έγκυρος. Ζητήστε νέο σύνδεσμο επαναφοράς.
        </div>
      )}
    </AuthLayout>
  );
}
