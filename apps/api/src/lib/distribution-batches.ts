/**
 * Bulk portal distribution: plan, queue, process, cancel, retry.
 *
 * A batch is a durable list of (property, portal) items. Nothing is sent when it
 * is created; items are claimed and run a few at a time by `processBatch`, each
 * through the very same `runPublicationOperation` the single-property buttons use,
 * so permissions, eligibility rules, the portal providers, sync runs and audit
 * entries are the existing ones. There is no second publishing path.
 *
 * Reliability:
 *  - items are claimed with a conditional update, so two workers (or two browser
 *    tabs) never run the same item, and a retry never repeats a succeeded one;
 *  - an item whose lock is stale (the worker died) is claimed again, up to a
 *    bounded number of attempts;
 *  - one item failing never stops the others: the batch reports per item;
 *  - the same idempotency key returns the same batch.
 *
 * Processing is driven by calls (the CRM polls while a batch is open); any
 * scheduler can call the same function later. Nothing here runs on its own.
 */

import type { ChannelRequest, ChannelView } from "@home88/domain";
import { guardConfigFromSettings, guardPublicationChange } from "@home88/portals";
import { Prisma } from "@prisma/client";

import { loadConfig } from "../config";
import { forbidden, notFound, badRequest } from "./errors";
import { mapLimit } from "./map-limit";
import { db } from "./prisma";
import { loadPortalChannels, runPublicationOperation, type Viewer } from "./publications";
import { settings } from "../settings";
import type { OperationContext } from "./website-publication";
import { writeAudit } from "./audit";

export const BATCH_OPERATIONS = ["publish", "update", "unpublish"] as const;
export type BatchOperation = (typeof BATCH_OPERATIONS)[number];

/** One batch is bounded so it stays reviewable and recoverable; larger groups are done in several batches. */
export const MAX_BATCH_PROPERTIES = 500;
export const MAX_BATCH_ITEMS = 2000;
const STALE_LOCK_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const CLAIM_PER_CALL = 4;

export type PortalSelection = { code: string; accountId: string; environment: "TEST" | "PRODUCTION" };

export type PlanItem = {
  propertyId: string;
  reference: string | null;
  portalCode: string;
  ready: boolean;
  blockers: string[];
  mock: boolean;
};

/** A bulk withdrawal large enough to look like a mistake: held until a person explicitly confirms it. */
export type MassRemovalGuard = { portalCode: string; live: number; removing: number; remaining: number; message: string; confirmed: boolean };

export type BatchPlan = {
  guards: MassRemovalGuard[];
  operation: BatchOperation;
  propertyCount: number;
  portals: string[];
  items: PlanItem[];
  summary: { ready: number; blocked: number };
  /** Blocker text → how many items share it, so a thousand identical problems read as one line. */
  blockerGroups: Array<{ message: string; count: number }>;
};

const PERMISSION: Record<BatchOperation, string> = { publish: "portals.publish", update: "portals.update", unpublish: "portals.unpublish" };

export async function assertMayBulk(viewer: Viewer, operation: BatchOperation): Promise<void> {
  const s = settings();
  if (!(await s.can(viewer.role, "portals.bulk_publish")) || !(await s.can(viewer.role, PERMISSION[operation]))) {
    throw forbidden("Δεν έχετε δικαίωμα μαζικής ενέργειας στα portals.");
  }
}

