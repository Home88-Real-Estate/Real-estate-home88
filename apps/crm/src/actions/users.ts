"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

type SavedUser = { user: { id: string } };

function refresh(id?: string): void {
  revalidatePath("/users");
  if (id) revalidatePath(`/users/${id}`);
}

/** Create or update a staff account. Passwords are only set at creation here. */
export async function saveUser(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id");
  const role = str(formData, "role");

  const payload: Record<string, unknown> = {
    firstName: formData.get("firstName") ?? "",
    lastName: formData.get("lastName") ?? "",
    phone: formData.get("phone") ?? "",
  };
  if (role) payload.role = role;

  if (id) {
    const status = str(formData, "status");
    if (status) payload.status = status;

    const result = await apiFetch(`/api/users/${id}`, { method: "PATCH", json: payload });
    if (!result.ok) {
      return { ok: false, message: result.error.message, fields: result.error.fields };
    }
    refresh(id);
    return { ok: true, message: "Αποθηκεύτηκε." };
  }

  payload.email = str(formData, "email") ?? "";
  payload.password = formData.get("password") ?? "";

  const result = await apiFetch<SavedUser>("/api/users", { method: "POST", json: payload });
  if (!result.ok) {
    return { ok: false, message: result.error.message, fields: result.error.fields };
  }

  refresh(result.data.user.id);
  redirect(`/users/${result.data.user.id}`);
}

/** Admin-set password. Revokes the target's sessions, so they must sign in again. */
export async function setUserPassword(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, message: "Λείπει ο χρήστης." };

  const result = await apiFetch(`/api/users/${id}/password`, {
    method: "POST",
    json: { password: formData.get("password") ?? "" },
  });
  if (!result.ok) {
    return { ok: false, message: result.error.message, fields: result.error.fields };
  }

  refresh(id);
  return { ok: true, message: "Ο κωδικός άλλαξε. Οι συνδέσεις του χρήστη τερματίστηκαν." };
}

/** Suspend or reactivate an account. */
export async function setUserStatus(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const status = str(formData, "status");
  if (!id || !status) return;

  await apiFetch(`/api/users/${id}`, { method: "PATCH", json: { status } });
  refresh(id);
}
