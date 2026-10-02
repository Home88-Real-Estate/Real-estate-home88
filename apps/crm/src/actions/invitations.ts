"use server";

import { revalidatePath } from "next/cache";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

type MessageResponse = { ok: boolean; message?: string };

/**
 * Create a staff invitation. The account is not created here; the invitee sets
 * their own password from the emailed link.
 */
export async function inviteUserAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = str(formData, "email") ?? "";

  const payload: Record<string, unknown> = {
    email,
    firstName: str(formData, "firstName") ?? "",
    lastName: str(formData, "lastName") ?? "",
    role: str(formData, "role") ?? "",
  };
  const phone = str(formData, "phone");
  if (phone) payload.phone = phone;

  const result = await apiFetch("/api/invitations", { method: "POST", json: payload });
  if (!result.ok) {
    return { ok: false, message: result.error.message, fields: result.error.fields };
  }

  revalidatePath("/invitations");
  return { ok: true, message: `Η πρόσκληση στάλθηκε στο ${email}.` };
}

/** Withdraw a pending invitation. */
export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  if (!id) return;

  await apiFetch(`/api/invitations/${id}/revoke`, { method: "POST", json: {} });
  revalidatePath("/invitations");
}

/** Redeem an invitation: the invitee chooses their own password. */
export async function acceptInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = str(formData, "token") ?? "";
  const password = formData.get("password") ?? "";
  const confirmPassword = formData.get("confirmPassword") ?? "";

  if (password !== confirmPassword) {
    return {
      ok: false,
      message: "Οι κωδικοί δεν ταιριάζουν.",
      fields: { confirmPassword: ["Οι κωδικοί δεν ταιριάζουν."] },
    };
  }

  const result = await apiFetch<MessageResponse>("/api/invitations/accept", {
    method: "POST",
    json: { token, password: String(password) },
  });
  if (!result.ok) {
    return { ok: false, message: result.error.message, fields: result.error.fields };
  }

  return {
    ok: true,
    message: result.data.message ?? "Ο λογαριασμός ενεργοποιήθηκε. Συνδεθείτε με τον νέο κωδικό.",
  };
}
