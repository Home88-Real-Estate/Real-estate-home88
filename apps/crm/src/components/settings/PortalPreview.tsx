import { approvePortalFeed } from "@/actions/settings";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Preview = {
  total: number;
  selected: number;
  ready: number;
  blocked: number;
  notSelected: number;
  warningCount: number;
  expectedCount: number;
  mappingConfigured: boolean;
  guard: { blocked: boolean; surge: boolean; message: string | null; previousCount: number | null };
  reasonCounts: Array<{ reason: string; count: number }>;
  items: Array<{ reference: string; outcome: string; reasons: string[] }>;
};

type Version = { id: string; version: number; propertyCount: number; generatedAt: string; blocked: boolean; blockReason: string | null; approvedAt: string | null };

/**
 * Dry run of what the portal would receive, plus the feed history. It reads only;
 * nothing is published from here. A feed held back by the size guard shows its
 * reason and a confirm button for managers.
 */
export async function PortalPreview({ code, supportsPreview, canApprove }: { code: string; supportsPreview: boolean; canApprove: boolean }) {
  if (!supportsPreview) {
    return <div className="notice">Αυτό το portal δεν έχει ακόμη προσαρμογέα, οπότε δεν υπάρχει τι να προεπισκοπηθεί.</div>;
  }
  const [preview, versions] = await Promise.all([
    apiFetch<{ preview: Preview }>(`/api/portals/${encodeURIComponent(code)}/preview`),
    apiFetch<{ versions: Version[] }>(`/api/portals/${encodeURIComponent(code)}/feed/versions`),
  ]);
  if (!preview.ok) {
    // The portal has no row until it is first saved, which is not an error worth alarming about.
    return <div className={preview.status === 404 ? "notice" : "notice notice--danger"}>{preview.status === 404 ? "Αποθηκεύστε πρώτα τις ρυθμίσεις του portal για να δείτε προεπισκόπηση." : preview.error.message}</div>;
  }
  const p = preview.data.preview;
  const held = versions.ok ? versions.data.versions.find((v, i) => i === 0 && v.blocked && !v.approvedAt) : undefined;

  return (
    <div className="portalpreview">
      {p.guard.blocked && <div className="notice notice--danger" role="alert">{p.guard.message}</div>}
      {p.guard.surge && !p.guard.blocked && <div className="notice notice--warn">{p.guard.message}</div>}
      {held && (
        <div className="notice notice--warn" role="status">
          Η ροή (έκδοση {held.version}, {held.propertyCount} ακίνητα) δεν σερβίρεται μέχρι να την επιβεβαιώσετε. {held.blockReason}
          {canApprove && (
            <form action={approvePortalFeed} style={{ marginTop: 8 }}>
              <input type="hidden" name="_code" value={code} />
              <button type="submit" className="btn btn--primary">Επιβεβαίωση ροής</button>
            </form>
          )}
        </div>
      )}

      <dl className="stats" aria-label="Σύνοψη προεπισκόπησης">
        <div><dt>Υποψήφια</dt><dd>{p.total}</dd></div>
        <div><dt>Επιλέχθηκαν</dt><dd>{p.selected}</dd></div>
        <div><dt>Έτοιμα</dt><dd>{p.ready}</dd></div>
        <div><dt>Δεν μπορούν να δημοσιευτούν</dt><dd>{p.blocked}</dd></div>
        <div><dt>Εκτός κανόνα</dt><dd>{p.notSelected}</dd></div>
      </dl>
      <p className="hint">
        Η ροή θα περιέχει {p.expectedCount} ακίνητα
        {p.guard.previousCount !== null ? ` (τελευταία επιβεβαιωμένη: ${p.guard.previousCount})` : " (δεν έχει προηγηθεί δημοσίευση)"}.
        {!p.mappingConfigured && " Δεν έχουν οριστεί αντιστοιχίσεις κατηγοριών, οπότε δεν γίνεται έλεγχος κατηγορίας."}
        {p.warningCount > 0 && ` ${p.warningCount} προειδοποιήσεις.`}
      </p>

      {p.reasonCounts.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th scope="col">Λόγος εξαίρεσης</th><th scope="col">Ακίνητα</th></tr></thead>
            <tbody>{p.reasonCounts.map((r) => <tr key={r.reason}><td>{r.reason}</td><td>{r.count}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {p.items.length > 0 && (
        <details>
          <summary>Ακίνητα που δεν θα σταλούν ({p.items.length}{p.blocked + p.notSelected > p.items.length ? "+" : ""})</summary>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th scope="col">Κωδικός</th><th scope="col">Αποτέλεσμα</th><th scope="col">Λόγοι</th></tr></thead>
              <tbody>
                {p.items.map((i) => (
                  <tr key={i.reference}>
                    <th scope="row">{i.reference}</th>
                    <td>{i.outcome === "BLOCKED" ? "Δεν μπορεί να δημοσιευτεί" : "Εκτός κανόνα"}</td>
                    <td>{i.reasons.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {versions.ok && versions.data.versions.length > 0 && (
        <details>
          <summary>Ιστορικό ροής</summary>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th scope="col">Έκδοση</th><th scope="col">Ακίνητα</th><th scope="col">Δημιουργήθηκε</th><th scope="col">Κατάσταση</th></tr></thead>
              <tbody>
                {versions.data.versions.map((v) => (
                  <tr key={v.id}>
                    <th scope="row">{v.version}</th>
                    <td>{v.propertyCount}</td>
                    <td>{formatDateTime(v.generatedAt)}</td>
                    <td>{v.blocked ? (v.approvedAt ? "Επιβεβαιώθηκε" : "Σε αναμονή επιβεβαίωσης") : "Σερβίρεται"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
