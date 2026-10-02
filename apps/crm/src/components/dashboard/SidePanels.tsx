import Link from "next/link";
import { LEAD_SOURCE_LABELS, label } from "@home88/types";

import { money, plural, relative, timeOf, type DashboardData } from "@/lib/dashboard";
import { OFFER_STATUS_LABEL, VIEWING_STATUS_LABEL } from "@/lib/labels";

import { EmptyState } from "../EmptyState";
import { Icon, type IconName } from "../Icon";
import { StatusBadge } from "../StatusBadge";

export function TodaysViewings({ viewings }: { viewings: DashboardData["todaysViewings"] }) {
  return (
    <section className="panel" id="today-viewings" aria-labelledby="viewings-title">
      <div className="panel__head">
        <h2 id="viewings-title">Σημερινά ραντεβού</h2>
      </div>
      {viewings.length === 0 ? (
        <EmptyState compact title="Κανένα ραντεβού για σήμερα." />
      ) : (
        <ul className="list">
          {viewings.map((v) => (
            <li key={v.id}>
              <span className="list__time">{timeOf(v.startsAt)}</span>
              <span className="list__main">
                <Link href={`/properties/${v.property.id}`} className="list__title" title={v.property.titleEl}>
                  {v.property.titleEl}
                </Link>
                <span className="list__sub">
                  {v.property.reference}
                  {v.property.areaName ? ` · ${v.property.areaName}` : ""} · {v.clientName} · {v.agent.firstName}{" "}
                  {v.agent.lastName}
                </span>
              </span>
              {v.status !== "SCHEDULED" && (
                <span className={v.status === "COMPLETED" ? "badge badge--ok" : "badge badge--warn"}>
                  {VIEWING_STATUS_LABEL[v.status] ?? v.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LatestLeads({ leads, now }: { leads: DashboardData["latestLeads"]; now: string }) {
  return (
    <section className="panel" aria-labelledby="leads-title">
      <div className="panel__head">
        <h2 id="leads-title">Νέα leads</h2>
        <Link href="/leads" className="btn btn--ghost btn--sm">
          Όλα
        </Link>
      </div>
      {leads.length === 0 ? (
        <EmptyState
          compact
          title="Δεν υπάρχουν ακόμη leads"
          text="Τα αιτήματα από τον ιστότοπο και τα portals θα εμφανίζονται εδώ."
        />
      ) : (
        <ul className="list">
          {leads.map((lead) => (
            <li key={lead.id}>
              <span className="list__main">
                <Link href={`/leads/${lead.id}`} className="list__title">
                  {lead.firstName} {lead.lastName ?? ""}
                </Link>
                <span className="list__sub">
                  {label(LEAD_SOURCE_LABELS, lead.source, "el")}
                  {lead.property ? ` · ${lead.property.reference}` : ""} · {relative(lead.createdAt, now)}
                </span>
              </span>
              <StatusBadge value={lead.status} kind="lead" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LatestOffers({ offers, now }: { offers: DashboardData["latestOffers"]; now: string }) {
  return (
    <section className="panel" id="offers" aria-labelledby="offers-title">
      <div className="panel__head">
        <h2 id="offers-title">Τελευταίες προσφορές</h2>
      </div>
      {offers.length === 0 ? (
        <EmptyState compact title="Δεν υπάρχουν ακόμη προσφορές." />
      ) : (
        <ul className="list">
          {offers.map((offer) => (
            <li key={offer.id}>
              <span className="list__main">
                <span className="list__title">{money(offer.amount)}</span>
                <span className="list__sub">
                  <Link href={`/properties/${offer.property.id}`}>{offer.property.reference}</Link>
                  {offer.lead ? ` · ${offer.lead.firstName} ${offer.lead.lastName ?? ""}` : ""} ·{" "}
                  {relative(offer.createdAt, now)}
                </span>
              </span>
              <span
                className={
                  offer.status === "ACCEPTED"
                    ? "badge badge--ok"
                    : offer.status === "SUBMITTED" || offer.status === "COUNTERED"
                      ? "badge badge--info"
                      : "badge badge--muted"
                }
              >
                {OFFER_STATUS_LABEL[offer.status] ?? offer.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Scope = { mine: boolean; userId: string };

const ALERT: Record<string, { icon: IconName; text: (n: number) => string; href?: (scope: Scope) => string }> = {
  OVERDUE_TASKS: {
    icon: "clock",
    text: (n) => `${plural(n, "υπενθύμιση έχει", "υπενθυμίσεις έχουν")} λήξει`,
    href: () => "#reminders",
  },
  PORTAL_FAILED: {
    icon: "alert",
    text: (n) => `${plural(n, "δημοσίευση", "δημοσιεύσεις")} σε portals ${n === 1 ? "απέτυχε" : "απέτυχαν"}`,
  },
  UNCONTACTED_LEADS: {
    icon: "inbox",
    text: (n) => `${plural(n, "νέο lead", "νέα leads")} χωρίς επικοινωνία για πάνω από 24 ώρες`,
    href: ({ mine, userId }) => `/leads?status=NEW${mine ? `&assignedToId=${encodeURIComponent(userId)}` : ""}`,
  },
  ACTIVE_WITHOUT_PHOTO: {
    icon: "building",
    text: (n) => `${plural(n, "ακίνητο", "ακίνητα")} στην αγορά χωρίς εγκεκριμένη φωτογραφία`,
    href: ({ mine }) => `/properties?statusGroup=PUBLIC${mine ? "&mine=1" : ""}`,
  },
  OFFERS_PENDING: {
    icon: "key",
    text: (n) => `${plural(n, "προσφορά περιμένει", "προσφορές περιμένουν")} απάντηση`,
    href: () => "#offers",
  },
  MEDIA_PENDING: {
    icon: "eye",
    text: (n) => `${plural(n, "αρχείο περιμένει", "αρχεία περιμένουν")} έγκριση πριν δημοσιευτεί`,
  },
  STALE_DRAFTS: {
    icon: "mandate",
    text: (n) => `${plural(n, "πρόχειρο ακίνητο", "πρόχειρα ακίνητα")} χωρίς αλλαγή για 14+ ημέρες`,
    href: ({ mine }) => `/properties?status=DRAFT${mine ? "&mine=1" : ""}`,
  },
};

const SEVERITY_TEXT = { critical: "Κρίσιμο", warning: "Προσοχή", info: "Ενημέρωση" } as const;

export function Alerts({ alerts, mine, userId }: { alerts: DashboardData["alerts"]; mine: boolean; userId: string }) {
  return (
    <section className="panel" aria-labelledby="alerts-title">
      <div className="panel__head">
        <h2 id="alerts-title">Ειδοποιήσεις</h2>
      </div>
      {alerts.length === 0 ? (
        <EmptyState compact title="Όλα σε τάξη" text="Δεν υπάρχει κάτι που χρειάζεται την προσοχή σας." />
      ) : (
        <ul className="alert-list">
          {alerts.map((alert) => {
            const spec = ALERT[alert.code];
            if (!spec) return null;
            const href = spec.href?.({ mine, userId });
            const text = <span className="alert-item__text">{spec.text(alert.count)}</span>;
            return (
              <li key={alert.code} className={`alert-item alert-item--${alert.severity}`}>
                <span className="icon-dot" aria-hidden="true">
                  <Icon name={spec.icon} size={16} />
                </span>
                <span className="sr-only">{SEVERITY_TEXT[alert.severity]}:</span>
                {href ? (
                  <Link href={href} className="alert-item__link">
                    {text}
                    <Icon name="chevronRight" size={16} />
                  </Link>
                ) : (
                  text
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
