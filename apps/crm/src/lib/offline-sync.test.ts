import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { IDBFactory } from "fake-indexeddb";

import type { IntakeEdit, IntakeSession } from "./intake-client";
import { createOfflineStore, draftState, emptyDraft, planOps, type OfflineDraft } from "./offline-store";
import { backoff, createSync, localPhotoKey, type SyncApi } from "./offline-sync";

type Fail = { status: number; code: string; message: string; retryable: boolean };
const fail = (status: number, message = `HTTP ${status}`, code = "error"): Fail => ({ status, code, message, retryable: status >= 500 || status === 429 });

/** An in-memory stand-in for the intake API, with switches for the failures a phone meets. */
function fakeServer() {
  type S = { id: string; ref: string | null; status: IntakeSession["status"]; revision: number; fields: Record<string, string | number | boolean>; location: IntakeSession["location"]; turns: IntakeSession["turns"]; propertyId: string | null };
  const sessions = new Map<string, S>();
  const photos = new Map<string, number>();
  const calls: string[] = [];
  const sw = { offline: false, aiDown: false, authExpired: false, loseNextAnswer: "" as string, photoFailures: 0, refuseKey: "", editGate: null as Promise<void> | null };
  let n = 0;
  const dto = (s: S): IntakeSession => ({
    id: s.id, status: s.status, language: "el", revision: s.revision, propertyId: s.propertyId, stage: "collect", muted: false, photosLater: false, owner: null, canUndo: false,
    location: s.location, lang: "el", turns: s.turns, pending: [], asked: null,
    review: {
      rows: [], warnings: [], missing: [], ignored: [],
      blockers: s.fields.listingType && s.fields.propertyType && s.fields.titleEl && s.fields.descriptionEl ? [] : ["Συμπληρώστε τίτλο και περιγραφή."],
      ready: Boolean(s.fields.listingType && s.fields.propertyType && s.fields.titleEl && s.fields.descriptionEl),
    },
    fields: Object.fromEntries(Object.entries(s.fields).map(([k, value]) => [k, { value, origin: "AGENT_MANUAL" as const, confirmed: true }])),
    layout: null, catalog: [],
  });
  const gate = (name: string) => {
    calls.push(name);
    if (sw.offline) throw fail(0, "offline", "network");
    if (sw.authExpired) throw fail(401);
  };
  const lose = (name: string) => {
    if (sw.loseNextAnswer === name) {
      sw.loseNextAnswer = "";
      throw fail(0, "lost", "network");
    }
  };
  const own = (id: string) => {
    const s = sessions.get(id);
    if (!s) throw fail(404);
    return s;
  };
  const api: SyncApi = {
    async start(ref) {
      gate("start");
      let s = [...sessions.values()].find((x) => x.ref === ref);
      if (!s) {
        s = { id: `s${++n}`, ref, status: "ACTIVE", revision: 0, fields: {}, location: null, turns: [], propertyId: null };
        sessions.set(s.id, s);
      }
      lose("start");
      return dto(s);
    },
    async get(id) {
      gate("get");
      return dto(own(id));
    },
    async edit(id, edit: IntakeEdit, revision) {
      gate(`edit:${"key" in edit ? edit.key : edit.type}`);
      if (sw.editGate) await sw.editGate;
      const s = own(id);
      if (revision !== undefined && revision !== s.revision) throw fail(409);
      if (edit.type === "set") {
        if (edit.key === sw.refuseKey) throw fail(422, "Μη έγκυρη τιμή για αυτό το πεδίο.");
        s.fields[edit.key] = edit.value;
      } else if (edit.type === "clear") delete s.fields[edit.key];
      else if (edit.type === "location") s.location = "clear" in edit ? null : { lat: edit.lat, lng: edit.lng, accuracy: edit.accuracy ?? null, source: edit.source, visibility: edit.visibility, capturedAt: "", public: null };
      s.revision += 1;
      return dto(s);
    },
    async turn(id, text, revision) {
      gate("turn");
      if (sw.aiDown) throw fail(503, "Η φωνητική λειτουργία δεν είναι διαθέσιμη.");
      const s = own(id);
      if (revision !== s.revision) throw fail(409);
      s.turns.push({ role: "agent", text, at: "" });
      if (/95 τ/.test(text)) s.fields.area = 95;
      s.revision += 1;
      lose("turn");
      return dto(s);
    },
    async create(id, revision) {
      gate("create");
      const s = own(id);
      if (revision !== s.revision) throw fail(409);
      if (!dto(s).review.ready) throw fail(422, "Η καταχώριση δεν είναι έτοιμη.");
      if (!s.propertyId) {
        s.status = "CREATED";
        s.propertyId = `p-${s.id}`;
      }
      lose("create");
      return { session: dto(s), property: { id: s.propertyId, reference: `HM-${s.id}` } };
    },
    async uploadPhotos(_propertyId, sessionId) {
      gate("photos");
      const count = photos.get(sessionId) ?? 0;
      const failed = Math.min(count, sw.photoFailures);
      photos.set(sessionId, failed);
      return { uploaded: count - failed, failed };
    },
    async movePhotos(from, to) {
      if (photos.has(from)) {
        photos.set(to, photos.get(from)!);
        photos.delete(from);
      }
    },
    label: (key) => key,
  };
  return { api, sessions, photos, calls, sw };
}

