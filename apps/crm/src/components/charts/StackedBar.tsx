"use client";

import { useState } from "react";

import { num } from "@/lib/dashboard";

export type Segment = { key: string; label: string; value: number; color: string };

/**
 * Part-to-whole as one stacked bar, 2px surface gaps between segments, and a
 * legend that carries every value and share (so identity never relies on
 * colour alone). Hover/focus a segment or its legend entry to highlight it.
 */
export function StackedBar({ segments, unit }: { segments: Segment[]; unit: string }) {
  const [active, setActive] = useState<string | null>(null);
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);

  return (
    <div className={active ? "chart chart--dim" : "chart"} onPointerLeave={() => setActive(null)}>
      <div className="stackbar" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
        {visible.map((s) => (
          <span
            key={s.key}
            className="stackbar__seg chart__mark"
            data-active={active === s.key}
            style={{ flexGrow: s.value, background: s.color }}
            onPointerEnter={() => setActive(s.key)}
          />
        ))}
      </div>
      <ul className="legend legend--grid">
        {segments.map((s) => {
          const share = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <li
              key={s.key}
              tabIndex={0}
              data-active={active === s.key}
              onPointerEnter={() => setActive(s.key)}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive(null)}
              aria-label={`${s.label}: ${s.value} ${unit}, ${share}%`}
            >
              <span className="legend__swatch" style={{ background: s.color }} />
              <span className="legend__name">{s.label}</span>
              <strong>{num(s.value)}</strong>
              <span className="muted">{share}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
