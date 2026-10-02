import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "./LoginForm";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">HOME88</div>
        <p className="sub">Agent and back-office sign-in</p>
        <LoginForm />
        <p className="sub" style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
          <Link href="/forgot-password">Ξεχάσατε τον κωδικό σας;</Link>
        </p>
      </div>
    </div>
  );
}
