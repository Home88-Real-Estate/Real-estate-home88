import type { Metadata } from "next";
import Link from "next/link";
import { SELLER_STAGE_LABELS } from "@home88/domain";
import { PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { formatArea, formatDate, formatMoney } from "@/lib/format";
import { SELLER_STAGE_CLASS } from "@/lib/labels";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Ιδιοκτήτες" };

type Row = {
  id: string;
  reference: string;
  stage: string;
  listingType: string;
  ownerName: string;
  propertyType: string | null;
  areaName: string | null;
  city: string | null;
  area: number | null;
  askingPrice: number | null;
  valuation: number | null;
  property: { id: string; reference: string } | null;
  agent: { firstName: string; lastName: string } | null;
  nextFollowUpAt: string | null;
  followUpDue: boolean;
  updatedAt: string;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const OPEN = ["NEW", "CONTACTED", "VALUATION", "PROPOSAL", "MANDATE"];

export default async function SellersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const sp = await searchParams;
  const stage = first(sp.stage) || "OPEN";
  const scope = first(sp.scope);
  const q = first(sp.q);
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const result = await apiFetch<{ data: Row[]; counts: Record<string, number>; followUpsDue: number; scope: string; pagination: { page: number; pages: number; total: number } }>(
    "/api/sellers",
    {
      query: {
        stage: stage === "ALL" || stage === "DUE" ? undefined : stage,
        followUp: stage === "DUE" ? "due" : undefined,
        scope: scope || undefined,
        q: q || undefined,
        page,
      },
    },
  );
  const counts = result.ok ? result.data.counts : {};
  const countOf = (k: string) =>
    k === "OPEN" ? OPEN.reduce((s, x) => s + (counts[x] ?? 0), 0)
    : k === "ALL" ? Object.values(counts).reduce((a, b) => a + b, 0)
    : k === "DUE" ? (result.ok ? result.data.followUpsDue : 0)
    : counts[k] ?? 0;
  const tabs: Array<[string, string]> = [["OPEN", "Ανοιχτοί"], ["DUE", "Για επικοινωνία"], ...Object.entries(SELLER_STAGE_LABELS), ["ALL", "Όλοι"]];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ιδιοκτήτες</h1>
          <p className="muted">Από την πρώτη επαφή με τον ιδιοκτήτη μέχρι την ανάθεση και την καταχώριση του ακινήτου.</p>
        </div>
        <Link href="/sellers/new" className="btn btn--primary">Νέος ιδιοκτήτης</Link>
      </div>
      <nav className="tabs" aria-label="Στάδιο">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/sellers?stage=${k}${scope ? `&scope=${scope}` : ""}`} className="tabs__link" aria-current={stage === k ? "page" : undefined}>
            {l} <span className="muted">{countOf(k)}</span>
          </Link>
        ))}
      </nav>
      <form className="row no-print" style={{ marginBottom: 12 }}>
        <input type="hidden" name="stage" value={stage} />
        <input name="q" defaultValue={q} className="input input--sm" placeholder="Όνομα, κωδικός, περιοχή" aria-label="Αναζήτηση" />
        <button type="submit" className="btn btn--outline btn--sm">Αναζήτηση</button>
      </form>
      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <EmptyState title="Δεν υπάρχουν ιδιοκτήτες εδώ" text="Καταχωρίστε έναν ιδιοκτήτη που σκέφτεται να πουλήσει ή να νοικιάσει." action={{ href: "/sellers/new", label: "Νέος ιδιοκτήτης" }} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th>Ιδιοκτήτης</th>
                  <th>Ακίνητο</th>
                  <th className="num">Ζητά</th>
                  <th className="num">Εκτίμηση</th>
                  <th>Στάδιο</th>
                  <th>Επόμενη επικοινωνία</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/sellers/${s.id}`} className="mono">{s.reference}</Link></td>
                    <td>{s.ownerName}<span className="muted"> · {s.listingType === "RENT" ? "Ενοικίαση" : "Πώληση"}</span></td>
                    <td>
                      {s.property ? <span className="mono">{s.property.reference} </span> : null}
                      {[s.propertyType ? label(PROPERTY_TYPE_LABELS, s.propertyType, "el") : null, s.area ? formatArea(s.area) : null, s.areaName ?? s.city].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="num">{s.askingPrice != null ? formatMoney(s.askingPrice) : "—"}</td>
                    <td className="num">{s.valuation != null ? formatMoney(s.valuation) : "—"}</td>
                    <td><span className={SELLER_STAGE_CLASS[s.stage] ?? "badge"}>{SELLER_STAGE_LABELS[s.stage as keyof typeof SELLER_STAGE_LABELS] ?? s.stage}</span></td>
                    <td>{s.nextFollowUpAt && OPEN.includes(s.stage) ? <span className={s.followUpDue ? "badge badge--danger" : undefined}>{formatDate(s.nextFollowUpAt)}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.data.pagination.page} pages={result.data.pagination.pages} total={result.data.pagination.total} basePath="/sellers" params={{ stage, ...(scope ? { scope } : {}), ...(q ? { q } : {}) }} />
        </>
      )}
    </>
  );
}
