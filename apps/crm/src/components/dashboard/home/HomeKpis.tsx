import Link from "next/link";

import { delta, monthShort, num, type Flow } from "@/lib/dashboard";

import { Icon, type IconName } from "../../Icon";
import { Sparkline } from "./Sparkline";

export type OverviewKpi = { total: number; flow: Flow; trend: number[] };
export type Overview = {
  generatedAt: string;
  scope: "all" | "mine";
  period: { days: number };
  months: string[];
  kpis: { properties: OverviewKpi; contacts: OverviewKpi; requests: OverviewKpi; showings: OverviewKpi };
};

const CARDS: Array<{ key: keyof Overview["kpis"]; label: string; icon: IconName; href: string; what: string }> = [
  { key: "properties", label: "Ακίνητα", icon: "building", href: "/properties?statusGroup=CURRENT", what: "νέα ακίνητα" },
  { key: "contacts", label: "Επαφές", icon: "users", href: "/contacts", what: "νέες επαφές" },
  { key: "requests", label: "Ζητήσεις", icon: "search", href: "/requests", what: "νέες ζητήσεις" },
  { key: "showings", label: "Υποδείξεις", icon: "key", href: "/showings", what: "νέες υποδείξεις" },
];

export function HomeKpis({ overview }: { overview: Overview }) {
  const first = overview.months[0] ? monthShort(overview.months[0]) : "";
  const last = overview.months.length ? monthShort(overview.months[overview.months.length - 1]!) : "";
  return (
    <section className="home-kpis" aria-label="Βασικοί δείκτες">
      {CARDS.map((c) => {
        const k = overview.kpis[c.key];
        const change = delta(k.flow);
        const hasTrend = k.trend.some((v) => v > 0);
        return (
          <Link key={c.key} href={c.href} className="home-card home-kpi">
            <span className="home-kpi__top">
              <span className="home-kpi__icon" aria-hidden="true"><Icon name={c.icon} size={18} /></span>
              <span className="home-kpi__label">{c.label}</span>
            </span>
            <span className="home-kpi__value">{num(k.total)}</span>
            <span className="home-kpi__foot">
              <span className="home-kpi__delta" title={change.title}>
                <strong>{num(k.flow.value)}</strong> {c.what} · {overview.period.days} ημ.
                <span className={`delta delta--${change.direction}`}>
                  {change.direction !== "flat" && <Icon name={change.direction === "up" ? "arrowUp" : "arrowDown"} size={12} />}
                  {change.text}
                  <span className="sr-only">{change.direction === "up" ? " αύξηση" : change.direction === "down" ? " μείωση" : " χωρίς αλλαγή"} έναντι προηγούμενης περιόδου</span>
                </span>
              </span>
              {hasTrend && (
                <Sparkline
                  values={k.trend}
                  summary={`${c.what}, ${first}–${last}: ${k.trend.map((v) => num(v)).join(", ")}`}
                />
              )}
            </span>
          </Link>
        );
      })}
    </section>
  );
}
