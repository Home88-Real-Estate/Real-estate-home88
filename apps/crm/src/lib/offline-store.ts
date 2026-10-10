/**
 * Property drafts kept on this device while there is no connection, and the
 * queue of operations that will bring them to the server.
 *
 * Everything lives in this browser's IndexedDB, on this device only. A draft
 * holds what the agent entered; each change becomes an operation (start the
 * draft, set a field, send notes, set the location, save as a property, upload
 * photos) with its own id, status, retry count, last error and last attempt.
 * The sync (offline-sync.ts) works through them; nothing here talks to the
 * network. Photos stay in the photo store (pending-photos.ts), keyed by the
 * draft, until they are uploaded.
 *
 * Logout clears all of it (local-data.ts), after warning the agent about
 * anything not yet synced.
 */

export type FieldValue = string | number | boolean;
export type LocationVisibility = "exact" | "approximate" | "private";
export type OfflineLocation = {
  lat: number;
  lng: number;
  accuracy: number | null;
  source: "gps" | "map" | "manual";
  visibility: LocationVisibility;
};

export type OpType = "start" | "set" | "clear" | "location" | "note" | "create" | "photos";
export type OpStatus = "pending" | "syncing" | "done" | "failed" | "conflict";

export type OfflineOp = {
  opId: string;
  /** The draft (entity) this operation belongs to. */
  localId: string;
  type: OpType;
  /** set/clear: { key, value? }; location: OfflineLocation | null; note: { text }; others: {}. */
  payload: Record<string, unknown> | null;
  seq: number;
  createdAt: number;
  status: OpStatus;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number | null;
  /** Automatic retries wait until then; "Συγχρονισμός τώρα" does not. */
  nextAttemptAt: number | null;
};

export type Conflict = { key: string; label: string; mine: FieldValue | null; server: FieldValue | null };

export type OfflineDraft = {
  localId: string;
  createdAt: number;
  updatedAt: number;
  /** The server's intake session, once it exists (or the one the agent was in when the signal dropped). */
  sessionId: string | null;
  /** Field values as the server last showed them to this device: what "someone else changed it" is measured against. */
  base: Record<string, FieldValue>;
  baseLocation: OfflineLocation | null;
  /** What the agent entered here, as the draft should end up. */
  fields: Record<string, FieldValue>;
  /** Free text for the assistant, sent once as a message when the draft syncs. */
  notes: string;
  /** Notes already delivered (shown, no longer editable). */
  sentNotes: string[];
  location: OfflineLocation | null;
  /** Save it as a draft property as soon as it reaches the server (if it is complete enough). */
  createWhenSynced: boolean;
  propertyId: string | null;
  reference: string | null;
  conflicts: Conflict[];
  /** The latest thing the agent should know about this draft's sync, in Greek. */
  message: string | null;
  lastSyncedAt: number | null;
};

export type DraftState = "local" | "waiting" | "syncing" | "synced" | "failed" | "conflict" | "review";

export const STATE_LABEL: Record<DraftState, string> = {
  local: "Αποθηκεύτηκε στη συσκευή",
  waiting: "Εκκρεμεί συγχρονισμός",
  syncing: "Συγχρονισμός…",
  synced: "Συγχρονίστηκε",
  failed: "Δεν ολοκληρώθηκε· νέα προσπάθεια σε λίγο",
  conflict: "Σύγκρουση: χρειάζεται έλεγχο",
  review: "Χρειάζεται έλεγχο",
};

/** One status for a draft, from its operations; a draft is "synced" only once the server confirmed every one. */
export function draftState(draft: OfflineDraft, ops: OfflineOp[], online = true): DraftState {
  const mine = ops.filter((o) => o.localId === draft.localId);
  if (mine.some((o) => o.status === "syncing")) return "syncing";
  if (draft.conflicts.length > 0 || mine.some((o) => o.status === "conflict")) return "conflict";
  if (mine.some((o) => o.status === "failed")) return "review";
  const open = mine.filter((o) => o.status === "pending");
  if (open.length === 0) return "synced";
  if (open.some((o) => o.attempts > 0 && o.lastError)) return online ? "failed" : "waiting";
  return online ? "waiting" : "local";
}

export const pendingCount = (ops: OfflineOp[]) => ops.filter((o) => o.status === "pending" || o.status === "syncing" || o.status === "failed" || o.status === "conflict").length;

