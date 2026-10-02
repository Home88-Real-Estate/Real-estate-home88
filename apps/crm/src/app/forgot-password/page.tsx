import type { Metadata } from "next";
import Link from "next/link";

import { AuthLayout } from "@/components/AuthLayout";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

export const metadata: Metadata = { title: "Επαναφορά κωδικού" };

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Επαναφορά κωδικού"
      subtitle="Συμπληρώστε το email του λογαριασμού σας. Αν υπάρχει, θα λάβετε σύνδεσμο για να ορίσετε νέο κωδικό (ισχύει 60 λεπτά)."
      footer={
        <p className="auth__foot">
          <Link href="/login">← Επιστροφή στη σύνδεση</Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