const ready = { listingType: "SALE", propertyType: "APARTMENT", areaName: "Γλυφάδα", price: 250000, titleEl: "Διαμέρισμα στη Γλυφάδα", descriptionEl: "Φωτεινό διαμέρισμα." };

describe("offline drafts: the queue", () => {
  it("queues a start, each field, the save and the photos for a new draft", () => {
    const d = { ...emptyDraft(1), fields: { listingType: "SALE", area: 80 } };
    const plan = planOps(null, d, [], true, 1);
    assert.deepEqual(plan.add.map((o) => o.type), ["start", "set", "set", "create", "photos"]);
  });

  it("replaces a waiting change to the same field instead of stacking it, and drops a change undone", async () => {
    const store = createOfflineStore(new IDBFactory());
    const d = { ...emptyDraft(1), createWhenSynced: false, fields: { area: 80 } };
    await store.save(d, false, 1);
    await store.save({ ...d, fields: { area: 85 } }, false, 2);
    let ops = (await store.get(d.localId)).ops;
    assert.deepEqual(ops.map((o) => [o.type, o.payload?.value]), [["start", undefined], ["set", 85]]);
    await store.save({ ...d, fields: {} }, false, 3);
    ops = (await store.get(d.localId)).ops;
    assert.deepEqual(ops.map((o) => o.type), ["start"], "a field emptied before it was ever sent needs no operation");
  });

  it("continuing a server draft only queues what the agent changed", () => {
    const d: OfflineDraft = { ...emptyDraft(1), sessionId: "s1", createWhenSynced: false, base: { area: 90, city: "Αθήνα" }, fields: { area: 95, city: "Αθήνα" } };
    assert.deepEqual(planOps(null, d, [], false, 1).add.map((o) => [o.type, o.payload?.key]), [["set", "area"]]);
  });

  it("the save-as-property choice can be withdrawn", async () => {
    const store = createOfflineStore(new IDBFactory());
    const d = { ...emptyDraft(1), fields: { area: 80 } };
    await store.save(d, false, 1);
    await store.save({ ...d, createWhenSynced: false }, false, 2);
    assert.ok(!(await store.get(d.localId)).ops.some((o) => o.type === "create"));
  });

  it("retry waits grow and are capped", () => {
    assert.equal(backoff(1), 30_000);
    assert.equal(backoff(2), 60_000);
    assert.equal(backoff(20), 15 * 60_000);
  });
});

