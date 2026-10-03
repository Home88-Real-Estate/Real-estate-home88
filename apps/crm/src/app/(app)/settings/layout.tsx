import type { Metadata } from "next";

import { SettingsNav } from "@/components/settings/SettingsNav";
import { countdownText, getSettingsOverview } from "@/lib/settings";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: { default: "Ρυθμίσεις", template: "%s · Ρυθμίσεις" } };

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const overview = await getSettingsOverview();
  if (!overview.ok) {
    return (
      <>
        <h1>Ρυθμίσεις</h1>
        <div className={overview.status === 403 ? "notice" : "notice notice--danger"}>
          {overview.status === 403 ? "Δεν έχετε πρόσβαση στις ρυθμίσεις. Απευθυνθείτε σε διαχειριστή." : overview.error.message}
        </div>
      </>
    );
  }
  const sub = overview.data.subscription;
  const countdown = sub?.countdown ? countdownText(sub.countdown) : "";

  return (
    <div className="settings">
      <div className="settings__head">
        <h1>Ρυθμίσεις</h1>
        {countdown && (
          <p className={sub?.countdown?.expired ? "settings__sub is-expired" : sub && sub.countdown && sub.countdown.days < 30 ? "settings__sub is-soon" : "settings__sub"}>
            {countdown}
          </p>
        )}
      </div>
      <div className="settings__body">
        <SettingsNav sections={overview.data.sections} canViewHistory={overview.data.canViewHistory} />
        <div className="settings__main">{children}</div>
      </div>
    </div>
  );
}
