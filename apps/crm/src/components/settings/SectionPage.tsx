import { notFound } from "next/navigation";
import { settingsSection } from "@home88/domain";

import { apiFetch } from "@/lib/api";

import { AreasPanel } from "./AreasPanel";
import { MandateTemplates } from "./MandateTemplates";
import { NotificationsMatrix } from "./NotificationsMatrix";
import { PermissionsMatrix } from "./PermissionsMatrix";
import { PortalsList } from "./PortalsList";
import { PropertyProfiles } from "./PropertyProfiles";
import { SettingsForm, type SectionView } from "./SettingsForm";
import { TagsPanel } from "./TagsPanel";
import { TestEmailButton } from "./TestEmailButton";

const PROVIDER_LABEL: Record<string, [string, string]> = {
  configured: ["Ρυθμίστηκε", "badge badge--ok"],
  partial: ["Ελλιπείς ρυθμίσεις", "badge badge--warn"],
  environment: ["Από τις ρυθμίσεις του server", "badge badge--info"],
  not_configured: ["Δεν έχει ρυθμιστεί", "badge badge--muted"],
};

/** One settings section: header, what is not yet in effect, and its screen. */
export async function SectionPage({ sectionKey }: { sectionKey: string }) {
  const section = settingsSection(sectionKey);
  if (!section) notFound();

  const hasForm = section.fields.length > 0;
  const result = hasForm ? await apiFetch<SectionView>(`/api/settings/sections/${section.key}`) : null;
  if (result && !result.ok) {
    if (result.status === 404) notFound();
    return (
      <>
        <h2 className="settings__title">{section.title}</h2>
        <div className={result.status === 403 ? "notice" : "notice notice--danger"}>{result.error.message}</div>
      </>
    );
  }
  const view = result?.ok ? result.data : null;
  const provider = view?.provider ? PROVIDER_LABEL[view.provider] : null;

  return (
    <>
      <header className="settings__sectionhead">
        <div>
          <h2 className="settings__title">
            {section.title}
            {provider && <span className={provider[1]}>{provider[0]}</span>}
          </h2>
          <p className="muted">{section.description}</p>
        </div>
      </header>
      {section.pendingNote && <p className="notice">{section.pendingNote}</p>}

      {view && (
        <div className="panel">
          <SettingsForm view={view} />
          {section.key === "email" && view.canManage && <TestEmailButton />}
        </div>
      )}

      {section.key === "properties" && (
        <>
          <TagsPanel />
          <PropertyProfiles />
        </>
      )}
      {section.key === "mandates" && <MandateTemplates />}
      {section.key === "notifications" && <NotificationsMatrix />}
      {section.key === "permissions" && <PermissionsMatrix />}
      {section.key === "portals" && <PortalsList />}
      {section.key === "areas" && <AreasPanel />}
    </>
  );
}
