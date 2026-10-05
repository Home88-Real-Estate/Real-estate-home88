import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { REPORT_LABELS, isReportKind } from "@home88/domain";

import { AiSummary } from "@/components/reports/AiSummary";
import { apiFetch } from "@/lib/api";
import { formatCell, formatMetric, type Report } from "@/lib/reports";
import { CRM_BASE_PATH } from "@/lib/paths";
import { hasRole, requireRole } from "@/lib/session";

const RANGES = [
  { key: "today", label: "Σήμερα" },
  { key: "week", label: "Εβδομάδα" },
  { key: "month", label: "Μήνας" },
  { key: "quarter", label: "Τρίμηνο" },
  { key: "year", label: "Έτος" },
] as const;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const day = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens", day: "numeric", month: "long", year: "numeric" });

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const { kind } = await params;
  return { title: isReportKind(kind) ? REPORT_LABELS[kind].title : "Στατιστικά" };
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("AGENT");
  const { kind } = await params;
  if (!isReportKind(kind)) notFound();
  const sp = await searchParams;
  const manager = hasRole(user.role, "MANAGER");
  if (!hasRole(user.role, REPORT_LABELS[kind].minRole)) {
    return <div className="notice notice--danger">Η αναφορά είναι διαθέσιμη μόνο σε υπευθύνους. <Link href="/reports">Επιστροφή</Link></div>;
  }

  const query = { range: first(sp.range) || undefined, from: first(sp.from) || undefined, to: first(sp.to) || undefined, scope: first(sp.scope) || undefined };
  const [result, ai] = await Promise.all([
    apiFetch<Report>(`/api/reports/${kind}`, { query }),
    apiFetch<{ features: { REPORT_SUMMARY: boolean } }>("/api/ai/status"),
  ]);
  if (!result.ok) return <div className="notice notice--danger">{result.error.message}</div>;
  const report = result.data;
  const mine = report.scope === "mine";

  const href = (change: Partial<typeof query>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...query, ...change })) if (v) params.set(k, v);
    const qs = params.toString();
    return `/reports/${kind}${qs ? `?${qs}` : ""}`;
  };
  const csv = (table: string) => {
    const params = new URLSearchParams({ format: "csv", table });
    for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
    return `${CRM_BASE_PATH}/api/reports/${kind}?${params.toString()}`;
  };
  const rangeKey = report.period.key;
  const last = new Date(new Date(report.period.to).getTime() - 1);

  return (
    <>
      <div className="dash-head">
        <div>
          <p className="muted"><Link href="/reports">‹ Στατιστικά</Link></p>
          <h1>{report.title}</h1>
          <p>
            <span>Περίοδος: {day.format(new Date(report.period.from))} – {day.format(last)}</span> · {mine ? "Τα δικά μου" : "Όλο το γραφείο"}
          </p>
        </div>
        <div className="dash-filters">
          {manager && kind !== "sales" && kind !== "communications" && (
            <nav className="seg" aria-label="Εύρος δεδομένων">
              <Link href={href({ scope: "mine" })} aria-current={mine ? "true" : undefined}>Τα δικά μου</Link>
              <Link href={href({ scope: "all" })} aria-current={!mine ? "true" : undefined}>Όλο το γραφείο</Link>
            </nav>
          )}
          <nav className="seg" aria-label="Περίοδος">
            {RANGES.map((r) => (
              <Link key={r.key} href={href({ range: r.key, from: undefined, to: undefined })} aria-current={rangeKey === r.key ? "true" : undefined}>{r.label}</Link>
            ))}
          </nav>
          <details className="range-custom" open={rangeKey === "custom" || undefined}>
            <summary className={rangeKey === "custom" ? "btn btn--outline btn--sm is-active" : "btn btn--ghost btn--sm"}>Προσαρμοσμένο</summary>
            <form method="get" action={`${CRM_BASE_PATH}/reports/${kind}`} className="range-custom__form">
              <input type="hidden" name="range" value="custom" />
              {query.scope && <input type="hidden" name="scope" value={query.scope} />}
              <label>Από<input type="date" name="from" className="input" defaultValue={query.from} required /></label>
              <label>Έως<input type="date" name="to" className="input" defaultValue={query.to} required /></label>
              <button type="submit" className="btn btn--primary btn--sm">Εφαρμογή</button>
            </form>
          </details>
        </div>
      </div>

      <div className="stat-grid report-summary">
        {report.summary.map((m) => (
          <div className="stat" key={m.key}>
            <div className="label">{m.label}</div>
            <div className="value">{formatMetric(m.value, m.unit)}</div>
          </div>
        ))}
      </div>

      {ai.ok && ai.data.features.REPORT_SUMMARY && <AiSummary kind={kind} query={query} />}

      {report.truncated && <div className="notice">Η αναφορά κόπηκε στο όριο των 20.000 εγγραφών· τα νούμερα είναι μερικά. Στενέψτε την περίοδο.</div>}

      {report.tables.map((t) => (
        <section key={t.key} className="panel" aria-labelledby={`t-${t.key}`}>
          <div className="panel__head">
            <h2 id={`t-${t.key}`}>{t.title}</h2>
            <a className="btn btn--outline btn--sm" href={csv(t.key)} download>Λήψη CSV</a>
          </div>
          {t.rows.length === 0 ? (
            <p className="muted">Δεν υπάρχουν δεδομένα για την περίοδο.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>{t.columns.map((c) => <th key={c.key} scope="col" className={c.numeric ? "num" : undefined}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {t.rows.map((row, i) => (
                    <tr key={i}>{t.columns.map((c) => <td key={c.key} className={c.numeric ? "num" : undefined}>{formatCell(row[c.key] ?? null)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      <details className="panel report-defs" open>
        <summary><strong>Πώς μετράμε</strong></summary>
        <ul>
          {report.definitions.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      </details>
    </>
  );
}
