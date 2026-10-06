import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContactForm } from "@/components/contacts/ContactForm";
import { apiFetch } from "@/lib/api";
import type { DirectoryUser } from "@/lib/contacts";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Επεξεργασία επαφής" };

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("AGENT");
  const { id } = await params;
  const [result, users] = await Promise.all([
    apiFetch<{ contact: Record<string, unknown> & { id: string; assignedTo: { id: string } | null; sensitiveHidden: boolean } }>(`/api/contacts/${id}`),
    apiFetch<{ data: DirectoryUser[] }>("/api/users/directory"),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const c = result.data.contact;
  return (
    <>
      <h1>Επεξεργασία επαφής</h1>
      <ContactForm
        values={{ ...(c as object), assignedToId: c.assignedTo?.id ?? null }}
        users={users.ok ? users.data.data : []}
        currentUserId={user.id}
      />
    </>
  );
}
