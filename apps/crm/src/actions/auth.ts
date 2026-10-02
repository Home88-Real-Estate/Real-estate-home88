"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { API_URL, SESSION_COOKIE_NAME } from "@/lib/config";
import { str, type ActionState } from "@/lib/form";

/**
 * Revokes the session on the API and clears the cookie on this origin. The API
 * call is best-effort: even if the network is down, the local cookie is gone,
 * so the browser can no longer present the session.
 */
export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
    } catch {
      // Ignore: the cookie is cleared below regardless.
    }
  }

  store.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}

type MessageResponse = { ok: boolean; message?: string };

/** A signed-in user changes their own password. Other sessions are revoked. */
export async function changePasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const currentPassword = formData.get("currentPassword") ?? "";
  const newPassword = formData.get("newPassword") ?? "";
  const confirmPassword = formData.get("confirmPassword") ?? "";

  if (newPassword !== confirmPassword) {
    return {
      ok: false,
      message: "Οι νέοι κωδικοί δεν ταιριάζουν.",
      fields: { confirmPassword: ["Οι νέοι κωδικοί δεν ταιριάζουν."] },
    };
  }

  const result = await apiFetch<MessageResponse>("/api/auth/password", {
    method: "POST",
    json: { currentPassword: String(currentPassword), newPassword: String(newPassword) },
  });
  if (!result.ok) {
    return { ok: false, message: result.error.message, fields: result.error.fields };
  }
  return { ok: true, message: result.data.message ?? "Ο κωδικός άλλαξε με επιτυχία." };
}

/**
 * Request a reset link. The API answers identically whether or not the email
 * exists, and this action passes that answer through unchanged.
 */
export async function requestPasswordResetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = str(formData, "email") ?? "";
  const result = await apiFetch<MessageResponse>("/api/auth/forgot-password", {
    method: "POST",
    json: { email },
  });
  if (!result.ok) {
    return { ok: false, message: result.error.message, fields: result.error.fields };
  }
  return { ok: true, message: result.data.message };
}

/** Redeem a reset token. */
export async function resetPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = str(formData, "token") ?? "";
  const newPassword = formData.get("newPassword") ?? "";
  const confirmPassword = formData.get("confirmPassword") ?? "";

  if (newPassword !== confirmPassword) {
    return {
      ok: false,
      message: "Οι νέοι κωδικοί δεν ταιριάζουν.",
      fields: { confirmPassword: ["Οι νέοι κωδικοί δεν ταιριάζουν."] },
    };
  }

  const result = await apiFetch<MessageResponse>("/api/auth/reset-password", {
    method: "POST",
    json: { token, newPassword: String(newPassword) },
  });
  if (!result.ok) {
    return { ok: false, message: result.error.message, fields: result.error.fields };
  }
  return { ok: true, message: result.data.message ?? "Ο κωδικός επαναφέρθηκε." };
}
