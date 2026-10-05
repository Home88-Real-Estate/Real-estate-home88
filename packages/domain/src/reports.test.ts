import { test } from "node:test";
import assert from "node:assert/strict";

import { average, csvCell, hoursBetween, isReportKind, median, ratePct, sumMoney, toCsv } from "./reports";

test("rates, medians and sums never invent a number", () => {
  assert.equal(ratePct(1, 3), 33.3);
  assert.equal(ratePct(0, 5), 0);
  assert.equal(ratePct(2, 0), null, "nothing to divide is not zero");
  assert.equal(median([]), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(average([1, 2, 4]), 2.3);
  assert.equal(hoursBetween("2026-10-01T10:00:00Z", "2026-10-01T13:30:00Z"), 3.5);
  assert.equal(hoursBetween("2026-10-02T10:00:00Z", "2026-10-01T10:00:00Z"), null, "wrong order");
  assert.equal(hoursBetween(null, new Date()), null);
  assert.equal(sumMoney(["0.10", 0.2, null, { toString: () => "1.05" }]), 1.35, "cents are summed, not floats");
  assert.ok(isReportKind("leads") && !isReportKind("secrets"));
});

test("CSV cannot carry a spreadsheet formula", () => {
  for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd", "  =1+1"]) {
    const cell = csvCell(evil);
    assert.ok(cell.startsWith("\"'") || cell.startsWith("'"), `${JSON.stringify(evil)} → ${cell}`);
  }
  assert.equal(csvCell(-5), "-5", "a negative number is still a number");
  assert.equal(csvCell(12.5), "12,5", "decimal comma for Greek Excel");
  assert.equal(csvCell("a;b"), '"a;b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), "line1 line2");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(true), "ΝΑΙ");
});

test("CSV output: BOM, semicolons, CRLF", () => {
  const out = toCsv([{ header: "Όνομα", value: (r: { n: string; v: number }) => r.n }, { header: "Ποσό", value: (r) => r.v }], [{ n: "=x", v: 1.5 }]);
  assert.ok(out.startsWith("﻿Όνομα;Ποσό\r\n"));
  assert.ok(out.endsWith("'=x\";1,5\r\n".replace("'=x\"", "\"'=x\"")), out);
});
