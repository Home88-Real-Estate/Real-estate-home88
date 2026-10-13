import type { Metadata } from "next";
import Link from "next/link";

import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Αναλύσεις & Προτάσεις" };

type Queue = { key: string; label: string; count: number; href: string | null; hint: string };
type Row = { channel: string; listingType: string; listingWeeks: number; enquiries: number; qualified: number; viewings: number; offers: number; closedTransactions: number; enquiriesPerListingWeek: number | null; qualifiedPerListingWeek: number | null; note: string | null };
type Payload = {
  queues: Queue[];
  performance: { window: { from: string; to: string; days: number }; observedFrom: string | null; rows: Row[]; sample: { leads: number; truncated: boolean }; unavailable: string[]; definitions: Record<string, string> };
};

const CHANNEL: Record<string, string> = { WEBSITE: "Ιστότοπος HOME88", SPITOGATOS: "Spitogatos", XE_GR: "XE.gr", PORTAL_OTHER: "Άλλα portals" };
const TYPE: Record<string, string> = { SALE: "Πώληση", RENT: "Ενοικίαση", ASSIGNMENT: "Εκχώρηση" };
const DAYS = [30, 90, 180, 365];

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const raw = await searchParams;
  const days = DAYS.includes(Number(raw.days)) ? Number(raw.days) : 90;
  const res = await apiFetch<Payload>("/api/distribution/insights", { query: { days } });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Αναλύσεις & Προτάσεις</h1>
          <p className="muted">Τι χρειάζεται ενέργεια τώρα, και τι έχει μετρηθεί πραγματικά ανά προορισμό. Μετρήσεις που δεν υπάρχουν εμφανίζονται ως μη διαθέσιμες, ποτέ ως μηδέν.</p>
        </div>
      </div>
      {!res.ok ? (
        <div className="notice notice--danger">{res.error.message}</div>
      ) : (
        <>
          <div className="panel">
            <div className="panel__head"><h2>Εκκρεμότητες</h2></div>
            <ul className="pubchannels">
              {res.data.queues.map((q) => (
                <li key={q.key} className="pubchan">
                  <div className="pubchan__head">
                    <strong>{q.count}</strong>
                    {q.href && q.count > 0 ? <Link href={q.href}>{q.label}</Link> : <span>{q.label}</span>}
                  </div>
                  <div className="pubchan__body"><p className="hint">{q.hint}</p></div>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h2>Μετρημένη απόδοση ανά προορισμό</h2>
              <form method="get" className="filters"><select name="days" className="select" defaultValue={String(days)} aria-label="Διάστημα">{DAYS.map((d) => <option key={d} value={d}>Τελευταίες {d} ημέρες</option>)}</select><button className="btn btn--outline btn--sm" type="submit">Εμφάνιση</button></form>
            </div>
            <p className="hint">
              Διάστημα: {formatDateTime(res.data.performance.window.from)} – {formatDateTime(res.data.performance.window.to)}.{" "}
              {res.data.performance.observedFrom ? `Το ιστορικό δημοσιεύσεων ξεκινά ${formatDateTime(res.data.performance.observedFrom)}· ό,τι έγινε πριν δεν μετράται ως έκθεση.` : "Δεν υπάρχει ακόμη ιστορικό δημοσιεύσεων."}{" "}
              Δείγμα: {res.data.performance.sample.leads} επαφές{res.data.performance.sample.truncated ? " (περικομμένο)" : ""}.
            </p>
            {res.data.performance.rows.length === 0 ? (
              <div className="empty">Δεν υπάρχουν ακόμη επαφές από portals ή ιστότοπο ούτε ιστορικό δημοσιεύσεων σε αυτό το διάστημα.</div>
            ) : (
              <ul className="pubchannels">
                {res.data.performance.rows.map((r) => (
                  <li key={`${r.channel}-${r.listingType}`} className="pubchan">
                    <div className="pubchan__head"><strong>{CHANNEL[r.channel] ?? r.channel}</strong><span className="badge badge--muted">{TYPE[r.listingType] ?? r.listingType}</span></div>
                    <div className="pubchan__body">
                      <p>
                        {r.enquiries} επαφές · {r.qualified} αξιολογημένες · {r.viewings} υποδείξεις · {r.offers} προσφορές · {r.closedTransactions} κλεισμένες συναλλαγές · {r.listingWeeks} εβδομάδες έκθεσης
                      </p>
                      <p>{r.enquiriesPerListingWeek === null ? <span className="hint">Ρυθμός επαφών: μη διαθέσιμος</span> : <>Ρυθμός: <strong>{r.enquiriesPerListingWeek}</strong> επαφές ανά αγγελία-εβδομάδα ({r.qualifiedPerListingWeek} αξιολογημένες)</>}</p>
                      {r.note && <p className="hint">{r.note}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary>Ορισμοί και όρια</summary>
              <ul>{Object.entries(res.data.performance.definitions).map(([k, v]) => <li key={k}>{v}</li>)}</ul>
              <p className="hint">Μη διαθέσιμες μετρήσεις:</p>
              <ul>{res.data.performance.unavailable.map((u) => <li key={u}>{u}</li>)}</ul>
            </details>
          </div>
        </>
      )}
    </>
  );
}