describe("offline drafts: the sync", () => {
  let store: ReturnType<typeof createOfflineStore>;
  let server: ReturnType<typeof fakeServer>;
  let sync: ReturnType<typeof createSync>;
  let clock: number;
  const now = () => clock;
  beforeEach(() => {
    store = createOfflineStore(new IDBFactory());
    server = fakeServer();
    sync = createSync(store, server.api);
    clock = 1_000_000;
  });
  const stateOf = async (localId: string) => {
    const { draft, ops } = await store.get(localId);
    return draftState(draft!, ops);
  };

  it("a complete draft becomes one property with its photos, and a second sync does nothing", async () => {
    const d = { ...emptyDraft(clock), fields: ready, location: { lat: 37.86, lng: 23.75, accuracy: 9, source: "gps" as const, visibility: "approximate" as const } };
    server.photos.set(localPhotoKey(d.localId), 3);
    await store.save(d, true, clock);
    assert.equal(await stateOf(d.localId), "waiting");
    const out = await sync.sync({ now });
    assert.equal(out.synced, 1);
    const s = [...server.sessions.values()];
    assert.equal(s.length, 1);
    assert.equal(s[0]!.status, "CREATED");
    assert.equal(s[0]!.fields.price, 250000);
    assert.equal(s[0]!.location?.visibility, "approximate");
    assert.equal(server.photos.get(s[0]!.id), 0, "photos moved with the draft and were uploaded");
    const { draft } = await store.get(d.localId);
    assert.equal(draft!.reference, `HM-${s[0]!.id}`);
    assert.equal(await stateOf(d.localId), "synced");
    const before = server.calls.length;
    await sync.sync({ now });
    assert.equal(server.calls.length, before, "nothing left to send");
  });

  it("no signal: everything stays on the device; the next sync finishes without duplicates", async () => {
    const d = { ...emptyDraft(clock), fields: ready };
    await store.save(d, false, clock);
    server.sw.offline = true;
    assert.equal((await sync.sync({ now })).stopped, "offline");
    assert.equal(server.sessions.size, 0);
    assert.equal(await stateOf(d.localId), "waiting");
    server.sw.offline = false;
    server.sw.loseNextAnswer = "start";
    assert.equal((await sync.sync({ now })).stopped, "offline", "the answer to start was lost on the way back");
    await sync.sync({ now });
    assert.equal(server.sessions.size, 1, "the retried start found the same draft");
    assert.equal([...server.sessions.values()][0]!.status, "CREATED");
  });

  it("a lost answer to the save does not create a second property", async () => {
    const d = { ...emptyDraft(clock), fields: ready };
    await store.save(d, false, clock);
    server.sw.loseNextAnswer = "create";
    await sync.sync({ now });
    await sync.sync({ now });
    const s = [...server.sessions.values()][0]!;
    assert.equal(s.propertyId, `p-${s.id}`);
    assert.equal((await store.get(d.localId)).draft!.propertyId, s.propertyId);
    assert.equal(await stateOf(d.localId), "synced");
  });

  it("a value someone else changed meanwhile is not overwritten: the agent decides", async () => {
    server.sessions.set("s9", { id: "s9", ref: null, status: "ACTIVE", revision: 4, fields: { area: 90, city: "Αθήνα" }, location: null, turns: [], propertyId: null });
    const d: OfflineDraft = { ...emptyDraft(clock), sessionId: "s9", createWhenSynced: false, base: { area: 90, city: "Αθήνα" }, fields: { area: 95, city: "Βούλα" } };
    await store.save(d, false, clock);
    server.sessions.get("s9")!.fields.area = 100; // changed on the desktop while the phone was offline
    await sync.sync({ now });
    assert.equal(server.sessions.get("s9")!.fields.area, 100, "not overwritten");
    assert.equal(server.sessions.get("s9")!.fields.city, "Βούλα", "the untouched field went through");
    assert.equal(await stateOf(d.localId), "conflict");
    const { draft } = await store.get(d.localId);
    assert.deepEqual(draft!.conflicts.map((c) => [c.key, c.mine, c.server]), [["area", 95, 100]]);

    await sync.resolve(d.localId, "area", "mine");
    await sync.sync({ now });
    assert.equal(server.sessions.get("s9")!.fields.area, 95, "the agent chose their value");
    assert.equal(await stateOf(d.localId), "synced");
  });

  it("a conflict settled while a sync is running stays settled", async () => {
    server.sessions.set("s9", { id: "s9", ref: null, status: "ACTIVE", revision: 0, fields: { area: 90, city: "Αθήνα" }, location: null, turns: [], propertyId: null });
    const d: OfflineDraft = { ...emptyDraft(clock), sessionId: "s9", createWhenSynced: false, base: { area: 90, city: "Αθήνα" }, fields: { area: 95, city: "Βούλα" } };
    await store.save(d, false, clock);
    server.sessions.get("s9")!.fields.area = 100;
    let open!: () => void;
    server.sw.editGate = new Promise((r) => { open = r; });
    const running = sync.sync({ now });
    // The run has flagged the conflict and is now waiting on the city edit; the agent decides meanwhile.
    for (let i = 0; i < 50 && (await store.get(d.localId)).draft!.conflicts.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    await sync.resolve(d.localId, "area", "server");
    open();
    server.sw.editGate = null;
    await running;
    const { draft } = await store.get(d.localId);
    assert.deepEqual(draft!.conflicts, [], "the running sync did not bring the settled conflict back");
    assert.equal(server.sessions.get("s9")!.fields.city, "Βούλα");
    assert.equal(server.sessions.get("s9")!.fields.area, 100);
  });

  it("keeping the server's value drops the agent's change", async () => {
    server.sessions.set("s9", { id: "s9", ref: null, status: "ACTIVE", revision: 0, fields: { area: 90 }, location: null, turns: [], propertyId: null });
    const d: OfflineDraft = { ...emptyDraft(clock), sessionId: "s9", createWhenSynced: false, base: { area: 90 }, fields: { area: 95 } };
    await store.save(d, false, clock);
    server.sessions.get("s9")!.fields.area = 100;
    await sync.sync({ now });
    await sync.resolve(d.localId, "area", "server");
    await sync.sync({ now });
    assert.equal(server.sessions.get("s9")!.fields.area, 100);
    assert.equal((await store.get(d.localId)).draft!.fields.area, 100);
    assert.equal(await stateOf(d.localId), "synced");
  });

  it("the assistant being unavailable delays the notes and the save, not the fields", async () => {
    const d = { ...emptyDraft(clock), fields: ready, notes: "Ρετιρέ 95 τ.μ. με θέα" };
    await store.save(d, false, clock);
    server.sw.aiDown = true;
    await sync.sync({ now });
    const s = [...server.sessions.values()][0]!;
    assert.equal(s.fields.price, 250000, "fields synced");
    assert.equal(s.status, "ACTIVE", "not saved before the notes are in");
    const note = (await store.get(d.localId)).ops.find((o) => o.type === "note")!;
    assert.equal(note.status, "pending");
    assert.ok(note.nextAttemptAt! > clock, "retried later, not hammered");
    await sync.sync({ now });
    assert.equal(server.calls.filter((c) => c === "turn").length, 1, "not before its retry time");
    server.sw.aiDown = false;
    clock += backoff(1) + 1;
    await sync.sync({ now });
    assert.equal(s.turns.filter((t) => t.text === "Ρετιρέ 95 τ.μ. με θέα").length, 1, "sent exactly once");
    assert.equal(s.fields.area, 95, "the assistant read the notes");
    assert.equal(s.status, "CREATED");
    const { draft } = await store.get(d.localId);
    assert.equal(draft!.notes, "");
    assert.deepEqual(draft!.sentNotes, ["Ρετιρέ 95 τ.μ. με θέα"]);
  });

  it("an incomplete draft reaches the CRM and waits for the agent there", async () => {
    const d = { ...emptyDraft(clock), fields: { listingType: "SALE", propertyType: "APARTMENT" } };
    await store.save(d, false, clock);
    await sync.sync({ now });
    const s = [...server.sessions.values()][0]!;
    assert.equal(s.status, "ACTIVE");
    assert.equal(await stateOf(d.localId), "review");
    const create = (await store.get(d.localId)).ops.find((o) => o.type === "create")!;
    assert.match(create.lastError!, /τίτλο/);
    // Completed later in the assistant, on any device: the next due sync picks it up.
    s.fields.titleEl = "Τίτλος";
    s.fields.descriptionEl = "Περιγραφή";
    clock += backoff(1) + 1;
    await sync.sync({ now });
    assert.equal(s.status, "CREATED");
    assert.equal(await stateOf(d.localId), "synced");
  });

  it("photos that fail stay on the device and are retried; the draft is not called synced before", async () => {
    const d = { ...emptyDraft(clock), fields: ready };
    server.photos.set(localPhotoKey(d.localId), 4);
    await store.save(d, true, clock);
    server.sw.photoFailures = 2;
    await sync.sync({ now });
    const sid = [...server.sessions.values()][0]!.id;
    assert.equal(server.photos.get(sid), 2);
    assert.notEqual(await stateOf(d.localId), "synced");
    server.sw.photoFailures = 0;
    await sync.sync({ now, manual: true });
    assert.equal(server.photos.get(sid), 0);
    assert.equal(await stateOf(d.localId), "synced");
  });

  it("a refused value is shown to the agent; the rest still syncs", async () => {
    const d = { ...emptyDraft(clock), createWhenSynced: false, fields: { listingType: "SALE", area: 80 } };
    await store.save(d, false, clock);
    server.sw.refuseKey = "area";
    await sync.sync({ now });
    const s = [...server.sessions.values()][0]!;
    assert.equal(s.fields.listingType, "SALE");
    assert.equal(await stateOf(d.localId), "review");
    const op = (await store.get(d.localId)).ops.find((o) => o.payload?.key === "area")!;
    assert.equal(op.status, "failed");
    assert.match(op.lastError!, /Μη έγκυρη/);
  });

  it("an operation cut off mid-request (page closed) is picked up again by the next run", async () => {
    const d = { ...emptyDraft(clock), createWhenSynced: false, fields: { area: 80 } };
    await store.save(d, false, clock);
    const { ops } = await store.get(d.localId);
    for (const o of ops) await store.putOp({ ...o, status: "syncing" });
    await sync.sync({ now });
    assert.equal([...server.sessions.values()][0]?.fields.area, 80);
    assert.equal(await stateOf(d.localId), "synced");
  });

  it("an expired login stops the sync and keeps everything", async () => {
    const d = { ...emptyDraft(clock), fields: ready };
    await store.save(d, false, clock);
    server.sw.authExpired = true;
    assert.equal((await sync.sync({ now })).stopped, "auth");
    assert.equal(server.sessions.size, 0);
    const ops = (await store.get(d.localId)).ops;
    assert.equal(ops.length, 8, "start, six fields, save");
    assert.ok(ops.every((o) => o.status === "pending"));
  });

  it("a draft finished on another device takes no more field changes", async () => {
    server.sessions.set("s5", { id: "s5", ref: null, status: "CREATED", revision: 9, fields: { area: 90 }, location: null, turns: [], propertyId: "p-5" });
    const d: OfflineDraft = { ...emptyDraft(clock), sessionId: "s5", base: { area: 90 }, fields: { area: 95 } };
    await store.save(d, false, clock);
    await sync.sync({ now });
    assert.equal(server.sessions.get("s5")!.fields.area, 90);
    const { draft } = await store.get(d.localId);
    assert.equal(draft!.propertyId, "p-5");
    assert.match(draft!.message!, /άλλη συσκευή/);
    assert.equal(await stateOf(d.localId), "review");
  });
});