/** Plans without touching anything: every (property, portal) is judged with the viewer's own permissions. */
export async function planBatch(input: { operation: BatchOperation; propertyIds: string[]; portals: PortalSelection[]; viewer: Viewer; confirmMassRemoval?: boolean }): Promise<BatchPlan> {
  const { operation, viewer } = input;
  const ids = [...new Set(input.propertyIds)];
  if (ids.length === 0) throw badRequest("Δεν επιλέχθηκε κανένα ακίνητο.");
  if (ids.length > MAX_BATCH_PROPERTIES) throw badRequest(`Μία μαζική ενέργεια δέχεται έως ${MAX_BATCH_PROPERTIES} ακίνητα. Περιορίστε την επιλογή και επαναλάβετε.`);
  if (input.portals.length === 0) throw badRequest("Επιλέξτε τουλάχιστον ένα portal.");
  if (ids.length * input.portals.length > MAX_BATCH_ITEMS) throw badRequest(`Μία μαζική ενέργεια δέχεται έως ${MAX_BATCH_ITEMS} ενέργειες (ακίνητα × portals).`);
  const codes = input.portals.map((p) => p.code.toUpperCase());
  if (new Set(codes).size !== codes.length) throw badRequest("Κάθε portal μπορεί να επιλεγεί μία φορά.");
  await assertMayBulk(viewer, operation);
  // Portals fetch photos from the CRM's own origin on expiring links; without https the sends would fail one by one.
  const sendsMedia = operation !== "unpublish";
  const insecureOrigin = sendsMedia && !/^https:\/\//i.test(loadConfig().CRM_URL);

  const loaded = await mapLimit(ids, 4, async (id) => ({ id, data: await loadPortalChannels(id, viewer) }));
  const items: PlanItem[] = [];
  for (const { id, data } of loaded) {
    for (const sel of input.portals) {
      const code = sel.code.toUpperCase();
      if (!data) {
        items.push({ propertyId: id, reference: null, portalCode: code, ready: false, blockers: ["Το ακίνητο δεν βρέθηκε."], mock: false });
        continue;
      }
      const item = judge(operation, id, data.reference, code, sel, data.channels.find((c) => c.code === code), data.mayEdit);
      if (insecureOrigin && item.ready) {
        item.ready = false;
        item.blockers = ["Η διεύθυνση του CRM (CRM_URL) δεν είναι https, οπότε τα portals δεν μπορούν να λάβουν φωτογραφίες. Ρυθμίστε την πριν τη μαζική αποστολή."];
      }
      items.push(item);
    }
  }
  const guards = operation === "unpublish" ? await massRemovalGuards(items, input.confirmMassRemoval === true) : [];
  for (const g of guards) {
    if (g.confirmed) continue;
    for (const item of items) {
      if (item.portalCode === g.portalCode && item.ready) {
        item.ready = false;
        item.blockers = [g.message];
      }
    }
  }
  const blockedItems = items.filter((i) => !i.ready);
  const groups = new Map<string, number>();
  for (const i of blockedItems) for (const b of i.blockers) groups.set(b, (groups.get(b) ?? 0) + 1);
  return {
    guards,
    operation,
    propertyCount: ids.length,
    portals: codes,
    items,
    summary: { ready: items.length - blockedItems.length, blocked: blockedItems.length },
    blockerGroups: [...groups.entries()].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count),
  };
}

/**
 * Withdrawing many listings at once is how a wrong selection empties a portal
 * (and on cancel-and-replace portals the same effect comes from a short feed).
 * Per portal, the same thresholds as the served-feed guard apply to the number of
 * live listings: emptying a portal, or dropping past its limit, needs an explicit
 * confirmation. Small books swing naturally, so only a full emptying blocks there.
 */
async function massRemovalGuards(items: PlanItem[], confirmed: boolean): Promise<MassRemovalGuard[]> {
  const out: MassRemovalGuard[] = [];
  const codes = [...new Set(items.filter((i) => i.ready).map((i) => i.portalCode))];
  for (const code of codes) {
    const portal = await db().portal.findUnique({ where: { code }, select: { id: true, name: true, settings: true } });
    if (!portal) continue;
    const live = await db().portalListing.count({ where: { portalId: portal.id, state: { in: ["PUBLISHED", "OUTDATED", "IN_FEED"] } } });
    const removing = items.filter((i) => i.portalCode === code && i.ready).length;
    const remaining = Math.max(0, live - removing);
    const verdict = guardPublicationChange(live, remaining, guardConfigFromSettings((portal.settings ?? {}) as Record<string, unknown>));
    if (verdict.blocked) {
      out.push({
        portalCode: code,
        live,
        removing,
        remaining,
        confirmed,
        message: `Μαζική απόσυρση από ${portal.name}: ${removing} από ${live} δημοσιευμένα (απομένουν ${remaining}). Απαιτείται ρητή επιβεβαίωση.`,
      });
    }
  }
  return out;
}

