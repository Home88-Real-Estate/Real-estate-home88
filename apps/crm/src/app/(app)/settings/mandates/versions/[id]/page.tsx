import Link from "next/link";
import { notFound } from "next/navigation";
import { MANDATE_TYPES, TEMPLATE_LOCALES } from "@home88/domain";

import { activateTemplateVersion } from "@/actions/settings";
import { VERSION_STATUS } from "@/components/settings/MandateTemplates";
import { EditDraftForm } from "@/components/settings/TemplateForms";
import { apiFetch } from "@/lib/api";
import { MergeFields } from "@/components/settings/MergeFields";

type Version = { id: string; type: string; locale: string; version: number; status: string; body: string; checksum: string; notes: string | null; createdAt: string; activatedAt: string | null };

export default async function TemplateVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, list] = await Promise.all([
    apiFetch<{ version: Version }>(`/api/settings/mandates/versions/${encodeURIComponent(id)}`),
    apiFetch<{ canManage: boolean }>("/api/settings/mandates/templates"),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const v = result.data.version;
  const canManage = list.ok && list.data.canManage;
  const typeLabel = MANDATE_TYPES.find((t) => t.value === v.type)?.label ?? v.type;
  const localeLabel = TEMPLATE_LOCALES.find((l) => l.value === v.locale)?.label ?? v.locale;
  const status = VERSION_STATUS[v.status];

  return (
    <>
      <p><Link href="/settings/mandates">‹ Ψηφιακές Εντολές</Link></p>
      <header className="settings__sectionhead">
        <h2 className="settings__title">
          {typeLabel} · {localeLabel} · Έκδοση {v.version}
          {status && <span className={status[1]}>{status[0]}</span>}
        </h2>
        <p className="muted">
          Αποτύπωμα SHA-256: <span className="mono">{v.checksum.slice(0, 16)}…</span>
          {v.notes ? ` · ${v.notes}` : ""}
        </p>
      </header>
      <div className="panel">
        {v.status === "DRAFT" && canManage ? (
          <>
            <EditDraftForm id={v.id} body={v.body} notes={v.notes} />
            <form action={activateTemplateVersion} className="activate">
              <input type="hidden" name="id" value={v.id} />
              <p className="muted">
                Με την ενεργοποίηση το κείμενο κλειδώνει. Οι νέες εντολές θα χρησιμοποιούν αυτή την έκδοση· η προηγούμενη
                αποσύρεται αλλά μένει αποθηκευμένη για όσες εντολές την έχουν ήδη.
              </p>
              <button type="submit" className="btn btn--primary btn--sm">Ενεργοποίηση έκδοσης {v.version}</button>
            </form>
          </>
        ) : (
          <pre className="legaltext">{v.body}</pre>
        )}
        {v.status === "DRAFT" && canManage && <MergeFields />}
      </div>
    </>
  );
}
