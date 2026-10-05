/**
 * The automation engine.
 *
 * Each rule looks for something the office has stopped noticing and creates a
 * CRM task for the person responsible. Rules are off until Settings gives them
 * a number of days; nothing here ever contacts a client. A firing is recorded
 * in `automation_runs` in the same transaction as its task, and
 * (rule, record, episode) is unique, so two overlapping runs, or a run every
 * night, never create the same task twice.
 *
 * Tasks and notifications name records by reference only (LD-000123), never a
 * person.
 */

import { Prisma } from "@home88/database";
import {
  AUTOMATION_RULES,
  automationTaskTitle,
  scoreMatch,
  episodeKey,
  ruleDays,
  type AutomationRule,
  type AutomationRuleKey,
} from "@home88/domain";
import { randomUUID } from "node:crypto";

import { PROPERTY_MATCH_SELECT, toMatchProperty, toMatchRequest } from "./matching";
import { notify } from "./notify";
import { db } from "./prisma";
import { requestConfig, settings } from "../settings";

const DAY = 24 * 3_600_000;
const BATCH = 200;
const MAX_PAGES = 10;
const OPEN_LEAD = ["NEW", "CONTACTED", "QUALIFIED", "VIEWING", "OFFER"] as const;

export type RuleOutcome = { rule: AutomationRuleKey | "MATCH_NEW"; enabled: boolean; found: number; created: number };
export type AutomationOutcome = { rules: RuleOutcome[]; created: number };

type Candidate = {
  entityType: string;
  entityId: string;
  episode: string;
  reference: string;
  /** The user responsible; null → managers are told instead. */
  userId: string | null;
  description: string;
  priority?: "NORMAL" | "HIGH";
  links?: { leadId?: string; propertyId?: string; viewingId?: string };
  title?: string;
};

