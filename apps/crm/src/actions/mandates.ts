"use server";

/** Documents and mandates: every action forwards to the API, which authorises, validates and records the timeline. */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

function fail(error: { message: string; fields?: Record<string, string[]> }): ActionState {
  return { ok: false, message: error.message, fields: error.fields };
}

function refresh(id?: string) {
  revalidatePath("/mandates");
  if (id) revalidatePath(`/mandates/${id}`);
}

const PARTY_FIELDS = ["contactReference", "fullName", "taxId", "idNumber", "address", "phone", "email"] as const;

/** Up to three principal rows; empty rows are dropped. */
function readParties(fd: FormData) {
  const rows = [0, 1, 2].map((i) => Object.fromEntries(PARTY_FIELDS.map((k) => [k, str(fd, `party${i}.${k}`) ?? ""])));
  return rows.filter((r) => r.fullName || r.contactReference);
}

function readDraft(fd: FormData) {
  return {
    propertyReference: str(fd, "propertyReference") ?? "",
    startsAt: str(fd, "startsAt") ?? "",
    endsAt: str(fd, "endsAt") ?? "",
    terms: {
      price: str(fd, "price") ?? "",
      commission: str(fd, "commission") ?? "",
      viewingDate: str(fd, "viewingDate") ?? "",
      cadastralCode: str(fd, "cadastralCode") ?? "",
      special: str(fd, "special") ?? "",
    },
  };
}

export async function createMandate(_p: ActionState, fd: FormData): Promise<ActionState> {
  const parties = readParties(fd);
  const result = await apiFetch<{ mandate: { id: string } }>("/api/mandates", {
    method: "POST",
    json: {
      type: str(fd, "type") ?? "",
      locale: str(fd, "locale") ?? "el",
      sellerLeadId: str(fd, "sellerLeadId") ?? "",
      ...readDraft(fd),
      ...(parties.length ? { parties } : {}),
    },
  });
  if (!result.ok) return fail(result.error);
  refresh();
  const seller = str(fd, "sellerLeadId");
  if (seller) revalidatePath(`/sellers/${seller}`);
  redirect(`/mandates/${result.data.mandate.id}`);
}

export async function updateMandate(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const parties = readParties(fd);
  const result = await apiFetch(`/api/mandates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: { ...readDraft(fd), ...(parties.length ? { parties } : {}) },
  });
  if (!result.ok) return fail(result.error);
  refresh(id);
  return { ok: true, message: "Αποθηκεύτηκε." };
}

async function post(path: string, id: string, json: unknown, ok: string): Promise<ActionState> {
  const result = await apiFetch(`/api/mandates/${encodeURIComponent(id)}/${path}`, { method: "POST", json });
  if (!result.ok) return fail(result.error);
  refresh(id);
  return { ok: true, message: ok };
}

export async function issueMandate(_p: ActionState, fd: FormData): Promise<ActionState> {
  return post("issue", str(fd, "id") ?? "", {}, "Η εντολή εκδόθηκε.");
}

export async function sendMandate(_p: ActionState, fd: FormData): Promise<ActionState> {
  return post("send", str(fd, "id") ?? "", {}, "Στάλθηκε για υπογραφή.");
}

export async function refreshMandate(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  await apiFetch(`/api/mandates/${encodeURIComponent(id)}/refresh`, { method: "POST", json: {} });
  refresh(id);
}

export async function cancelMandate(_p: ActionState, fd: FormData): Promise<ActionState> {
  return post("cancel", str(fd, "id") ?? "", { reason: str(fd, "reason") ?? "" }, "Η εντολή ακυρώθηκε.");
}

export async function addMandateNote(_p: ActionState, fd: FormData): Promise<ActionState> {
  return post("notes", str(fd, "id") ?? "", { text: str(fd, "text") ?? "" }, "Η σημείωση καταγράφηκε.");
}

export async function duplicateMandate(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch<{ mandate: { id: string } }>(`/api/mandates/${encodeURIComponent(id)}/duplicate`, { method: "POST", json: {} });
  refresh();
  if (result.ok) redirect(`/mandates/${result.data.mandate.id}`);
}

/** A short-lived signed link, opened only after the API has checked access and logged it. */
export async function downloadDocument(fd: FormData): Promise<void> {
  const id = str(fd, "documentId") ?? "";
  const result = await apiFetch<{ url: string }>(`/api/documents/${encodeURIComponent(id)}/download`);
  if (result.ok) redirect(result.data.url);
}

export async function deleteDocument(fd: FormData): Promise<void> {
  const id = str(fd, "documentId") ?? "";
  await apiFetch(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
  revalidatePath("/documents");
  const back = str(fd, "back");
  if (back) revalidatePath(back);
}

export async function revalidateAfterUpload(path: string): Promise<void> {
  if (typeof path === "string" && /^\/[a-z0-9/_-]{0,200}$/i.test(path)) revalidatePath(path);
  revalidatePath("/documents");
}
