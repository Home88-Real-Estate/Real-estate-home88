import Link from "next/link";
import { PORTAL_STATUS_LABELS } from "@home88/domain";

import { apiFetch } from "@/lib/api";

type Row = { code: string; name: string; transport: string; enabled: boolean; status: string; hasAdapter: boolean; lastSuccessAt: string | null; lastError: string | null };

export const CAPABILITY_LABELS: Record<string, string> = {
  create: "δημιουργία",
  update: "ενημέρωση",
  unpublish: "απόσυρση",
  delete: "διαγραφή",
  pull: "το portal διαβάζει τη ροή",
  push: "αποστολή μέσω API",
  webhooks: "webhooks",
  leads: "εισαγωγή leads",
  images: "φωτογραφίες",
  video: "βίντεο",
  virtualTour: "virtual tour",
  incrementalSync: "σταδιακός συγχρονισμός",
  fullSync: "πλήρης συγχρονισμός",
  dryRun: "προεπισκόπηση",
};

export const STATUS_CLASS: Record<string, string> = {
  PLANNED: "badge badge--muted",
  NOT_CONFIGURED: "badge badge--muted",
  CONFIGURED: "badge badge--info",
  CONNECTED: "badge badge--ok",
  ERROR: "badge badge--danger",
  DISABLED: "badge badge--warn",
};

export const TRANSPORT_LABEL: Record<string, string> = {
  API: "API",
  XML_FEED: "Ροή XML",
  CSV_FEED: "Ροή CSV",
  JSON_FEED: "Ροή JSON",
  MANUAL: "Χειροκίνητα",
};

export async function PortalsList() {
  const result = await apiFetch<{ data: Row[] }>("/api/settings/portals");
  if (!result.ok) return <div className="notice notice--danger">{result.error.message}</div>;
  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h2>Υποστηριζόμενα portals</h2>
          <p className="panel__sub">Η λίστα δεν σημαίνει ότι η HOME88 έχει λογαριασμό σε όλα. Κάθε portal μένει ανενεργό μέχρι να το ρυθμίσετε.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Portal</th>
              <th scope="col">Σύνδεση</th>
              <th scope="col">Κατάσταση</th>
              <th scope="col">Τελευταίος επιτυχής συγχρονισμός</th>
            </tr>
          </thead>
          <tbody>
            {result.data.data.map((p) => (
              <tr key={p.code}>
                <th scope="row"><Link href={`/settings/portals/${p.code}`}>{p.name}</Link></th>
                <td>{TRANSPORT_LABEL[p.transport] ?? p.transport}{!p.hasAdapter && <span className="hint"> · χωρίς προσαρμογέα ακόμη</span>}</td>
                <td><span className={STATUS_CLASS[p.status] ?? "badge"}>{PORTAL_STATUS_LABELS[p.status] ?? p.status}</span></td>
                <td className="muted">{p.lastSuccessAt ? new Date(p.lastSuccessAt).toLocaleString("el-GR", { timeZone: "Europe/Athens" }) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
