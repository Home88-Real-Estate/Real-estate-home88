import { LEAD_OPEN_STAGES, PROPERTY_CATEGORIES } from "@home88/domain";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, label } from "@home88/types";

import { monthLong, monthShort, num, type DashboardData } from "@/lib/dashboard";
import { CATEGORY_LABEL } from "@/lib/labels";

import { BarList } from "../charts/BarList";
import { ChartCard } from "../charts/ChartCard";
import { ColumnChart } from "../charts/ColumnChart";
import { StackedBar } from "../charts/StackedBar";
import { EmptyState } from "../EmptyState";

/** Ordinal ramp for the five open pipeline stages (validated light/dark). */
const STAGE_COLOR = ["var(--viz-ord-1)", "var(--viz-ord-2)", "var(--viz-ord-3)", "var(--viz-ord-4)", "var(--viz-ord-5)"];
/** Categorical slots 1-4, fixed order: a category keeps its colour whatever the counts. */
const CATEGORY_COLOR: Record<string, string> = {
  RESIDENTIAL: "var(--viz-1)",
  COMMERCIAL: "var(--viz-2)",
  LAND: "var(--viz-3)",
  OTHER: "var(--viz-4)",
};

const SERIES = [
  { key: "newProperties", title: "Νέα ακίνητα" },
  { key: "leads", title: "Leads" },
  { key: "viewings", title: "Επισκέψεις" },
  { key: "closings", title: "Πωλήσεις & ενοικιάσεις" },
] as const;

