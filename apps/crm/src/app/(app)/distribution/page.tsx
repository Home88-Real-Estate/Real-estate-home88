import type { Metadata } from "next";
import Link from "next/link";
import { DISTRIBUTION_STATUSES, DISTRIBUTION_STATUS_LABELS } from "@home88/domain";

import { apiFetch } from "@/lib/api";
import { STATUS_BADGE, type DirectoryResponse } from "@/lib/distribution";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Πύλες & Διανομή" };

/** Where HOME88 stands on every destination: real counts, each opening the matching list. */
export default async function DistributionOverviewPage() {
  await requireRole("AGENT");
  const result = await apiFetch<DirectoryResponse>("/api/distribution/portals");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Πύλες & Διανομή</h1>
          <p className="muted">
            Η κατάσταση κάθε προορισμού. Ένα όνομα στον κατάλογο δεν σημαίνει σύνδεση: «Συνδεδεμένο» εμφανίζεται μόνο μετά από πραγματικά επιτυχημένο συγχρονισμό.
          </p>
        </div>
        <Link className="btn btn--primary" href="/distribution/portals">Πύλες & Συνδέσεις</Link>
      </div>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : (
        <>
          <div className="stat-grid">
            {DISTRIBUTION_STATUSES.filter((s) => result.data.counts[s] > 0).map((s) => (
              <Link key={s} className="stat" href={`/distribution/portals?status=${s}`}>
                <div className="label"><span className={STATUS_BADGE[s]}>{DISTRIBUTION_STATUS_LABELS[s]}</span></div>
                <div className="value">{result.data.counts[s]}</div>
              </Link>
            ))}
          </div>
          <div className="panel">
            <div className="panel__head"><h2>Τι χρειάζεται ενέργεια</h2></div>
            <ul>
              {result.data.data.filter((r) => r.status === "SYNC_ERROR").map((r) => (
                <li key={r.key}>{r.name}: {r.live?.lastError ?? "σφάλμα συγχρονισμού"} · <Link href={`/settings/portals/${r.catalogCode}`}>Άνοιγμα</Link></li>
              ))}
              {result.data.data.filter((r) => r.status === "AWAITING_ACCOUNT").map((r) => (
                <li key={r.key}>{r.name}: χρειάζεται λογαριασμός ή διαπιστευτήρια · <Link href={`/settings/portals/${r.catalogCode}`}>Ρύθμιση</Link></li>
              ))}
              {result.data.counts.SYNC_ERROR + result.data.counts.AWAITING_ACCOUNT === 0 && <li className="muted">Δεν υπάρχει εκκρεμότητα.</li>}
            </ul>
            <p className="hint">Η μαζική δημοσίευση και το κέντρο συγχρονισμού θα προστεθούν στη συνέχεια· δεν εμφανίζονται μέχρι να λειτουργούν.</p>
          </div>
        </>
      )}
    </>
  );
}
