import Link from "next/link";

import { StatusBadge } from "@/components/StatusBadge";
import { PropertyTagsForm } from "@/components/PropertyTagsForm";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Row = {
  code: string;
  name: string;
  enabled: boolean;
  state: string;
  externalId: string | null;
  externalUrl: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  outcome: "READY" | "BLOCKED" | "NOT_SELECTED";
  reasons: string[];
  warnings: string[];
};

/**
 * Where this property stands on every portal, and why not where it is held
 * back. "Website published" says nothing here: each portal has its own rule.
 */
export async function PropertyPortalPanel({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const [portals, tags] = await Promise.all([
    apiFetch<{ portals: Row[] }>(`/api/properties/${encodeURIComponent(propertyId)}/portals`),
    apiFetch<{ codes: string[]; available: Array<{ code: string; labelEl: string }> }>(`/api/properties/${encodeURIComponent(propertyId)}/tags`),
  ]);

  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h2>Διανομή σε portals</h2>
          <p className="panel__sub">Κάθε portal έχει δικό του κανόνα δημοσίευσης. Η δημοσίευση στον ιστότοπο δεν συνεπάγεται δημοσίευση σε portal.</p>
        </div>
      </div>

      {!portals.ok ? (
        <div className="notice notice--danger">{portals.error.message}</div>
      ) : portals.data.portals.length === 0 ? (
        <div className="empty">
          Δεν έχει ρυθμιστεί ακόμη κάποιο portal. <Link href="/settings/portals">Ρύθμιση</Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Portal</th>
                <th scope="col">Κατάσταση</th>
                <th scope="col">Στον επόμενο συγχρονισμό</th>
                <th scope="col">Τελευταίος συγχρονισμός</th>
                <th scope="col">Σύνδεσμος</th>
              </tr>
            </thead>
            <tbody>
              {portals.data.portals.map((row) => (
                <tr key={row.code}>
                  <th scope="row">
                    <Link href={`/settings/portals/${row.code}`}>{row.name}</Link>
                    {!row.enabled && <span className="hint"> · ανενεργό</span>}
                  </th>
                  <td>
                    <StatusBadge value={row.state} kind="portal" />
                    {row.lastError && <div className="hint">{row.lastError}</div>}
                  </td>
                  <td>
                    {row.outcome === "READY" ? (
                      "Θα δημοσιευτεί"
                    ) : (
                      <>
                        {row.outcome === "BLOCKED" ? "Δεν μπορεί να δημοσιευτεί" : "Δεν επιλέχθηκε"}
                        <div className="hint">{row.reasons.join(" · ")}</div>
                      </>
                    )}
                    {row.warnings.length > 0 && <div className="hint">{row.warnings.join(" · ")}</div>}
                    {row.outcome === "BLOCKED" && canManage && (
                      <div className="hint"><Link href={`/properties/${propertyId}/edit`}>Διόρθωση ακινήτου</Link></div>
                    )}
                  </td>
                  <td>{row.lastSyncedAt ? formatDateTime(row.lastSyncedAt) : "—"}</td>
                  <td>{row.externalUrl ? <a href={row.externalUrl}>Άνοιγμα</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tags.ok && (
        <>
          <h3 style={{ marginTop: 20 }}>Ετικέτες</h3>
          <PropertyTagsForm propertyId={propertyId} selected={tags.data.codes} available={tags.data.available} canEdit={canManage} />
        </>
      )}
    </div>
  );
}
