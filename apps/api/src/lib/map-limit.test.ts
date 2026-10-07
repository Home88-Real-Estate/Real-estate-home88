import assert from "node:assert/strict";
import { test } from "node:test";

import { mapLimit, runAll } from "./map-limit";

test("runs results in input order and returns all of them", async () => {
  const out = await mapLimit([1, 2, 3, 4], 2, async (n) => n * 2);
  assert.deepEqual(out, [2, 4, 6, 8]);
});

test("never runs more than `limit` jobs at once", async () => {
  let inFlight = 0;
  let peak = 0;
  await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n;
  });
  assert.equal(peak, 3);
});

test("handles an empty input", async () => {
  const out = await mapLimit([], 3, async () => 1);
  assert.deepEqual(out, []);
});

test("rejects when a job throws", async () => {
  await assert.rejects(
    mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    }),
    /boom/,
  );
});

test("larger limits than the input are fine", async () => {
  const out = await mapLimit([10, 20], 100, async (n) => n + 1);
  assert.deepEqual(out, [11, 21]);
});

test("runAll runs factories bound, in order, with per-slot types", async () => {
  let inFlight = 0;
  let peak = 0;
  const [a, b] = await runAll(
    [
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return "text";
      },
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return 7;
      },
    ] as const,
    1,
  );
  assert.deepEqual([a, b], ["text", 7]);
  assert.equal(peak, 1);
});