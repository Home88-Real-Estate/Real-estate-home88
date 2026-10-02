"use client";

import { useState } from "react";

import { num } from "@/lib/dashboard";

import { useElementWidth } from "./useElementWidth";

export type ColumnPoint = {
  key: string;
  /** Axis label, e.g. "Οκτ". */
  label: string;
  /** Tooltip heading, e.g. "Οκτώβριος 2026". */
  title: string;
  value: number;
  /** The period is still running (drawn lighter, said so in the tooltip). */
  partial?: boolean;
};

/** A clean upper bound for the axis: 1, 2, 2.5, 5 or 10 × 10^n. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * exp) return step * exp;
  return 10 * exp;
}

const HEIGHT = 128;
const PAD_TOP = 20;
const PAD_BOTTOM = 22;
const PAD_X = 6;

/** Rounded data-end (4px), square at the baseline. */
function columnPath(x: number, top: number, bottom: number, width: number): string {
  const r = Math.min(4, width / 2, bottom - top);
  return [
    `M${x},${bottom}`,
    `L${x},${top + r}`,
    `Q${x},${top} ${x + r},${top}`,
    `L${x + width - r},${top}`,
    `Q${x + width},${top} ${x + width},${top + r}`,
    `L${x + width},${bottom}`,
    "Z",
  ].join(" ");
}

/**
 * Single-series column chart for one small multiple. One hue (slot 1); the
 * panel title names the series, so there is no legend. Only the latest complete
 * column carries a value label (a running month's partial count would mislead);
 * every column has a hover/focus readout.
 */
export function ColumnChart({ points, label }: { points: ColumnPoint[]; label: string }) {
  const { ref, width } = useElementWidth<HTMLDivElement>(280);
  const [active, setActive] = useState<number | null>(null);

  const n = points.length;
  const plotW = width - PAD_X * 2;
  const band = plotW / n;
  const barW = Math.max(4, Math.min(18, band * 0.62));
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const baseline = HEIGHT - PAD_BOTTOM;
  const plotH = baseline - PAD_TOP;
  const y = (v: number) => baseline - (v / max) * plotH;
  const cx = (i: number) => PAD_X + band * i + band / 2;
  const last = n - 1;
  const labelled = points[last]?.partial && last > 0 ? last - 1 : last;

  const move = (to: number) => setActive(Math.max(0, Math.min(last, to)));
  const shown = active == null ? null : points[active];

  return (
    <div className={active == null ? "chart" : "chart chart--dim"} ref={ref}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`${label}: ${points.map((p) => `${p.title} ${p.value}`).join(", ")}`}
        tabIndex={0}
        onFocus={() => setActive(last)}
        onBlur={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") move((active ?? last) - 1);
          else if (event.key === "ArrowRight") move((active ?? last) + 1);
          else if (event.key === "Home") move(0);
          else if (event.key === "End") move(last);
          else return;
          event.preventDefault();
        }}
        onPointerLeave={() => setActive(null)}
      >
        {/* Recessive frame: one gridline at the axis maximum, the baseline. */}
        <line className="chart__grid" x1={PAD_X} x2={width - PAD_X} y1={PAD_TOP} y2={PAD_TOP} />
        <text className="chart__tick" x={PAD_X} y={PAD_TOP - 6}>
          {num(max)}
        </text>
        {points.map((p, i) => {
          const x = cx(i) - barW / 2;
          const top = y(p.value);
          return (
            <g key={p.key}>
              {p.value > 0 && (
                <path
                  className="chart__mark"
                  data-active={active === i}
                  d={columnPath(x, top, baseline, barW)}
                  fill="var(--viz-1)"
                  fillOpacity={p.partial ? 0.45 : 1}
                />
              )}
              {/* The hit target is the whole band, not just the painted bar. */}
              <rect
                className="chart__hit"
                x={PAD_X + band * i}
                y={PAD_TOP - 8}
                width={band}
                height={plotH + 8}
                onPointerEnter={() => setActive(i)}
              />
              {(i % 3 === 2 || i === last) && (
                <text className="chart__tick" x={cx(i)} y={HEIGHT - 6} textAnchor="middle">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
        <line className="chart__axis" x1={PAD_X} x2={width - PAD_X} y1={baseline} y2={baseline} />
        {points[labelled] && (
          <text className="chart__value" x={cx(labelled)} y={y(points[labelled].value) - 5} textAnchor="middle">
            {num(points[labelled].value)}
          </text>
        )}
      </svg>
      {shown && active != null && (
        <div className="chart__tip" style={{ left: cx(active), top: y(shown.value) }} role="status">
          <strong>{num(shown.value)}</strong>
          {shown.title}
          {shown.partial ? " (μέχρι σήμερα)" : ""}
        </div>
      )}
    </div>
  );
}
