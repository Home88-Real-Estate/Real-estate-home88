import Link from "next/link";

import { apiFetch } from "@/lib/api";

import { NewVersionForm } from "./TemplateForms";
import { MergeFields } from "./MergeFields";

type Slot = {
  type: string;
  typeLabel: string;
  locale: string;
  localeLabel: string;
  versions: Array<{ id: string; version: number; status: string; checksum: string; notes: string | null; createdAt: string; activatedAt: string | null }>;
};

export const VERSION_STATUS: Record<string, [string, string]> = {
  DRAFT: ["Πρόχειρη", "badge badge--warn"],
  ACTIVE: ["Ενεργή", "badge badge--ok"],
  RETIRED: ["Αποσυρμένη", "badge badge--muted"],
};

const DATE = new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Athens" });

export async function MandateTemplates() {
  const result = await apiFetch<{ data: Slot[]; canManage: boolean }>("/api/settings/mandates/templates");
  if (!result.ok) return <div className="notice notice--danger">{result.error.message}</div>;
  const { data, canManage } = result.data;
  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h2>Κείμενα εντολών</h2>
          <p className="panel__sub">
            Κάθε κείμενο κρατιέται σε εκδόσεις. Μια ενεργή έκδοση δεν αλλάζει ποτέ: για διόρθωση δημιουργείτε νέα. Κάθε
            υπογεγραμμένη εντολή θα δείχνει την ακριβή έκδοση που υπογράφηκε. Το σύστημα δεν γράφει νομικά κείμενα.
          </p>
        </div>
      </div>
      <div className="slots">
        {data.map((slot) => {
          const active = slot.versions.find((v) => v.status === "ACTIVE");
          const draft = slot.versions.find((v) => v.status === "DRAFT");
          return (
            <section key={`${slot.type}-${slot.locale}`} className="slot">
              <div className="between">
                <h3>{slot.typeLabel} <span className="muted">· {slot.localeLabel}</span></h3>
                {active ? <span className="badge badge--ok">Έκδοση {active.version}</span> : <span className="badge badge--muted">Δεν υπάρχει εγκεκριμένο κείμενο</span>}
              </div>
              {slot.versions.length > 0 && (
                <ul className="slot__versions">
                  {slot.versions.map((v) => (
                    <li key={v.id}>
                      <Link href={`/settings/mandates/versions/${v.id}`}>Έκδοση {v.version}</Link>
                      <span className={VERSION_STATUS[v.status]?.[1] ?? "badge"}>{VERSION_STATUS[v.status]?.[0] ?? v.status}</span>
                      <span className="muted">{DATE.format(new Date(v.activatedAt ?? v.createdAt))}</span>
                      {v.notes && <span className="muted">· {v.notes}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {canManage && !draft && (
                <details className="subpanel">
                  <summary>{active ? "Νέα έκδοση" : "Προσθήκη εγκεκριμένου κειμένου"}</summary>
                  <NewVersionForm type={slot.type} locale={slot.locale} label={`${slot.typeLabel} (${slot.localeLabel})`} />
                </details>
              )}
            </section>
          );
        })}
      </div>
      {canManage && <MergeFields />}
    </div>
  );
}
