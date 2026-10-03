/** Server-side reads for the settings screens (all through the API). */

import { apiFetch } from "./api";

export type SettingsOverview = {
  sections: Array<{ key: string; title: string; navGroup: string; canManage: boolean }>;
  missingPublicFields: Array<{ section: string; key: string; label: string }>;
  subscription: {
    status: string | null;
    plan: string | null;
    expiresAt: string | null;
    countdown: { expired: boolean; days: number; hours: number; minutes: number } | null;
  } | null;
  canViewHistory: boolean;
};

export function getSettingsOverview() {
  return apiFetch<SettingsOverview>("/api/settings");
}

export type Countdown = { expired: boolean; days: number; hours: number; minutes: number };

export function countdownText(c: Countdown | null): string {
  if (!c) return "";
  if (c.expired) return "Η συνδρομή έχει λήξει";
  const parts = [`${c.days} ${c.days === 1 ? "μέρα" : "μέρες"}`, `${c.hours} ${c.hours === 1 ? "ώρα" : "ώρες"}`, `${c.minutes} λεπτά`];
  return `Η συνδρομή λήγει σε ${parts.join(", ")}`;
}
