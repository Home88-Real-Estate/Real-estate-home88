import type { Metadata } from "next";
import Link from "next/link";

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
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">HOME88</div>
        <p className="sub">Ορίστε νέο κωδικό</p>

        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="notice notice--danger">
            Ο σύνδεσμος δεν είναι έγκυρος. Ζητήστε νέο σύνδεσμο επαναφοράς.
          </div>
        )}

        <p className="sub" style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
          <Link href="/forgot-password">Ζητήστε νέο σύνδεσμο</Link>
        </p>
      </div>
    </div>
  );
}
