import type { Metadata } from "next";
import Link from "next/link";

import { ShowingForm } from "@/components/showings/ShowingForm";
import { apiFetch } from "@/lib/api";
import type { DirectoryUser } from "@/lib/contacts";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Νέα Υπόδειξη" };

export default async function NewShowingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("AGENT");
  const sp = await searchParams;
  const contactId = (Array.isArray(sp.contact) ? sp.contact[0] : sp.contact) ?? "";
  const [users, contact] = await Promise.all([
    apiFetch<{ data: DirectoryUser[] }>("/api/users/directory"),
    contactId ? apiFetch<{ contact: { id: string; reference: string; firstName: string; lastName: string; email: string | null; mobile: string | null; phone: string | null } }>(`/api/contacts/${encodeURIComponent(contactId)}`) : Promise.resolve(null),
  ]);
  const isManager = ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(user.role);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Νέα Υπόδειξη</h1>
          <p className="muted">Επιλέξτε πελάτη και τα ακίνητα που του υποδεικνύονται. Η εντολή υπόδειξης παράγεται από το εγκεκριμένο πρότυπο.</p>
        </div>
        <Link href="/showings" className="btn btn--outline btn--sm">Επιστροφή</Link>
      </div>
      <ShowingForm
        values={contact?.ok ? { contact: contact.data.contact } : undefined}
        users={users.ok ? users.data.data : []}
        currentUserId={user.id}
        canAssign={isManager}
      />
    </>
  );
}
