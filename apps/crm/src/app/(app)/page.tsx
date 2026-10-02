import type { Metadata } from "next";
import Link from "next/link";

import { AgentsTable, Categories, LeadsBySource, MonthlyActivity, Pipeline } from "@/components/dashboard/ChartPanels";
import { Kpi } from "@/components/dashboard/Kpi";
import { PropertyTabs } from "@/components/dashboard/PropertyTabs";
import { ReminderTabs } from "@/components/dashboard/ReminderTabs";
import { Alerts, LatestLeads, LatestOffers, TodaysViewings } from "@/components/dashboard/SidePanels";
import { TodayStrip } from "@/components/dashboard/TodayStrip";
import { apiFetch } from "@/lib/api";
import { greeting, longDate, num, rangeLabel, type DashboardData } from "@/lib/dashboard";
import { CRM_BASE_PATH } from "@/lib/paths";
import { hasRole, requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Αρχική" };

const RANGES = [
  { key: "today", label: "Σήμερα" },
  { key: "week", label: "Εβδομάδα" },
  { key: "month", label: "Μήνας" },
  { key: "quarter", label: "Τρίμηνο" },
  { key: "year", label: "Έτος" },
] as const;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = new Date().toISOString();
  const firstName = user.firstName || user.email;

  if (!hasRole(user.role, "AGENT")) {
    return (
      <>
        <div className="dash-head">
          <div>
            <h1>
              {greeting(now)}, {firstName}
            </h1>
            <p>{longDate(now)}</p>
          </div>
        </div>
        <div className="notice">
          Ο ρόλος σας δεν έχει πρόσβαση στα στοιχεία ακινήτων και πελατών. Για περισσότερη πρόσβαση
          επικοινωνήστε με τον διαχειριστή του γραφείου.
        </div>
      </>
    );
  }

  const query = {
    range: first(sp.range) || undefined,
    from: first(sp.from) || undefined,
    to: first(sp.to) || undefined,
    scope: first(sp.scope) || undefined,
  };
  const result = await apiFetch<DashboardData>("/api/dashboard", { query });

  /** Dashboard URL with some filters changed, the others kept. */
  const href = (change: Partial<Record<keyof typeof query, string | undefined>>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...query, ...change })) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  if (!result.ok) {
    return (
      <>
        <div className="dash-head">
          <div>
            <h1>
              {greeting(now)}, {firstName}
            </h1>
            <p>{longDate(now)}</p>
          </div>
        </div>
        <div className="notice notice--danger dash-error" role="alert">
          Δεν ήταν δυνατή η φόρτωση των στοιχείων ({result.error.message}). Ανανεώστε τη σελίδα σε λίγο.
        </div>
      </>
    );
  }

  const data = result.data;
  const mine = data.scope === "mine";
  const mineQuery = mine ? "&mine=1" : "";
  const assigned = mine ? `assignedToId=${encodeURIComponent(user.id)}` : "";
  const leadsHref = (extra = "") => {
    const params = [assigned, extra].filter(Boolean).join("&");
    return params ? `/leads?${params}` : "/leads";
  };
  const p = data.period;
  const rangeKey = data.range.key;

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>
            {greeting(data.generatedAt)}, {firstName}
          </h1>
          <p>
            {longDate(data.generatedAt)} ·{" "}
            <span className="nowrap">Περίοδος: {rangeLabel(data.range.from, data.range.to)}</span>
          </p>
        </div>
        <div className="dash-filters">
          <nav className="seg" aria-label="Εύρος δεδομένων">
            <Link href={href({ scope: "mine" })} aria-current={mine ? "true" : undefined}>
              Τα δικά μου
            </Link>
            <Link href={href({ scope: "all" })} aria-current={!mine ? "true" : undefined}>
              Όλο το γραφείο
            </Link>
          </nav>
          <nav className="seg" aria-label="Περίοδος">
            {RANGES.map((r) => (
              <Link
                key={r.key}
                href={href({ range: r.key, from: undefined, to: undefined })}
                aria-current={rangeKey === r.key ? "true" : undefined}
              >
                {r.label}
              </Link>
            ))}
          </nav>
          <details className="range-custom" open={rangeKey === "custom" || undefined}>
            <summary className={rangeKey === "custom" ? "btn btn--outline btn--sm is-active" : "btn btn--ghost btn--sm"}>
              Προσαρμοσμένο
            </summary>
            <form method="get" action={CRM_BASE_PATH || "/"} className="range-custom__form">
              <input type="hidden" name="range" value="custom" />
              {query.scope && <input type="hidden" name="scope" value={query.scope} />}
              <label>
                Από
                <input type="date" name="from" className="input" defaultValue={query.from} required />
              </label>
              <label>
                Έως
                <input type="date" name="to" className="input" defaultValue={query.to} required />
              </label>
              <button type="submit" className="btn btn--primary btn--sm">
                Εφαρμογή
              </button>
            </form>
          </details>
        </div>
      </div>

      <TodayStrip data={data} mine={mine} userId={user.id} />

      <section className="kpi-section" aria-labelledby="kpi-portfolio">
        <h2 className="kpi-section__title" id="kpi-portfolio">
          Χαρτοφυλάκιο {mine ? "· τα δικά μου" : ""}
        </h2>
        <div className="kpis">
          <Kpi
            label="Ακίνητα"
            value={data.portfolio.total}
            icon="building"
            href={`/properties?statusGroup=CURRENT${mineQuery}`}
            meta={`${num(data.portfolio.active)} στην αγορά · ${num(data.portfolio.onWebsite)} στον ιστότοπο`}
          />
          <Kpi
            label="Κατοικίες"
            value={data.portfolio.byCategory.RESIDENTIAL}
            icon="home"
            href={`/properties?category=RESIDENTIAL&statusGroup=CURRENT${mineQuery}`}
          />
          <Kpi
            label="Επαγγελματικά"
            value={data.portfolio.byCategory.COMMERCIAL}
            icon="building"
            href={`/properties?category=COMMERCIAL&statusGroup=CURRENT${mineQuery}`}
          />
          <Kpi
            label="Οικόπεδα / Γη"
            value={data.portfolio.byCategory.LAND}
            icon="globe"
            href={`/properties?category=LAND&statusGroup=CURRENT${mineQuery}`}
          />
        </div>
      </section>

      <section className="kpi-section" aria-labelledby="kpi-period">
        <h2 className="kpi-section__title" id="kpi-period">
          Δραστηριότητα περιόδου
        </h2>
        <div className="kpis">
          <Kpi label="Νέα leads" value={p.leads.value} flow={p.leads} icon="inbox" href={leadsHref()} />
          <Kpi
            label="Από τον ιστότοπο"
            value={p.websiteLeads.value}
            flow={p.websiteLeads}
            icon="globe"
            href={leadsHref("channel=WEBSITE")}
          />
          <Kpi
            label="Από portals"
            value={p.portalLeads.value}
            flow={p.portalLeads}
            icon="external"
            href={leadsHref("channel=PORTAL")}
          />
          <Kpi
            label="Επισκέψεις"
            value={p.viewings.value}
            flow={p.viewings}
            icon="calendar"
            meta={`${num(data.upcomingViewings)} προγραμματισμένα ραντεβού`}
          />
          <Kpi label="Προσφορές" value={p.offers.value} flow={p.offers} icon="key" />
          <Kpi
            label="Πωλήσεις"
            value={p.sales.value}
            flow={p.sales}
            icon="check"
            href={`/properties?status=SOLD${mineQuery}`}
          />
          <Kpi
            label="Ενοικιάσεις"
            value={p.rentals.value}
            flow={p.rentals}
            icon="key"
            href={`/properties?status=RENTED${mineQuery}`}
          />
          <Kpi
            label="Νέα ακίνητα"
            value={p.newProperties.value}
            flow={p.newProperties}
            icon="plus"
            href={`/properties?statusGroup=CURRENT${mineQuery}`}
          />
        </div>
      </section>

      <div className="dash-grid">
        <div className="dash-main">
          <MonthlyActivity monthly={data.monthly} />
          <div className="dash-pair">
            <LeadsBySource sources={data.leadsBySource} />
            <Pipeline pipeline={data.pipeline} />
          </div>
          <Categories byCategory={data.portfolio.byCategory} />
          {data.agents && <AgentsTable agents={data.agents} />}
          <PropertyTabs added={data.recentProperties} updated={data.updatedProperties} now={data.generatedAt} />
        </div>
        <aside className="dash-side" aria-label="Σήμερα">
          <ReminderTabs reminders={data.reminders} now={data.generatedAt} />
          <TodaysViewings viewings={data.todaysViewings} />
          <Alerts alerts={data.alerts} mine={mine} userId={user.id} />
          <LatestLeads leads={data.latestLeads} now={data.generatedAt} />
          <LatestOffers offers={data.latestOffers} now={data.generatedAt} />
        </aside>
      </div>
    </>
  );
}
