"use server";

import { revalidatePath } from "next/cache";

import type { ChannelOperation, ChannelRequest, PublicationsOperationResponse } from "@home88/domain";

import { apiFetch } from "@/lib/api";

const OPERATIONS: ChannelOperation[] = ["validate", "preview", "publish", "update", "unpublish"];

export type PublicationActionState = { ran?: PublicationsOperationResponse; error?: string };

/**
 * One request for the selected channels. The server decides, per channel, whether
 * it may run; a denied or failed channel never stops the others.
 */
export async function publicationOperation(_p: PublicationActionState, formData: FormData): Promise<PublicationActionState> {
  const propertyId = String(formData.get("propertyId") ?? "");
  const operation = String(formData.get("op") ?? "") as ChannelOperation;
  if (!OPERATIONS.includes(operation)) return { error: "Άγνωστη ενέργεια." };
  const channels: ChannelRequest[] = [];
  for (const code of formData.getAll("channel").map(String)) {
    const accountId = String(formData.get(`account.${code}`) ?? "");
    const environment = String(formData.get(`environment.${code}`) ?? "");
    channels.push(code === "WEBSITE" ? { code } : { code, accountId, environment: environment === "PRODUCTION" ? "PRODUCTION" : "TEST" });
  }
  if (channels.length === 0) return { error: "Επιλέξτε τουλάχιστον ένα κανάλι." };
  const result = await apiFetch<PublicationsOperationResponse>(`/api/properties/${encodeURIComponent(propertyId)}/publications/${operation}`, {
    method: "POST",
    json: { channels, force: formData.get("force") === "1" ? true : undefined },
  });
  revalidatePath(`/properties/${propertyId}`);
  if (!result.ok) return { error: result.error.message };
  return { ran: result.data };
}
