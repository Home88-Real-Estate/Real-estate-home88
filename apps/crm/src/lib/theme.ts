/**
 * Theme preference: "system" follows the OS; "light"/"dark" pin it. Stored
 * per browser in localStorage and applied as data-theme on <html> by the
 * inline script in app/layout.tsx before first paint, so there is no flash.
 */

export const THEME_KEY = "h88-theme";
export type ThemePreference = "system" | "light" | "dark";

/** Inline, dependency-free: runs before React, in <head>. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;

export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
  try {
    if (preference === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

export function readTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}
