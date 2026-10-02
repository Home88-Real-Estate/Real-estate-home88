import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthLayout } from "@/components/AuthLayout";
import { getCurrentUser } from "@/lib/session";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Σύνδεση" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <AuthLayout
      title="Σύνδεση"
      subtitle="Καλώς ήρθατε στο HOME88 CRM. Συνδεθείτε με τα στοιχεία του λογαριασμού σας."
      footer={
        <p className="auth__foot">
          Νέος συνεργάτης; Ο λογαριασμός δημιουργείται με πρόσκληση από τον διαχειριστή.{" "}
          <Link href="/forgot-password">Δεν έχετε ορίσει κωδικό;</Link>
        </p>
      }
    >
      <LoginForm />
    </AuthLayout>
  );
}
