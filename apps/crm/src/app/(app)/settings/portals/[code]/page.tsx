import Link from "next/link";
import { notFound } from "next/navigation";
import { PORTAL_STATUS_LABELS } from "@home88/domain";

import { PortalForm, type PortalDetail } from "@/components/settings/PortalForm";
import { PortalMappingsForm, type MappingEntry } from "@/components/settings/PortalMappingsForm";
import { PortalPreview } from "@/components/settings/PortalPreview";
import { CAPABILITY_LABELS, STATUS_CLASS, TRANSPORT_LABEL } from "@/components/settings/PortalsList";
import { apiFetch } from "@/lib/api";
import { hasRole, requireRole } from "@/lib/session";

type Detail = PortalDetail & {
  transport: string;
  status: string;
  integrationStatus: string;
  capabilities: Record<string, boolean>;
  verification: { status: string; note: string };
  note: string | null;
  hasAdapter: boolean;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
};

export default async function PortalSettingsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await requireRole("AGENT");
  const [result, email] = await Promise.all([
    apiFetch<{ portal: Detail; canManage: boolean; tags: Array<{ code: string; labelEl: string }> }>(`/api/settings/portals/${encodeURIComponent(code)}`),
    apiFetch<{ encryptionReady: boolean }>("/api/settings/sections/email"),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const { portal, canManage, tags } = result.data;
  const encryptionMissing = email.ok ? !email.data.encryptionReady : false;
  const mappings = hasRole(user.role, "MANAGER")
    ? await apiFetch<{ entries: MappingEntry[]; features: Array<{ code: string; label: string }> }>(`/api/portals/${encodeURIComponent(code)}/mappings`)
    : null;
  const caps = Object.entries(portal.capabilities).filter(([, on]) => on).map(([key]) => CAPABILITY_LABELS[key] ?? key);
  return (
    <>
      <p><Link href="/settings/portals">‹ Portals</Link></p>
      <header className="settings__sectionhead">
        <h2 className="settings__title">
          {portal.name}
          <span className={STATUS_CLASS[portal.integrationStatus] ?? "badge"}>{PORTAL_STATUS_LABELS[portal.integrationStatus] ?? portal.integrationStatus}</span>
        </h2>
        <p className="muted">
          {TRANSPORT_LABEL[portal.transport] ?? portal.transport}
          {portal.note ? ` · ${portal.note}` : ""}
        </p>
        <p className="hint">
          {portal.hasAdapter
            ? `Δυνατότητες: ${caps.length ? caps.join(", ") : "καμία"}. Το «Συνδεδεμένο» εμφανίζεται μόνο όταν έχει επιτύχει πραγματικός συγχρονισμός· η δημιουργία ροής δεν αποδεικνύει ότι το portal την εισήγαγε.`
            : "Δεν υπάρχει ακόμη προσαρμογέας για αυτό το portal· κάθε δυνατότητα παραμένει ανενεργή μέχρι να επιβεβαιωθεί η τρέχουσα τεκμηρίωση και η πρόσβαση του παρόχου."}
        </p>
        {portal.verification.status !== "VERIFIED" && (
          <p className="notice notice--warn" role="note">
            <strong>Απαιτείται επιβεβαίωση παρόχου.</strong> {portal.verification.note}
          </p>
        )}
        {portal.lastError && <p className="notice notice--danger">Τελευταίο σφάλμα: {portal.lastError}</p>}
      </header>
      <div className="panel">
        <PortalForm portal={portal} tags={tags} canManage={canManage} encryptionNote={encryptionMissing} />
      </div>
      {mappings && (
        <>
          <div className="panel">
            <div className="panel__head"><div><h2>Προεπισκόπηση δημοσίευσης</h2><p className="panel__sub">Τι θα λάβει το portal, τι αποκλείεται και γιατί. Δεν στέλνει τίποτα.</p></div></div>
            <PortalPreview code={code} supportsPreview={portal.capabilities.dryRun === true} canApprove={hasRole(user.role, "MANAGER")} />
          </div>
          {mappings.ok && (
            <div className="panel">
              <div className="panel__head"><div><h2>Αντιστοιχίσεις κατηγοριών και χαρακτηριστικών</h2></div></div>
              <PortalMappingsForm code={code} entries={mappings.data.entries} features={mappings.data.features} canEdit={hasRole(user.role, "ADMIN")} />
            </div>
          )}
        </>
      )}
    </>
  );
}
