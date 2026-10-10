/**
 * Brings drafts saved on this device to the server, operation by operation.
 *
 *  - Idempotent: a draft is started with its device id (the server returns the
 *    same session for the same id), and saving as a property is one-shot on the
 *    server, so a retry after a lost answer never makes a duplicate.
 *  - Careful with other people's changes: a field is written only if the
 *    server still holds the value this device last saw (or already holds the
 *    agent's value). If someone changed it meanwhile, the operation waits as a
 *    conflict for the agent to decide; nothing is overwritten silently.
 *  - Patient with failures: no connection stops the run and keeps everything;
 *    a busy or unavailable server is retried later with growing waits; a value
 *    the server refuses is shown to the agent. Photos are deleted from the
 *    device only after each one is uploaded and confirmed.
 *  - One run at a time, across tabs (Web Locks where available).
 */

import type { IntakeEdit, IntakeSession } from "./intake-client";
import {
  draftState, sameLocation, type Conflict, type FieldValue, type OfflineDraft, type OfflineLocation, type OfflineOp, type OfflineStore,
} from "./offline-store";

export type ApiFailure = { status: number; code: string; message: string; retryable: boolean };

export type SyncApi = {
  start(clientRef: string): Promise<IntakeSession>;
  get(id: string): Promise<IntakeSession>;
  edit(id: string, edit: IntakeEdit, revision?: number): Promise<IntakeSession>;
  turn(id: string, text: string, revision: number): Promise<IntakeSession>;
  create(id: string, revision: number): Promise<{ session: IntakeSession; property: { id: string; reference: string } }>;
  /** Uploads the draft's photos kept on this device to the property; each one is removed from the device once confirmed. */
  uploadPhotos(propertyId: string, sessionId: string): Promise<{ uploaded: number; failed: number }>;
  /** Photos picked before the draft had a server session are kept under its device id; they move with it. */
  movePhotos(fromKey: string, toKey: string): Promise<void>;
  label(key: string): string;
};

export type SyncSummary = { ran: boolean; stopped: "offline" | "auth" | null; synced: number; waiting: number; attention: number };

export const localPhotoKey = (localId: string) => `local:${localId}`;

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;
export const backoff = (attempts: number) => Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));

class Stop extends Error {
  constructor(readonly reason: "offline" | "auth") {
    super(reason);
  }
}

function failure(error: unknown): ApiFailure {
  const e = error as Partial<ApiFailure> & { message?: string };
  return { status: typeof e?.status === "number" ? e.status : -1, code: e?.code ?? "error", message: e?.message ?? "Άγνωστο σφάλμα.", retryable: Boolean(e?.retryable) };
}

const valuesOf = (s: IntakeSession): Record<string, FieldValue> => Object.fromEntries(Object.entries(s.fields).map(([k, v]) => [k, v.value]));
const locationOf = (s: IntakeSession): OfflineLocation | null =>
  s.location ? { lat: s.location.lat, lng: s.location.lng, accuracy: s.location.accuracy, source: s.location.source, visibility: s.location.visibility } : null;
const same = (a: FieldValue | null | undefined, b: FieldValue | null | undefined) => (a ?? null) === (b ?? null);

const ORDER: Record<OfflineOp["type"], number> = { start: 0, set: 1, clear: 1, location: 1, note: 2, create: 3, photos: 4 };

