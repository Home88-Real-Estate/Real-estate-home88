import { MESSAGE_STATUS_LABELS } from "@home88/domain";

import { setSmsOptOut } from "@/actions/messages";
import { Compose } from "@/components/messages/Compose";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Msg = { id: string; channel: string; purpose: string; status: string; to: string | null; subject: string | null; body: string | null; segments: number | null; error: string | null; template: string | null; sentBy: string | null; createdAt: string };

export const MESSAGE_STATUS_CLASS: Record<string, string> = { SENT: "badge badge--ok", LOGGED: "badge badge--muted", FAILED: "badge badge--danger", BLOCKED: "badge badge--warn" };

/** Compose and history for one contact. Consent and opt-outs are enforced by the API; this only shows them. */
export async function ContactCommunication({ contactId, propertyReference }: { contactId: string; propertyReference?: string }) {
  const [state, templates, history] = await Promise.all([
    apiFetch<{ hasEmail: boolean; hasMobile: boolean; marketingConsent: boolean; marketingOptOut: boolean; smsOptOut: boolean; smsProvider: { state: string }; unsubscribeAvailable: boolean }>(`/api/contacts/${encodeURIComponent(contactId)}/communication`),
    apiFetch<{ data: Array<{ id: string; name: string; channel: string; purpose: string }> }>("/api/message-templates"),
    apiFetch<{ data: Msg[] }>("/api/messages", { query: { contactId } }),
  ]);
  if (!state.ok) return <div className="notice notice--danger">{state.error.message}</div>;
  const s = state.data;
  return (
    <section className="panel" id="communication">
      <div className="panel__head">
        <div><h2>Επικοινωνία</h2><p className="panel__sub">Email και SMS προς τον πελάτη. Όλα καταγράφονται· τα μηνύματα προώθησης απαιτούν συγκατάθεση.</p></div>
        {s.hasMobile && (
          <form action={setSmsOptOut}>
            <input type="hidden" name="contactId" value={contactId} />
            <input type="hidden" name="optOut" value={s.smsOptOut ? "false" : "true"} />
            <button type="submit" className="btn btn--ghost btn--sm">{s.smsOptOut ? "Επαναφορά SMS" : "Δεν θέλει SMS"}</button>
          </form>
        )}
      </div>
      {!s.hasEmail && !s.hasMobile ? (
        <p className="muted">Η επαφή δεν έχει email ή κινητό.</p>
      ) : (
        <details className="subpanel" open>
          <summary>Νέο μήνυμα</summary>
          <Compose contactId={contactId} templates={templates.ok ? templates.data.data : []} state={s} propertyReference={propertyReference} />
        </details>
      )}
      <h3 style={{ fontSize: "0.95rem", margin: "16px 0 8px" }}>Ιστορικό</h3>
      {!history.ok || history.data.data.length === 0 ? (
        <p className="muted">Δεν έχουν σταλεί μηνύματα.</p>
      ) : (
        history.data.data.map((m) => (
          <article key={m.id} className="msg">
            <div className="msg__head">
              <span className="badge badge--muted">{m.channel === "EMAIL" ? "Email" : "SMS"}</span>
              {m.purpose === "MARKETING" && <span className="badge badge--info">Προώθηση</span>}
              <span className={MESSAGE_STATUS_CLASS[m.status] ?? "badge"}>{MESSAGE_STATUS_LABELS[m.status] ?? m.status}</span>
              <span className="muted">{formatDateTime(m.createdAt)}{m.sentBy ? ` · ${m.sentBy}` : ""}{m.template ? ` · ${m.template}` : ""}</span>
            </div>
            {m.subject && <strong>{m.subject}</strong>}
            <pre className="msg__body">{m.body}</pre>
            {m.error && <p className="error" style={{ margin: 0 }}>{m.error}</p>}
          </article>
        ))
      )}
    </section>
  );
}
