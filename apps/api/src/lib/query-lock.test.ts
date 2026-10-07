import assert from "node:assert/strict";
import { test } from "node:test";

import { withQueryLock } from "./query-lock";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("never runs more queries than the global cap at once", async () => {
  let inFlight = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 20 }, () =>
      withQueryLock(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await delay(5);
        inFlight -= 1;
      }),
    ),
  );
  assert.equal(peak, 4, "the global cap is honoured across the whole batch");
});

test("releases its slot on failure, so later queries are not blocked", async () => {
  await assert.rejects(
    withQueryLock(async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  const value = await withQueryLock(async () => "after");
  assert.equal(value, "after");
});

test("carries the query's result through", async () => {
  const out = await withQueryLock(async () => ({ total: 7 }));
  assert.deepEqual(out, { total: 7 });
});

test("waits are served in FIFO order", async () => {
  const order: number[] = [];
  const waiters = Array.from({ length: 8 }, (_, i) => i);
  await Promise.all(
    waiters.map((i) =>
      withQueryLock(async () => {
        order.push(i);
        await delay(i === 0 ? 30 : 2);
      }),
    ),
  );
  assert.deepEqual(order, waiters, "start order stays FIFO once past the cap");
});