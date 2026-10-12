import type { Metadata } from "next";
import Link from "next/link";
import {
  DELIVERY_METHOD_LABELS,
  DIRECTORY_PRIORITY_LABELS,
  DISTRIBUTION_MARKET_LABELS,
  DISTRIBUTION_STATUSES,
  DISTRIBUTION_STATUS_LABELS,
} from "@home88/domain";

import { apiFetch } from "@/lib/api";
import { STATUS_BADGE, type DirectoryResponse } from "@/lib/distribution";
import { formatDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Πύλες & Συνδέσεις" };

const FILTERS = ["q", "market", "method", "status", "priority", "country"] as const;

export default async function DistributionPortalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const k of FILTERS) {
    const v = raw[k];
    if (typeof v === "string" && v) params.set(k, v);
  }
  const result = await apiFetch<DirectoryResponse>(`/api/distribution/portals?${params.toString()}`);
  const value = (k: (typeof FILTERS)[number]) => (typeof raw[k] === "string" ? (raw[k] as string) : "");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Πύλες & Συνδέσεις</h1>
          <p className="muted">Κατάλογος προορισμών με την πραγματική κατάσταση σύνδεσης. Οι προδιαγραφές και η αποδοχή ακινήτων στην Ελλάδα δεν θεωρούνται επιβεβαιωμένες μέχρι να τις επιβεβαιώσει το ίδιο το portal.</p>
        </div>
      </div>

      <form method="get" className="filters" role="search">
        <label className="sr-only" htmlFor="q">Αναζήτηση</label>
        <input id="q" name="q" className="input" placeholder="Αναζήτηση portal ή ομίλου" defaultValue={value("q")} />
        <select name="market" className="select" defaultValue={value("market")} aria-label="Αγορά">
          <option value="">Όλες οι αγορές</option>
          {Object.entries(DISTRIBUTION_MARKET_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="method" className="select" defaultValue={value("method")} aria-label="Τρόπος παράδοσης">
          <option value="">Κάθε τρόπος παράδοσης</option>
          {Object.entries(DELIVERY_METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="status" className="select" defaultValue={value("status")} aria-label="Κατάσταση">
          <option value="">Κάθε κατάσταση</option>
          {DISTRIBUTION_STATUSES.map((s) => <option key={s} value={s}>{DISTRIBUTION_STATUS_LABELS[s]}</option>)}
        </select>
        <select name="priority" className="select" defaultValue={value("priority")} aria-label="Προτεραιότητα">
          <option value="">Κάθε προτεραιότητα</option>
          {Object.entries(DIRECTORY_PRIORITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="btn btn--outline" type="submit">Φίλτρο</button>
        {params.size > 0 && <Link className="btn btn--ghost" href="/distribution/portals">Καθαρισμός</Link>}
      </form>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <div className="empty">Κανένα αποτέλεσμα για αυτά τα φίλτρα.</div>
      ) : (
        <ul className="pubchannels">
          {result.data.data.map((r) => (
            <li key={r.key} className="pubchan">
              <div className="pubchan__head">
                <strong>{r.name}</strong>
                <span className={STATUS_BADGE[r.status]}>{DISTRIBUTION_STATUS_LABELS[r.status]}</span>
                <span className="badge badge--muted">{r.country === "INT" ? "Διεθνές" : r.country}</span>
              </div>
              <div className="pubchan__body">
                <p className="hint">
                  {r.market === "GR" ? "" : `${DISTRIBUTION_MARKET_LABELS[r.market]} · `}{DIRECTORY_PRIORITY_LABELS[r.priority]}
                  {r.group ? ` · ${r.group}` : ""} · Παράδοση: {DELIVERY_METHOD_LABELS[r.delivery]} ·{" "}
                  {r.specification === "DOCUMENTED" ? "υπάρχει δημοσιευμένη προδιαγραφή (δεν έχει επικυρωθεί από το portal)" : "προδιαγραφές μη επιβεβαιωμένες"} ·{" "}
                  {r.greece === "YES" ? "ελληνική αγορά" : "αποδοχή ελληνικών ακινήτων: άγνωστη"}
                </p>
                {r.note && <p>{r.note}</p>}
                {r.caution && <p className="notice notice--warn">{r.caution}</p>}
                {r.live?.lastSuccessAt && <p className="hint">Τελευταίος επιτυχής συγχρονισμός: {formatDateTime(r.live.lastSuccessAt)}</p>}
                {r.live?.lastError && <p className="hint">Τελευταίο σφάλμα: {r.live.lastError}</p>}
                {r.catalogCode && <p><Link href={`/settings/portals/${r.catalogCode}`}>Ρύθμιση σύνδεσης</Link></p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
