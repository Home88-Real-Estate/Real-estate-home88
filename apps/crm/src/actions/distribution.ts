"use server";

import { apiFetch } from "@/lib/api";

export type Selection = { ids: string[] } | { filter: Record<string, string>; exclude: string[] };
export type PortalChoice = { code: string; accountId: string; environment: "TEST" | "PRODUCTION" };
export type Operation = "publish" | "update" | "unpublish";

export type PlanItem = { propertyId: string; reference: string | null; portalCode: string; ready: boolean; blockers: string[]; mock: boolean };
export type Plan = {
  operation: Operation;
  propertyCount: number;
  matched: number;
  portals: string[];
  summary: { ready: number; blocked: number };
  blockerGroups: Array<{ message: string; count: number }>;
  items: PlanItem[];
  readyPreview: PlanItem[];
};
export type BatchItem = {
  id: string; propertyId: string; reference: string | null; title: string | null; portalCode: string; status: string; attempts: number;
  resultStatus: string | null; errorCode: string | null; message: string | null; externalId: string | null; mock: boolean; blockers: string[];
};
export type Batch = {
  id: string; operation: string; status: string; counts: Record<string, number>; total: number; progress: number; items: BatchItem[]; page: number; pageSize: number;
};

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const body = (operation: Operation, selection: Selection, portals: PortalChoice[], idempotencyKey?: string) => ({
  operation,
  selection: "ids" in selection ? { ids: selection.ids } : { filter: selection.filter, exclude: selection.exclude.length ? selection.exclude : undefined },
  portals,
  idempotencyKey,
});

export async function planDistribution(operation: Operation, selection: Selection, portals: PortalChoice[]): Promise<Result<Plan>> {
  const r = await apiFetch<Plan>("/api/distribution/plan", { method: "POST", json: body(operation, selection, portals) });
  return r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
}

export async function createDistribution(operation: Operation, selection: Selection, portals: PortalChoice[], idempotencyKey: string): Promise<Result<{ id: string; reused: boolean }>> {
  const r = await apiFetch<{ id: string; reused: boolean }>("/api/distribution/batches", { method: "POST", json: body(operation, selection, portals, idempotencyKey) });
  return r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
}

const step = (id: string, name: "process" | "cancel" | "retry") => async (): Promise<Result<Batch>> => {
  const r = await apiFetch<Batch>(`/api/distribution/batches/${encodeURIComponent(id)}/${name}`, { method: "POST" });
  return r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
};

export async function processDistribution(id: string): Promise<Result<Batch>> { return step(id, "process")(); }
export async function cancelDistribution(id: string): Promise<Result<Batch>> { return step(id, "cancel")(); }
export async function retryDistribution(id: string): Promise<Result<Batch>> { return step(id, "retry")(); }
