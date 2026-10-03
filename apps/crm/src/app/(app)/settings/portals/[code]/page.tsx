import Link from "next/link";
import { notFound } from "next/navigation";
import { PORTAL_STATUS_LABELS } from "@home88/domain";

import { PortalForm, type PortalDetail } from "@/components/settings/PortalForm";
import { STATUS_CLASS, TRANSPORT_LABEL } from "@/components/settings/PortalsList";
import { apiFetch } from "@/lib/api";

type Detail = PortalDetail & { transport: string; status: string; note: string | null; hasAdapter: boolean; lastSyncAt: string | null; lastSuccessAt: string | null; lastError: string | null };

export default async function PortalSettingsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
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
  return (
    <>
      <p><Link href="/settings/portals">‹ Portals</Link></p>
      <header className="settings__sectionhead">
        <h2 className="settings__title">
          {portal.name}
          <span className={STATUS_CLASS[portal.status] ?? "badge"}>{PORTAL_STATUS_LABELS[portal.status] ?? portal.status}</span>
        </h2>
        <p className="muted">
          {TRANSPORT_LABEL[portal.transport] ?? portal.transport}
          {portal.note ? ` · ${portal.note}` : ""}
          {!portal.hasAdapter && " · Ο αυτόματος συγχρονισμός για αυτό το portal προστίθεται στη Φάση 6."}
        </p>
        {portal.lastError && <p className="notice notice--danger">Τελευταίο σφάλμα: {portal.lastError}</p>}
      </header>
      <div className="panel">
        <PortalForm portal={portal} tags={tags} canManage={canManage} encryptionNote={encryptionMissing} />
      </div>
    </>
  );
}