/** Create the task and its run record together. false = this episode was already handled. */
async function fire(rule: string, taskTitle: string, c: Candidate, now: Date): Promise<boolean> {
  const taskId = randomUUID();
  try {
    await db().$transaction(async (tx) => {
      await tx.automationRun.create({
        data: { rule, entityType: c.entityType, entityId: c.entityId, episode: c.episode, taskId, assignedToId: c.userId },
      });
      await tx.task.create({
        data: {
          id: taskId,
          title: c.title ?? taskTitle,
          description: c.description,
          priority: c.priority ?? "NORMAL",
          dueAt: now,
          assignedToId: c.userId,
          // Unassigned tasks are announced to the managers right away; assigned ones by the reminder run that follows.
          dueNotifiedAt: c.userId ? null : now,
          ...c.links,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
  if (!c.userId) {
    await notify({ event: "TASK_DUE", title: `Εργασία χωρίς υπεύθυνο: ${c.title ?? taskTitle}`, entityType: "TASK", entityId: taskId, userIds: [], link: "/reminders" });
  }
  return true;
}

/** One page of candidates, oldest first. A full page means there may be more. */
type Page = { items: Candidate[]; full: boolean };
type Finder = (days: number, now: Date, skip: number) => Promise<Page>;
const page = (rows: unknown[], items: Candidate[]): Page => ({ items, full: rows.length >= BATCH });

const FINDERS: Record<Exclude<AutomationRuleKey, never>, Finder> = {
  async LEAD_STALE(d, now, skip) {
    const cutoff = new Date(now.getTime() - d * DAY);
    const leads = await db().lead.findMany({
      where: { status: { in: [...OPEN_LEAD] }, OR: [{ lastContactedAt: { lte: cutoff } }, { lastContactedAt: null, createdAt: { lte: cutoff } }] },
      select: { id: true, reference: true, assignedToId: true, lastContactedAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      skip,
      take: BATCH,
    });
    return page(leads, leads.map((l) => ({
      entityType: "LEAD",
      entityId: l.id,
      episode: episodeKey([l.lastContactedAt ?? l.createdAt]),
      reference: l.reference,
      userId: l.assignedToId,
      description: l.lastContactedAt ? `Δεν έχει καταγραφεί επικοινωνία από τις ${l.lastContactedAt.toISOString().slice(0, 10)}.` : "Δεν έχει καταγραφεί καμία επικοινωνία από τη δημιουργία του lead.",
      links: { leadId: l.id },
    })));
  },

  async VIEWING_FOLLOWUP(d, now, skip) {
    const cutoff = new Date(now.getTime() - d * DAY);
    const viewings = await db().viewing.findMany({
      where: { status: "COMPLETED", startsAt: { lte: cutoff, gte: new Date(now.getTime() - 60 * DAY) }, lead: { is: { status: { in: [...OPEN_LEAD] } } } },
      select: { id: true, startsAt: true, agentId: true, lead: { select: { id: true, reference: true, lastContactedAt: true } } },
      orderBy: { startsAt: "asc" },
      skip,
      take: BATCH,
    });
    return page(viewings, viewings
      .filter((v) => v.lead && (!v.lead.lastContactedAt || v.lead.lastContactedAt <= v.startsAt))
      .map((v) => ({
        entityType: "VIEWING",
        entityId: v.id,
        episode: episodeKey([v.id]),
        reference: v.lead!.reference,
        userId: v.agentId,
        description: `Η υπόδειξη ολοκληρώθηκε στις ${v.startsAt.toISOString().slice(0, 10)} και το lead δεν έχει καταγραφεί επικοινωνία μετά από αυτή.`,
        links: { leadId: v.lead!.id, viewingId: v.id },
      })));
  },

  async LISTING_STALE(d, now, skip) {
    const cutoff = new Date(now.getTime() - d * DAY);
    const props = await db().property.findMany({
      where: { status: { in: ["ACTIVE", "UNDER_OFFER", "RESERVED"] }, updatedAt: { lte: cutoff } },
      select: { id: true, reference: true, agentId: true, updatedAt: true },
      orderBy: { updatedAt: "asc" },
      skip,
      take: BATCH,
    });
    return page(props, props.map((p) => ({
      entityType: "PROPERTY",
      entityId: p.id,
      episode: episodeKey([p.updatedAt]),
      reference: p.reference,
      userId: p.agentId,
      description: `Η καταχώριση δεν έχει αλλάξει από τις ${p.updatedAt.toISOString().slice(0, 10)}. Ελέγξτε τιμή, φωτογραφίες και διαθεσιμότητα.`,
      links: { propertyId: p.id },
    })));
  },

  async MANDATE_EXPIRING(d, now, skip) {
    const mandates = await db().mandate.findMany({
      where: { status: "SIGNED", endsAt: { gte: now, lte: new Date(now.getTime() + d * DAY) } },
      select: { id: true, reference: true, number: true, agentId: true, endsAt: true, propertyId: true },
      orderBy: { endsAt: "asc" },
      skip,
      take: BATCH,
    });
    return page(mandates, mandates.map((m) => ({
      entityType: "MANDATE",
      entityId: m.id,
      episode: episodeKey([m.endsAt]),
      reference: m.number ?? m.reference,
      userId: m.agentId,
      description: `Η εντολή λήγει στις ${m.endsAt!.toISOString().slice(0, 10)}. Ανανέωση ή ενημέρωση του ιδιοκτήτη.`,
      priority: "HIGH" as const,
      links: m.propertyId ? { propertyId: m.propertyId } : undefined,
    })));
  },

  async OFFER_EXPIRING(d, now, skip) {
    const offers = await db().offer.findMany({
      where: { status: { in: ["SUBMITTED", "COUNTERED"] }, expiresAt: { gte: now, lte: new Date(now.getTime() + d * DAY) } },
      select: { id: true, reference: true, agentId: true, expiresAt: true, propertyId: true },
      orderBy: { expiresAt: "asc" },
      skip,
      take: BATCH,
    });
    return page(offers, offers.map((o) => ({
      entityType: "OFFER",
      entityId: o.id,
      episode: episodeKey([o.expiresAt]),
      reference: o.reference,
      userId: o.agentId,
      description: `Η προσφορά λήγει στις ${o.expiresAt!.toISOString().slice(0, 10)} και περιμένει απάντηση.`,
      priority: "HIGH" as const,
      links: { propertyId: o.propertyId },
    })));
  },

  async SELLER_FOLLOWUP(d, now, skip) {
    const cutoff = new Date(now.getTime() - d * DAY);
    const sellers = await db().sellerLead.findMany({
      where: { stage: { notIn: ["LISTED", "LOST"] }, nextFollowUpAt: { lte: cutoff } },
      select: { id: true, reference: true, agentId: true, nextFollowUpAt: true },
      orderBy: { nextFollowUpAt: "asc" },
      skip,
      take: BATCH,
    });
    return page(sellers, sellers.map((s) => ({
      entityType: "SELLER_LEAD",
      entityId: s.id,
      episode: episodeKey([s.nextFollowUpAt]),
      reference: s.reference,
      userId: s.agentId,
      description: `Η προγραμματισμένη επικοινωνία με τον ιδιοκτήτη ήταν για τις ${s.nextFollowUpAt!.toISOString().slice(0, 10)}.`,
    })));
  },
};

/** Days for each rule, from the settings section it lives in. */
async function thresholds(): Promise<Map<string, number | null>> {
  const [automation, properties] = await Promise.all([settings().config("automation"), settings().config("properties")]);
  const bySection: Record<string, Record<string, unknown>> = { automation, properties };
  return new Map(AUTOMATION_RULES.map((r) => [r.key, ruleDays(bySection[r.section] ?? {}, r as AutomationRule)]));
}

/**
 * New public properties that suit open requests become a task for the
 * request's agent, when Settings → Ζητήσεις asks for it. The client is never
 * contacted: the agent reviews the matches and sends them from the contact.
 */
async function matchAlerts(now: Date): Promise<RuleOutcome> {
  const outcome: RuleOutcome = { rule: "MATCH_NEW", enabled: false, found: 0, created: 0 };
  const mode = (await settings().config("requests")).newMatchAlerts;
  if (mode !== "APPROVAL") return outcome;
  outcome.enabled = true;

  const rules = await requestConfig();
  const recent = await db().propertyStatusHistory.findMany({
    where: { toStatus: "ACTIVE", createdAt: { gte: new Date(now.getTime() - 2 * DAY) } },
    select: { id: true, propertyId: true },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  for (const h of recent) {
    if (await db().automationRun.findFirst({ where: { rule: "MATCH_NEW", entityId: h.propertyId, episode: { startsWith: `${h.id}|` } }, select: { id: true } })) continue;
    const property = await db().property.findUnique({ where: { id: h.propertyId }, select: PROPERTY_MATCH_SELECT });
    if (!property || property.status !== "ACTIVE") continue;
    const target = toMatchProperty(property);
    const requests = await db().buyerRequest.findMany({
      where: { status: "ACTIVE", listingType: property.listingType, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      take: 1000,
    });
    const byAgent = new Map<string, string[]>();
    for (const r of requests) {
      const result = scoreMatch(toMatchRequest(r), target, rules);
      if (!result || result.score < rules.minMatchScore) continue;
      const key = r.assignedToId ?? r.createdById ?? "";
      byAgent.set(key, [...(byAgent.get(key) ?? []), r.reference]);
    }
    for (const [agent, refs] of byAgent) {
      outcome.found += 1;
      const userId = agent || null;
      const title = `Αντιστοιχίσεις νέου ακινήτου · ${property.reference}`;
      const made = await fire(
        "MATCH_NEW",
        title,
        {
          entityType: "PROPERTY",
          entityId: property.id,
          episode: `${h.id}|${agent || "-"}`,
          reference: property.reference,
          userId,
          description: `Το νέο ακίνητο ταιριάζει σε ${refs.length} ενεργές ζητήσεις: ${refs.slice(0, 10).join(", ")}${refs.length > 10 ? "…" : ""}. Δείτε τις αντιστοιχίσεις και στείλτε τις στον πελάτη από την επαφή του.`,
          links: { propertyId: property.id },
        },
        now,
      );
      if (made) {
        outcome.created += 1;
        await notify({ event: "MATCH_NEW", title: `Νέο ακίνητο ${property.reference} ταιριάζει σε ${refs.length} ζητήσεις`, entityType: "PROPERTY", entityId: property.id, userIds: userId ? [userId] : [], link: `/properties/${property.id}` });
      }
    }
  }
  return outcome;
}

export async function runAutomations(now: Date = new Date()): Promise<AutomationOutcome> {
  const days = await thresholds();
  const rules: RuleOutcome[] = [];
  for (const rule of AUTOMATION_RULES) {
    const d = days.get(rule.key) ?? null;
    if (d === null) {
      rules.push({ rule: rule.key, enabled: false, found: 0, created: 0 });
      continue;
    }
    // Page through the candidates: records already handled stay in the query (their condition still holds), so
    // looking only at the first page would let old, handled records hide new ones.
    let found = 0;
    let created = 0;
    for (let pageNo = 0; pageNo < MAX_PAGES; pageNo += 1) {
      const { items: candidates, full } = await FINDERS[rule.key](d, now, pageNo * BATCH);
      if (candidates.length === 0 && !full) break;
      const done = await db().automationRun.findMany({
        where: { rule: rule.key, entityId: { in: candidates.map((c) => c.entityId) } },
        select: { entityId: true, episode: true },
      });
      const handled = new Set(done.map((r) => `${r.entityId}|${r.episode}`));
      for (const c of candidates) {
        if (handled.has(`${c.entityId}|${c.episode}`)) continue;
        found += 1;
        if (await fire(rule.key, automationTaskTitle(rule as AutomationRule, c.reference), c, now)) created += 1;
      }
      if (!full) break;
    }
    rules.push({ rule: rule.key, enabled: true, found, created });
  }
  rules.push(await matchAlerts(now));
  return { rules, created: rules.reduce((n, r) => n + r.created, 0) };
}
