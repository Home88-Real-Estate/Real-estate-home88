import type { Metadata } from "next";
import Link from "next/link";

import { apiFetch } from "@/lib/api";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Στατιστικά" };

export default async function ReportsPage() {
  await requireRole("AGENT");
  const result = await apiFetch<{ data: Array<{ kind: string; title: string; description: string }> }>("/api/reports");
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Στατιστικά</h1>
          <p className="muted">Αναφορές που μετρώνται απευθείας από τα στοιχεία του CRM, με τον ορισμό κάθε αριθμού δίπλα του. Κάθε πίνακας κατεβαίνει σε CSV.</p>
        </div>
      </div>
      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : (
        <div className="report-cards">
          {result.data.data.map((r) => (
            <Link key={r.kind} href={`/reports/${r.kind}`} className="panel report-card">
              <h2>{r.title}</h2>
              <p className="muted">{r.description}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
