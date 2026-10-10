/**
 * Minimal stroke icon set (24×24 grid, 1.75 stroke, currentColor), drawn for
 * the HOME88 CRM. Inline SVG: no icon font, no external request, and icons
 * inherit text colour so they work in both themes.
 */

const PATHS = {
  home: "M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6.5H9V21H4.5a1 1 0 0 1-1-1z",
  building:
    "M4 21V5.5A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5V21M15 10h3.5a1.5 1.5 0 0 1 1.5 1.5V21M3 21h18M7.5 8h4M7.5 12h4M7.5 16h4",
  inbox: "M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5M5.5 5h13l2 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-5.5z",
  users:
    "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5",
  search: "M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.5l-5-5",
  mandate:
    "M14 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5zM14 3.5v5h5M8.5 13h7M8.5 16.5h4",
  folder: "M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9.3A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5z",
  file: "M14 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5zM14 3.5v5h5",
  bell: "M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5zM10 20.5a2.2 2.2 0 0 0 4 0",
  calendar: "M4.5 6h15a1 1 0 0 1 1 1v12.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 10.5h17M8 3.5V8M16 3.5V8",
  megaphone: "M4 10v4a1 1 0 0 0 1 1h2.5L14 19V5L7.5 9H5a1 1 0 0 0-1 1zM17.5 9a4 4 0 0 1 0 6M8 15l1.5 5",
  chart: "M4 20.5h16.5M7 17V11M11.5 17V6.5M16 17v-4",
  message: "M4.5 5h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-4.5 3.5V17h-1a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 9.5h8M8 12.5h5",
  globe:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z",
  shield: "M12 3.5 19.5 6v5.5c0 4.5-3 7.8-7.5 9-4.5-1.2-7.5-4.5-7.5-9V6zM9 12l2 2 4-4",
  userCog: "M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 20.5a7 7 0 0 1 10-6.3M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 13.5v1.5M18 21v1.5M14.8 16.5l1.3.8M19.9 19.7l1.3.8M14.8 19.5l1.3-.8M19.9 16.3l1.3-.8",
  send: "M20.5 3.5 10 14M20.5 3.5l-6 17-4.5-6.5-6.5-4.5z",
  team: "M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 20a6 6 0 0 1 12 0M5 11.5a2.5 2.5 0 1 0 0-5M19 11.5a2.5 2.5 0 1 1 0-5M1.5 19a4.5 4.5 0 0 1 3-4.2M22.5 19a4.5 4.5 0 0 0-3-4.2",
  sliders: "M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1M15 4.5v4M9 10v4M17 15.5v4",
  plug: "M9 3.5V8M15 3.5V8M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5v4",
  image: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M9 9.5h.01",
  plus: "M12 5v14M5 12h14",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  chevronLeft: "M14.5 6 8.5 12l6 6",
  chevronRight: "M9.5 6l6 6-6 6",
  chevronDown: "M6 9.5l6 6 6-6",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  monitor: "M3.5 5h17a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8.5 21h7M12 17v4",
  logout: "M14 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H14M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  alert: "M12 4 21 19.5H3zM12 10v4M12 17h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff:
    "M3.5 3.5l17 17M10.6 6.1A8.7 8.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.6 3.4M6.6 7.6C4 9.3 2.5 12 2.5 12s3.5 6 9.5 6a8.6 8.6 0 0 0 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2",
  lock: "M6.5 11h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11",
  mail: "M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM3.5 6.5 12 13l8.5-6.5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  table: "M4 4.5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM3 9.5h18M3 14.5h18M9.5 9.5v10",
  barChart: "M4 20h16M7 16.5v-5M12 16.5V7M17 16.5v-8",
  key: "M14.5 9.5a5 5 0 1 1-9.9 1 5 5 0 0 1 9.9-1zM13.5 12.5 21 20M17.5 16.5l2-2M19.5 18.5l2-2",
  sparkle: "M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2-5.2-1.8 5.2-1.8zM19 16v4M17 18h4",
  mic: "M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3",
  keyboard: "M3.5 6.5h17a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM6.5 10h1M10 10h1M13.5 10h1M17 10h.5M6.5 13.5h1M17 13.5h.5M10 13.5h4",
  wave: "M3.5 12h1M7 9v6M10.5 5.5v13M14 8v8M17.5 10v4M20.5 12h.5",
  bulb: "M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z",
  euro: "M17.5 6.5A6.5 6.5 0 1 0 17.5 17.5M4.5 10.5h9M4.5 13.5h9",
  ruler: "M3.5 16.5 16.5 3.5l4 4-13 13zM7 13l1.5 1.5M10 10l2 2M13 7l1.5 1.5",
  pin: "M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  heading: "M5 6V4.5h14V6M12 4.5v15M9 19.5h6",
  lines: "M4.5 6.5h15M4.5 11h15M4.5 15.5h10",
  undo: "M9 5.5 4.5 10 9 14.5M5 10h9.5a5 5 0 0 1 0 10H11",
  play: "M8 5.5v13l10.5-6.5z",
  stop: "M7 7h10v10H7z",
  save: "M5.5 4h10.5l3.5 3.5V19a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 4v5h7V4M8 20v-6h8v6",
  hand: "M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7.5a6.5 6.5 0 0 1-6.5 6.5h-.5a6 6 0 0 1-5-2.7L3.5 14a1.5 1.5 0 0 1 2.4-1.8L8 14.5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5v.5",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  chat: "M4.5 5h15a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5h-1a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8.5 10.5h.5M12 10.5h.5M15.5 10.5h.5",
  cloudOff: "M3.5 3.5l17 17M8.5 7.4A5.5 5.5 0 0 1 17.3 11h.2a3.5 3.5 0 0 1 2 6.4M16 19H7a4 4 0 0 1-.9-7.9",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  className,
  label,
}: {
  name: IconName;
  size?: number;
  className?: string;
  /** Accessible name; omit for decorative icons next to visible text. */
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `icon ${className}` : "icon"}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
