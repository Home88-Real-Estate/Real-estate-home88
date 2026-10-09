"use client";

import { useActionState, useState } from "react";

import type { ChannelAccountChoice, ChannelOperation, ChannelResult, ChannelView, PublicationsPayload } from "@home88/domain";

import { publicationOperation, type PublicationActionState } from "@/actions/publications";

const STATUS: Record<string, string> = {
  DRAFT: "Πρόχειρο", READY: "Έτοιμο", VALIDATION_FAILED: "Δεν περνά τον έλεγχο", PUBLISHED: "Δημοσιευμένο", OUTDATED: "Δημοσιευμένο · χρειάζεται ενημέρωση",
  UPDATE_PENDING: "Δημοσιευμένο · ενημέρωση σε εξέλιξη", UNPUBLISHED: "Μη δημοσιευμένο", SOLD: "Πωλήθηκε", RENTED: "Ενοικιάστηκε", ARCHIVED: "Αρχειοθετημένο",
  NOT_PUBLISHED: "Δεν έχει δημοσιευτεί", FAILED: "Αποτυχία", IN_FEED: "Στο feed", REMOVED: "Αποσύρθηκε", NOT_CONFIGURED: "Δεν έχει ρυθμιστεί",
  BLOCKED: "Μπλοκαρισμένο", VALIDATED: "Ο έλεγχος πέρασε", PREVIEWED: "Προεπισκόπηση", UPDATED: "Ενημερώθηκε", UNCHANGED: "Καμία αλλαγή", REJECTED: "Απορρίφθηκε",
};
const label = (s: string) => STATUS[s] ?? s;

const OPS: Array<{ op: ChannelOperation; text: string; primary?: boolean; allowed: (v: ChannelView) => boolean }> = [
  { op: "validate", text: "Έλεγχος", allowed: (v) => v.actions.validate },
  { op: "preview", text: "Προεπισκόπηση", allowed: (v) => v.actions.preview },
  { op: "publish", text: "Δημοσίευση επιλεγμένων", primary: true, allowed: (v) => v.actions.publish },
  { op: "update", text: "Ενημέρωση", allowed: (v) => v.actions.update },
  { op: "unpublish", text: "Απόσυρση", allowed: (v) => v.actions.unpublish },
];

function usable(accounts: ChannelAccountChoice[]) { return accounts.filter((a) => a.providerKind !== "none"); }

export function PublicationForm({ propertyId, data }: { propertyId: string; data: PublicationsPayload }) {
  const channels = [data.website, ...data.portals];
  const [state, action, pending] = useActionState<PublicationActionState, FormData>(publicationOperation, {});
  // Selection is transient (this screen only); the server holds the real state.
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [accounts, setAccounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.portals.map((p) => [p.code, p.accountId ?? usable(p.accounts).find((a) => a.enabled)?.id ?? usable(p.accounts)[0]?.id ?? ""])),
  );
  const results = new Map<string, ChannelResult>((state.ran?.results ?? []).map((r) => [r.channel, r]));
  const anyPicked = channels.some((c) => picked[c.code]);
  const pickedViews = channels.filter((c) => picked[c.code]);

  return (
    <form action={action} className="pubpanel">
      <input type="hidden" name="propertyId" value={propertyId} />
      <ul className="pubchannels">
            {channels.map((c) => {
              const acct = c.accounts.find((a) => a.id === accounts[c.code]);
              const r = results.get(c.code);
              const selectable = c.operational;
              return (
                <li key={c.code} className="pubchan">
                  <div className="pubchan__head">
                    <label className="pubchan__pick">
                      <input type="checkbox" name="channel" value={c.code} disabled={!selectable} checked={!!picked[c.code]} onChange={(e) => setPicked({ ...picked, [c.code]: e.target.checked })} />
                      <span>{c.name}</span>
                    </label>
                    {c.kind === "PORTAL" && c.mock && <span className="badge badge--muted">mock</span>}
                    <span className="badge">{label(c.status)}</span>
                    {c.readiness === "BLOCKED" && <span className="badge badge--danger">Μπλοκαρισμένο</span>}
                    {c.readiness === "NOT_CONFIGURED" && <span className="badge badge--muted">Δεν έχει ρυθμιστεί</span>}
                  </div>
                  <div className="pubchan__body">
                    {c.kind === "PORTAL" && usable(c.accounts).length > 0 && (
                      <>
                        <label className="sr-only" htmlFor={`acct-${c.code}`}>Λογαριασμός {c.name}</label>
                        <select id={`acct-${c.code}`} className="select" name={`account.${c.code}`} value={accounts[c.code]} onChange={(e) => setAccounts({ ...accounts, [c.code]: e.target.value })}>
                          {usable(c.accounts).map((a) => <option key={a.id} value={a.id}>{a.accountName} · {a.environment}{a.providerKind === "mock" ? " · mock" : ""}{a.enabled ? "" : " · ανενεργός"}</option>)}
                        </select>
                        <input type="hidden" name={`environment.${c.code}`} value={acct?.environment ?? "TEST"} />
                      </>
                    )}
                    {c.blockers.length > 0 && <ul className="pubchan__blockers">{c.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
                    {c.warnings.length > 0 && <p className="hint">{c.warnings.join(" · ")}</p>}
                    {c.note && <p className="hint">{c.note}</p>}
                    {c.mock && <p className="hint">Mock πάροχος: δεν γίνεται επικοινωνία με πραγματικό portal.</p>}
                    {c.url && <p><a href={c.url} target="_blank" rel="noreferrer">{c.kind === "WEBSITE" ? "Δημόσια σελίδα" : "Αγγελία στο portal"}</a></p>}
                    {c.externalId && <p className="hint mono">ID {c.externalId}</p>}
                    {c.lastSuccessAt && <p className="hint">Τελευταία επιτυχία: {new Date(c.lastSuccessAt).toLocaleString("el-GR")}</p>}
                    {c.lastError && <p className="hint">Τελευταίο σφάλμα: {c.lastError}</p>}
                    {r && (
                      <div className={r.ok ? "notice notice--ok" : "notice notice--danger"} role={r.ok ? "status" : "alert"}>
                        {label(r.status)} — {r.message}
                        {r.mock && " (mock — όχι πραγματική δημοσίευση)"}
                        {r.revalidation && !r.revalidation.ok && r.revalidation.attempted && " · Η δημόσια σελίδα θα ανανεωθεί σε λίγα λεπτά."}
                        {r.blockers.length > 0 && <ul>{r.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
      </ul>
      <div className="pubpanel__buttons">
        {OPS.map((o) => (
          <button key={o.op} type="submit" name="op" value={o.op} className={o.primary ? "btn btn--primary btn--sm" : "btn btn--outline btn--sm"} disabled={pending || !anyPicked || !pickedViews.every((v) => o.allowed(v))}>
            {o.text}
          </button>
        ))}
      </div>
      {state.error && <div className="notice notice--danger" role="alert">{state.error}</div>}
      {state.ran && (
        <p className="hint" role="status">
          {state.ran.summary.ok} επιτυχή · {state.ran.summary.failed} όχι. Τα κανάλια εκτελούνται ανεξάρτητα.
        </p>
      )}
    </form>
  );
}
