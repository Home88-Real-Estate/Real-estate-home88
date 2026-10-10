import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { IDBFactory } from "fake-indexeddb";

import { createPhotoStore } from "./pending-photos";

const photo = (id: string, content = id) => ({ id, file: new File([content], `${id}.jpg`, { type: "image/jpeg", lastModified: 1_700_000_000_000 }) });
const text = (f: File) => f.text();

describe("photos kept across a closed tab", () => {
  let store: ReturnType<typeof createPhotoStore>;
  beforeEach(() => {
    store = createPhotoStore(new IDBFactory());
  });

  it("returns the photos of a draft in the order they were arranged, with their name, type and date", async () => {
    assert.equal(await store.save("s1", [photo("a", "AAA"), photo("b", "BBBB")]), "saved");
    const back = await store.load("s1");
    assert.deepEqual(back.map((p) => p.id), ["a", "b"]);
    assert.equal(back[0]!.file.name, "a.jpg");
    assert.equal(back[0]!.file.type, "image/jpeg");
    assert.equal(back[0]!.file.lastModified, 1_700_000_000_000);
    assert.equal(await text(back[1]!.file), "BBBB");
  });

  it("follows later changes: reordering, removing and adding", async () => {
    await store.save("s1", [photo("a"), photo("b"), photo("c")]);
    await store.save("s1", [photo("c"), photo("a"), photo("d")]);
    assert.deepEqual((await store.load("s1")).map((p) => p.id), ["c", "a", "d"]);
  });

  it("keeps drafts apart", async () => {
    await store.save("s1", [photo("a")]);
    await store.save("s2", [photo("x"), photo("y")]);
    assert.deepEqual((await store.load("s1")).map((p) => p.id), ["a"]);
    await store.clear("s1");
    assert.deepEqual(await store.load("s1"), []);
    assert.deepEqual((await store.load("s2")).map((p) => p.id), ["x", "y"], "clearing one draft leaves the others");
  });

  it("drops a photo once it has been uploaded", async () => {
    await store.save("s1", [photo("a"), photo("b")]);
    await store.remove("s1", "a");
    assert.deepEqual((await store.load("s1")).map((p) => p.id), ["b"]);
  });

  it("forgets photos older than a week and nothing newer", async () => {
    await store.save("keep", [photo("k")]);
    assert.equal(await store.purgeStale(Date.now() + 60 * 60 * 1000), 0, "an hour later nothing is stale");
    assert.equal((await store.load("keep")).length, 1);
    assert.equal(await store.purgeStale(Date.now() + 8 * 24 * 60 * 60 * 1000), 1, "eight days later it is");
    assert.deepEqual(await store.load("keep"), []);
  });

  it("reports unavailable storage instead of failing", async () => {
    const none = createPhotoStore(undefined);
    assert.equal(await none.save("s1", [photo("a")]), "unavailable");
    assert.deepEqual(await none.load("s1"), []);
    await none.clear("s1");
    await none.remove("s1", "a");
    assert.equal(await none.purgeStale(), 0);
  });

  it("reports a full disk as full, and an unreadable database as unavailable", async () => {
    const quota = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    const fullFactory = { open() { const r: any = {}; queueMicrotask(() => { r.result = { transaction() { throw quota; }, close() {} }; r.onsuccess?.(); }); return r; } } as unknown as IDBFactory;
    assert.equal(await createPhotoStore(fullFactory).save("s1", [photo("a")]), "full");
    const brokenFactory = { open() { const r: any = {}; queueMicrotask(() => { r.error = new Error("nope"); r.onerror?.(); }); return r; } } as unknown as IDBFactory;
    assert.equal(await createPhotoStore(brokenFactory).save("s1", [photo("a")]), "unavailable");
    assert.deepEqual(await createPhotoStore(brokenFactory).load("s1"), []);
  });
});

describe("photos of drafts saved for offline sync", () => {
  it("move with the draft when it gets its server id, in order", async () => {
    const store = createPhotoStore(new IDBFactory());
    await store.save("local:abc", [photo("a"), photo("b")]);
    await store.move("local:abc", "s7");
    assert.deepEqual((await store.load("s7")).map((p) => p.id), ["a", "b"]);
    assert.equal((await store.load("local:abc")).length, 0);
    assert.deepEqual(await store.counts(), { s7: 2 });
  });

  it("are not forgotten after a week while they wait to sync, and are wiped at logout", async () => {
    const store = createPhotoStore(new IDBFactory());
    await store.save("local:abc", [photo("a")]);
    await store.save("s8", [photo("b")]);
    await store.save("s9", [photo("c")]);
    const later = Date.now() + 8 * 24 * 60 * 60 * 1000;
    assert.equal(await store.purgeStale(later, (id) => id === "s8"), 1);
    assert.deepEqual(Object.keys(await store.counts()).sort(), ["local:abc", "s8"]);
    await store.wipe();
    assert.deepEqual(await store.counts(), {});
  });
});
