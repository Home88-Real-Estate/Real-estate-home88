import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PermanentUploadError,
  uploadAll,
  withRetry,
  type UploadIO,
  type UploadTicket,
} from "./upload-queue";

function ticket(key: string, withVariants: boolean): UploadTicket {
  const put = (k: string) => ({ storageKey: k, url: `https://s3.test/${k}`, headers: {} });
  return {
    storageKey: key,
    upload: { url: `https://s3.test/${key}`, headers: {} },
    variants: withVariants ? { preview: put(`${key}.preview`), thumbnail: put(`${key}.thumbnail`) } : {},
  };
}

function fakeIO(overrides: Partial<UploadIO> = {}) {
  const log: string[] = [];
  let offlineChecks = 0;
  const io: UploadIO = {
    async requestTicket(input) {
      log.push(`ticket:${input.fileName}`);
      return ticket(`key-${input.fileName}`, input.withVariants);
    },
    async put(target) {
      log.push(`put:${target.url.replace("https://s3.test/", "")}`);
    },
    async confirm(input) {
      log.push(`confirm:${input.storageKey}:${input.hasPreview}:${input.hasThumbnail}`);
    },
    async makeVariants() {
      return { preview: new Blob(["p"]), thumbnail: new Blob(["t"]) };
    },
    async waitForOnline() {
      offlineChecks += 1;
    },
    async sleep() {},
    ...overrides,
  };
  return { io, log, checks: () => offlineChecks };
}

const photo = (name: string) => new File([new Uint8Array(10)], name, { type: "image/jpeg" });
const pdf = (name: string) => new File([new Uint8Array(10)], name, { type: "application/pdf" });

test("a photo uploads original, preview and thumbnail, then confirms once", async () => {
  const { io, log } = fakeIO();
  const result = await uploadAll(io, [photo("a.jpg")], undefined, () => {});
  assert.deepEqual(result, { done: 1, failed: 0 });
  assert.deepEqual(log, [
    "ticket:a.jpg",
    "put:key-a.jpg",
    "put:key-a.jpg.preview",
    "put:key-a.jpg.thumbnail",
    "confirm:key-a.jpg:true:true",
  ]);
});

test("documents get no variants", async () => {
  const { io, log } = fakeIO();
  await uploadAll(io, [pdf("deed.pdf")], undefined, () => {});
  assert.deepEqual(log, ["ticket:deed.pdf", "put:key-deed.pdf", "confirm:key-deed.pdf:false:false"]);
});

test("a dropped connection is retried, waiting for the network each time", async () => {
  let failures = 2;
  const { io, log, checks } = fakeIO({
    async put(target) {
      if (failures > 0) {
        failures -= 1;
        throw new TypeError("Failed to fetch");
      }
      log.push(`put:${target.url}`);
    },
  });
  const result = await uploadAll(io, [pdf("x.pdf")], undefined, () => {});
  assert.deepEqual(result, { done: 1, failed: 0 });
  assert.ok(checks() >= 4, "waited for the network before each attempt");
});

test("a failed variant does not lose the original", async () => {
  const { io, log } = fakeIO({
    async put(target) {
      if (target.url.endsWith(".preview")) throw new Error("boom");
      log.push(`put:${target.url.replace("https://s3.test/", "")}`);
    },
  });
  await uploadAll(io, [photo("b.jpg")], undefined, () => {});
  assert.equal(log.at(-1), "confirm:key-b.jpg:false:true");
});

test("permanent errors are not retried and do not stop other files", async () => {
  let ticketCalls = 0;
  const { io } = fakeIO({
    async requestTicket(input) {
      ticketCalls += 1;
      if (input.fileName === "bad.exe") throw new PermanentUploadError("Unsupported file type.");
      return ticket(`key-${input.fileName}`, false);
    },
  });
  const states: string[] = [];
  const result = await uploadAll(io, [pdf("bad.exe"), pdf("ok.pdf")], undefined, (i, u) => {
    if (u.state === "failed") states.push(`${i}:${u.message}`);
  });
  assert.deepEqual(result, { done: 1, failed: 1 });
  assert.equal(ticketCalls, 2);
  assert.deepEqual(states, ["0:Unsupported file type."]);
});

test("withRetry gives up after the attempt budget", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry({ waitForOnline: async () => {}, sleep: async () => {} }, async () => {
      calls += 1;
      throw new Error("still down");
    }, { attempts: 3 }),
  );
  assert.equal(calls, 3);
});
