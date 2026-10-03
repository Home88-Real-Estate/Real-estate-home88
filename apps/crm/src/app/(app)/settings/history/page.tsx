import Link from "next/link";
import { settingsSection } from "@home88/domain";

import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";

export const metadata = { title: "Ιστορικό αλλαγών" };

type Row = { id: string; section: string; field: string | null; action: string; summary: string | null; masked: boolean; oldValue: unknown; newValue: unknown; actorName: string | null; createdAt: string };

const DATE = new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });

function show(value: unknown, section: string, field: string | null): string {
  const def = field ? settingsSection(section)?.fields.find((f) => f.key === field) : undefined;
  const option = (v: unknown) => def?.options?.find((o) => o.value === String(v))?.label ?? String(v);
  if (value === null || value === undefined || value === "") return "κενό";
  if (def?.options && Array.isArray(value)) return value.length ? value.map(option).join(", ") : "κενό";
  if (def?.options) return option(value);
  if (typeof value === "boolean") return value ? "Ναι" : "Όχι";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "κενό";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export default async function SettingsHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const page = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1;
  const section = (Array.isArray(sp.section) ? sp.section[0] : sp.section) ?? "";
  const result = await apiFetch<{ data: Row[]; page: number; pages: number; total: number }>("/api/settings/audit", { query: { page, section } });
  if (!result.ok) return <div className={result.status === 403 ? "notice" : "notice notice--danger"}>{result.error.message}</div>;
  const { data, pages, total } = result.data;

  return (
    <>
      <header className="settings__sectionhead">
        <h2 className="settings__title">Ιστορικό αλλαγών</h2>
        <p className="muted">
          Κάθε αλλαγή ρυθμίσεων: ποιος, πότε, τι. Κωδικοί, κλειδιά, ΑΦΜ και ΓΕΜΗ καταγράφονται μόνο ως «άλλαξε», χωρίς τιμή.
        </p>
      </header>
      {section && <p className="filter-chip-row"><span className="filter-chip">{settingsSection(section)?.title ?? section}</span> <Link href="/settings/history">Όλες οι ενότητες</Link></p>}
      {data.length === 0 ? (
        <p className="empty">Δεν υπάρχουν αλλαγές ακόμη.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Πότε</th>
                <th scope="col">Ποιος</th>
                <th scope="col">Ενότητα</th>
                <th scope="col">Αλλαγή</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{DATE.format(new Date(r.createdAt))}</td>
                  <td>{r.actorName ?? "—"}</td>
                  <td><Link href={`/settings/history?section=${r.section}`}>{settingsSection(r.section)?.title ?? r.section}</Link></td>
                  <td>
                    <strong>{r.summary ?? r.field ?? r.action}</strong>
                    {r.masked ? (
                      <span className="badge badge--muted" style={{ marginLeft: 8 }}>Καλυμμένη τιμή</span>
                    ) : r.action === "UPDATED" || r.action === "GRANTED" || r.action === "REVOKED" ? (
                      <span className="muted"> · {show(r.oldValue, r.section, r.field)} → {show(r.newValue, r.section, r.field)}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={pages} total={total} basePath="/settings/history" params={section ? { section } : undefined} />
    </>
  );
}
