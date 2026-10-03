"use server";

/** Transactions: every action forwards to the API, which authorises, validates and records the timeline. */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

function fail(error: { message: string; fields?: Record<string, string[]> }): ActionState {
  return { ok: false, message: error.message, fields: error.fields };
}

function refresh(id?: string) {
  revalidatePath("/transactions");
  if (id) revalidatePath(`/transactions/${id}`);
}

export async function createTransaction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const result = await apiFetch<{ transaction: { id: string } }>("/api/transactions", {
    method: "POST",
    json: {
      propertyReference: str(fd, "propertyReference") ?? "",
      buyerName: str(fd, "buyerName") ?? "",
      buyerPhone: str(fd, "buyerPhone") ?? "",
      buyerEmail: str(fd, "buyerEmail") ?? "",
      leadReference: str(fd, "leadReference") ?? "",
      expectedCloseAt: str(fd, "expectedCloseAt") ?? "",
      notes: str(fd, "notes") ?? "",
    },
  });
  if (!result.ok) return fail(result.error);
  refresh();
  redirect(`/transactions/${result.data.transaction.id}`);
}

export async function addOffer(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/transactions/${encodeURIComponent(id)}/offers`, {
    method: "POST",
    json: {
      party: str(fd, "party") ?? "BUYER",
      amount: str(fd, "amount") ?? "",
      conditions: str(fd, "conditions") ?? "",
      financing: str(fd, "financing") ?? "",
      deposit: str(fd, "deposit") ?? "",
      expiresAt: str(fd, "expiresAt") ?? "",
      notes: str(fd, "notes") ?? "",
    },
  });
  if (!result.ok) return fail(result.error);
  refresh(id);
  return { ok: true, message: "Η προσφορά καταχωρίστηκε." };
}

export async function respondOffer(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  await apiFetch(`/api/transactions/${encodeURIComponent(id)}/offers/${encodeURIComponent(str(fd, "offerId") ?? "")}/respond`, {
    method: "POST",
    json: { action: str(fd, "action"), note: str(fd, "note") ?? "" },
  });
  refresh(id);
}

export async function moveTransaction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/transactions/${encodeURIComponent(id)}/status`, {
    method: "POST",
    json: { status: str(fd, "status"), date: str(fd, "date") ?? "", reason: str(fd, "reason") ?? "" },
  });
  if (!result.ok) return fail(result.error);
  refresh(id);
  return { ok: true, message: "Η κατάσταση άλλαξε." };
}

export async function calculateCommissionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/transactions/${encodeURIComponent(id)}/commission`, {
    method: "POST",
    json: { overrideRate: str(fd, "overrideRate") ?? "", overrideReason: str(fd, "overrideReason") ?? "" },
  });
  if (!result.ok) return fail(result.error);
  refresh(id);
  return { ok: true, message: "Η προμήθεια υπολογίστηκε." };
}

export async function updateCommissionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/transactions/${encodeURIComponent(id)}/commission`, {
    method: "PATCH",
    json: { status: str(fd, "status"), invoiceNumber: str(fd, "invoiceNumber") ?? "", dueDate: str(fd, "dueDate") ?? "", paidAmount: str(fd, "paidAmount") ?? "" },
  });
  if (!result.ok) return fail(result.error);
  refresh(id);
  return { ok: true, message: "Αποθηκεύτηκε." };
}

export async function addChecklistItem(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/transactions/${encodeURIComponent(id)}/checklist`, { method: "POST", json: { label: str(fd, "label") ?? "" } });
  if (!result.ok) return fail(result.error);
  refresh(id);
  return { ok: true, message: "Προστέθηκε." };
}

export async function setChecklistStatus(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  await apiFetch(`/api/transactions/${encodeURIComponent(id)}/checklist/${encodeURIComponent(str(fd, "itemId") ?? "")}`, {
    method: "PATCH",
    json: { status: str(fd, "status") },
  });
  refresh(id);
}

export async function addTransactionNote(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/transactions/${encodeURIComponent(id)}/notes`, { method: "POST", json: { text: str(fd, "text") ?? "" } });
  if (!result.ok) return fail(result.error);
  refresh(id);
  return { ok: true, message: "Η σημείωση καταγράφηκε." };
}
