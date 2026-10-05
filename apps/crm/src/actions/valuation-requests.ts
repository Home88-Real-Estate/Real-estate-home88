"use server";

/** Website valuation requests: workflow and opening an agent valuation. The API authorises every call. */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { str } from "@/lib/form";

function refresh(id: string) {
  revalidatePath("/valuations/requests");
  revalidatePath(`/valuations/requests/${id}`);
}

export async function setRequestStage(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  await apiFetch(`/api/valuation-requests/${encodeURIComponent(id)}`, { method: "PATCH", json: { stage: str(fd, "stage") } });
  refresh(id);
}

export async function assignRequest(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  const agent = str(fd, "assignedAgentId");
  await apiFetch(`/api/valuation-requests/${encodeURIComponent(id)}`, { method: "PATCH", json: { assignedAgentId: agent || null } });
  refresh(id);
}

export async function openAgentValuation(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch<{ valuation: { id: string } }>(`/api/valuation-requests/${encodeURIComponent(id)}/agent-valuation`, { method: "POST", json: {} });
  refresh(id);
  revalidatePath("/valuations");
  if (result.ok) redirect(`/valuations/${result.data.valuation.id}`);
}