export function createSync(store: OfflineStore, api: SyncApi, notify: () => void = () => undefined) {
  let running: Promise<SyncSummary> | null = null;

  async function save(op: OfflineOp, change: Partial<OfflineOp>) {
    Object.assign(op, change);
    await store.putOp(op);
    notify();
  }

  /** Runs one API call for an operation and sorts out what a failure means. Returns null when the call failed. */
  async function attempt<T>(op: OfflineOp, run: () => Promise<T>, now: () => number): Promise<{ ok: true; value: T } | { ok: false; error: ApiFailure }> {
    await save(op, { status: "syncing", lastAttemptAt: now() });
    try {
      return { ok: true, value: await run() };
    } catch (e) {
      const error = failure(e);
      if (error.status === 0) {
        await save(op, { status: "pending" });
        throw new Stop("offline");
      }
      if (error.status === 401) {
        await save(op, { status: "pending", lastError: "Συνδεθείτε ξανά για να συνεχιστεί ο συγχρονισμός." });
        throw new Stop("auth");
      }
      const attempts = op.attempts + 1;
      if (error.retryable || error.status === 503) {
        await save(op, { status: "pending", attempts, lastError: error.message, nextAttemptAt: now() + backoff(attempts) });
      } else {
        await save(op, { status: "failed", attempts, lastError: error.message, nextAttemptAt: null });
      }
      return { ok: false, error };
    }
  }

  async function syncDraft(draft: OfflineDraft, all: OfflineOp[], manual: boolean, now: () => number): Promise<void> {
    // Waiting operations run when their retry time has come; a refused save, note or photo upload is
    // looked at again later too (the agent may have completed the draft elsewhere), a refused value is not.
    const due = (o: OfflineOp) => {
      if (o.status === "pending") return manual || !o.nextAttemptAt || o.nextAttemptAt <= now();
      if (o.status === "failed" && (o.type === "create" || o.type === "photos" || o.type === "note")) return manual || (o.nextAttemptAt !== null && o.nextAttemptAt <= now());
      return false;
    };
    const ops = all.filter((o) => o.localId === draft.localId).sort((a, b) => ORDER[a.type] - ORDER[b.type] || a.seq - b.seq);
    if (!ops.some(due)) return;
    // The agent may edit the draft or settle a conflict while this run is busy, so a write never puts back
    // this run's whole (older) copy: only the parts the sync itself changed, on top of what is stored now.
    const dirty = new Set<keyof OfflineDraft>();
    let newConflicts: Conflict[] = [];
    let deliveredNote: string | null = null;
    const change = (patch: Partial<OfflineDraft>) => {
      Object.assign(draft, patch);
      for (const key of Object.keys(patch) as Array<keyof OfflineDraft>) dirty.add(key);
    };
    const put = async () => {
      const latest = (await store.get(draft.localId)).draft ?? draft;
      const merged: OfflineDraft = { ...latest };
      for (const key of dirty) (merged as Record<string, unknown>)[key] = draft[key];
      if (newConflicts.length > 0) merged.conflicts = [...latest.conflicts.filter((c) => !newConflicts.some((n) => n.key === c.key)), ...newConflicts];
      if (deliveredNote !== null) {
        merged.sentNotes = latest.sentNotes.includes(deliveredNote) ? latest.sentNotes : [...latest.sentNotes, deliveredNote];
        if (latest.notes.trim() === deliveredNote) merged.notes = "";
      }
      dirty.clear();
      newConflicts = [];
      deliveredNote = null;
      Object.assign(draft, { conflicts: merged.conflicts, notes: merged.notes, sentNotes: merged.sentNotes, fields: merged.fields });
      await store.putDraft(merged);
      notify();
    };

    // 1. The server session: started once, with the device's id.
    let session: IntakeSession;
    const start = ops.find((o) => o.type === "start" && o.status !== "done");
    if (!draft.sessionId) {
      if (!start) return;
      const r = await attempt(start, () => api.start(draft.localId), now);
      if (!r.ok) return;
      session = r.value;
      change({ sessionId: session.id });
      await api.movePhotos(localPhotoKey(draft.localId), session.id).catch(() => undefined);
      await save(start, { status: "done", lastError: null });
      await put();
    } else {
      if (start && start.status !== "done") await save(start, { status: "done", lastError: null });
      const probe = ops.find(due)!;
      const r = await attempt(probe, () => api.get(draft.sessionId!), now);
      if (!r.ok) {
        if (r.error.status === 404) {
          change({ message: "Η καταχώριση δεν βρέθηκε στο CRM. Ελέγξτε τα στοιχεία και αποθηκεύστε τη ξανά ως νέα." });
          await put();
        }
        return;
      }
      session = r.value;
      if (probe.status === "syncing") await save(probe, { status: "pending" });
    }

    // 2. A draft finished or dropped on another device takes no more field changes.
    if (session.status !== "ACTIVE") {
      if (session.propertyId) change({ propertyId: session.propertyId });
      const why = session.status === "CREATED"
        ? "Η καταχώριση αποθηκεύτηκε ήδη ως ακίνητο από άλλη συσκευή· οι υπόλοιπες αλλαγές γίνονται πλέον από την καρτέλα του ακινήτου."
        : "Η καταχώριση ακυρώθηκε σε άλλη συσκευή.";
      for (const o of ops) {
        if (o.status === "done") continue;
        if (o.type === "create" && session.status === "CREATED") await save(o, { status: "done", lastError: null });
        else if (o.type === "photos" && session.status === "CREATED") continue;
        else await save(o, { status: "failed", lastError: why });
      }
      change({ message: why });
      await put();
      if (session.status !== "CREATED") return;
    }

    // 3. Someone else's change since this device last looked becomes a conflict, decided up front.
    const server = valuesOf(session);
    const conflicts: Conflict[] = [];
    for (const o of ops) {
      if (!due(o) || session.status !== "ACTIVE") continue;
      if (o.type === "set" || o.type === "clear") {
        const key = String(o.payload?.key);
        const mine = o.type === "set" ? (o.payload?.value as FieldValue) : null;
        if (same(server[key], mine)) await save(o, { status: "done", lastError: null });
        else if (!same(server[key], draft.base[key])) {
          await save(o, { status: "conflict", lastError: "Η τιμή άλλαξε στο CRM όσο ήσασταν εκτός σύνδεσης." });
          conflicts.push({ key, label: api.label(key), mine, server: server[key] ?? null });
        }
      } else if (o.type === "location") {
        const mine = (o.payload as OfflineLocation | null) ?? null;
        const there = locationOf(session);
        if (sameLocation(there, mine)) await save(o, { status: "done", lastError: null });
        else if (!sameLocation(there, draft.baseLocation)) {
          await save(o, { status: "conflict", lastError: "Η θέση άλλαξε στο CRM όσο ήσασταν εκτός σύνδεσης." });
          conflicts.push({ key: "__location", label: "Θέση ακινήτου", mine: mine ? `${mine.lat}, ${mine.lng}` : null, server: there ? `${there.lat}, ${there.lng}` : null });
        }
      }
    }
    if (conflicts.length > 0) {
      newConflicts = conflicts;
      await put();
    }

    const adopt = (next: IntakeSession) => {
      session = next;
      change({ base: valuesOf(next), baseLocation: locationOf(next) });
    };

    // 4. The agent's own values, then the notes for the assistant, then saving, then photos.
    for (const o of ops) {
      if (!due(o) || o.status === "conflict" || o.status === "done") continue;
      if (session.status !== "ACTIVE" && o.type !== "photos") continue;
      if (o.type === "set" || o.type === "clear" || o.type === "location") {
        const edit: IntakeEdit =
          o.type === "set" ? { type: "set", key: String(o.payload!.key), value: o.payload!.value as FieldValue }
          : o.type === "clear" ? { type: "clear", key: String(o.payload!.key) }
          : o.payload ? { type: "location", ...(o.payload as OfflineLocation) } : { type: "location", clear: true };
        let r = await attempt(o, () => api.edit(session.id, edit, session.revision), now);
        if (!r.ok && r.error.status === 409) {
          // The session moved on (another tab or device): look again before writing.
          const fresh = await attempt(o, () => api.get(session.id), now);
          if (!fresh.ok) return;
          const key = o.type === "location" ? null : String(o.payload!.key);
          const changed = key ? !same(valuesOf(fresh.value)[key], draft.base[key]) : !sameLocation(locationOf(fresh.value), draft.baseLocation);
          session = fresh.value;
          if (changed) {
            await save(o, { status: "conflict", lastError: "Η τιμή άλλαξε στο CRM όσο ήσασταν εκτός σύνδεσης." });
            continue;
          }
          r = await attempt(o, () => api.edit(session.id, edit, session.revision), now);
        }
        if (!r.ok) {
          if (r.error.retryable || r.error.status === 503) return;
          continue;
        }
        adopt(r.value);
        await save(o, { status: "done", lastError: null, nextAttemptAt: null });
        await put();
      } else if (o.type === "note") {
        const text = String(o.payload?.text ?? "");
        let r = await attempt(o, () => api.turn(session.id, text, session.revision), now);
        if (!r.ok && r.error.status === 409) {
          const fresh = await attempt(o, () => api.get(session.id), now);
          if (!fresh.ok) return;
          session = fresh.value;
          // The first try may have arrived and only its answer been lost.
          if (session.turns.some((t) => t.role === "agent" && t.text === text)) r = { ok: true, value: session };
          else r = await attempt(o, () => api.turn(session.id, text, session.revision), now);
        }
        if (!r.ok) {
          if (r.error.status === 503) await save(o, { lastError: "Η φωνητική βοήθεια δεν είναι διαθέσιμη τώρα· οι σημειώσεις θα σταλούν αργότερα." });
          continue;
        }
        adopt(r.value);
        deliveredNote = text;
        await save(o, { status: "done", lastError: null, nextAttemptAt: null });
        await put();
      } else if (o.type === "create") {
        if (ops.some((x) => x !== o && x.type !== "photos" && x.status !== "done")) {
          await save(o, { lastError: "Θα αποθηκευτεί ως ακίνητο μόλις συγχρονιστούν τα υπόλοιπα στοιχεία." });
          continue;
        }
        if (!session.review.ready) {
          const why = `Για να αποθηκευτεί ως ακίνητο: ${session.review.blockers.join(" ")}`.trim();
          await save(o, { status: "failed", attempts: o.attempts + 1, lastError: why, nextAttemptAt: now() + backoff(o.attempts + 1) });
          change({ message: "Το πρόχειρο είναι στο CRM. Ανοίξτε το για να το ολοκληρώσετε και να το αποθηκεύσετε ως ακίνητο." });
          await put();
          continue;
        }
        const r = await attempt(o, () => api.create(session.id, session.revision), now);
        if (!r.ok) continue;
        session = r.value.session;
        change({ propertyId: r.value.property.id, reference: r.value.property.reference, message: null });
        await save(o, { status: "done", lastError: null, nextAttemptAt: null });
        await put();
      } else if (o.type === "photos") {
        if (!draft.propertyId) continue;
        const propertyId = draft.propertyId;
        const r = await attempt(o, () => api.uploadPhotos(propertyId, session.id), now);
        if (!r.ok) continue;
        if (r.value.failed > 0) {
          const attempts = o.attempts + 1;
          await save(o, { status: "pending", attempts, lastError: `${r.value.failed} φωτογραφίες δεν ανέβηκαν ακόμη· θα ξαναδοκιμαστούν.`, nextAttemptAt: now() + backoff(attempts) });
        } else await save(o, { status: "done", lastError: null, nextAttemptAt: null });
      }
    }

    // 5. Once everything the agent entered is on the server, the device shows what the server holds.
    const left = (await store.get(draft.localId)).ops;
    if (left.every((o) => o.type === "photos" || o.type === "create" || o.status === "done")) change({ fields: { ...draft.base } });
    change({ lastSyncedAt: now() });
    await put();
  }

  async function run(manual: boolean, now: () => number): Promise<SyncSummary> {
    const listed = await store.list();
    // Only one run at a time holds the lock, so anything still marked as in flight was cut off (the page was
    // closed mid-request). It goes back to waiting; the checks before each write make the retry safe.
    for (const o of listed.ops) if (o.status === "syncing") await store.putOp({ ...o, status: "pending", nextAttemptAt: null });
    const { drafts, ops } = await store.list();
    let stopped: SyncSummary["stopped"] = null;
    for (const draft of drafts) {
      try {
        await syncDraft(draft, ops, manual, now);
      } catch (e) {
        if (e instanceof Stop) {
          stopped = e.reason;
          break;
        }
        const latest = (await store.get(draft.localId).catch(() => ({ draft: null }))).draft;
        if (latest) await store.putDraft({ ...latest, message: "Κάτι πήγε στραβά στον συγχρονισμό· θα ξαναδοκιμαστεί." }).catch(() => undefined);
      }
    }
    const after = await store.list();
    const states = after.drafts.map((d) => draftState(d, after.ops));
    notify();
    return {
      ran: true,
      stopped,
      synced: states.filter((s) => s === "synced").length,
      waiting: states.filter((s) => s === "waiting" || s === "failed" || s === "local").length,
      attention: states.filter((s) => s === "conflict" || s === "review").length,
    };
  }

  return {
    /** Runs a sync unless one is already running here or in another tab. `manual` ignores the retry waits. */
    sync(options: { manual?: boolean; now?: () => number } = {}): Promise<SyncSummary> {
      if (running) return running;
      const now = options.now ?? Date.now;
      const go = () => run(Boolean(options.manual), now);
      const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
      running = (locks
        ? (locks.request("h88-offline-sync", { ifAvailable: true }, (lock) => (lock ? go() : { ran: false, stopped: null, synced: 0, waiting: 0, attention: 0 })) as Promise<SyncSummary>)
        : go()
      ).finally(() => {
        running = null;
      });
      return running;
    },

    /** The agent's decision on a conflict: keep their value (it will be written) or take the server's. */
    async resolve(localId: string, key: string, keep: "mine" | "server"): Promise<void> {
      const { draft, ops } = await store.get(localId);
      if (!draft) return;
      const conflict = draft.conflicts.find((c) => c.key === key);
      for (const o of ops) {
        const matches = key === "__location" ? o.type === "location" : (o.type === "set" || o.type === "clear") && o.payload?.key === key;
        if (!matches || o.status !== "conflict") continue;
        if (keep === "mine") await store.putOp({ ...o, status: "pending", lastError: null, nextAttemptAt: null });
        else await store.putOp({ ...o, status: "done", lastError: "Κρατήθηκε η τιμή του CRM." });
      }
      if (conflict && key !== "__location") {
        if (keep === "mine") draft.base = { ...draft.base, [key]: conflict.server as FieldValue };
        else if (conflict.server === null) {
          const { [key]: _gone, ...rest } = draft.fields;
          draft.fields = rest;
        } else draft.fields = { ...draft.fields, [key]: conflict.server };
        if (keep === "mine" && conflict.server === null) {
          const { [key]: _gone, ...rest } = draft.base;
          draft.base = rest;
        }
      }
      if (key === "__location" && keep === "mine") {
        const fresh = await api.get(draft.sessionId!).catch(() => null);
        if (fresh) draft.baseLocation = locationOf(fresh);
      }
      draft.conflicts = draft.conflicts.filter((c) => c.key !== key);
      await store.putDraft(draft);
      notify();
    },
  };
}
