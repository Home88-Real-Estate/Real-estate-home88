"use server";

/** Communications: every action forwards to the API, which applies consent, opt-out and template rules. */

import { revalidatePath } from "next/cache";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

export type PreviewState = ActionState & {
  preview?: { to: string | null; subject: string | null; text: string | null; missing: string[]; blocked: string | null; segments: { encoding: string; segments: number; length: number } | null; purpose: string };
};

function compose(fd: FormData) {
  return {
    contactId: str(fd, "contactId") ?? "",
    channel: str(fd, "channel") ?? "EMAIL",
    templateId: str(fd, "templateId") ?? "",
    purpose: str(fd, "templateId") ? undefined : (str(fd, "purpose") ?? "SERVICE"),
    subject: str(fd, "subject") ?? "",
    body: str(fd, "body") ?? "",
    propertyReference: str(fd, "propertyReference") ?? "",
  };
}

/** One form, two buttons: "preview" shows exactly what will go out; "send" sends it. */
export async function composeMessage(_p: PreviewState, fd: FormData): Promise<PreviewState> {
  const intent = str(fd, "intent") ?? "preview";
  const body = compose(fd);
  if (intent === "preview") {
    const r = await apiFetch<{ preview: NonNullable<PreviewState["preview"]> }>("/api/messages/preview", { method: "POST", json: body });
    if (!r.ok) return { ok: false, message: r.error.message, fields: r.error.fields };
    return { ok: true, preview: r.data.preview };
  }
  const r = await apiFetch<{ message: { status: string; error: string | null } }>("/api/messages", { method: "POST", json: body });
  revalidatePath(`/contacts/${body.contactId}`);
  revalidatePath("/messages");
  if (!r.ok) return { ok: false, message: r.error.message, fields: r.error.fields };
  const s = r.data.message.status;
  return {
    ok: s !== "FAILED",
    message: s === "SENT" ? "Το μήνυμα στάλθηκε." : s === "LOGGED" ? "Καταγράφηκε· δεν στάλθηκε γιατί δεν έχει ρυθμιστεί πάροχος email." : `Απέτυχε: ${r.data.message.error ?? ""}`,
  };
}

export async function saveTemplate(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const json = {
    name: str(fd, "name") ?? "",
    channel: str(fd, "channel") ?? "EMAIL",
    purpose: str(fd, "purpose") ?? "SERVICE",
    subject: str(fd, "subject") ?? "",
    body: str(fd, "body") ?? "",
    active: str(fd, "active") !== "false",
  };
  const r = id
    ? await apiFetch(`/api/message-templates/${encodeURIComponent(id)}`, { method: "PATCH", json })
    : await apiFetch("/api/message-templates", { method: "POST", json });
  if (!r.ok) return { ok: false, message: r.error.message, fields: r.error.fields };
  revalidatePath("/messages/templates");
  return { ok: true, message: "Το πρότυπο αποθηκεύτηκε." };
}

export async function toggleTemplate(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  await apiFetch(`/api/message-templates/${encodeURIComponent(id)}`, { method: "PATCH", json: { active: str(fd, "active") === "true" } });
  revalidatePath("/messages/templates");
}

export async function setSmsOptOut(fd: FormData): Promise<void> {
  const id = str(fd, "contactId") ?? "";
  await apiFetch(`/api/contacts/${encodeURIComponent(id)}/sms-opt-out`, { method: "POST", json: { optOut: str(fd, "optOut") === "true" } });
  revalidatePath(`/contacts/${id}`);
}

export async function markNotificationsRead(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  await apiFetch("/api/notifications/read", { method: "POST", json: id ? { ids: [id] } : {} });
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
