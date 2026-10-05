/**
 * Automations: which rules are on, what they have done, and a manual run.
 *
 * Rules are configured in Settings (Αυτοματισμοί, and Ακίνητα for stale
 * listings). The scheduler runs them with the reminder job; an administrator
 * can run them now.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AUTOMATION_RULES, ruleDays, type AutomationRule } from "@home88/domain";

import { runAutomations } from "../lib/automation";
import { tooManyRequests } from "../lib/errors";
import { parseInput } from "../lib/http";
import { db } from "../lib/prisma";
import { consume } from "../lib/rate-limit";
import { requireAuth, requireRole } from "../plugins/auth";
import { settings } from "../settings";

const DAY = 24 * 3_600_000;
const RULE_LABELS: Record<string, string> = { ...Object.fromEntries(AUTOMATION_RULES.map((r) => [r.key, r.label])), MATCH_NEW: "Νέο ακίνητο που ταιριάζει σε ζητήσεις" };

export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/automation", { preHandler: requireRole("MANAGER") }, async () => {
    const [automation, properties, requests] = await Promise.all([settings().config("automation"), settings().config("properties"), settings().config("requests")]);
    const bySection: Record<string, Record<string, unknown>> = { automation, properties };
    const since = new Date(Date.now() - 30 * DAY);
    const counts = await db().automationRun.groupBy({ by: ["rule"], where: { createdAt: { gte: since } }, _count: { _all: true }, _max: { createdAt: true } });
    const stat = new Map(counts.map((c) => [c.rule, c]));
    const rules = [
      ...AUTOMATION_RULES.map((r) => ({
        key: r.key,
        label: r.label,
        help: r.help,
        days: ruleDays(bySection[r.section] ?? {}, r as AutomationRule),
        settingsHref: r.section === "properties" ? "/settings/properties" : "/settings/automation",
        last30Days: stat.get(r.key)?._count._all ?? 0,
        lastRunAt: stat.get(r.key)?._max.createdAt?.toISOString() ?? null,
      })),
      {
        key: "MATCH_NEW",
        label: RULE_LABELS.MATCH_NEW!,
        help: "Όταν ένα ακίνητο γίνεται ενεργό και ταιριάζει σε ενεργές ζητήσεις, ο υπεύθυνος της ζήτησης παίρνει εργασία.",
        days: null,
        mode: requests.newMatchAlerts === "APPROVAL" ? "APPROVAL" : "MANUAL",
        settingsHref: "/settings/requests",
        last30Days: stat.get("MATCH_NEW")?._count._all ?? 0,
        lastRunAt: stat.get("MATCH_NEW")?._max.createdAt?.toISOString() ?? null,
      },
    ];
    return { rules };
  });

  app.get("/automation/runs", { preHandler: requireRole("MANAGER") }, async (request) => {
    const q = parseInput(z.object({ page: z.coerce.number().int().min(1).default(1), rule: z.string().max(40).optional() }), request.query);
    const where = q.rule ? { rule: q.rule } : {};
    const [total, runs] = await Promise.all([
      db().automationRun.count({ where }),
      db().automationRun.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * 25, take: 25 }),
    ]);
    const tasks = await db().task.findMany({
      where: { id: { in: runs.map((r) => r.taskId).filter((x): x is string => !!x) } },
      select: { id: true, title: true, status: true, assignedTo: { select: { firstName: true, lastName: true } } },
    });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return {
      data: runs.map((r) => {
        const t = r.taskId ? byId.get(r.taskId) : undefined;
        return {
          id: r.id,
          rule: r.rule,
          ruleLabel: RULE_LABELS[r.rule] ?? r.rule,
          entityType: r.entityType,
          entityId: r.entityId,
          createdAt: r.createdAt.toISOString(),
          task: t ? { id: t.id, title: t.title, status: t.status } : null,
          assignee: t?.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}`.trim() : null,
        };
      }),
      pagination: { page: q.page, pages: Math.max(1, Math.ceil(total / 25)), total },
    };
  });

  app.post("/automation/run", { preHandler: requireRole("ADMIN") }, async (request) => {
    const limit = consume(`automation-run:${request.auth!.user.id}`, { points: 5, durationSeconds: 60 });
    if (!limit.allowed) throw tooManyRequests("Πολλές εκτελέσεις. Δοκιμάστε ξανά σε λίγο.");
    return runAutomations();
  });
}