const DB_NAME = "h88-offline";
const DRAFTS = "drafts";
const OPS = "ops";

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(DRAFTS, { keyPath: "localId" });
      db.createObjectStore(OPS, { keyPath: "opId" }).createIndex("localId", "localId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  });
const wrap = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function emptyDraft(now = Date.now()): OfflineDraft {
  return {
    localId: newId(), createdAt: now, updatedAt: now, sessionId: null, base: {}, baseLocation: null, fields: {}, notes: "", sentNotes: [],
    location: null, createWhenSynced: true, propertyId: null, reference: null, conflicts: [], message: null, lastSyncedAt: null,
  };
}

const sameValue = (a: FieldValue | null | undefined, b: FieldValue | null | undefined) => (a ?? null) === (b ?? null);
export const sameLocation = (a: OfflineLocation | null, b: OfflineLocation | null) =>
  (a === null && b === null) || (a !== null && b !== null && a.lat === b.lat && a.lng === b.lng && a.visibility === b.visibility);

function op(localId: string, type: OpType, payload: OfflineOp["payload"], seq: number, now: number): OfflineOp {
  return { opId: newId(), localId, type, payload, seq, createdAt: now, status: "pending", attempts: 0, lastError: null, lastAttemptAt: null, nextAttemptAt: null };
}

/**
 * The operations that take the queue from `before` (what was saved last time, or null for a new draft) to
 * `after`. Operations still waiting for the same field are replaced rather than stacked, so the queue
 * stays short however often the agent saves.
 */
export function planOps(before: OfflineDraft | null, after: OfflineDraft, queued: OfflineOp[], hasPhotos: boolean, now = Date.now()): { add: OfflineOp[]; drop: string[] } {
  const add: OfflineOp[] = [];
  const drop: string[] = [];
  const open = queued.filter((o) => o.localId === after.localId && (o.status === "pending" || o.status === "failed"));
  let seq = Math.max(0, ...queued.filter((o) => o.localId === after.localId).map((o) => o.seq)) + 1;
  const next = (type: OpType, payload: OfflineOp["payload"]) => add.push(op(after.localId, type, payload, seq++, now));

  if (!before && !after.sessionId && !queued.some((o) => o.localId === after.localId && o.type === "start")) next("start", {});

  const keys = new Set([...Object.keys(before?.fields ?? {}), ...Object.keys(after.fields)]);
  for (const key of keys) {
    const was = before ? before.fields[key] : after.base[key];
    const now = after.fields[key];
    if (sameValue(was, now)) continue;
    for (const o of open) if ((o.type === "set" || o.type === "clear") && o.payload?.key === key) drop.push(o.opId);
    if (sameValue(now, after.base[key]) && !queued.some((o) => o.localId === after.localId && o.status === "done" && (o.type === "set" || o.type === "clear") && o.payload?.key === key)) continue;
    if (now === undefined || now === "") next("clear", { key });
    else next("set", { key, value: now });
  }

  const wasLocation = before ? before.location : after.baseLocation;
  if (!sameLocation(wasLocation, after.location)) {
    for (const o of open) if (o.type === "location") drop.push(o.opId);
    if (!sameLocation(after.location, after.baseLocation)) next("location", after.location ? { ...after.location } : null);
  }

  if ((before?.notes ?? "") !== after.notes) {
    for (const o of open) if (o.type === "note") drop.push(o.opId);
    if (after.notes.trim()) next("note", { text: after.notes.trim() });
  }

  if (!after.createWhenSynced) for (const o of open) if (o.type === "create") drop.push(o.opId);
  const hasCreate = queued.some((o) => o.localId === after.localId && o.type === "create" && !drop.includes(o.opId));
  if (after.createWhenSynced && !after.propertyId && !hasCreate) next("create", {});

  const hasPhotosOp = open.some((o) => o.type === "photos");
  if (hasPhotos && !hasPhotosOp && (after.createWhenSynced || after.propertyId)) next("photos", {});
  return { add, drop: [...new Set(drop)] };
}

export function createOfflineStore(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB) {
  async function withDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
    if (!factory) throw new Error("unavailable");
    const db = await open(factory);
    try {
      return await run(db);
    } finally {
      db.close();
    }
  }

  return {
    available: () => Boolean(factory),

    async list(): Promise<{ drafts: OfflineDraft[]; ops: OfflineOp[] }> {
      if (!factory) return { drafts: [], ops: [] };
      try {
        return await withDb(async (db) => {
          const tx = db.transaction([DRAFTS, OPS]);
          const [drafts, ops] = await Promise.all([wrap(tx.objectStore(DRAFTS).getAll()), wrap(tx.objectStore(OPS).getAll())]);
          return {
            drafts: (drafts as OfflineDraft[]).sort((a, b) => b.updatedAt - a.updatedAt),
            ops: (ops as OfflineOp[]).sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt),
          };
        });
      } catch {
        return { drafts: [], ops: [] };
      }
    },

    async get(localId: string): Promise<{ draft: OfflineDraft | null; ops: OfflineOp[] }> {
      return withDb(async (db) => {
        const tx = db.transaction([DRAFTS, OPS]);
        const draft = (await wrap(tx.objectStore(DRAFTS).get(localId))) as OfflineDraft | undefined;
        const ops = (await wrap(tx.objectStore(OPS).index("localId").getAll(localId))) as OfflineOp[];
        return { draft: draft ?? null, ops: ops.sort((a, b) => a.seq - b.seq) };
      });
    },

    /**
     * Saves what the agent entered and queues what changed since it was last saved, in one transaction.
     * Only the agent's own parts (fields, notes, location, the save-as-property choice) are taken from
     * `edited`; what the sync recorded (session, server values, conflicts, result) is kept as stored.
     */
    async save(edited: OfflineDraft, hasPhotos: boolean, now = Date.now()): Promise<OfflineDraft> {
      return withDb(async (db) => {
        const tx = db.transaction([DRAFTS, OPS], "readwrite");
        const drafts = tx.objectStore(DRAFTS);
        const ops = tx.objectStore(OPS);
        const before = ((await wrap(drafts.get(edited.localId))) as OfflineDraft | undefined) ?? null;
        const after: OfflineDraft = before
          ? {
              ...before,
              fields: edited.fields,
              // Notes the sync already delivered are not sent twice by a screen that had not refreshed yet.
              notes: before.sentNotes.includes(edited.notes.trim()) ? "" : edited.notes,
              location: edited.location,
              createWhenSynced: edited.createWhenSynced,
            }
          : edited;
        const queued = (await wrap(ops.index("localId").getAll(after.localId))) as OfflineOp[];
        const plan = planOps(before, after, queued, hasPhotos, now);
        for (const id of plan.drop) ops.delete(id);
        for (const o of plan.add) ops.put(o);
        const saved = { ...after, updatedAt: now, conflicts: after.conflicts.filter((c) => plan.add.every((o) => o.payload?.key !== c.key)) };
        drafts.put(saved);
        await done(tx);
        return saved;
      });
    },

    async putDraft(draft: OfflineDraft): Promise<void> {
      await withDb(async (db) => {
        const tx = db.transaction(DRAFTS, "readwrite");
        tx.objectStore(DRAFTS).put(draft);
        await done(tx);
      });
    },

    async putOp(o: OfflineOp): Promise<void> {
      await withDb(async (db) => {
        const tx = db.transaction(OPS, "readwrite");
        tx.objectStore(OPS).put(o);
        await done(tx);
      });
    },

    /** Removes a draft and its queue (after it synced, or when the agent discards it). */
    async remove(localId: string): Promise<void> {
      await withDb(async (db) => {
        const tx = db.transaction([DRAFTS, OPS], "readwrite");
        tx.objectStore(DRAFTS).delete(localId);
        const ops = tx.objectStore(OPS);
        for (const key of (await wrap(ops.index("localId").getAllKeys(localId))) as string[]) ops.delete(key);
        await done(tx);
      });
    },

    /** Everything, for logout. */
    async wipe(): Promise<void> {
      if (!factory) return;
      await withDb(async (db) => {
        const tx = db.transaction([DRAFTS, OPS], "readwrite");
        tx.objectStore(DRAFTS).clear();
        tx.objectStore(OPS).clear();
        await done(tx);
      }).catch(() => undefined);
    },
  };
}

export type OfflineStore = ReturnType<typeof createOfflineStore>;
export const offlineStore = createOfflineStore();
