"use client";

import { useEffect, useState } from "react";

import { CRM_BASE_PATH } from "@/lib/paths";

type Series = { key: string; values: number[]; total: number };
type Payload = { days: string[]; series: Series[]; periodDays: number };

const PERIODS = [7, 30, 90] as const;
const LABELS: Record<string, string> = { leads: "Νέα leads", contacts: "Νέες επαφές", requests: "Νέες ζητήσεις", viewings: "Υποδείξεις" };
// Distinct dash patterns as well as colours, so lines are told apart without colour.
const STYLE: Record<string, { color: string; dash: string }> = {
  leads: { color: "var(--viz-1, #1473d2)", dash: "" },
  contacts: { color: "var(--viz-2, #d95926)", dash: "6 4" },
  requests: { color: "var(--viz-3, #1b8a5a)", dash: "2 4" },
  viewings: { color: "var(--viz-4, #7a4fc4)", dash: "10 4 2 4" },
};
const FMT = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", timeZone: "Europe/Athens" });

export function StatsPanel({ scope }: { scope?: string }) {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [state, setState] = useState<{ status: "loading" | "error" | "ok"; data?: Payload }>({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ status: "loading", data: s.data }));
    const params = new URLSearchParams({ days: String(days) });
    if (scope) params.set("scope", scope);
    fetch(`${CRM_BASE_PATH}/api/dashboard/series?${params}`, { credentials: "same-origin", headers: { accept: "application/json" }, signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setState({ status: "ok", data: (await r.json()) as Payload });
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setState({ status: "error" });
      });
    return () => ctrl.abort();
  }, [days, scope]);

  const data = state.data;
  const w = 640;
  const h = 200;
  const pad = { l: 28, r: 8, t: 8, b: 20 };
  const max = data ? Math.max(1, ...data.series.flatMap((s) => s.values)) : 1;
  const n = data?.days.length ?? 0;
  const x = (i: number) => pad.l + (n > 1 ? (i / (n - 1)) * (w - pad.l - pad.r) : 0);
  const y = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const empty = data ? data.series.every((s) => s.total === 0) : false;

  return (
    <section className="home-card home-stats" aria-labelledby="home-stats-title" aria-busy={state.status === "loading"}>
      <div className="home-card__head">
        <h2 id="home-stats-title">Στατιστικά</h2>
        <div className="seg" role="group" aria-label="Περίοδος στατιστικών">
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={days === p} aria-current={days === p ? "true" : undefined} onClick={() => setDays(p)}>
              {p} ημέρες
            </button>
          ))}
        </div>
      </div>
      {state.status === "error" && <p className="notice notice--danger" role="alert">Δεν ήταν δυνατή η φόρτωση των στατιστικών. Δοκιμάστε ξανά σε λίγο.</p>}
      {state.status === "loading" && !data && <div className="home-skeleton" style={{ height: 200 }} aria-label="Φόρτωση" />}
      {data && (
        <div className={state.status === "loading" ? "is-stale" : undefined}>
          {empty ? (
            <p className="hint">Δεν υπάρχει δραστηριότητα στην επιλεγμένη περίοδο.</p>
          ) : (
            <svg viewBox={`0 0 ${w} ${h}`} className="home-chart" role="img" aria-label={`Δραστηριότητα τελευταίων ${data.periodDays} ημερών: ${data.series.map((s) => `${LABELS[s.key] ?? s.key} ${s.total}`).join(", ")}`}>
              {[0, 0.5, 1].map((t) => (
                <g key={t}>
                  <line x1={pad.l} x2={w - pad.r} y1={y(max * t)} y2={y(max * t)} stroke="var(--line)" />
                  <text x={pad.l - 6} y={y(max * t) + 4} textAnchor="end" fontSize="10" fill="var(--ink-muted)">{Math.round(max * t)}</text>
                </g>
              ))}
              {data.series.map((s) => (
                <polyline
                  key={s.key}
                  fill="none"
                  stroke={STYLE[s.key]?.color}
                  strokeWidth="2"
                  strokeDasharray={STYLE[s.key]?.dash}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                />
              ))}
              {[0, Math.floor((n - 1) / 2), n - 1].map((i) =>
                data.days[i] ? (
                  <text key={i} x={x(i)} y={h - 4} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="10" fill="var(--ink-muted)">
                    {FMT.format(new Date(`${data.days[i]}T12:00:00Z`))}
                  </text>
                ) : null,
              )}
            </svg>
          )}
          <ul className="home-legend">
            {data.series.map((s) => (
              <li key={s.key}>
                <svg width="26" height="8" aria-hidden="true"><line x1="0" x2="26" y1="4" y2="4" stroke={STYLE[s.key]?.color} strokeWidth="2" strokeDasharray={STYLE[s.key]?.dash} /></svg>
                {LABELS[s.key] ?? s.key}: <strong>{s.total}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
