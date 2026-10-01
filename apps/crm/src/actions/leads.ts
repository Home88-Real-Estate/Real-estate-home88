"use server";

import { revalidatePath } from "next/cache";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

export async function changeLeadStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = str(formData, "leadId");
  const status = str(formData, "status");

  if (!leadId || !status) {
    return { ok: false, message: "Missing lead or status." };
  }

  const result = await apiFetch<{ lead: { id: string } }>(`/api/leads/${leadId}/status`, {
    method: "PATCH",
    json: {
      status,
      note: str(formData, "note"),
      lostReason: str(formData, "lostReason"),
    },
  });

  if (!result.ok) {
    return { ok: false, message: result.error.message, fields: result.error.fields };
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return { ok: true, message: "Status updated." };
}
