"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  cancelDistribution, createDistribution, planDistribution, processDistribution, retryDistribution,
  type Batch, type Operation, type Plan, type PortalChoice, type Selection,
} from "@/actions/distribution";

export type WorkspaceRow = {
  id: string; reference: string; title: string; status: string; price: number | null; priceOnRequest: boolean; city: string | null; areaName: string | null; agent: string | null;
  website: { status: string; enabled: boolean } | null; portals: { published: number; issues: number };
};
export type Destination = { code: string; name: string; accounts: Array<{ id: string; accountName: string; environment: "TEST" | "PRODUCTION"; enabled: boolean; providerKind: "mock" | "real" }> };

const OP_LABEL: Record<Operation, string> = { publish: "Δημοσίευση", update: "Ενημέρωση", unpublish: "Απόσυρση" };
const ITEM_LABEL: Record<string, string> = { QUEUED: "Σε ουρά", RUNNING: "Εκτελείται", SUCCEEDED: "Επιτυχία", FAILED: "Αποτυχία", BLOCKED: "Μπλοκαρισμένο", CANCELLED: "Ακυρώθηκε" };
const STORE = "home88.distribution.selection";

type Stored = { key: string; all: boolean; ids: string[]; excluded: string[] };

const money = (v: number | null, onRequest: boolean) => (onRequest ? "Κατόπιν αιτήματος" : v == null ? "—" : new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));

/**
 * Selecting properties across pages, choosing portals, checking, then running a
 * durable batch whose progress and per-item outcomes are shown here. The server
 * decides everything (what matches a filter, what is allowed, what ran); this
 * component only holds the selection and drives the polling.
 */
