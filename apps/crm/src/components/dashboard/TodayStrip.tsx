import Link from "next/link";

import { num, type DashboardData } from "@/lib/dashboard";

import { Icon, type IconName } from "../Icon";

type Chip = {
  key: string;
  count: number;
  text: string;
  icon: IconName;
  tone: "critical" | "warning" | "info" | "ok";
  href?: string;
};

/**
 * "HOME88 Σήμερα": what needs attention right now, in one line. Each chip has
 * an icon and words, so the meaning never rests on colour.
 */
export function TodayStrip({ data, mine, userId }: { data: DashboardData; mine: boolean; userId: string }) {
  const uncontacted = data.alerts.find((a) => a.code === "UNCONTACTED_LEADS")?.count ?? 0;
  const offers = data.alerts.find((a) => a.code === "OFFERS_PENDING")?.count ?? 0;
  const chips: Chip[] = [
    {
      key: "overdue",
      count: data.reminders.overdue.count,
      text: "εκπρόθεσμες υπενθυμίσεις",
      icon: "clock",
      tone: "critical",
      href: "#reminders",
    },
    { key: "today", count: data.reminders.today.count, text: "υπενθυμίσεις σήμερα", icon: "bell", tone: "info", href: "#reminders" },
    {
      key: "viewings",
      count: data.todaysViewings.length,
      text: "ραντεβού σήμερα",
      icon: "calendar",
      tone: "ok",
      href: "#today-viewings",
    },
    {
      key: "leads",
      count: uncontacted,
      text: "leads χωρίς επικοινωνία",
      icon: "inbox",
      tone: "warning",
      href: `/leads?status=NEW${mine ? `&assignedToId=${encodeURIComponent(userId)}` : ""}`,
    },
    { key: "offers", count: offers, text: "προσφορές σε εκκρεμότητα", icon: "key", tone: "info", href: "#offers" },
    {
      key: "drafts",
      count: data.portfolio.drafts,
      text: "πρόχειρα προς ολοκλήρωση",
      icon: "mandate",
      tone: "info",
      href: `/properties?status=DRAFT${mine ? "&mine=1" : ""}`,
    },
  ];

  return (
    <section className="today" aria-label="HOME88 Σήμερα">
      <p className="today__title">
        <Icon name="sparkle" size={18} />
        HOME88 Σήμερα
      </p>
      <div className="today__chips">
        {chips.map((chip) => {
          const body = (
            <>
              <span className="chip__dot" aria-hidden="true">
                <Icon name={chip.icon} />
              </span>
              <strong>{num(chip.count)}</strong> {chip.text}
            </>
          );
          const className = `chip chip--${chip.tone}${chip.count === 0 ? " chip--zero" : ""}`;
          return chip.href && chip.count > 0 ? (
            <Link key={chip.key} href={chip.href} className={className}>
              {body}
            </Link>
          ) : (
            <span key={chip.key} className={className}>
              {body}
            </span>
          );
        })}
      </div>
    </section>
  );
}
