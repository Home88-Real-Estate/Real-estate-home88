import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

export const metadata: Metadata = { title: "Επαναφορά κωδικού" };

export default function ForgotPasswordPage() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">HOME88</div>
        <p className="sub">Ξεχάσατε τον κωδικό;</p>
        <ForgotPasswordForm />
        <p className="sub" style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
          <Link href="/login">Επιστροφή στη σύνδεση</Link>
        </p>
      </div>
    </div>
  );
}
