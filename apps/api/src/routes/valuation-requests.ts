/**
 * Website valuation requests (automated indications) in the CRM.
 *
 *  - The automated result and its comparable snapshot are read-only here (the
 *    database refuses changes). Agents move the request through its workflow
 *    and, to give their own view, open an agent valuation from it: the agent's
 *    recommended price and reasoning live there, next to — never over — the
 *    automated result.
 *  - Managers see every request; others see the ones assigned to them and the
 *    unassigned queue.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";

import { writeAudit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { db } from "../lib/prisma";
import { allocateReference } from "../lib/references";
import { requireRole, roleAtLeast } from "../plugins/auth";
import { refresh } from "./valuations";

type Actor = { id: string; role: string; firstName: string; lastName: string; email: string };

export const VALUATION_REQUEST_STAGES = ["NEW", "REVIEWING", "CONTACTED", "INSPECTION_REQUIRED", "COMPLETED", "CONVERTED", "CLOSED"] as const;

const listSchema = z.object({
  stage: z.enum(VALUATION_REQUEST_STAGES).optional(),
  status: z.enum(["COMPLETED", "INSUFFICIENT_DATA"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const patchSchema = z
  .object({
    stage: z.enum(VALUATION_REQUEST_STAGES).optional(),
    assignedAgentId: z.string().max(40).nullable().optional(),
  })
  .strict();

const PAGE = 25;
const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));

function visibleTo(actor: Actor): Prisma.ValuationRequestWhereInput {
  if (roleAtLeast(actor.role, "MANAGER")) return {};
  return { OR: [{ assignedAgentId: actor.id }, { assignedAgentId: null }] };
}

function meta(request: FastifyRequest) {
  return { ipAddress: clientIp(request), userAgent: userAgent(request) };
}

async function loadVisible(actor: Actor, id: string) {
  const row = await db().valuationRequest.findFirst({ where: { AND: [{ id }, visibleTo(actor)] } });
  if (!row) throw notFound("Το αίτημα εκτίμησης δεν βρέθηκε.");
  return row;
}

export async function valuationRequestRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };

  app.get("/valuation-requests", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const q = parseInput(listSchema, request.query);
    const where: Prisma.ValuationRequestWhereInput = {
      AND: [visibleTo(actor), q.stage ? { stage: q.stage } : {}, q.status ? { status: q.status } : {}],
    };
    const [rows, total] = await Promise.all([
      db().valuationRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * PAGE,
        take: PAGE,
        include: {
          contact: { select: { firstName: true, lastName: true } },
          lead: { select: { reference: true } },
          assignedAgent: { select: { firstName: true, lastName: true } },
        },
      }),
      db().valuationRequest.count({ where }),
    ]);
    return {
      pagination: { page: q.page, pages: Math.max(1, Math.ceil(total / PAGE)), total },
      data: rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        status: r.status,
        stage: r.stage,
        propertyType: r.propertyType,
        city: r.city,
        areaName: r.areaName,
        areaSqm: n(r.areaSqm),
        estimatedMin: n(r.estimatedMin),
        estimatedValue: n(r.estimatedValue),
        estimatedMax: n(r.estimatedMax),
        confidence: r.confidence,
        comparableCount: r.comparableCount,
        client: r.contact ? `${r.contact.firstName} ${r.contact.lastName}`.trim() : null,
        lead: r.lead?.reference ?? null,
        agent: r.assignedAgent ? `${r.assignedAgent.firstName} ${r.assignedAgent.lastName}`.trim() : null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.get("/valuation-requests/:id", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    await loadVisible(actor, id);
    const r = await db().valuationRequest.findUniqueOrThrow({
      where: { id },
      include: {
        comparables: { orderBy: { rank: "asc" } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        lead: { select: { id: true, reference: true, status: true } },
        valuation: { select: { id: true, reference: true, status: true, recommendedPrice: true } },
        assignedAgent: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return {
      request: {
        id: r.id,
        reference: r.reference,
        status: r.status,
        stage: r.stage,
        channel: r.channel,
        listingType: r.listingType,
        subject: {
          propertyType: r.propertyType, region: r.region, city: r.city, areaName: r.areaName, areaSqm: n(r.areaSqm),
          bedrooms: r.bedrooms, bathrooms: r.bathrooms, floor: r.floor, yearBuilt: r.yearBuilt, condition: r.condition, features: r.features,
        },
        result: {
          estimatedMin: n(r.estimatedMin), estimatedValue: n(r.estimatedValue), estimatedMax: n(r.estimatedMax),
          pricePerSqm: n(r.pricePerSqm), pricePerSqmLow: n(r.pricePerSqmLow), pricePerSqmHigh: n(r.pricePerSqmHigh),
          confidence: r.confidence, comparableCount: r.comparableCount, strongComparableCount: r.strongComparableCount,
          transactionCount: r.transactionCount, askingCount: r.askingCount, scope: r.scope, explanation: r.explanation,
        },
        engineVersion: r.engineVersion,
        methodologyVersion: r.methodologyVersion,
        referenceDate: r.referenceDate.toISOString(),
        config: r.config,
        contact: r.contact ? { id: r.contact.id, name: `${r.contact.firstName} ${r.contact.lastName}`.trim() } : null,
        lead: r.lead,
        agentValuation: r.valuation ? { ...r.valuation, recommendedPrice: n(r.valuation.recommendedPrice) } : null,
        assignedAgent: r.assignedAgent ? { id: r.assignedAgent.id, name: `${r.assignedAgent.firstName} ${r.assignedAgent.lastName}`.trim() } : null,
        createdAt: r.createdAt.toISOString(),
        comparables: r.comparables.map((c) => ({
          id: c.id,
          rank: c.rank,
          source: c.source,
          observationType: c.observationType,
          tier: c.tier,
          propertyId: c.propertyId,
          price: n(c.price),
          areaSqm: n(c.areaSqm),
          pricePerSqm: n(c.pricePerSqm),
          similarity: n(c.similarity),
          recency: n(c.recency),
          weight: n(c.weight),
          ageMonths: n(c.ageMonths),
          breakdown: c.breakdown,
          outlier: c.outlier,
          snapshot: c.snapshot,
        })),
      },
    };
  });

  app.patch("/valuation-requests/:id", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const before = await loadVisible(actor, id);
    const input = parseInput(patchSchema, request.body);

    const data: Prisma.ValuationRequestUncheckedUpdateInput = {};
    if (input.stage) data.stage = input.stage;
    if (input.assignedAgentId !== undefined) {
      const self = input.assignedAgentId === actor.id;
      // Agents may take an unassigned request or release their own; reassigning others is a manager's call.
      if (!roleAtLeast(actor.role, "MANAGER") && !(self && before.assignedAgentId == null) && !(input.assignedAgentId === null && before.assignedAgentId === actor.id)) {
        throw forbidden("Μόνο υπεύθυνος μπορεί να αναθέσει το αίτημα σε άλλον.");
      }
      if (input.assignedAgentId) {
        const user = await db().user.findFirst({ where: { id: input.assignedAgentId, status: "ACTIVE" }, select: { id: true } });
        if (!user) throw badRequest("Ο χρήστης δεν βρέθηκε.");
      }
      data.assignedAgentId = input.assignedAgentId;
    }
    if (Object.keys(data).length === 0) return { ok: true };
    await db().valuationRequest.update({ where: { id }, data });
    await writeAudit({
      entity: "VALUATION",
      entityId: id,
      action: "request.update",
      changes: { from: { stage: before.stage, assignedAgentId: before.assignedAgentId }, to: input },
      actorId: actor.id,
      ...meta(request),
    });
    return { ok: true };
  });

  /**
   * Opens an agent valuation (Εκτίμηση) from the request: the subject and the
   * engine's comparables (at the frozen prices) are copied in, so the agent
   * starts from the same evidence and adds their own judgement there.
   */
  app.post("/valuation-requests/:id/agent-valuation", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    await loadVisible(actor, id);
    const r = await db().valuationRequest.findUniqueOrThrow({ where: { id }, include: { comparables: { where: { outlier: false }, orderBy: { rank: "asc" } } } });
    if (r.valuationId) throw conflict("Υπάρχει ήδη εκτίμηση συμβούλου για αυτό το αίτημα.");

    const created = await db().$transaction(async (tx) => {
      const reference = await allocateReference(tx, "valuation", "VAL");
      const v = await tx.valuation.create({
        data: {
          reference,
          listingType: r.listingType,
          propertyType: r.propertyType,
          city: r.city,
          areaName: r.areaName,
          area: r.areaSqm,
          bedrooms: r.bedrooms,
          floor: r.floor,
          yearBuilt: r.yearBuilt,
          condition: r.condition,
          agentId: actor.id,
          createdById: actor.id,
        },
      });
      if (r.comparables.length) {
        await tx.valuationComparable.createMany({
          data: r.comparables.map((c) => {
            const s = (c.snapshot ?? {}) as Record<string, unknown>;
            const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : null);
            const int = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : null);
            return {
              valuationId: v.id,
              kind: c.observationType === "TRANSACTION" ? (c.source === "HOME88" ? "SOLD" : "EXTERNAL") : c.source === "HOME88" ? "ASKING" : "EXTERNAL",
              propertyId: c.propertyId,
              label: str("reference") ?? `${c.source} ${str("sourceRecordId") ?? c.observationRef}`,
              source: c.source === "HOME88" ? null : c.source,
              city: str("city"),
              areaName: str("areaName"),
              price: c.price,
              area: c.areaSqm,
              bedrooms: int("bedrooms"),
              floor: int("floor"),
              yearBuilt: int("yearBuilt"),
              condition: str("condition"),
              observedAt: str("observedAt") ? new Date(str("observedAt")!) : null,
              similarity: Math.round(Number(c.similarity) * 100),
            };
          }),
        });
      }
      await refresh(tx, v.id);
      await tx.valuationRequest.update({
        where: { id: r.id },
        data: { valuationId: v.id, stage: r.stage === "NEW" ? "REVIEWING" : r.stage, assignedAgentId: r.assignedAgentId ?? actor.id },
      });
      return v;
    });
    await writeAudit({ entity: "VALUATION", entityId: created.id, action: "create", changes: { fromRequest: r.reference }, actorId: actor.id, ...meta(request) });
    return { valuation: { id: created.id, reference: created.reference } };
  });
}
