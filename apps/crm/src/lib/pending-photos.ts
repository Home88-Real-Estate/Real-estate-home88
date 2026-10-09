/**
 * Keeps the photos an agent has picked for a draft that is not saved yet, so
 * closing the tab, a reload or the phone killing the page does not lose them.
 *
 * They live in this browser's own IndexedDB, on this device only: nothing here
 * is sent anywhere, and the store is emptied as each photo is uploaded, when the
 * draft is abandoned, and after a week. Storage can be unavailable (private
 * mode) or full: every call then reports it and the screen works as before.
 */

export type StoredPhoto = { id: string; file: File };
export type SaveResult = "saved" | "unavailable" | "full";

type Row = { key: string; sessionId: string; id: string; position: number; name: string; type: string; lastModified: number; savedAt: number; blob: Blob };

const DB_NAME = "h88-intake";
const STORE = "photos";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("sessionId", "sessionId");
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

function isFull(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "QuotaExceededError";
}

export function createPhotoStore(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB) {
  async function withDb<T>(run: (db: IDBDatabase) => Promise<T>, fallback: T): Promise<T> {
    if (!factory) return fallback;
    let db: IDBDatabase;
    try {
      db = await open(factory);
    } catch {
      return fallback;
    }
    try {
      return await run(db);
    } catch {
      return fallback;
    } finally {
      db.close();
    }
  }

  return {
    /** Makes the stored photos for this draft exactly `files`, in this order. Photos already stored are not rewritten. */
    async save(sessionId: string, files: StoredPhoto[]): Promise<SaveResult> {
      if (!factory) return "unavailable";
      let db: IDBDatabase;
      try {
        db = await open(factory);
      } catch {
        return "unavailable";
      }
      try {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const existing = await wrap(store.index("sessionId").getAll(sessionId)) as Row[];
        const keep = new Map(files.map((f, i) => [`${sessionId}:${f.id}`, { f, position: i }]));
        for (const row of existing) if (!keep.has(row.key)) store.delete(row.key);
        const known = new Map(existing.map((r) => [r.key, r]));
        for (const [key, { f, position }] of keep) {
          const row = known.get(key);
          if (row) {
            if (row.position !== position) store.put({ ...row, position });
          } else {
            const record: Row = { key, sessionId, id: f.id, position, name: f.file.name, type: f.file.type, lastModified: f.file.lastModified, savedAt: Date.now(), blob: f.file };
            store.put(record);
          }
        }
        await done(tx);
        return "saved";
      } catch (error) {
        return isFull(error) ? "full" : "unavailable";
      } finally {
        db.close();
      }
    },

    /** The photos stored for this draft, in the order they were arranged. */
    load(sessionId: string): Promise<StoredPhoto[]> {
      return withDb(async (db) => {
        const rows = (await wrap(db.transaction(STORE).objectStore(STORE).index("sessionId").getAll(sessionId))) as Row[];
        return rows
          .sort((a, b) => a.position - b.position)
          .map((r) => ({ id: r.id, file: new File([r.blob], r.name, { type: r.type, lastModified: r.lastModified }) }));
      }, []);
    },

    /** Drops one photo (it has been uploaded). */
    remove(sessionId: string, id: string): Promise<void> {
      return withDb(async (db) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(`${sessionId}:${id}`);
        await done(tx);
      }, undefined);
    },

    /** Drops every photo of a draft. */
    clear(sessionId: string): Promise<void> {
      return withDb(async (db) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const keys = (await wrap(store.index("sessionId").getAllKeys(sessionId))) as string[];
        for (const key of keys) store.delete(key);
        await done(tx);
      }, undefined);
    },

    /** Forgets photos saved more than a week ago, whichever draft they belonged to. */
    purgeStale(now: number = Date.now()): Promise<number> {
      return withDb(async (db) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const rows = (await wrap(store.getAll())) as Row[];
        const stale = rows.filter((r) => r.savedAt <= now - WEEK_MS);
        for (const r of stale) store.delete(r.key);
        await done(tx);
        return stale.length;
      }, 0);
    },
  };
}

export const photoStore = createPhotoStore();