function judge(operation: BatchOperation, propertyId: string, reference: string, code: string, sel: PortalSelection, channel: ChannelView | undefined, mayEdit: boolean): PlanItem {
  const base = { propertyId, reference, portalCode: code, mock: false };
  if (!channel) return { ...base, ready: false, blockers: ["Άγνωστο portal."] };
  const account = channel.accounts.find((a) => a.id === sel.accountId && a.environment === sel.environment);
  const mock = account?.providerKind === "mock";
  const blockers: string[] = [];
  if (!channel.operational) blockers.push(channel.note ?? "Το portal δεν είναι έτοιμο για δημοσίευση.");
  else if (!account || account.providerKind === "none") blockers.push("Ο επιλεγμένος λογαριασμός δεν είναι διαθέσιμος.");
  else if (!account.enabled) blockers.push("Ο επιλεγμένος λογαριασμός είναι ανενεργός.");
  if (!mayEdit) blockers.push("Δεν έχετε δικαίωμα επεξεργασίας αυτού του ακινήτου.");
  if (blockers.length === 0) {
    if (operation === "publish") {
      if (channel.status === "FAILED") blockers.push("Η προηγούμενη αποστολή απέτυχε· χρησιμοποιήστε επανάληψη από το ακίνητο.");
      else if (!channel.actions.publish) blockers.push(["PUBLISHED", "OUTDATED", "IN_FEED"].includes(channel.status) ? "Είναι ήδη δημοσιευμένο." : "Δεν επιτρέπεται η δημοσίευση.");
      else if (channel.readiness !== "READY") blockers.push(...(channel.blockers.length ? channel.blockers : ["Το ακίνητο δεν πληροί τους κανόνες του portal."]));
    } else if (!channel.actions[operation]) {
      blockers.push(operation === "update" ? "Δεν είναι δημοσιευμένο στο portal ή δεν επιτρέπεται η ενημέρωση." : "Δεν είναι δημοσιευμένο στο portal ή δεν επιτρέπεται η απόσυρση.");
    }
  }
  return { ...base, ready: blockers.length === 0, blockers, mock };
}

export type CreatedBatch = { id: string; status: string; reused: boolean };

/** Persists the plan: ready items are queued, blocked ones are recorded (and visible) but never run. */
export async function createBatch(input: {
  operation: BatchOperation;
  plan: BatchPlan;
  portals: PortalSelection[];
  idempotencyKey?: string;
  selection: Prisma.InputJsonValue;
  viewer: Viewer;
  ctx: OperationContext;
}): Promise<CreatedBatch> {
  if (input.idempotencyKey) {
    const existing = await db().portalDistributionBatch.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, status: true, createdById: true } });
    if (existing) {
      if (existing.createdById !== input.viewer.id) throw forbidden("Δεν έχετε πρόσβαση σε αυτή τη μαζική ενέργεια.");
      return { id: existing.id, status: existing.status, reused: true };
    }
  }
  const accountOf = new Map(input.portals.map((p) => [p.code.toUpperCase(), p]));
  const readyCount = input.plan.items.filter((i) => i.ready).length;
  if (readyCount === 0) throw badRequest("Καμία ενέργεια δεν είναι έτοιμη να εκτελεστεί. Διορθώστε τα εμπόδια ή αλλάξτε την επιλογή.");
  let batch: { id: string; status: string };
  try {
    batch = await db().$transaction(async (tx) => {
    const created = await tx.portalDistributionBatch.create({
      data: {
        operation: input.operation,
        status: "QUEUED",
        createdById: input.viewer.id,
        requestId: input.ctx.requestId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        selection: input.selection,
        items: {
          create: input.plan.items.map((i) => ({
            propertyId: i.propertyId,
            portalCode: i.portalCode,
            portalAccountId: accountOf.get(i.portalCode)?.accountId ?? null,
            environment: accountOf.get(i.portalCode)?.environment ?? "TEST",
            status: i.ready ? "QUEUED" : "BLOCKED",
            blockers: i.ready ? undefined : i.blockers,
            message: i.ready ? null : i.blockers[0] ?? null,
            mock: i.mock,
          })),
        },
      },
      select: { id: true, status: true },
    });
    await writeAudit(
      {
        actorId: input.viewer.id,
        action: "portal_batch_created",
        entity: "PORTAL",
        entityId: created.id,
        changes: { operation: input.operation, properties: input.plan.propertyCount, portals: input.plan.portals, queued: readyCount, blocked: input.plan.summary.blocked, massRemovalConfirmed: input.plan.guards.filter((g) => g.confirmed).map((g) => ({ portal: g.portalCode, removing: g.removing, live: g.live })) },
        ipAddress: input.ctx.ipAddress,
        userAgent: input.ctx.userAgent,
      },
      tx,
    );
    return created;
    });
  } catch (error) {
    // Two requests with the same key raced: the loser returns the winner's batch instead of failing.
    if (input.idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await db().portalDistributionBatch.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, status: true, createdById: true } });
      if (winner && winner.createdById === input.viewer.id) return { id: winner.id, status: winner.status, reused: true };
    }
    throw error;
  }
  return { id: batch.id, status: batch.status, reused: false };
}

// --- Reading ------------------------------------------------------------------------------------------------------------

async function loadOwned(batchId: string, viewer: Viewer) {
  const batch = await db().portalDistributionBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound("Η μαζική ενέργεια δεν βρέθηκε.");
  if (batch.createdById !== viewer.id && !(await settings().can(viewer.role, "portals.unpublish"))) throw forbidden("Δεν έχετε πρόσβαση σε αυτή τη μαζική ενέργεια.");
  return batch;
}

