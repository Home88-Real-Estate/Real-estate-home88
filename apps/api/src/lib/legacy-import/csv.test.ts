import assert from "node:assert/strict";
import test from "node:test";

import { LegacyCsvError, parseLegacyCsv } from "./csv";

function errorCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof LegacyCsvError && error.code === code);
}

test("parses Greek Excel CSV with BOM, semicolons, CRLF and quoted separators", () => {
  const csv = "\uFEFFΚωδικός;Ονοματεπώνυμο;Σχόλια\r\nEP-1;Μαρία Παπαδοπούλου;\"Διαμέρισμα, κέντρο; θέα\"\r\n";
  const parsed = parseLegacyCsv(csv);

  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["Κωδικός", "Ονοματεπώνυμο", "Σχόλια"]);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0]?.values, ["EP-1", "Μαρία Παπαδοπούλου", "Διαμέρισμα, κέντρο; θέα"]);
  assert.deepEqual(parsed.rows[0]?.issues, []);
});

test("supports escaped quotes and newlines inside quoted cells", () => {
  const parsed = parseLegacyCsv('id,name,note\n1,"A ""quoted"" name","first line\nsecond line"\n', { delimiter: "COMMA" });
  assert.deepEqual(parsed.rows[0]?.values, ["1", 'A "quoted" name', "first line\nsecond line"]);
});

test("auto detects comma and tab delimiters", () => {
  assert.equal(parseLegacyCsv("id,name\n1,A", {}).delimiter, ",");
  assert.equal(parseLegacyCsv("id\tname\n1\tA", {}).delimiter, "\t");
});

test("explicit delimiter overrides auto detection", () => {
  const parsed = parseLegacyCsv("id;name\n1;A", { delimiter: "COMMA" });
  assert.deepEqual(parsed.headers, ["id;name"]);
  assert.deepEqual(parsed.rows[0]?.values, ["1;A"]);
});

test("retains malformed-width rows for review without echoing cell values in issues", () => {
  const secret = "private-contact@example.test";
  const parsed = parseLegacyCsv(`id;name\n1;A\n2;${secret};unexpected\n`);
  assert.equal(parsed.rows[1]?.issues[0]?.code, "COLUMN_COUNT_MISMATCH");
  assert.equal(parsed.rows[1]?.issues[0]?.expectedColumns, 2);
  assert.equal(parsed.rows[1]?.issues[0]?.actualColumns, 3);
  assert.equal(JSON.stringify(parsed.rows[1]?.issues).includes(secret), false);
});

test("skips empty records but preserves logical source row numbers", () => {
  const parsed = parseLegacyCsv("id;name\n\n1;A\n\n2;B\n");
  assert.deepEqual(parsed.rows.map((row) => row.rowNumber), [3, 5]);
});

test("rejects empty files and header-only files", () => {
  errorCode(() => parseLegacyCsv("  "), "EMPTY_FILE");
  errorCode(() => parseLegacyCsv("id;name\n"), "NO_DATA_ROWS");
});

test("rejects empty and duplicate headers case-insensitively", () => {
  errorCode(() => parseLegacyCsv(";name\n1;A"), "EMPTY_HEADER");
  errorCode(() => parseLegacyCsv("ID;id\n1;A"), "DUPLICATE_HEADER");
  errorCode(() => parseLegacyCsv("ΟΝΟΜΑ;όνομα\n1;A"), "DUPLICATE_HEADER");
});

test("rejects unclosed quotes, embedded quotes, and characters after a closing quote", () => {
  errorCode(() => parseLegacyCsv('id;name\n1;"A'), "UNTERMINATED_QUOTE");
  errorCode(() => parseLegacyCsv('id;name\n1;bad"name'), "INVALID_QUOTE");
  errorCode(() => parseLegacyCsv('id;name\n1;"A"x'), "INVALID_QUOTE");
});

test("enforces byte, row, column and cell limits", () => {
  errorCode(() => parseLegacyCsv("id;name\n1;A", { maxBytes: 4 }), "FILE_TOO_LARGE");
  errorCode(() => parseLegacyCsv("id\n1\n2", { maxRows: 1 }), "TOO_MANY_ROWS");
  errorCode(() => parseLegacyCsv("a;b;c\n1;2;3", { maxColumns: 2 }), "TOO_MANY_COLUMNS");
  errorCode(() => parseLegacyCsv("id;name\n1;abcdef", { maxCellChars: 5 }), "FIELD_TOO_LONG");
});

test("rejects binary NUL bytes", () => {
  errorCode(() => parseLegacyCsv("id;name\n1;A\0B"), "NULL_BYTE");
});
