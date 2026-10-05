/**
 * Report builders.
 *
 * Every number is counted from the records for the requested period and scope
 * at the moment of the request; nothing is cached or estimated. Reports hold
 * no client names or contact details: agents appear by name, records by their
 * reference. Scope "mine" restricts to the signed-in user's own records.
 *
 * Definitions are returned with each report and shown beside the numbers.
 */

import {
  COMMISSION_STATUS_LABELS,
  PUBLIC_PROPERTY_STATUSES,
  SELLER_STAGES,
  SELLER_STAGE_LABELS,
  TRANSACTION_STATUS_LABELS,
  MANDATE_STATUS_LABELS,
  MESSAGE_STATUS_LABELS,
  channelOf,
  median,
  ratePct,
  REPORT_LABELS,
  sumMoney,
  type DateRange,
  type ReportDigest,
  type ReportKind,
} from "@home88/domain";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, PROPERTY_STATUS_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { db } from "./prisma";
import { settings } from "../settings";

export type Scope = { all: boolean; userId: string };

export type ReportCell = string | number | null;
export type ReportTable = {
  key: string;
  title: string;
  columns: Array<{ key: string; label: string; numeric?: boolean }>;
  rows: Array<Record<string, ReportCell>>;
};
export type ReportMetric = { key: string; label: string; value: ReportCell; unit?: "%" | "€" | "ημ." | null };
export type ReportResult = {
  kind: ReportKind;
  title: string;
  period: { key: string; from: string; to: string };
  scope: "mine" | "all";
  definitions: string[];
  summary: ReportMetric[];
  tables: ReportTable[];
  /** True when a table was cut at the row limit. */
  truncated: boolean;
};

const ROW_LIMIT = 20_000;
const DAY = 24 * 3_600_000;
const PUBLIC = [...PUBLIC_PROPERTY_STATUSES];
const OPEN_LEAD = ["NEW", "CONTACTED", "QUALIFIED", "VIEWING", "OFFER"];
const LOST_LEAD = ["LOST", "NOT_INTERESTED"];

const between = (range: DateRange) => ({ gte: range.from, lt: range.to });
const days = (from: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const pct = (n: number | null) => n;

function head(kind: ReportKind, range: DateRange, scope: Scope): Omit<ReportResult, "definitions" | "summary" | "tables" | "truncated"> {
  return {
    kind,
    title: REPORT_LABELS[kind].title,
    period: { key: range.key, from: range.from.toISOString(), to: range.to.toISOString() },
    scope: scope.all ? "all" : "mine",
  };
}

async function agentNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const users = await db().user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
}

const count = <T>(items: T[], key: (item: T) => string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return m;
};

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

