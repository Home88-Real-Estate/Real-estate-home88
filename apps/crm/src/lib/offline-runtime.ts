"use client";

/**
 * The offline queue as the CRM pages use it: the real API behind the sync,
 * change notifications across components and tabs, and a hook for screens.
 */

import { useCallback, useEffect, useState } from "react";
import { CORE_FIELDS, CORE_FLAGS, DETAIL_FIELDS } from "@home88/domain";

import { browserIO, persistOrder } from "./browser-upload";
import { intakeApi } from "./intake-client";
import { offlineStore, pendingCount, type OfflineDraft, type OfflineOp } from "./offline-store";
import { createSync, type SyncApi, type SyncSummary } from "./offline-sync";
import { photoStore } from "./pending-photos";
import { uploadAll } from "./upload-queue";

const EVENT = "h88:offline";
const CHANNEL = "h88-offline";

const EXTRA_LABELS: Record<string, string> = {
  listingType: "Είδος αγγελίας", propertyType: "Τύπος ακινήτου", price: "Τιμή", monthlyRent: "Μηνιαίο μίσθωμα", priceOnRequest: "Τιμή κατόπιν επικοινωνίας",
  condition: "Κατάσταση ακινήτου", region: "Περιφέρεια", city: "Πόλη / Δήμος", areaName: "Περιοχή", neighborhood: "Γειτονιά", address: "Διεύθυνση",
  postalCode: "Τ.Κ.", titleEl: "Τίτλος (ελληνικά)", titleEn: "Τίτλος (αγγλικά)", descriptionEl: "Περιγραφή (ελληνικά)", descriptionEn: "Περιγραφή (αγγλικά)",
};

export function fieldName(key: string): string {
  return EXTRA_LABELS[key] ?? CORE_FIELDS[key]?.label ?? CORE_FLAGS[key]?.label ?? DETAIL_FIELDS[key]?.label ?? key;
}

let channel: BroadcastChannel | null = null;
function bus(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => window.dispatchEvent(new Event(EVENT));
  return channel;
}

/** Tells every screen (in this tab and others) that the queue changed. */
export function notifyOffline() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
  try {
    bus()?.postMessage("changed");
  } catch {
    /* another tab simply refreshes later */
  }
}

const api: SyncApi = {
  start: async (clientRef) => (await intakeApi.start("el", clientRef)).session,
  get: async (id) => (await intakeApi.get(id)).session,
  edit: async (id, edit, revision) => (await intakeApi.edit(id, edit, revision)).session,
  turn: async (id, text, revision) => (await intakeApi.turn(id, text, revision)).session,
  create: async (id, revision) => {
    const out = await intakeApi.create(id, revision);
    return { session: out.session, property: out.property };
  },
  async uploadPhotos(propertyId, sessionId) {
    const stored = await photoStore.load(sessionId);
    if (stored.length === 0) return { uploaded: 0, failed: 0 };
    const mediaIds: Array<string | undefined> = [];
    const result = await uploadAll(browserIO(propertyId), stored.map((p) => p.file), "PHOTO", (index, update) => {
      if (update.state !== "done") return;
      mediaIds[index] = update.mediaId;
      // Deleted from the device only once the server confirmed this photo.
      void photoStore.remove(sessionId, stored[index]!.id);
    });
    if (result.failed === 0 && mediaIds.length === stored.length && mediaIds.every(Boolean)) {
      await persistOrder(propertyId, mediaIds as string[]).catch(() => undefined);
    }
    return { uploaded: result.done, failed: result.failed };
  },
  movePhotos: (from, to) => photoStore.move(from, to),
  label: fieldName,
};

export const offlineSync = createSync(offlineStore, api, notifyOffline);

export type QueueView = {
  drafts: OfflineDraft[];
  ops: OfflineOp[];
  pending: number;
  online: boolean;
  syncing: boolean;
  last: SyncSummary | null;
  loaded: boolean;
  syncNow: () => Promise<void>;
  reload: () => Promise<void>;
};

/** The queue for a screen: refreshed on every change, with the connection state and a manual sync. */
export function useOfflineQueue(): QueueView {
  const [drafts, setDrafts] = useState<OfflineDraft[]>([]);
  const [ops, setOps] = useState<OfflineOp[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [last, setLast] = useState<SyncSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const out = await offlineStore.list();
    setDrafts(out.drafts);
    setOps(out.ops);
    setLoaded(true);
  }, []);

  useEffect(() => {
    bus();
    setOnline(navigator.onLine);
    void reload();
    const changed = () => void reload();
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener(EVENT, changed);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener(EVENT, changed);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [reload]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      setLast(await offlineSync.sync({ manual: true }));
    } finally {
      setSyncing(false);
      await reload();
    }
  }, [reload]);

  return { drafts, ops, pending: pendingCount(ops), online, syncing, last, loaded, syncNow, reload };
}

/**
 * Keeps the queue moving while any CRM page is open: on load, when the connection comes back, and every
 * minute while something waits. Rendered once, in the app shell.
 */
export function OfflineSyncAgent() {
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped || !navigator.onLine) return;
      const { ops } = await offlineStore.list();
      if (pendingCount(ops) === 0) return;
      await offlineSync.sync().catch(() => undefined);
    };
    void tick();
    const online = () => void tick();
    window.addEventListener("online", online);
    const timer = window.setInterval(() => void tick(), 60_000);
    return () => {
      stopped = true;
      window.removeEventListener("online", online);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
