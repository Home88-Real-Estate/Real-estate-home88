import type { Metadata } from "next";

import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const user = await requireUser();

  return (
    <>
      <h1 style={{ marginTop: 0 }}>Ασφάλεια</h1>
      <ChangePasswordForm email={user.email} />
    </>
  );
}
