"use server";

import { revalidatePath } from "next/cache";

import { apiFetch } from "@/lib/api";
import type { ActionState } from "@/lib/form";

/** Run the automations now (administrators). The same engine the scheduler runs. */
export async function runAutomationsNow(_p: ActionState): Promise<ActionState> {
  const r = await apiFetch<{ created: number }>("/api/automation/run", { method: "POST", json: {} });
  revalidatePath("/automation");
  revalidatePath("/reminders");
  if (!r.ok) return { ok: false, message: r.error.message };
  return { ok: true, message: r.data.created === 0 ? "Δεν βρέθηκε κάτι νέο." : `Δημιουργήθηκαν ${r.data.created} εργασίες.` };
}
