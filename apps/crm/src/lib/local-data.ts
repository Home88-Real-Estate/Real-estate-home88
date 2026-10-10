"use client";

/**
 * What the CRM keeps on this device, and clearing it at logout.
 *
 * Drafts saved offline, photos waiting to upload, unsent assistant text and the
 * service worker's copies of the app's own files. A shared phone or tablet must
 * not hand the next person someone else's drafts, so logout removes all of it,
 * after the agent has been told what has not reached the server yet.
 */

import { draftState, offlineStore } from "./offline-store";
import { photoStore } from "./pending-photos";

export async function unsyncedSummary(): Promise<{ drafts: number; photos: number }> {
  const [{ drafts, ops }, counts] = await Promise.all([offlineStore.list(), photoStore.counts()]);
  return {
    drafts: drafts.filter((d) => draftState(d, ops) !== "synced").length,
    photos: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

export async function wipeLocalData(): Promise<void> {
  await Promise.all([offlineStore.wipe(), photoStore.wipe()]);
  try {
    for (const key of Object.keys(window.localStorage)) if (key.startsWith("h88.intake.")) window.localStorage.removeItem(key);
  } catch {
    /* storage blocked: nothing was kept there either */
  }
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "h88:clear" });
    if ("caches" in window) for (const key of await caches.keys()) if (key.startsWith("h88-")) await caches.delete(key);
  } catch {
    /* the caches hold only the app's own static files */
  }
}

export function logoutWarning(s: { drafts: number; photos: number }): string | null {
  if (s.drafts === 0 && s.photos === 0) return null;
  const parts = [
    s.drafts > 0 ? `${s.drafts} ${s.drafts === 1 ? "καταχώριση που δεν έχει" : "καταχωρίσεις που δεν έχουν"} συγχρονιστεί` : null,
    s.photos > 0 ? `${s.photos} ${s.photos === 1 ? "φωτογραφία που δεν έχει" : "φωτογραφίες που δεν έχουν"} ανέβει` : null,
  ].filter(Boolean);
  return `Σε αυτή τη συσκευή υπάρχουν ${parts.join(" και ")}. Με την αποσύνδεση διαγράφονται από τη συσκευή. Συνέχεια;`;
}
