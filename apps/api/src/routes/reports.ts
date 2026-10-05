/**
 * Reports (Στατιστικά).
 *
 * Agents see reports over their own records; managers and above choose their
 * own or the whole agency, and are the only ones who see commissions and
 * message volumes. Every table can be downloaded as CSV; a download is
 * recorded in the audit trail (who, which report, which period, how many
 * rows, never the contents).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { REPORT_KINDS, REPORT_LABELS, isReportKind, resolveRange, toCsv } from "@home88/domain";

import { writeAudit } from "../lib/audit";
import { forbidden, notFound, tooManyRequests } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { consume } from "../lib/rate-limit";
import { buildReport } from "../lib/reports";
import { requireAuth, requireRole, roleAtLeast } from "../plugins/auth";

const querySchema = z.object({
  range: z.string().max(20).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  scope: z.enum(["mine", "all"]).optional(),
  format: z.enum(["json", "csv"]).optional(),
  table: z.string().max(40).optional(),
});

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/reports", { preHandler: requireRole("AGENT") }, async (request) => {
    const role = request.auth!.user.role;
    return {
      data: REPORT_KINDS.filter((k) => roleAtLeast(role, REPORT_LABELS[k].minRole)).map((k) => ({
        kind: k,
        title: REPORT_LABELS[k].title,
        description: REPORT_LABELS[k].description,
      })),
    };
  });

  app.get("/reports/:kind", { preHandler: requireRole("AGENT") }, async (request, reply) => {
    const actor = request.auth!.user;
    const { kind } = request.params as { kind: string };
    if (!isReportKind(kind)) throw notFound("Η αναφορά δεν βρέθηκε.");
    if (!roleAtLeast(actor.role, REPORT_LABELS[kind].minRole)) throw forbidden("Η αναφορά είναι διαθέσιμη μόνο σε υπευθύνους.");
    const limit = consume(`report:${actor.id}`, { points: 60, durationSeconds: 60 });
    if (!limit.allowed) throw tooManyRequests("Πολλά αιτήματα αναφορών. Δοκιμάστε ξανά σε λίγο.");

    const q = parseInput(querySchema, request.query);
    const manager = roleAtLeast(actor.role, "MANAGER");
    const all = manager && (q.scope ?? "all") === "all";
    const now = new Date();
    const range = resolveRange({ key: q.range ?? "month", from: q.from, to: q.to }, now);
    const report = await buildReport(kind, range, { all, userId: actor.id }, now);

    if (q.format !== "csv") return report;

    const table = report.tables.find((t) => t.key === (q.table ?? report.tables[0]?.key));
    if (!table) throw notFound("Ο πίνακας δεν βρέθηκε.");
    await writeAudit({
      entity: "REPORT",
      entityId: kind,
      action: "export",
      changes: { table: table.key, range: range.key, from: range.from.toISOString(), to: range.to.toISOString(), scope: report.scope, rows: table.rows.length },
      actorId: actor.id,
      ipAddress: clientIp(request),
      userAgent: userAgent(request),
    });
    const csv = toCsv(
      table.columns.map((c) => ({ header: c.label, value: (row: Record<string, string | number | null>) => row[c.key] })),
      table.rows,
    );
    const day = now.toISOString().slice(0, 10);
    reply.header("cache-control", "no-store");
    reply.header("content-disposition", `attachment; filename="home88-${kind}-${table.key}-${day}.csv"`);
    reply.type("text/csv; charset=utf-8");
    return csv;
  });
}