export function DistributionWorkspace({ rows, total, page, limit, maxBatch, filter, destinations }: {
  rows: WorkspaceRow[]; total: number; page: number; limit: number; maxBatch: number; filter: Record<string, string>; destinations: Destination[];
}) {
  const filterKey = useMemo(() => JSON.stringify(filter), [filter]);
  const [all, setAll] = useState(false);
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [operation, setOperation] = useState<Operation>("publish");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [accounts, setAccounts] = useState<Record<string, string>>(() => Object.fromEntries(destinations.map((d) => [d.code, (d.accounts.find((a) => a.enabled) ?? d.accounts[0])?.id ?? ""])));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const stop = useRef(false);
  const key = useRef<string>("");

  // The selection survives paging; a different filter starts a new one.
  useEffect(() => {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as Stored | null;
      if (s && s.key === filterKey) { setAll(s.all); setIds(new Set(s.ids)); setExcluded(new Set(s.excluded)); }
      else sessionStorage.removeItem(STORE);
    } catch { /* storage unavailable: selection just won't persist */ }
  }, [filterKey]);
  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify({ key: filterKey, all, ids: [...ids], excluded: [...excluded] } satisfies Stored)); } catch { /* ignore */ }
  }, [filterKey, all, ids, excluded]);

  const selectedCount = all ? total - excluded.size : ids.size;
  const pageIds = rows.map((r) => r.id);
  const pageAllChecked = pageIds.length > 0 && pageIds.every((id) => (all ? !excluded.has(id) : ids.has(id)));
  const isChecked = (id: string) => (all ? !excluded.has(id) : ids.has(id));

  const toggle = (id: string) => {
    if (all) setExcluded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    else setIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    setPlan(null);
  };
  const togglePage = () => {
    if (all) setExcluded((s) => { const n = new Set(s); for (const id of pageIds) { if (pageAllChecked) n.add(id); else n.delete(id); } return n; });
    else setIds((s) => { const n = new Set(s); for (const id of pageIds) { if (pageAllChecked) n.delete(id); else n.add(id); } return n; });
    setPlan(null);
  };
  const clear = () => { setAll(false); setIds(new Set()); setExcluded(new Set()); setPlan(null); };
  const selectAllMatching = () => { setAll(true); setExcluded(new Set()); setPlan(null); };

  const selection = (): Selection => (all ? { filter, exclude: [...excluded] } : { ids: [...ids] });
  const choices = (): PortalChoice[] =>
    destinations.filter((d) => picked[d.code]).map((d) => {
      const a = d.accounts.find((x) => x.id === accounts[d.code]);
      return { code: d.code, accountId: a?.id ?? "", environment: a?.environment ?? "TEST" };
    });

  const check = () => {
    setError(null); setBatch(null);
    startTransition(async () => {
      const r = await planDistribution(operation, selection(), choices());
      if (r.ok) setPlan(r.data); else { setPlan(null); setError(r.message); }
    });
  };

  const poll = useCallback(async (id: string) => {
    stop.current = false;
    for (let i = 0; i < 400 && !stop.current; i++) {
      const r = await processDistribution(id);
      if (!r.ok) { setError(r.message); return; }
      setBatch(r.data);
      if (r.data.status === "COMPLETED" || r.data.status === "CANCELLED") return;
    }
  }, []);
  useEffect(() => () => { stop.current = true; }, []);

  const start = () => {
    setError(null);
    if (!key.current) key.current = `ui-${crypto.randomUUID()}`;
    startTransition(async () => {
      const r = await createDistribution(operation, selection(), choices(), key.current);
      if (!r.ok) { setError(r.message); return; }
      key.current = "";
      setPlan(null);
      await poll(r.data.id);
    });
  };
  const cancel = () => { if (!batch) return; stop.current = true; startTransition(async () => { const r = await cancelDistribution(batch.id); if (r.ok) setBatch(r.data); else setError(r.message); }); };
  const retry = () => { if (!batch) return; startTransition(async () => { const r = await retryDistribution(batch.id); if (!r.ok) { setError(r.message); return; } setBatch(r.data); await poll(batch.id); }); };

  const running = batch !== null && batch.status !== "COMPLETED" && batch.status !== "CANCELLED";
  const hasPortal = choices().length > 0;
  const lastPage = Math.max(1, Math.ceil(total / limit));
  const href = (p: number) => `?${new URLSearchParams({ ...filter, page: String(p) }).toString()}`;

  return (
    <div className="distws">
      {(selectedCount > 0 || all) && (
        <div className="distws__bar" role="status">
          <strong>{selectedCount}</strong> {selectedCount === 1 ? "ακίνητο επιλέχθηκε" : "ακίνητα επιλέχθηκαν"}
          {all ? ` (όλα τα αποτελέσματα του φίλτρου${excluded.size ? `, εκτός ${excluded.size}` : ""})` : ""}.
          <button type="button" className="btn btn--ghost btn--sm" onClick={clear}>Καθαρισμός επιλογής</button>
        </div>
      )}
      {pageAllChecked && !all && total > rows.length && (
        <div className="notice">
          Επιλέχθηκαν και τα {rows.length} ακίνητα αυτής της σελίδας. {total <= maxBatch ? (
            <button type="button" className="btn btn--outline btn--sm" onClick={selectAllMatching}>Επιλογή και των {total} αποτελεσμάτων του φίλτρου</button>
          ) : (<span>Το φίλτρο έχει {total} αποτελέσματα· μία ενέργεια δέχεται έως {maxBatch}. Περιορίστε το φίλτρο για να τα επιλέξετε όλα.</span>)}
        </div>
      )}

      <ul className="pubchannels">
        <li className="pubchan"><label className="pubchan__pick"><input type="checkbox" checked={pageAllChecked} onChange={togglePage} aria-label="Επιλογή όλων της σελίδας" /> Επιλογή σελίδας ({rows.length})</label></li>
        {rows.map((r) => (
          <li key={r.id} className="pubchan">
            <div className="pubchan__head">
              <label className="pubchan__pick"><input type="checkbox" checked={isChecked(r.id)} onChange={() => toggle(r.id)} aria-label={`Επιλογή ${r.reference}`} /> <Link href={`/properties/${r.id}#publication`}>{r.reference}</Link></label>
              <span className="badge">{r.status}</span>
              <span className="badge badge--muted">Ιστότοπος: {r.website?.enabled ? "δημοσιευμένο" : "όχι"}</span>
              <span className="badge badge--muted">Portals: {r.portals.published} δημοσιευμένα{r.portals.issues ? ` · ${r.portals.issues} με σφάλμα` : ""}</span>
            </div>
            <div className="pubchan__body"><p>{r.title}</p><p className="hint">{[r.areaName, r.city].filter(Boolean).join(", ") || "—"} · {money(r.price, r.priceOnRequest)} · {r.agent ?? "Χωρίς ανάθεση"}</p></div>
          </li>
        ))}
      </ul>
      <nav className="pager" aria-label="Σελίδες">
        {page > 1 && <Link className="btn btn--outline btn--sm" href={href(page - 1)}>← Προηγούμενη</Link>}
        <span className="hint">Σελίδα {page} από {lastPage} · {total} ακίνητα</span>
        {page < lastPage && <Link className="btn btn--outline btn--sm" href={href(page + 1)}>Επόμενη →</Link>}
      </nav>

      {selectedCount > 0 && (
        <section className="panel" aria-label="Μαζική ενέργεια">
          <div className="panel__head"><h2>Μαζική ενέργεια σε {selectedCount} ακίνητα</h2></div>
          {destinations.length === 0 ? (
            <div className="notice">Δεν υπάρχει portal με λειτουργικό adapter και λογαριασμό. Ρυθμίστε έναν στις <Link href="/settings/portals">Ρυθμίσεις διανομής</Link>.</div>
          ) : (
            <>
              <label>Ενέργεια{" "}
                <select className="select" value={operation} onChange={(e) => { setOperation(e.target.value as Operation); setPlan(null); }} disabled={running}>
                  {(Object.keys(OP_LABEL) as Operation[]).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
                </select>
              </label>
              <ul className="pubchannels">
                {destinations.map((d) => (
                  <li key={d.code} className="pubchan">
                    <div className="pubchan__head">
                      <label className="pubchan__pick"><input type="checkbox" checked={!!picked[d.code]} onChange={(e) => { setPicked({ ...picked, [d.code]: e.target.checked }); setPlan(null); }} disabled={running} /> {d.name}</label>
                      {d.accounts.find((a) => a.id === accounts[d.code])?.providerKind === "mock" && <span className="badge badge--muted">mock · όχι πραγματική δημοσίευση</span>}
                    </div>
                    <div className="pubchan__body">
                      <select className="select" aria-label={`Λογαριασμός ${d.name}`} value={accounts[d.code]} onChange={(e) => { setAccounts({ ...accounts, [d.code]: e.target.value }); setPlan(null); }} disabled={running}>
                        {d.accounts.map((a) => <option key={a.id} value={a.id}>{a.accountName} · {a.environment}{a.providerKind === "mock" ? " · mock" : ""}{a.enabled ? "" : " · ανενεργός"}</option>)}
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="pubpanel__buttons">
                <button type="button" className="btn btn--outline btn--sm" onClick={check} disabled={busy || running || !hasPortal}>Έλεγχος επιλογής</button>
                <button type="button" className="btn btn--primary btn--sm" onClick={start} disabled={busy || running || !plan || plan.summary.ready === 0}>Έναρξη ({plan?.summary.ready ?? 0} ενέργειες)</button>
              </div>
            </>
          )}
          {error && <div className="notice notice--danger" role="alert">{error}</div>}

          {plan && (
            <div className="distws__plan" role="status">
              <p><strong>{plan.summary.ready}</strong> έτοιμες · <strong>{plan.summary.blocked}</strong> μπλοκαρισμένες από {plan.propertyCount} ακίνητα × {plan.portals.length} portal. Τίποτα δεν έχει σταλεί ακόμη.</p>
              {plan.readyPreview.some((i) => i.mock) && <p className="hint">Ο επιλεγμένος λογαριασμός είναι mock: δεν θα γίνει επικοινωνία με πραγματικό portal.</p>}
              {plan.blockerGroups.length > 0 && (
                <ul className="pubchan__blockers">{plan.blockerGroups.slice(0, 8).map((g) => <li key={g.message}>{g.count} × {g.message}</li>)}</ul>
              )}
              {plan.items.length > 0 && <details><summary>Μπλοκαρισμένα ({plan.summary.blocked}){plan.summary.blocked > plan.items.length ? ` — πρώτα ${plan.items.length}` : ""}</summary><ul>{plan.items.map((i) => <li key={`${i.propertyId}-${i.portalCode}`}>{i.reference ?? i.propertyId} · {i.portalCode}: {i.blockers.join(" · ")}</li>)}</ul></details>}
            </div>
          )}
        </section>
      )}

      {batch && (
        <section className="panel" aria-label="Πρόοδος" aria-live="polite">
          <div className="panel__head"><h2>{OP_LABEL[batch.operation as Operation] ?? batch.operation} · {batch.status === "COMPLETED" ? "ολοκληρώθηκε" : batch.status === "CANCELLED" ? "ακυρώθηκε" : "σε εξέλιξη"}</h2></div>
          <progress value={Math.round(batch.progress * 100)} max={100} aria-label="Πρόοδος" />
          <p>{Object.entries(batch.counts).filter(([, n]) => n > 0).map(([k, n]) => `${ITEM_LABEL[k] ?? k}: ${n}`).join(" · ")}</p>
          <div className="pubpanel__buttons">
            {running && <button type="button" className="btn btn--outline btn--sm" onClick={cancel} disabled={busy}>Ακύρωση υπολειπόμενων</button>}
            {!running && batch.counts.FAILED! > 0 && <button type="button" className="btn btn--primary btn--sm" onClick={retry} disabled={busy}>Επανάληψη αποτυχημένων ({batch.counts.FAILED})</button>}
          </div>
          <ul className="pubchannels">
            {[...batch.items].sort((a, b) => Number(b.status === "FAILED") - Number(a.status === "FAILED")).map((i) => (
              <li key={i.id} className="pubchan">
                <div className="pubchan__head"><strong>{i.reference ?? i.propertyId}</strong><span className={i.status === "FAILED" ? "badge badge--danger" : "badge"}>{ITEM_LABEL[i.status] ?? i.status}</span><span className="badge badge--muted">{i.portalCode}</span>{i.mock && <span className="badge badge--muted">mock</span>}</div>
                <div className="pubchan__body">{i.message && <p className="hint">{i.message}</p>}{i.externalId && <p className="hint mono">ID {i.externalId}</p>}</div>
              </li>
            ))}
          </ul>
          {batch.total > batch.pageSize && <p className="hint">Εμφανίζονται οι πρώτες {batch.pageSize} γραμμές.</p>}
        </section>
      )}
    </div>
  );
}