async function leadsReport(range: DateRange, scope: Scope, now: Date): Promise<ReportResult> {
  const leads = await db().lead.findMany({
    where: { createdAt: between(range), ...(scope.all ? {} : { assignedToId: scope.userId }) },
    select: { status: true, source: true, assignedToId: true, lastContactedAt: true, createdAt: true },
    take: ROW_LIMIT,
  });
  const total = leads.length;
  const won = leads.filter((l) => l.status === "WON").length;
  const lost = leads.filter((l) => LOST_LEAD.includes(l.status)).length;
  const open = leads.filter((l) => OPEN_LEAD.includes(l.status));
  const waiting = open.filter((l) => !l.lastContactedAt);
  const contacted = leads.filter((l) => l.lastContactedAt).length;

  const byStatus = count(leads, (l) => l.status);
  const statusRows = ["NEW", "CONTACTED", "QUALIFIED", "VIEWING", "OFFER", "WON", "LOST", "NOT_INTERESTED"].map((s) => ({
    status: label(LEAD_STATUS_LABELS, s, "el"),
    leads: byStatus.get(s) ?? 0,
    share: ratePct(byStatus.get(s) ?? 0, total),
  }));

  const sources = [...new Set(leads.map((l) => l.source))];
  const sourceRows = sources
    .map((s) => {
      const of = leads.filter((l) => l.source === s);
      const w = of.filter((l) => l.status === "WON").length;
      const lo = of.filter((l) => LOST_LEAD.includes(l.status)).length;
      return { source: label(LEAD_SOURCE_LABELS, s, "el"), channel: { WEBSITE: "Ιστότοπος", PORTAL: "Portals", DIRECT: "Άμεσα" }[channelOf(s)], leads: of.length, won: w, lost: lo, winRate: ratePct(w, w + lo) };
    })
    .sort((a, b) => b.leads - a.leads);

  const tables: ReportTable[] = [
    { key: "status", title: "Κατάσταση σήμερα των leads της περιόδου", columns: [{ key: "status", label: "Κατάσταση" }, { key: "leads", label: "Leads", numeric: true }, { key: "share", label: "% των leads", numeric: true }], rows: statusRows },
    { key: "source", title: "Πηγές", columns: [{ key: "source", label: "Πηγή" }, { key: "channel", label: "Κανάλι" }, { key: "leads", label: "Leads", numeric: true }, { key: "won", label: "Κέρδη", numeric: true }, { key: "lost", label: "Χαμένα", numeric: true }, { key: "winRate", label: "% επιτυχίας", numeric: true }], rows: sourceRows },
  ];
  if (scope.all) {
    const names = await agentNames(leads.map((l) => l.assignedToId));
    const ids = [...new Set(leads.map((l) => l.assignedToId ?? "—"))];
    tables.push({
      key: "agent",
      title: "Ανά συνεργάτη",
      columns: [{ key: "agent", label: "Συνεργάτης" }, { key: "leads", label: "Leads", numeric: true }, { key: "contacted", label: "Με επικοινωνία", numeric: true }, { key: "won", label: "Κέρδη", numeric: true }],
      rows: ids
        .map((id) => {
          const of = leads.filter((l) => (l.assignedToId ?? "—") === id);
          return { agent: id === "—" ? "Χωρίς ανάθεση" : (names.get(id) ?? "—"), leads: of.length, contacted: of.filter((l) => l.lastContactedAt).length, won: of.filter((l) => l.status === "WON").length };
        })
        .sort((a, b) => b.leads - a.leads),
    });
  }

  return {
    ...head("leads", range, scope),
    definitions: [
      "Αφορά τα leads που δημιουργήθηκαν μέσα στην περίοδο. Η κατάσταση είναι η σημερινή, όχι αυτή που είχαν τότε.",
      "% επιτυχίας = κερδισμένα ÷ (κερδισμένα + χαμένα ή χωρίς ενδιαφέρον). Τα ανοιχτά leads δεν μετράνε ούτε υπέρ ούτε κατά.",
      "«Με επικοινωνία» = έχει καταγραφεί τουλάχιστον μία επικοινωνία. Ο χρόνος αναμονής μετριέται μόνο για ανοιχτά leads χωρίς καμία επικοινωνία.",
    ],
    summary: [
      { key: "total", label: "Leads", value: total },
      { key: "open", label: "Ανοιχτά", value: open.length },
      { key: "won", label: "Κερδισμένα", value: won },
      { key: "lost", label: "Χαμένα", value: lost },
      { key: "winRate", label: "Ποσοστό επιτυχίας", value: pct(ratePct(won, won + lost)), unit: "%" },
      { key: "contacted", label: "Με επικοινωνία", value: pct(ratePct(contacted, total)), unit: "%" },
      { key: "waiting", label: "Ανοιχτά χωρίς επικοινωνία", value: waiting.length },
      { key: "waitingDays", label: "Διάμεσος χρόνος αναμονής τους", value: median(waiting.map((l) => days(l.createdAt, now))), unit: "ημ." },
    ],
    tables,
    truncated: leads.length >= ROW_LIMIT,
  };
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

async function inventoryReport(range: DateRange, scope: Scope, now: Date): Promise<ReportResult> {
  const ownProps = scope.all ? {} : { OR: [{ agentId: scope.userId }, { createdById: scope.userId }] };
  const props = await db().property.findMany({
    where: ownProps,
    select: { status: true, propertyType: true, areaName: true, city: true, publishedAt: true, updatedAt: true, createdAt: true },
    take: ROW_LIMIT,
  });
  const publicProps = props.filter((p) => (PUBLIC as string[]).includes(p.status));
  const age = (p: { publishedAt: Date | null; createdAt: Date }) => days(p.publishedAt ?? p.createdAt, now);
  const staleAfter = (await settings().config("properties")).staleAfterDays;
  const staleDays = typeof staleAfter === "number" ? staleAfter : null;
  const stale = staleDays === null ? null : publicProps.filter((p) => days(p.updatedAt, now) >= staleDays).length;

  const [reductions, closings] = await Promise.all([
    db().propertyPriceHistory.findMany({
      where: { createdAt: between(range), property: ownProps },
      select: { fromPrice: true, toPrice: true, fromMonthlyRent: true, toMonthlyRent: true },
      take: ROW_LIMIT,
    }),
    db().propertyStatusHistory.count({ where: { toStatus: { in: ["SOLD", "RENTED"] }, createdAt: between(range), property: ownProps } }),
  ]);
  const cut = reductions.filter((r) => (r.fromPrice != null && r.toPrice != null && num(r.toPrice) < num(r.fromPrice)) || (r.fromMonthlyRent != null && r.toMonthlyRent != null && num(r.toMonthlyRent) < num(r.fromMonthlyRent))).length;

  const byStatus = count(props, (p) => p.status);
  const typeKeys = [...new Set(publicProps.map((p) => p.propertyType))];
  const areaKeys = [...new Set(publicProps.map((p) => p.areaName || p.city || "—"))];
  const buckets: Array<[string, (d: number) => boolean]> = [
    ["Έως 30 ημέρες", (d) => d <= 30],
    ["31 – 60 ημέρες", (d) => d > 30 && d <= 60],
    ["61 – 90 ημέρες", (d) => d > 60 && d <= 90],
    ["Πάνω από 90 ημέρες", (d) => d > 90],
  ];

  return {
    ...head("inventory", range, scope),
    definitions: [
      "Το χαρτοφυλάκιο είναι η σημερινή εικόνα. Η περίοδος επηρεάζει μόνο τις μειώσεις τιμής και τα κλεισίματα.",
      "«Σε προβολή» = ενεργά, υπό προσφορά και κρατημένα. Ο χρόνος στην αγορά μετράται από τη δημοσίευση (ή τη δημιουργία, αν λείπει).",
      "Μείωση τιμής = καταγεγραμμένη αλλαγή τιμής προς τα κάτω μέσα στην περίοδο. Κλείσιμο = αλλαγή κατάστασης σε «Πωλήθηκε» ή «Νοικιάστηκε».",
      staleDays === null ? "Ο έλεγχος «χωρίς ενημέρωση» είναι ανενεργός· ορίζεται στις Ρυθμίσεις → Ακίνητα." : `«Χωρίς ενημέρωση» = καμία αλλαγή για ${staleDays} ημέρες ή περισσότερο (Ρυθμίσεις → Ακίνητα).`,
    ],
    summary: [
      { key: "public", label: "Σε προβολή", value: publicProps.length },
      { key: "draft", label: "Πρόχειρα", value: byStatus.get("DRAFT") ?? 0 },
      { key: "underOffer", label: "Υπό προσφορά", value: byStatus.get("UNDER_OFFER") ?? 0 },
      { key: "dom", label: "Διάμεσος χρόνος στην αγορά", value: median(publicProps.map(age)), unit: "ημ." },
      { key: "stale", label: "Χωρίς ενημέρωση", value: stale },
      { key: "cuts", label: "Μειώσεις τιμής στην περίοδο", value: cut },
      { key: "closings", label: "Κλεισίματα στην περίοδο", value: closings },
    ],
    tables: [
      { key: "status", title: "Ανά κατάσταση", columns: [{ key: "status", label: "Κατάσταση" }, { key: "properties", label: "Ακίνητα", numeric: true }], rows: ["DRAFT", "ACTIVE", "UNDER_OFFER", "RESERVED", "SOLD", "RENTED", "INACTIVE", "ARCHIVED"].map((s) => ({ status: label(PROPERTY_STATUS_LABELS, s, "el"), properties: byStatus.get(s) ?? 0 })) },
      { key: "type", title: "Σε προβολή ανά τύπο", columns: [{ key: "type", label: "Τύπος" }, { key: "properties", label: "Ακίνητα", numeric: true }, { key: "dom", label: "Διάμεσες ημέρες στην αγορά", numeric: true }], rows: typeKeys.map((t) => { const of = publicProps.filter((p) => p.propertyType === t); return { type: label(PROPERTY_TYPE_LABELS, t, "el"), properties: of.length, dom: median(of.map(age)) }; }).sort((a, b) => b.properties - a.properties) },
      { key: "aging", title: "Ηλικία καταχωρίσεων σε προβολή", columns: [{ key: "bucket", label: "Χρόνος στην αγορά" }, { key: "properties", label: "Ακίνητα", numeric: true }], rows: buckets.map(([name, fn]) => ({ bucket: name, properties: publicProps.filter((p) => fn(age(p))).length })) },
      { key: "area", title: "Σε προβολή ανά περιοχή (πρώτες 15)", columns: [{ key: "area", label: "Περιοχή" }, { key: "properties", label: "Ακίνητα", numeric: true }, { key: "dom", label: "Διάμεσες ημέρες στην αγορά", numeric: true }], rows: areaKeys.map((a) => { const of = publicProps.filter((p) => (p.areaName || p.city || "—") === a); return { area: a, properties: of.length, dom: median(of.map(age)) }; }).sort((a, b) => b.properties - a.properties).slice(0, 15) },
    ],
    truncated: props.length >= ROW_LIMIT,
  };
}

// ---------------------------------------------------------------------------
// Sales and commissions (managers only; enforced by the route)
// ---------------------------------------------------------------------------

async function salesReport(range: DateRange, scope: Scope): Promise<ReportResult> {
  const [closed, all] = await Promise.all([
    db().transaction.findMany({
      where: { closedAt: between(range), status: "CLOSED" },
      select: { agentId: true, agreedAmount: true, commission: { select: { net: true, gross: true, agentShare: true, agencyShare: true, status: true, paidAmount: true } } },
      take: ROW_LIMIT,
    }),
    db().transaction.findMany({ select: { status: true, agreedAmount: true }, take: ROW_LIMIT }),
  ]);
  const withCommission = closed.filter((t) => t.commission && t.commission.status !== "CANCELLED");
  const gross = sumMoney(withCommission.map((t) => t.commission!.gross));
  const paid = sumMoney(withCommission.map((t) => t.commission!.paidAmount));
  const names = await agentNames(closed.map((t) => t.agentId));
  const agentIds = [...new Set(closed.map((t) => t.agentId ?? "—"))];
  const statuses = ["NEGOTIATION", "AGREEMENT", "CONTRACT", "CLOSED", "CANCELLED"];
  const commissionStatuses = [...new Set(withCommission.map((t) => t.commission!.status))];

  return {
    ...head("sales", range, scope),
    definitions: [
      "Κλεισίματα = συναλλαγές σε κατάσταση «Ολοκληρώθηκε» με ημερομηνία ολοκλήρωσης μέσα στην περίοδο. Οι ακυρωμένες συναλλαγές και προμήθειες δεν μετράνε.",
      "Προμήθεια καθαρή = χωρίς ΦΠΑ· με ΦΠΑ = ό,τι τιμολογείται. Ποσοστά και κανόνες είναι αυτοί που είχαν ισχύ όταν υπολογίστηκε η κάθε προμήθεια.",
      "Εισπράχθηκε = καταγεγραμμένες πληρωμές. Εκκρεμεί = με ΦΠΑ μείον εισπραχθέντα.",
      "Η εικόνα «ανά κατάσταση» δείχνει όλες τις συναλλαγές σήμερα, ανεξάρτητα από την περίοδο.",
    ],
    summary: [
      { key: "deals", label: "Κλεισίματα", value: closed.length },
      { key: "agreed", label: "Συμφωνημένα ποσά", value: sumMoney(closed.map((t) => t.agreedAmount)), unit: "€" },
      { key: "net", label: "Προμήθεια (καθαρή)", value: sumMoney(withCommission.map((t) => t.commission!.net)), unit: "€" },
      { key: "gross", label: "Προμήθεια (με ΦΠΑ)", value: gross, unit: "€" },
      { key: "agency", label: "Μερίδιο γραφείου", value: sumMoney(withCommission.map((t) => t.commission!.agencyShare)), unit: "€" },
      { key: "agent", label: "Μερίδια συνεργατών", value: sumMoney(withCommission.map((t) => t.commission!.agentShare)), unit: "€" },
      { key: "paid", label: "Εισπράχθηκε", value: paid, unit: "€" },
      { key: "outstanding", label: "Εκκρεμεί", value: Math.round((gross - paid) * 100) / 100, unit: "€" },
    ],
    tables: [
      { key: "status", title: "Συναλλαγές ανά κατάσταση (σήμερα)", columns: [{ key: "status", label: "Κατάσταση" }, { key: "count", label: "Συναλλαγές", numeric: true }, { key: "agreed", label: "Συμφωνημένα ποσά (€)", numeric: true }], rows: statuses.map((s) => { const of = all.filter((t) => t.status === s); return { status: TRANSACTION_STATUS_LABELS[s as keyof typeof TRANSACTION_STATUS_LABELS] ?? s, count: of.length, agreed: sumMoney(of.map((t) => t.agreedAmount)) }; }) },
      { key: "agent", title: "Κλεισίματα ανά συνεργάτη", columns: [{ key: "agent", label: "Συνεργάτης" }, { key: "deals", label: "Κλεισίματα", numeric: true }, { key: "agreed", label: "Συμφωνημένα ποσά (€)", numeric: true }, { key: "net", label: "Προμήθεια καθαρή (€)", numeric: true }, { key: "agentShare", label: "Μερίδιο συνεργάτη (€)", numeric: true }, { key: "agencyShare", label: "Μερίδιο γραφείου (€)", numeric: true }], rows: agentIds.map((id) => { const of = closed.filter((t) => (t.agentId ?? "—") === id); const c = of.filter((t) => t.commission && t.commission.status !== "CANCELLED").map((t) => t.commission!); return { agent: id === "—" ? "Χωρίς συνεργάτη" : (names.get(id) ?? "—"), deals: of.length, agreed: sumMoney(of.map((t) => t.agreedAmount)), net: sumMoney(c.map((x) => x.net)), agentShare: sumMoney(c.map((x) => x.agentShare)), agencyShare: sumMoney(c.map((x) => x.agencyShare)) }; }).sort((a, b) => b.deals - a.deals) },
      { key: "commission", title: "Προμήθειες κλεισιμάτων ανά κατάσταση", columns: [{ key: "status", label: "Κατάσταση" }, { key: "count", label: "Προμήθειες", numeric: true }, { key: "gross", label: "Με ΦΠΑ (€)", numeric: true }, { key: "paid", label: "Εισπράχθηκε (€)", numeric: true }], rows: commissionStatuses.map((s) => { const of = withCommission.filter((t) => t.commission!.status === s); return { status: COMMISSION_STATUS_LABELS[s] ?? s, count: of.length, gross: sumMoney(of.map((t) => t.commission!.gross)), paid: sumMoney(of.map((t) => t.commission!.paidAmount)) }; }) },
    ],
    truncated: closed.length >= ROW_LIMIT || all.length >= ROW_LIMIT,
  };
}

// ---------------------------------------------------------------------------
// Sellers and mandates
// ---------------------------------------------------------------------------

async function sellersReport(range: DateRange, scope: Scope, now: Date): Promise<ReportResult> {
  const sellers = await db().sellerLead.findMany({
    where: { createdAt: between(range), ...(scope.all ? {} : { agentId: scope.userId }) },
    select: { stage: true, createdAt: true, listedAt: true, lostReason: true, _count: { select: { valuations: true } }, mandates: { select: { status: true } } },
    take: ROW_LIMIT,
  });
  const total = sellers.length;
  const valued = sellers.filter((s) => s._count.valuations > 0).length;
  const mandated = sellers.filter((s) => s.mandates.some((m) => m.status === "SIGNED")).length;
  const listed = sellers.filter((s) => s.listedAt || s.stage === "LISTED").length;
  const toListing = sellers.filter((s) => s.listedAt).map((s) => days(s.createdAt, s.listedAt!)).filter((d) => d >= 0);

  const mandateWhere = { status: "SIGNED", endsAt: { not: null }, ...(scope.all ? {} : { agentId: scope.userId }) };
  const signed = await db().mandate.findMany({ where: mandateWhere, select: { reference: true, type: true, endsAt: true }, orderBy: { endsAt: "asc" }, take: ROW_LIMIT });
  const left = (m: { endsAt: Date | null }) => Math.ceil((m.endsAt!.getTime() - now.getTime()) / DAY);
  const inForce = signed.filter((m) => left(m) >= 0);
  const expiring = (n: number) => inForce.filter((m) => left(m) <= n).length;

  const byStage = count(sellers, (s) => s.stage);
  const reasons = count(sellers.filter((s) => s.stage === "LOST" && s.lostReason), (s) => s.lostReason!);

  return {
    ...head("sellers", range, scope),
    definitions: [
      "Αφορά τους ιδιοκτήτες που καταχωρίστηκαν μέσα στην περίοδο. Το στάδιο είναι το σημερινό.",
      "Το «χωνί» μετράει πόσοι από αυτούς έχουν εκτίμηση, πόσοι υπογεγραμμένη εντολή και πόσοι έχουν καταχωριστεί ως ακίνητο.",
      "Οι εντολές που λήγουν μετράνε υπογεγραμμένες εντολές με ημερομηνία λήξης, σήμερα και στο μέλλον, ανεξάρτητα από την περίοδο.",
    ],
    summary: [
      { key: "total", label: "Ιδιοκτήτες", value: total },
      { key: "valued", label: "Με εκτίμηση", value: ratePct(valued, total), unit: "%" },
      { key: "mandated", label: "Με υπογεγραμμένη εντολή", value: ratePct(mandated, total), unit: "%" },
      { key: "listed", label: "Καταχωρίστηκαν", value: ratePct(listed, total), unit: "%" },
      { key: "toListing", label: "Διάμεσος χρόνος μέχρι την καταχώριση", value: median(toListing), unit: "ημ." },
      { key: "exp30", label: "Εντολές που λήγουν σε 30 ημέρες", value: expiring(30) },
      { key: "exp90", label: "Εντολές που λήγουν σε 90 ημέρες", value: expiring(90) },
    ],
    tables: [
      { key: "stage", title: "Ανά στάδιο", columns: [{ key: "stage", label: "Στάδιο" }, { key: "sellers", label: "Ιδιοκτήτες", numeric: true }], rows: SELLER_STAGES.map((s) => ({ stage: SELLER_STAGE_LABELS[s] ?? s, sellers: byStage.get(s) ?? 0 })) },
      { key: "funnel", title: "Από το ενδιαφέρον στην καταχώριση", columns: [{ key: "step", label: "Βήμα" }, { key: "sellers", label: "Ιδιοκτήτες", numeric: true }, { key: "share", label: "% του συνόλου", numeric: true }], rows: [["Καταχωρίστηκαν", total], ["Με εκτίμηση", valued], ["Με υπογεγραμμένη εντολή", mandated], ["Καταχωρίστηκαν ως ακίνητο", listed]].map(([step, n]) => ({ step: step as string, sellers: n as number, share: ratePct(n as number, total) })) },
      { key: "lost", title: "Λόγοι απώλειας", columns: [{ key: "reason", label: "Λόγος" }, { key: "sellers", label: "Ιδιοκτήτες", numeric: true }], rows: [...reasons.entries()].map(([reason, n]) => ({ reason, sellers: n })).sort((a, b) => b.sellers - a.sellers).slice(0, 10) },
      { key: "mandates", title: "Υπογεγραμμένες εντολές σε ισχύ — πρώτες 25 που λήγουν", columns: [{ key: "reference", label: "Εντολή" }, { key: "type", label: "Τύπος" }, { key: "endsAt", label: "Λήξη" }, { key: "left", label: "Ημέρες που απομένουν", numeric: true }], rows: inForce.slice(0, 25).map((m) => ({ reference: m.reference, type: m.type, endsAt: m.endsAt!.toISOString().slice(0, 10), left: left(m) })) },
    ],
    truncated: sellers.length >= ROW_LIMIT,
  };
}

// ---------------------------------------------------------------------------
// Communications (managers only; enforced by the route)
// ---------------------------------------------------------------------------

async function communicationsReport(range: DateRange, scope: Scope): Promise<ReportResult> {
  const created = between(range);
  const [messages, mail, smsOptOuts, suppressions] = await Promise.all([
    db().message.findMany({ where: { createdAt: created }, select: { channel: true, purpose: true, status: true, error: true, sentById: true }, take: ROW_LIMIT }),
    db().emailLog.findMany({ where: { createdAt: created }, select: { category: true, sentAt: true }, take: ROW_LIMIT }),
    db().contact.count({ where: { smsOptOutAt: created } }),
    db().emailSuppression.count({ where: { createdAt: created } }),
  ]);
  const names = await agentNames(messages.map((m) => m.sentById));
  const senders = [...new Set(messages.map((m) => m.sentById ?? "—"))];
  const statuses = ["SENT", "LOGGED", "FAILED", "BLOCKED"];
  const blocked = count(messages.filter((m) => m.status === "BLOCKED" && m.error), (m) => m.error!);

  return {
    ...head("communications", range, scope),
    definitions: [
      "Μηνύματα προς πελάτες που στάλθηκαν από το CRM μέσα στην περίοδο. Το περιεχόμενό τους δεν εμφανίζεται εδώ.",
      "«Καταγράφηκε» = δεν υπήρχε πάροχος και το μήνυμα δεν παραδόθηκε· «Δεν επιτρέπεται» = το σύστημα αρνήθηκε την αποστολή (π.χ. χωρίς συγκατάθεση).",
      "Τα email του συστήματος (ειδοποιήσεις, προσκλήσεις) μετρώνται χωριστά από τα μηνύματα προς πελάτες.",
    ],
    summary: [
      { key: "messages", label: "Μηνύματα προς πελάτες", value: messages.length },
      { key: "sent", label: "Στάλθηκαν", value: messages.filter((m) => m.status === "SENT").length },
      { key: "failed", label: "Απέτυχαν", value: messages.filter((m) => m.status === "FAILED").length },
      { key: "blocked", label: "Δεν επιτράπηκαν", value: messages.filter((m) => m.status === "BLOCKED").length },
      { key: "smsOptOuts", label: "Νέες απεγγραφές SMS", value: smsOptOuts },
      { key: "suppressions", label: "Νέες διευθύνσεις στη λίστα διαγραφών", value: suppressions },
    ],
    tables: [
      { key: "channel", title: "Ανά κανάλι και αποτέλεσμα", columns: [{ key: "channel", label: "Κανάλι" }, { key: "purpose", label: "Είδος" }, ...statuses.map((s) => ({ key: s, label: MESSAGE_STATUS_LABELS[s] ?? s, numeric: true }))], rows: ["EMAIL", "SMS"].flatMap((ch) => ["SERVICE", "MARKETING"].map((p) => { const of = messages.filter((m) => m.channel === ch && m.purpose === p); return { channel: ch === "EMAIL" ? "Email" : "SMS", purpose: p === "SERVICE" ? "Εξυπηρέτηση" : "Προώθηση", ...Object.fromEntries(statuses.map((s) => [s, of.filter((m) => m.status === s).length])) }; })) },
      { key: "sender", title: "Ανά αποστολέα", columns: [{ key: "sender", label: "Συνεργάτης" }, { key: "messages", label: "Μηνύματα", numeric: true }], rows: senders.map((id) => ({ sender: id === "—" ? "Σύστημα" : (names.get(id) ?? "—"), messages: messages.filter((m) => (m.sentById ?? "—") === id).length })).sort((a, b) => b.messages - a.messages) },
      { key: "blocked", title: "Γιατί δεν επιτράπηκαν", columns: [{ key: "reason", label: "Λόγος" }, { key: "messages", label: "Μηνύματα", numeric: true }], rows: [...blocked.entries()].map(([reason, n]) => ({ reason, messages: n })).sort((a, b) => b.messages - a.messages).slice(0, 10) },
      { key: "system", title: "Email συστήματος", columns: [{ key: "category", label: "Κατηγορία" }, { key: "logged", label: "Καταγράφηκαν", numeric: true }, { key: "delivered", label: "Παραδόθηκαν στον πάροχο", numeric: true }], rows: ["TRANSACTIONAL", "MARKETING"].map((c) => { const of = mail.filter((m) => m.category === c); return { category: c === "TRANSACTIONAL" ? "Λειτουργικά" : "Προώθηση", logged: of.length, delivered: of.filter((m) => m.sentAt).length }; }) },
    ],
    truncated: messages.length >= ROW_LIMIT || mail.length >= ROW_LIMIT,
  };
}

// ---------------------------------------------------------------------------

export async function buildReport(kind: ReportKind, range: DateRange, scope: Scope, now: Date = new Date()): Promise<ReportResult> {
  switch (kind) {
    case "leads":
      return leadsReport(range, scope, now);
    case "inventory":
      return inventoryReport(range, scope, now);
    case "sales":
      return salesReport(range, scope);
    case "sellers":
      return sellersReport(range, scope, now);
    case "communications":
      return communicationsReport(range, scope);
  }
}

const dayFormat = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens", day: "numeric", month: "long", year: "numeric" });

/** The text AI summaries and page headers use for a period. */
export function periodLabel(period: { from: string; to: string }): string {
  const from = new Date(period.from);
  const last = new Date(new Date(period.to).getTime() - 1);
  return `${dayFormat.format(from)} – ${dayFormat.format(last)}`;
}

/** Aggregate numbers only: what an AI summary may be built from. */
export function reportDigest(report: ReportResult): ReportDigest {
  return {
    title: report.title,
    period: periodLabel(report.period),
    scope: report.scope === "all" ? "όλο το γραφείο" : "μόνο τα δικά μου",
    metrics: report.summary.map((m) => ({ label: m.label, value: m.value === null ? null : `${m.value}${m.unit ? ` ${m.unit}` : ""}` })),
  };
}
