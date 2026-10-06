"use server";

/** Contacts and showings: every action forwards to the API, which authorises, validates and audits. */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { bool, str, type ActionState } from "@/lib/form";

function fail(error: { message: string; fields?: Record<string, string[]> }): ActionState {
  return { ok: false, message: error.message, fields: error.fields };
}

const ROLES = ["BUYER", "SELLER", "LANDLORD", "TENANT", "OTHER"];

function readContact(fd: FormData) {
  return {
    firstName: str(fd, "firstName") ?? "",
    lastName: str(fd, "lastName") ?? "",
    company: str(fd, "company") ?? "",
    email: str(fd, "email") ?? "",
    phone: str(fd, "phone") ?? "",
    mobile: str(fd, "mobile") ?? "",
    workPhone: str(fd, "workPhone") ?? "",
    city: str(fd, "city") ?? "",
    postalCode: str(fd, "postalCode") ?? "",
    roles: fd.getAll("roles").filter((r): r is string => typeof r === "string" && ROLES.includes(r)),
    preferredContactMethod: str(fd, "preferredContactMethod") ?? "ANY",
    preferredLocale: str(fd, "preferredLocale") ?? "el",
    status: str(fd, "status") ?? "ACTIVE",
  };
}

export type ContactActionState = ActionState & { duplicates?: Array<{ id: string; reference: string; firstName: string; lastName: string }> };

export async function createContact(_prev: ContactActionState, fd: FormData): Promise<ContactActionState> {
  const assignedToId = str(fd, "assignedToId");
  const result = await apiFetch<{ contact: { id: string } }>("/api/contacts", {
    method: "POST",
    json: { ...readContact(fd), taxId: str(fd, "taxId") ?? "", address: str(fd, "address") ?? "", ...(assignedToId ? { assignedToId } : {}), confirmDuplicate: bool(fd, "confirmDuplicate") },
  });
  if (!result.ok) {
    if (result.status === 409) {
      const dup = (result.error as unknown as { duplicates?: ContactActionState["duplicates"] }).duplicates;
      return { ...fail(result.error), duplicates: dup };
    }
    return fail(result.error);
  }
  revalidatePath("/contacts");
  redirect(`/contacts/${result.data.contact.id}`);
}

