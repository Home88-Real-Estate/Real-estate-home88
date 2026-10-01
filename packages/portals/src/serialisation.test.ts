import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeCsvField, toCsvRow } from "./csv";
import { block, element, escapeXml } from "./xml";

test("escapeXml escapes the five XML entities", () => {
  assert.equal(escapeXml(`A & B < C > D "E" 'F'`), "A &amp; B &lt; C &gt; D &quot;E&quot; &apos;F&apos;");
});

test("element omits null, undefined and empty values", () => {
  assert.equal(element("x", null), "");
  assert.equal(element("x", undefined), "");
  assert.equal(element("x", ""), "");
});

test("element renders numbers, booleans and attributes", () => {
  assert.equal(element("price", 0, { currency: "EUR" }), '<price currency="EUR">0</price>');
  assert.equal(element("parking", false), "<parking>false</parking>");
});

test("block is omitted when it has no children", () => {
  assert.equal(block("images", [element("url", null)]), "");
  assert.equal(block("images", [element("url", "https://x/1.jpg")]).includes("<images>"), true);
});

test("escapeCsvField quotes only when required", () => {
  assert.equal(escapeCsvField("plain"), "plain");
  assert.equal(escapeCsvField("a,b"), '"a,b"');
  assert.equal(escapeCsvField('a"b'), '"a""b"');
  assert.equal(escapeCsvField("a\nb"), '"a\nb"');
});

test("toCsvRow joins fields with commas and blanks nullish values", () => {
  assert.equal(toCsvRow(["a", null, 1, undefined, true]), "a,,1,,true");
});
