import type { Metadata } from "next";
import Link from "next/link";

import { ContactForm } from "@/components/contacts/ContactForm";
import { apiFetch } from "@/lib/api";
import type { DirectoryUser } from "@/lib/contacts";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Νέα επαφή" };

export default async function NewContactPage() {
  const user = await requireRole("AGENT");
  const users = await apiFetch<{ data: DirectoryUser[] }>("/api/users/directory");
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Νέα επαφή</h1>
          <p className="muted">Αν υπάρχει ήδη επαφή με το ίδιο email ή τηλέφωνο, θα σας ζητηθεί έλεγχος πριν δημιουργηθεί νέα.</p>
        </div>
        <Link href="/contacts" className="btn btn--outline btn--sm">Επιστροφή</Link>
      </div>
      <ContactForm users={users.ok ? users.data.data : []} currentUserId={user.id} />
    </>
  );
}