export async function getBatch(batchId: string, viewer: Viewer, opts: { status?: string; page?: number } = {}) {
  const batch = await loadOwned(batchId, viewer);
  const grouped = await db().portalDistributionItem.groupBy({ by: ["status"], where: { batchId }, _count: { _all: true } });
  const counts: Record<string, number> = { QUEUED: 0, RUNNING: 0, SUCCEEDED: 0, FAILED: 0, BLOCKED: 0, CANCELLED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = 50;
  const where: Prisma.PortalDistributionItemWhereInput = { batchId, ...(opts.status ? { status: opts.status } : {}) };
  const items = await db().portalDistributionItem.findMany({ where, orderBy: [{ status: "asc" }, { propertyId: "asc" }, { portalCode: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
  const refs = await db().property.findMany({ where: { id: { in: items.map((i) => i.propertyId) } }, select: { id: true, reference: true, titleEl: true } });
  const refOf = new Map(refs.map((r) => [r.id, r]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const open = (counts.QUEUED ?? 0) + (counts.RUNNING ?? 0);
  return {
    id: batch.id,
    operation: batch.operation,
    status: batch.status,
    createdAt: batch.createdAt.toISOString(),
    finishedAt: batch.finishedAt?.toISOString() ?? null,
    counts,
    total,
    progress: total === 0 ? 1 : (total - open) / total,
    items: items.map((i) => ({
      id: i.id,
      propertyId: i.propertyId,
      reference: refOf.get(i.propertyId)?.reference ?? null,
      title: refOf.get(i.propertyId)?.titleEl ?? null,
      portalCode: i.portalCode,
      status: i.status,
      attempts: i.attempts,
      resultStatus: i.resultStatus,
      errorCode: i.errorCode,
      message: i.message,
      externalId: i.externalId,
      mock: i.mock,
      blockers: Array.isArray(i.blockers) ? (i.blockers as string[]) : [],
    })),
    page,
    pageSize,
  };
}

export async function listBatches(viewer: Viewer) {
  const all = await settings().can(viewer.role, "portals.unpublish"); // managers see everyone's batches
  const rows = await db().portalDistributionBatch.findMany({
    where: all ? {} : { createdById: viewer.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, operation: true, status: true, createdAt: true, finishedAt: true, createdById: true, _count: { select: { items: true } } },
  });
  return rows.map((r) => ({ id: r.id, operation: r.operation, status: r.status, createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, items: r._count.items, mine: r.createdById === viewer.id }));
}

// --- Running ------------------------------------------------------------------------------------------------------------

/**
 * Claims up to a few items and runs them. Safe to call concurrently and
 * repeatedly: claiming is a conditional update, and finished items are never
 * claimed. Returns the batch's current state.
 */
export async function processBatch(batchId: string, viewer: Viewer, ctx: OperationContext) {
  const batch = await loadOwned(batchId, viewer);
  if (batch.status === "CANCELLED" || batch.status === "COMPLETED") return getBatch(batchId, viewer);
  const creator = await db().user.findUnique({ where: { id: batch.createdById }, select: { id: true, role: true, status: true } });
  // Items run with the creator's own permissions, never the poller's.
  const runAs: Viewer | null = creator && creator.status === "ACTIVE" ? { id: creator.id, role: creator.role } : null;

  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
  const candidates = await db().portalDistributionItem.findMany({
    where: { batchId, OR: [{ status: "QUEUED" }, { status: "RUNNING", lockedAt: { lt: staleBefore } }], attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { id: "asc" },
    take: CLAIM_PER_CALL,
  });
  // A queued item can only run if its creator may still act.
  for (const item of candidates) {
    const claimed = await db().portalDistributionItem.updateMany({
      where: { id: item.id, OR: [{ status: "QUEUED" }, { status: "RUNNING", lockedAt: { lt: staleBefore } }] },
      data: { status: "RUNNING", lockedAt: new Date(), startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue; // someone else has it
    await runItem(item.id, batch.operation as BatchOperation, runAs, ctx);
  }

  // Items that exhausted their attempts while "running" (worker died repeatedly) become failures.
  await db().portalDistributionItem.updateMany({
    where: { batchId, status: "RUNNING", lockedAt: { lt: staleBefore }, attempts: { gte: MAX_ATTEMPTS } },
    data: { status: "FAILED", errorCode: "worker_lost", message: "Η εκτέλεση διακόπηκε επανειλημμένα. Δοκιμάστε ξανά.", finishedAt: new Date() },
  });
  await settleBatch(batchId);
  return getBatch(batchId, viewer);
}

async function runItem(itemId: string, operation: BatchOperation, runAs: Viewer | null, ctx: OperationContext): Promise<void> {
  const item = await db().portalDistributionItem.findUniqueOrThrow({ where: { id: itemId } });
  const finish = (data: Prisma.PortalDistributionItemUpdateInput) => db().portalDistributionItem.update({ where: { id: itemId }, data: { ...data, lockedAt: null, finishedAt: new Date() } });
  if (!runAs) {
    await finish({ status: "FAILED", errorCode: "actor_inactive", message: "Ο χρήστης που ξεκίνησε την ενέργεια δεν είναι πλέον ενεργός." });
    return;
  }
  const channel: ChannelRequest = { code: item.portalCode, accountId: item.portalAccountId ?? undefined, environment: item.environment === "PRODUCTION" ? "PRODUCTION" : "TEST" };
  try {
    const out = await runPublicationOperation({ propertyId: item.propertyId, operation, channels: [channel], viewer: runAs, ctx: { ...ctx, actorId: runAs.id } });
    const r = out.results[0]!;
    await finish({
      status: r.ok ? "SUCCEEDED" : "FAILED",
      resultStatus: r.status,
      errorCode: r.errorCode,
      message: r.message,
      externalId: r.externalId,
      mock: r.mock,
      blockers: r.blockers.length ? r.blockers : undefined,
    });
  } catch (error) {
    // A denial or an unexpected error fails this item only.
    const message = error instanceof Error ? error.message : "Άγνωστο σφάλμα.";
    await finish({ status: "FAILED", errorCode: "item_error", message: message.slice(0, 300) });
  }
}

async function settleBatch(batchId: string): Promise<void> {
  const open = await db().portalDistributionItem.count({ where: { batchId, status: { in: ["QUEUED", "RUNNING"] } } });
  const batch = await db().portalDistributionBatch.findUnique({ where: { id: batchId }, select: { status: true } });
  if (!batch || batch.status === "CANCELLED") return;
  if (open === 0) await db().portalDistributionBatch.updateMany({ where: { id: batchId, status: { not: "COMPLETED" } }, data: { status: "COMPLETED", finishedAt: new Date() } });
  else await db().portalDistributionBatch.updateMany({ where: { id: batchId, status: "QUEUED" }, data: { status: "RUNNING" } });
}

/** Stops queued work. Items already running finish; nothing that was sent is undone. */
export async function cancelBatch(batchId: string, viewer: Viewer, ctx: OperationContext) {
  const batch = await loadOwned(batchId, viewer);
  if (batch.createdById !== viewer.id && !(await settings().can(viewer.role, "portals.unpublish"))) throw forbidden("Μόνο ο δημιουργός ή διαχειριστής μπορεί να ακυρώσει.");
  if (batch.status === "COMPLETED" || batch.status === "CANCELLED") return getBatch(batchId, viewer);
  await db().portalDistributionItem.updateMany({ where: { batchId, status: "QUEUED" }, data: { status: "CANCELLED", message: "Ακυρώθηκε πριν εκτελεστεί." } });
  await db().portalDistributionBatch.update({ where: { id: batchId }, data: { status: "CANCELLED", cancelledAt: new Date(), finishedAt: new Date() } });
  await writeAudit({ actorId: viewer.id, action: "portal_batch_cancelled", entity: "PORTAL", entityId: batchId, changes: { cancelled: true }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
  return getBatch(batchId, viewer);
}

/** Re-queues only the failed items (never the succeeded ones), within the attempt bound. */
export async function retryFailed(batchId: string, viewer: Viewer, ctx: OperationContext) {
  const batch = await loadOwned(batchId, viewer);
  if (batch.createdById !== viewer.id && !(await settings().can(viewer.role, "portals.retry"))) throw forbidden("Δεν έχετε δικαίωμα επανάληψης.");
  if (batch.status === "CANCELLED") throw badRequest("Η μαζική ενέργεια έχει ακυρωθεί.");
  const re = await db().portalDistributionItem.updateMany({
    where: { batchId, status: "FAILED", attempts: { lt: MAX_ATTEMPTS } },
    data: { status: "QUEUED", errorCode: null, message: null, resultStatus: null, finishedAt: null },
  });
  if (re.count > 0) await db().portalDistributionBatch.update({ where: { id: batchId }, data: { status: "RUNNING", finishedAt: null } });
  await writeAudit({ actorId: viewer.id, action: "portal_batch_retried", entity: "PORTAL", entityId: batchId, changes: { requeued: re.count }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
  return getBatch(batchId, viewer);
}
