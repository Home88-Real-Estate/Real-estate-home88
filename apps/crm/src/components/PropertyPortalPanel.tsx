import Link from "next/link";

import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { PropertyPortalActions, type PortalAccountChoice } from "@/components/PropertyPortalActions";

type Row = {
  code: string;
  name: string;
  enabled: boolean;
  state: string;
  externalId: string | null;
  externalUrl: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  needsReview: boolean;
  nextRetryAt: string | null;
  outcome: "READY" | "BLOCKED" | "NOT_SELECTED";
  reasons: string[];
  warnings: string[];
  hasAdapter: boolean;
  portalAccountId: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
  lastActionBy: string | null;
  lastSuccessfulSyncAt: string | null;
  lastFailedAt: string | null;
  lastErrorCode: string | null;
  accounts: PortalAccountChoice[];
};

const ACTION_LABEL: Record<string, string> = { PUBLISH: "Δημοσίευση", UPDATE: "Ενημέρωση", UNPUBLISH: "Απόσυρση", RETRY: "Επανάληψη", PREVIEW: "Προεπισκόπηση" };

/**
 * Where this property stands on every portal, and why not where it is held
 * back. "Website published" says nothing here: each portal has its own rule.
 */
export async function PropertyPortalPanel({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const portals = await apiFetch<{ portals: Row[]; permissions: Record<string, boolean> }>(`/api/properties/${encodeURIComponent(propertyId)}/portals`);

  const perms = portals.ok ? portals.data.permissions : {};

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
                <th scope="col">Χειροκίνητη δημοσίευση</th>
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
                    {row.needsReview && <div className="hint"><strong>Χρειάζεται έλεγχο</strong> — διορθώστε την αιτία και δημοσιεύστε ξανά.</div>}
                    {!row.needsReview && row.nextRetryAt && <div className="hint">Νέα προσπάθεια: {formatDateTime(row.nextRetryAt)}</div>}
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
                  <td>
                    {row.externalUrl ? <a href={row.externalUrl}>Άνοιγμα</a> : "—"}
                    {row.externalId && <div className="hint mono">ID {row.externalId}</div>}
                  </td>
                  <td>
                    {row.lastAction && (
                      <div className="hint">
                        {ACTION_LABEL[row.lastAction] ?? row.lastAction}
                        {row.lastActionBy ? ` από ${row.lastActionBy}` : ""}
                        {row.lastActionAt ? ` · ${formatDateTime(row.lastActionAt)}` : ""}
                      </div>
                    )}
                    <PropertyPortalActions
                      propertyId={propertyId}
                      row={{ code: row.code, state: row.state, hasAdapter: row.hasAdapter, needsReview: row.needsReview, portalAccountId: row.portalAccountId, accounts: row.accounts, outcome: row.outcome }}
                      permissions={{ preview: perms.preview === true, publish: perms.publish === true, update: perms.update === true, unpublish: perms.unpublish === true, retry: perms.retry === true }}
                    />
                    {perms.view_sync_history === true && <div className="hint"><Link href={`/properties/${propertyId}/portals/${row.code}`}>Ιστορικό</Link></div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
