"use client";

import { startTransition, useActionState, useState } from "react";

import { composeMessage, type PreviewState } from "@/actions/messages";

type Template = { id: string; name: string; channel: string; purpose: string };
type State = { hasEmail: boolean; hasMobile: boolean; marketingConsent: boolean; marketingOptOut: boolean; smsOptOut: boolean; smsProvider: { state: string }; unsubscribeAvailable: boolean };

const initial: PreviewState = { ok: false };

export function Compose({ contactId, templates, state, propertyReference }: { contactId: string; templates: Template[]; state: State; propertyReference?: string }) {
  const [result, action, pending] = useActionState(composeMessage, initial);
  const [channel, setChannel] = useState<"EMAIL" | "SMS">(state.hasEmail ? "EMAIL" : "SMS");
  const [templateId, setTemplateId] = useState("");
  const list = templates.filter((t) => t.channel === channel);
  const p = result.preview;
  const err = (k: string) => result.fields?.[k]?.[0];

  // Dispatch by hand: a form bound with action={} is reset by React after each
  // submit, which would wipe the message between "preview" and "send".
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(event.currentTarget);
    fd.set("intent", submitter?.value ?? "preview");
    startTransition(() => action(fd));
  }

  return (
    <form onSubmit={onSubmit} className="formgrid">
      <input type="hidden" name="contactId" value={contactId} />
      <div className="field">
        <label htmlFor="c-channel">Κανάλι</label>
        <select id="c-channel" name="channel" className="select" value={channel} onChange={(e) => { setChannel(e.target.value as "EMAIL" | "SMS"); setTemplateId(""); }}>
          <option value="EMAIL" disabled={!state.hasEmail}>Email{state.hasEmail ? "" : " (χωρίς διεύθυνση)"}</option>
          <option value="SMS" disabled={!state.hasMobile}>SMS{state.hasMobile ? "" : " (χωρίς κινητό)"}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="c-tpl">Πρότυπο</label>
        <select id="c-tpl" name="templateId" className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">— Ελεύθερο κείμενο —</option>
          {list.map((t) => <option key={t.id} value={t.id}>{t.name}{t.purpose === "MARKETING" ? " · προώθηση" : ""}</option>)}
        </select>
      </div>
      {!templateId && (
        <>
          <div className="field">
            <label htmlFor="c-purpose">Είδος</label>
            <select id="c-purpose" name="purpose" className="select" defaultValue="SERVICE">
              <option value="SERVICE">Εξυπηρέτηση (για το αίτημά του)</option>
              <option value="MARKETING">Προώθηση (απαιτεί συγκατάθεση)</option>
            </select>
          </div>
          {channel === "EMAIL" && (
            <div className="field">
              <label htmlFor="c-subject">Θέμα</label>
              <input id="c-subject" name="subject" className="input" maxLength={200} />
              {err("subject") && <span className="error">{err("subject")}</span>}
            </div>
          )}
          <div className="field span2">
            <label htmlFor="c-body">Κείμενο</label>
            <textarea id="c-body" name="body" className="textarea textarea--sm" maxLength={5000} placeholder="Μπορείτε να χρησιμοποιήσετε πεδία, π.χ. {{contact.firstName}}" />
            {err("body") && <span className="error">{err("body")}</span>}
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="c-prop">Ακίνητο (κωδικός)</label>
        <input id="c-prop" name="propertyReference" className="input mono" maxLength={20} defaultValue={propertyReference} placeholder="H88-000123" />
        {err("propertyReference") && <span className="error">{err("propertyReference")}</span>}
      </div>
      <div className="compose__meta span2">
        <span>Συγκατάθεση για προώθηση: {state.marketingConsent ? "ναι" : "όχι"}</span>
        {state.marketingOptOut && <span className="badge badge--warn">Διαγραμμένος από ενημερώσεις</span>}
        {state.smsOptOut && <span className="badge badge--warn">Δεν δέχεται SMS</span>}
        {channel === "SMS" && state.smsProvider.state !== "configured" && <span className="badge badge--muted">Δεν έχει ρυθμιστεί πάροχος SMS</span>}
      </div>

      {p && (
        <div className="span2 msg" aria-live="polite">
          <div className="msg__head">
            <strong>Προεπισκόπηση</strong>
            <span className="muted">προς {p.to ?? "—"}</span>
            {p.segments && <span className="muted">{p.segments.length} χαρ. · {p.segments.segments} SMS ({p.segments.encoding})</span>}
          </div>
          {p.subject && <div><strong>{p.subject}</strong></div>}
          <pre className="msg__body">{p.text}</pre>
          {p.missing.length > 0 && <p className="error" style={{ margin: 0 }}>Λείπουν: {p.missing.join(", ")}</p>}
          {p.blocked && <p className="error" style={{ margin: 0 }}>{p.blocked}</p>}
        </div>
      )}

      <div className="span2 row">
        <button type="submit" name="intent" value="preview" className="btn btn--outline btn--sm" disabled={pending}>Προεπισκόπηση</button>
        <button type="submit" name="intent" value="send" className="btn btn--primary btn--sm" disabled={pending || !p || p.missing.length > 0 || !!p.blocked}>Αποστολή</button>
        {result.message && <span className={result.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{result.message}</span>}
      </div>
    </form>
  );
}