export async function updateContact(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  if (!id) return { ok: false, message: "Λείπει η επαφή." };
  const sensitive = fd.get("sensitiveHidden") !== "1";
  const assignedToId = str(fd, "assignedToId");
  const result = await apiFetch(`/api/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: { ...readContact(fd), ...(sensitive ? { taxId: str(fd, "taxId") ?? "", address: str(fd, "address") ?? "" } : {}), assignedToId: assignedToId ?? null },
  });
  if (!result.ok) return fail(result.error);
  revalidatePath("/contacts");
  redirect(`/contacts/${id}`);
}

export async function bulkContacts(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ids = fd.getAll("ids").filter((v): v is string => typeof v === "string" && v.length > 0);
  const action = str(fd, "action");
  if (ids.length === 0) return { ok: false, message: "Επιλέξτε τουλάχιστον μία επαφή." };
  if (!action) return { ok: false, message: "Επιλέξτε ενέργεια." };
  const json: Record<string, unknown> = { ids, action };
  if (action === "assign") json.assignedToId = str(fd, "assignedToId") ?? null;
  if (action === "status") json.status = str(fd, "status");
  const result = await apiFetch<{ updated: number; skipped: number }>("/api/contacts/bulk", { method: "POST", json });
  if (!result.ok) return fail(result.error);
  revalidatePath("/contacts");
  return { ok: true, message: `Ενημερώθηκαν ${result.data.updated} επαφές.` };
}

export async function linkProperty(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const contactId = str(fd, "contactId");
  if (!contactId) return { ok: false, message: "Λείπει η επαφή." };
  const result = await apiFetch(`/api/contacts/${encodeURIComponent(contactId)}/properties`, {
    method: "POST",
    json: { propertyId: str(fd, "propertyId") ?? "", relation: str(fd, "relation") ?? "INTERESTED", notes: str(fd, "notes") ?? "" },
  });
  if (!result.ok) return fail(result.error);
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true, message: "Το ακίνητο συνδέθηκε." };
}

export async function unlinkProperty(fd: FormData): Promise<void> {
  const contactId = str(fd, "contactId");
  const linkId = str(fd, "linkId");
  if (!contactId || !linkId) return;
  await apiFetch(`/api/contacts/${encodeURIComponent(contactId)}/properties/${encodeURIComponent(linkId)}`, { method: "DELETE" });
  revalidatePath(`/contacts/${contactId}`);
}

export async function createContactReminder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const contactId = str(fd, "contactId");
  const result = await apiFetch("/api/tasks", {
    method: "POST",
    json: { title: str(fd, "title") ?? "", description: str(fd, "description"), priority: str(fd, "priority") ?? "NORMAL", dueAt: str(fd, "dueAt"), contactId, showingId: str(fd, "showingId") },
  });
  if (!result.ok) return fail(result.error);
  if (contactId) revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/reminders");
  const showingId = str(fd, "showingId");
  if (showingId) revalidatePath(`/showings/${showingId}`);
  return { ok: true, message: "Η υπενθύμιση δημιουργήθηκε." };
}

// --- Showings -----------------------------------------------------------------

const FEE_FIELDS = ["feePayer", "feeMethod", "feeBasis", "feePercentage", "feeFixedAmount", "feeCurrency", "vatTreatment", "vatRate", "paymentTrigger"] as const;

function readShowing(fd: FormData, editing: boolean) {
  const date = str(fd, "visitDate");
  const time = str(fd, "visitTime");
  const contactReference = str(fd, "contactReference") ?? "";
  const idNumber = str(fd, "idNumber");
  // An edit that cannot read the stored identity number (masked) leaves the parties untouched.
  const keepParties = editing && fd.get("partyMasked") === "1";
  const fee: Record<string, string | null> = {};
  for (const k of FEE_FIELDS) {
    const v = str(fd, k);
    if (v !== undefined) fee[k] = v;
    else if (editing) fee[k] = null;
  }
  const propertyReferences = fd.getAll("propertyReference").filter((v): v is string => typeof v === "string" && v.length > 0);
  return {
    contactReference,
    ...fee,
    ...(keepParties ? {} : { parties: contactReference ? [{ contactReference, role: "BUYER", ...(idNumber ? { idNumber } : {}) }] : [] }),
    propertyReferences,
    visitAt: date ? `${date}T${time ?? "09:00"}` : "",
    responsibleUserId: str(fd, "responsibleUserId"),
    comments: str(fd, "comments") ?? "",
    language: str(fd, "language") ?? "el",
  };
}

export async function createShowing(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const body = readShowing(fd, false);
  if (!body.contactReference) return { ok: false, message: "Επιλέξτε πελάτη.", fields: { contactReference: ["Επιλέξτε πελάτη."] } };
  if (body.propertyReferences.length === 0) return { ok: false, message: "Επιλέξτε τουλάχιστον ένα ακίνητο.", fields: { propertyReferences: ["Επιλέξτε τουλάχιστον ένα ακίνητο."] } };
  const result = await apiFetch<{ showing: { id: string } }>("/api/showings", { method: "POST", json: body });
  if (!result.ok) return fail(result.error);
  const id = result.data.showing.id;

  // Optional reminder, through the existing reminders module.
  if (bool(fd, "addReminder")) {
    const dueAt = str(fd, "reminderAt");
    const contact = await apiFetch<{ data: Array<{ id: string }> }>("/api/contacts", { query: { q: body.contactReference, limit: 1 } });
    await apiFetch("/api/tasks", {
      method: "POST",
      json: { title: str(fd, "reminderTitle") ?? "Follow-up υπόδειξης", dueAt, contactId: contact.ok ? contact.data.data[0]?.id : undefined, showingId: id },
    });
  }
  revalidatePath("/showings");
  revalidatePath("/contacts");
  redirect(`/showings/${id}`);
}

export async function updateShowing(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  if (!id) return { ok: false, message: "Λείπει η υπόδειξη." };
  const body = readShowing(fd, true);
  if (!body.contactReference) return { ok: false, message: "Επιλέξτε πελάτη.", fields: { contactReference: ["Επιλέξτε πελάτη."] } };
  if (body.propertyReferences.length === 0) return { ok: false, message: "Επιλέξτε τουλάχιστον ένα ακίνητο.", fields: { propertyReferences: ["Επιλέξτε τουλάχιστον ένα ακίνητο."] } };
  const result = await apiFetch(`/api/showings/${encodeURIComponent(id)}`, { method: "PATCH", json: body });
  if (!result.ok) return fail(result.error);
  revalidatePath("/showings");
  revalidatePath(`/showings/${id}`);
  redirect(`/showings/${id}`);
}

export async function issueShowing(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  if (!id) return { ok: false, message: "Λείπει η υπόδειξη." };
  const ack = str(fd, "acknowledgeFeeAnomaly");
  const result = await apiFetch(`/api/showings/${encodeURIComponent(id)}/issue`, { method: "POST", json: ack ? { acknowledgeFeeAnomaly: ack } : {} });
  if (!result.ok) return fail(result.error);
  revalidatePath("/showings");
  revalidatePath(`/showings/${id}`);
  return { ok: true, message: "Η υπόδειξη εκδόθηκε." };
}

export async function sendShowing(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  if (!id) return { ok: false, message: "Λείπει η υπόδειξη." };
  const result = await apiFetch(`/api/showings/${encodeURIComponent(id)}/send`, { method: "POST", json: {} });
  if (!result.ok) return fail(result.error);
  revalidatePath(`/showings/${id}`);
  return { ok: true, message: "Στάλθηκε για υπογραφή." };
}

export async function cancelShowing(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  if (!id) return { ok: false, message: "Λείπει η υπόδειξη." };
  const result = await apiFetch(`/api/showings/${encodeURIComponent(id)}/cancel`, { method: "POST", json: { reason: str(fd, "reason") ?? "" } });
  if (!result.ok) return fail(result.error);
  revalidatePath("/showings");
  revalidatePath(`/showings/${id}`);
  return { ok: true, message: "Η υπόδειξη ακυρώθηκε." };
}

/** Mints a short-lived signed link after the API's permission check and audit, then sends the browser there. */
export async function downloadShowingPdf(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  if (!id) return;
  const result = await apiFetch<{ url: string }>(`/api/showings/${encodeURIComponent(id)}/pdf`);
  if (!result.ok) redirect(`/showings/${id}?error=${encodeURIComponent(result.error.message)}`);
  redirect(result.data.url);
}
