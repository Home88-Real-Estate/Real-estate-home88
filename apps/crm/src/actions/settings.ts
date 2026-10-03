"use server";

/**
 * Settings actions. Each one forwards the form to the API, which authorises,
 * validates, audits and stores. Secrets typed into a form go straight to the
 * API and are never echoed back: an empty secret input means "keep".
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { settingsSection, storedFields } from "@home88/domain";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

function fail(error: { message: string; fields?: Record<string, string[]> }): ActionState {
  return { ok: false, message: error.message, fields: error.fields };
}

function refresh() {
  revalidatePath("/settings", "layout");
}

// --- Form sections -------------------------------------------------------------

/** On a failed save the submitted values come back, so the form keeps what was typed (never secrets). */
export type SettingsActionState = ActionState & { values?: Record<string, unknown> };

export async function saveSettingsSection(_previous: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const key = str(formData, "_section") ?? "";
  const section = settingsSection(key);
  if (!section) return { ok: false, message: "Άγνωστη ενότητα." };

  const values: Record<string, unknown> = {};
  for (const field of storedFields(section)) {
    if (field.readOnly) continue;
    if (field.type === "boolean") values[field.key] = formData.get(field.key) !== null;
    else if (field.type === "multiselect" || field.type === "weekdays") values[field.key] = formData.getAll(field.key).map(String);
    else values[field.key] = (formData.get(field.key) as string | null) ?? "";
  }

  const secrets: Record<string, string> = {};
  const clearSecrets: string[] = [];
  for (const field of section.fields.filter((f) => f.type === "secret")) {
    const value = formData.get(`secret.${field.key}`);
    if (typeof value === "string" && value.trim() !== "") secrets[field.key] = value;
    else if (formData.get(`clear.${field.key}`) !== null) clearSecrets.push(field.key);
  }

  const result = await apiFetch(`/api/settings/sections/${encodeURIComponent(key)}`, {
    method: "PUT",
    json: { values, ...(Object.keys(secrets).length ? { secrets } : {}), ...(clearSecrets.length ? { clearSecrets } : {}) },
  });
  if (!result.ok) return { ...fail(result.error), values };
  refresh();
  return { ok: true, message: "Οι ρυθμίσεις αποθηκεύτηκαν." };
}

export async function sendTestEmail(_previous: ActionState): Promise<ActionState> {
  const result = await apiFetch<{ delivered: boolean; message: string }>("/api/settings/email/test", { method: "POST", json: {} });
  if (!result.ok) return fail(result.error);
  refresh();
  return { ok: result.data.delivered, message: result.data.message };
}

// --- Permissions and notifications ---------------------------------------------

export async function togglePermission(formData: FormData): Promise<void> {
  await apiFetch("/api/settings/permissions", {
    method: "PUT",
    json: { role: str(formData, "role"), permission: str(formData, "permission"), granted: formData.get("granted") === "true" },
  });
  refresh();
}

export async function toggleNotification(formData: FormData): Promise<void> {
  await apiFetch("/api/settings/notifications", {
    method: "PUT",
    json: { event: str(formData, "event"), channel: str(formData, "channel"), enabled: formData.get("enabled") === "true" },
  });
  refresh();
}

// --- Property tags -------------------------------------------------------------

export async function createPropertyTag(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await apiFetch("/api/settings/property-tags", {
    method: "POST",
    json: {
      code: str(formData, "code") ?? "",
      labelEl: str(formData, "labelEl") ?? "",
      labelEn: str(formData, "labelEn") ?? "",
      color: str(formData, "color") ?? "slate",
    },
  });
  if (!result.ok) return fail(result.error);
  refresh();
  return { ok: true, message: "Η ετικέτα προστέθηκε." };
}

