"use client";

import { useState } from "react";

import { num } from "@/lib/dashboard";

export type BarRow = { key: string; label: string; value: number; color: string };

/**
 * Horizontal bars with labels on the left and the value at each bar's tip.
 * Bars are 14px, rounded at the data end, square at the baseline. Rows are
 * focusable; hover and focus show the share of the total.
 */
export function BarList({ rows, unit }: { rows: BarRow[]; unit: string }) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  return (
    <ul className="barlist" onPointerLeave={() => setActive(null)}>
      {rows.map((row) => {
        const share = total > 0 ? Math.round((row.value / total) * 100) : 0;
        return (
          <li
            key={row.key}
            className="barlist__row"
            data-active={active === row.key}
            tabIndex={0}
            aria-label={`${row.label}: ${row.value} ${unit} (${share}%)`}
            onPointerEnter={() => setActive(row.key)}
            onFocus={() => setActive(row.key)}
            onBlur={() => setActive(null)}
          >
            <span className="barlist__label" title={row.label}>
              {row.label}
            </span>
            <span className="barlist__track">
              <span
                className="barlist__bar chart__mark"
                data-active={active === row.key}
                style={{ width: `${(row.value / max) * 82}%`, background: row.color }}
              />
              <span className="barlist__value">{num(row.value)}</span>
              {active === row.key && (
                <span className="barlist__share" role="status">
                  {share}% του συνόλου
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
