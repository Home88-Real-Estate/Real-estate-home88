import type { Metadata } from "next";
import Link from "next/link";

import { markNotificationsRead } from "@/actions/messages";
import { EmptyState } from "@/components/EmptyState";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Ειδοποιήσεις" };

type N = { id: string; kind: string; title: string; entityType: string; entityId: string; read: boolean; createdAt: string };

/** Where each notification opens. */
function hrefOf(n: N): string {
  switch (n.entityType) {
    case "LEAD": return `/leads/${n.entityId}`;
    case "REQUEST": return `/requests/${n.entityId}`;
    case "TRANSACTION": return `/transactions/${n.entityId}`;
    case "MANDATE": return `/mandates/${n.entityId}`;
    case "PROPERTY": return `/properties/${n.entityId}`;
    case "SUBMISSION": return `/submissions/${n.entityId}`;
    case "VIEWING": return "/calendar";
    case "TASK": return "/reminders";
    default: return "/";
  }
}

export default async function NotificationsPage() {
  await requireRole("AGENT");
  const result = await apiFetch<{ unread: number; data: N[] }>("/api/notifications");
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ειδοποιήσεις</h1>
          <p className="muted">Τι άλλαξε στα δικά σας θέματα. Ποιες ειδοποιήσεις έρχονται και από ποιο κανάλι ορίζεται στις Ρυθμίσεις.</p>
        </div>
        {result.ok && result.data.unread > 0 && (
          <form action={markNotificationsRead}>
            <button type="submit" className="btn btn--outline btn--sm">Όλες ως αναγνωσμένες</button>
          </form>
        )}
      </div>
      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <EmptyState title="Καμία ειδοποίηση" text="Θα εμφανίζονται εδώ νέα leads, προσφορές, υπογραφές εντολών και υπενθυμίσεις." />
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          {result.data.data.map((n) => (
            <div key={n.id} className={n.read ? "notif" : "notif is-unread"}>
              <span className="notif__dot" aria-hidden="true" />
              <Link href={hrefOf(n)} className="notif__title">{n.title}</Link>
              <span className="row">
                <span className="muted" style={{ fontSize: "0.8rem" }}>{formatDateTime(n.createdAt)}</span>
                {!n.read && (
                  <form action={markNotificationsRead}>
                    <input type="hidden" name="id" value={n.id} />
                    <button type="submit" className="btn btn--ghost btn--sm" aria-label={`Αναγνωσμένη: ${n.title}`}>✓</button>
                  </form>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