export function MonthlyActivity({ monthly }: { monthly: DashboardData["monthly"] }) {
  const last = monthly.length - 1;
  const anyActivity = monthly.some((m) => SERIES.some((s) => m[s.key] > 0));
  const table = (
    <table className="chart-table">
      <thead>
        <tr>
          <th>Μήνας</th>
          {SERIES.map((s) => (
            <th key={s.key} className="num">
              {s.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthly.map((m, i) => (
          <tr key={m.month}>
            <td>
              {monthLong(m.month)}
              {i === last ? " (σε εξέλιξη)" : ""}
            </td>
            {SERIES.map((s) => (
              <td key={s.key} className="num">
                {num(m[s.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartCard
      title="Δραστηριότητα ανά μήνα"
      subtitle="Τελευταίοι 12 μήνες · ο τρέχων μήνας είναι σε εξέλιξη (πιο αχνός)"
      table={table}
    >
      {!anyActivity ? (
        <EmptyState
          compact
          title="Δεν υπάρχει ακόμη δραστηριότητα"
          text="Τα γραφήματα συμπληρώνονται καθώς καταχωρίζετε ακίνητα, leads και επισκέψεις."
        />
      ) : (
        <div className="multiples">
          {SERIES.map((s) => {
            const total = monthly.reduce((sum, m) => sum + m[s.key], 0);
            return (
              <div key={s.key} className="multiple">
                <p className="multiple__title">{s.title}</p>
                <p className="multiple__total">
                  {num(total)}
                  <span>σε 12 μήνες</span>
                </p>
                <ColumnChart
                  label={s.title}
                  points={monthly.map((m, i) => ({
                    key: m.month,
                    label: monthShort(m.month),
                    title: monthLong(m.month),
                    value: m[s.key],
                    partial: i === last,
                  }))}
                />
              </div>
            );
          })}
        </div>
      )}
    </ChartCard>
  );
}

export function LeadsBySource({ sources }: { sources: DashboardData["leadsBySource"] }) {
  const rows = sources.map((s) => ({
    key: s.source,
    label: label(LEAD_SOURCE_LABELS, s.source, "el"),
    value: s.count,
    color: "var(--viz-1)",
  }));
  const table = (
    <table className="chart-table">
      <thead>
        <tr>
          <th>Πηγή</th>
          <th className="num">Leads</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td className="num">{num(r.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <ChartCard title="Leads ανά πηγή" subtitle="Στην επιλεγμένη περίοδο" table={table}>
      {rows.length === 0 ? (
        <EmptyState compact title="Κανένα lead στην περίοδο" />
      ) : (
        <BarList rows={rows} unit="leads" />
      )}
    </ChartCard>
  );
}

export function Pipeline({ pipeline }: { pipeline: DashboardData["pipeline"] }) {
  const open = pipeline.stages.filter((s) => (LEAD_OPEN_STAGES as readonly string[]).includes(s.key));
  const won = pipeline.stages.find((s) => s.key === "WON")?.count ?? 0;
  const rows = open.map((s, i) => ({
    key: s.key,
    label: label(LEAD_STATUS_LABELS, s.key, "el"),
    value: s.count,
    color: STAGE_COLOR[i] ?? "var(--viz-ord-5)",
  }));
  const any = pipeline.open + won + pipeline.lost > 0;
  const table = (
    <table className="chart-table">
      <thead>
        <tr>
          <th>Στάδιο</th>
          <th className="num">Leads</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td className="num">{num(r.value)}</td>
          </tr>
        ))}
        <tr>
          <td>Κερδήθηκαν</td>
          <td className="num">{num(won)}</td>
        </tr>
        <tr>
          <td>Χάθηκαν / χωρίς ενδιαφέρον</td>
          <td className="num">{num(pipeline.lost)}</td>
        </tr>
      </tbody>
    </table>
  );
  return (
    <ChartCard
      title="Πορεία leads"
      subtitle="Leads της περιόδου ανά τρέχον στάδιο"
      table={table}
    >
      {!any ? (
        <EmptyState compact title="Κανένα lead στην περίοδο" />
      ) : (
        <>
          <BarList rows={rows} unit="leads" />
          <p className="pipeline-foot">
            <span>
              Ανοιχτά: <strong>{num(pipeline.open)}</strong>
            </span>
            <span>
              Κερδήθηκαν: <strong>{num(won)}</strong>
            </span>
            <span>
              Χάθηκαν: <strong>{num(pipeline.lost)}</strong>
            </span>
          </p>
        </>
      )}
    </ChartCard>
  );
}

export function Categories({ byCategory }: { byCategory: DashboardData["portfolio"]["byCategory"] }) {
  const segments = PROPERTY_CATEGORIES.map((key) => ({
    key,
    label: CATEGORY_LABEL[key],
    value: byCategory[key] ?? 0,
    color: CATEGORY_COLOR[key]!,
  }));
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const table = (
    <table className="chart-table">
      <thead>
        <tr>
          <th>Κατηγορία</th>
          <th className="num">Ακίνητα</th>
          <th className="num">%</th>
        </tr>
      </thead>
      <tbody>
        {segments.map((s) => (
          <tr key={s.key}>
            <td>{s.label}</td>
            <td className="num">{num(s.value)}</td>
            <td className="num">{total ? Math.round((s.value / total) * 100) : 0}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <ChartCard title="Χαρτοφυλάκιο ανά κατηγορία" subtitle="Όλα τα ακίνητα εκτός από τα αρχειοθετημένα" table={table}>
      {total === 0 ? (
        <EmptyState compact title="Δεν υπάρχουν ακόμη ακίνητα" />
      ) : (
        <StackedBar segments={segments} unit="ακίνητα" />
      )}
    </ChartCard>
  );
}

export function AgentsTable({ agents }: { agents: NonNullable<DashboardData["agents"]> }) {
  return (
    <section className="panel" aria-labelledby="agents-title">
      <div className="panel__head">
        <div>
          <h2 id="agents-title">Απόδοση συμβούλων</h2>
          <p className="panel__sub">Ενεργά ακίνητα σήμερα · τα υπόλοιπα στην επιλεγμένη περίοδο</p>
        </div>
      </div>
      {agents.length === 0 ? (
        <EmptyState compact title="Καμία δραστηριότητα συμβούλων στην περίοδο." />
      ) : (
        <div className="table-scroll">
          <table className="chart-table">
            <thead>
              <tr>
                <th>Σύμβουλος</th>
                <th className="num">Ενεργά ακίνητα</th>
                <th className="num">Leads</th>
                <th className="num">Επισκέψεις</th>
                <th className="num">Προσφορές</th>
                <th className="num">Κλεισίματα</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td className="num">{num(a.activeProperties)}</td>
                  <td className="num">{num(a.leads)}</td>
                  <td className="num">{num(a.viewings)}</td>
                  <td className="num">{num(a.offers)}</td>
                  <td className="num">{num(a.closings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
