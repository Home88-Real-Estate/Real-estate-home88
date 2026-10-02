"use client";

import { useEffect, useState } from "react";

import { applyTheme, readTheme, type ThemePreference } from "@/lib/theme";

import { Icon, type IconName } from "./Icon";

const NEXT: Record<ThemePreference, ThemePreference> = { system: "light", light: "dark", dark: "system" };
const ICON: Record<ThemePreference, IconName> = { system: "monitor", light: "sun", dark: "moon" };
const NAME: Record<ThemePreference, string> = { system: "σύστημα", light: "φωτεινό", dark: "σκοτεινό" };

/** Cycles system → light → dark. */
export function ThemeToggle() {
  // Unknown until mounted (localStorage is browser-only); render "system".
  const [theme, setTheme] = useState<ThemePreference>("system");
  useEffect(() => setTheme(readTheme()), []);

  const next = NEXT[theme];
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      title={`Θέμα: ${NAME[theme]}`}
      aria-label={`Θέμα: ${NAME[theme]}. Αλλαγή σε ${NAME[next]}.`}
    >
      <Icon name={ICON[theme]} />
    </button>
  );
}