export async function updatePropertyTag(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, message: "Λείπει η ετικέτα." };
  const result = await apiFetch(`/api/settings/property-tags/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: {
      labelEl: str(formData, "labelEl") ?? "",
      labelEn: str(formData, "labelEn") ?? "",
      color: str(formData, "color") ?? "slate",
      active: formData.get("active") !== null,
    },
  });
  if (!result.ok) return fail(result.error);
  refresh();
  return { ok: true, message: "Αποθηκεύτηκε." };
}

// --- Areas ---------------------------------------------------------------------

export async function createArea(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await apiFetch("/api/settings/areas", {
    method: "POST",
    json: {
      level: str(formData, "level") ?? "",
      parentId: str(formData, "parentId") ?? "",
      nameEl: str(formData, "nameEl") ?? "",
      nameEn: str(formData, "nameEn") ?? "",
      slug: str(formData, "slug") ?? "",
    },
  });
  if (!result.ok) return fail(result.error);
  refresh();
  return { ok: true, message: "Η περιοχή προστέθηκε." };
}

export async function updateArea(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, message: "Λείπει η περιοχή." };
  const result = await apiFetch(`/api/settings/areas/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: {
      nameEl: str(formData, "nameEl") ?? "",
      nameEn: str(formData, "nameEn") ?? "",
      slug: str(formData, "slug") ?? "",
      active: formData.get("active") !== null,
    },
  });
  if (!result.ok) return fail(result.error);

  const mappings: Array<{ portalCode: string; externalId: string }> = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("map.") || typeof value !== "string" || !value.trim()) continue;
    mappings.push({ portalCode: name.slice(4), externalId: value.trim() });
  }
  const mapped = await apiFetch(`/api/settings/areas/${encodeURIComponent(id)}/mappings`, { method: "PUT", json: { mappings } });
  if (!mapped.ok) return fail(mapped.error);
  refresh();
  return { ok: true, message: "Αποθηκεύτηκε." };
}

// --- Portals ---------------------------------------------------------------------

export async function savePortal(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const code = str(formData, "_code") ?? "";
  const values: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const clearSecrets: string[] = [];
  for (const [name, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (name.startsWith("v.")) values[name.slice(2)] = value;
    else if (name.startsWith("secret.") && value.trim()) secrets[name.slice(7)] = value;
    else if (name.startsWith("clear.")) clearSecrets.push(name.slice(6));
  }
  const result = await apiFetch(`/api/settings/portals/${encodeURIComponent(code)}`, {
    method: "PUT",
    json: {
      enabled: formData.get("enabled") !== null,
      values,
      ...(Object.keys(secrets).length ? { secrets } : {}),
      ...(clearSecrets.length ? { clearSecrets: clearSecrets.filter((k) => !(k in secrets)) } : {}),
      rule: {
        mode: str(formData, "ruleMode") ?? "NONE",
        propertyTypes: formData.getAll("ruleTypes").map(String),
        includeTags: formData.getAll("ruleInclude").map(String),
        excludeTags: formData.getAll("ruleExclude").map(String),
      },
    },
  });
  if (!result.ok) return fail(result.error);
  refresh();
  return { ok: true, message: "Το portal αποθηκεύτηκε." };
}

// --- Mandate templates ---------------------------------------------------------

export async function createTemplateVersion(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const type = str(formData, "type") ?? "";
  const locale = str(formData, "locale") ?? "";
  const result = await apiFetch<{ version: { id: string } }>(
    `/api/settings/mandates/templates/${encodeURIComponent(type)}/${encodeURIComponent(locale)}/versions`,
    { method: "POST", json: { body: (formData.get("body") as string | null) ?? "", notes: str(formData, "notes") ?? "" } },
  );
  if (!result.ok) return fail(result.error);
  refresh();
  redirect(`/settings/mandates/versions/${result.data.version.id}`);
}

export async function updateTemplateVersion(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id") ?? "";
  const result = await apiFetch(`/api/settings/mandates/versions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: { body: (formData.get("body") as string | null) ?? "", notes: str(formData, "notes") ?? "" },
  });
  if (!result.ok) return fail(result.error);
  refresh();
  return { ok: true, message: "Η πρόχειρη έκδοση αποθηκεύτηκε." };
}

export async function activateTemplateVersion(formData: FormData): Promise<void> {
  const id = str(formData, "id") ?? "";
  await apiFetch(`/api/settings/mandates/versions/${encodeURIComponent(id)}/activate`, { method: "POST", json: {} });
  refresh();
}
