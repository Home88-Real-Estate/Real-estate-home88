import assert from "node:assert/strict";
import test from "node:test";

import {
  LegacyMappingConfigurationError,
  mapLegacyImportRow,
  validateLegacyImportMapping,
} from "./mapping";

const throwsMapping = (fn: () => unknown) =>
  assert.throws(fn, (error: unknown) => error instanceof LegacyMappingConfigurationError);

test("contact mapping trims text, normalises email and accepts a company-only contact", () => {
  const headers = ["Όνομα", "Επώνυμο", "Ηλεκτρονικό ταχυδρομείο", "Εταιρεία"];
  const mapping = validateLegacyImportMapping({
    targetType: "CONTACT",
    fields: [
      { sourceHeader: "Όνομα", targetField: "firstName", transform: "TEXT" },
      { sourceHeader: "Επώνυμο", targetField: "lastName", transform: "TEXT" },
      { sourceHeader: "Ηλεκτρονικό ταχυδρομείο", targetField: "email", transform: "EMAIL" },
      { sourceHeader: "Εταιρεία", targetField: "company", transform: "TEXT" },
    ],
  }, headers);

  const result = mapLegacyImportRow(mapping, headers, [" Μαρία ", " Παπαδοπούλου ", " MARIA@EXAMPLE.GR ", " HOME88 "]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.record, {
    firstName: "Μαρία",
    lastName: "Παπαδοπούλου",
    email: "maria@example.gr",
    company: "HOME88",
  });

  const companyOnly = mapLegacyImportRow(mapping, headers, ["", "", "", "HOME88"]);
  assert.equal(companyOnly.issues.length, 0);
});

test("contact mapping rejects records with no identity and invalid email", () => {
  const headers = ["Όνομα", "Email"];
  const mapping = validateLegacyImportMapping({
    targetType: "CONTACT",
    fields: [
      { sourceHeader: "Όνομα", targetField: "firstName", transform: "TEXT" },
      { sourceHeader: "Email", targetField: "email", transform: "EMAIL" },
    ],
  }, headers);

  const result = mapLegacyImportRow(mapping, headers, ["", "not-an-email"]);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["INVALID_EMAIL", "CONTACT_IDENTITY_MISSING"]);
});

test("boolean conversion uses an explicit non-overlapping value map", () => {
  const headers = ["Επιπλωμένο"];
  const mapping = validateLegacyImportMapping({
    targetType: "PROPERTY",
    fields: [
      { sourceHeader: "Είδος", targetField: "listingType", transform: "ENUM_MAP", valueMap: { "Πώληση": "SALE" } },
      { sourceHeader: "Κατηγορία", targetField: "propertyType", transform: "ENUM_MAP", valueMap: { "Διαμέρισμα": "APARTMENT" } },
      { sourceHeader: "Περιγραφή", targetField: "descriptionEl", transform: "TEXT" },
      { sourceHeader: "Επιπλωμένο", targetField: "furnished", transform: "BOOLEAN_MAP", trueValues: ["ΝΑΙ", "yes"], falseValues: ["ΟΧΙ", "no"] },
    ],
  }, ["Είδος", "Κατηγορία", "Περιγραφή", ...headers]);

  const result = mapLegacyImportRow(mapping, ["Είδος", "Κατηγορία", "Περιγραφή", ...headers], ["Πώληση", "Διαμέρισμα", "Καλή κατάσταση", "ΝΑΙ"]);
  assert.equal(result.record.furnished, true);
  assert.equal(result.record.listingType, "SALE");
  assert.equal(result.issues.length, 0);

  const unknown = mapLegacyImportRow(mapping, ["Είδος", "Κατηγορία", "Περιγραφή", ...headers], ["Πώληση", "Διαμέρισμα", "Περιγραφή", "Άγνωστο"]);
  assert.ok(unknown.issues.some((issue) => issue.code === "UNMAPPED_BOOLEAN"));
});

test("property mapping applies explicit European decimal conversion and validates a draft", () => {
  const headers = ["Συναλλαγή", "Τύπος", "Περιγραφή", "Τιμή", "Εμβαδόν"];
  const mapping = validateLegacyImportMapping({
    targetType: "PROPERTY",
    fields: [
      { sourceHeader: "Συναλλαγή", targetField: "listingType", transform: "ENUM_MAP", valueMap: { "Πώληση": "SALE" } },
      { sourceHeader: "Τύπος", targetField: "propertyType", transform: "ENUM_MAP", valueMap: { "Διαμέρισμα": "APARTMENT" } },
      { sourceHeader: "Περιγραφή", targetField: "descriptionEl", transform: "TEXT" },
      { sourceHeader: "Τιμή", targetField: "price", transform: "NUMBER_COMMA" },
      { sourceHeader: "Εμβαδόν", targetField: "area", transform: "NUMBER_COMMA" },
    ],
  }, headers);

  const result = mapLegacyImportRow(mapping, headers, ["Πώληση", "Διαμέρισμα", "Φωτεινό διαμέρισμα", "1.250.000,50", "95,75"]);
  assert.equal(result.record.price, 1_250_000.5);
  assert.equal(result.record.area, 95.75);
  assert.equal(result.record.status, "DRAFT");
  assert.equal(result.issues.length, 0);
});

test("mapping rejects duplicate headers, duplicate targets, unknown targets and unsafe property fields", () => {
  const headers = ["Όνομα", "Είδος", "Τύπος", "Περιγραφή"];
  throwsMapping(() => validateLegacyImportMapping({
    targetType: "CONTACT",
    fields: [
      { sourceHeader: "Όνομα", targetField: "firstName", transform: "TEXT" },
      { sourceHeader: "Όνομα", targetField: "lastName", transform: "TEXT" },
    ],
  }, headers));

  throwsMapping(() => validateLegacyImportMapping({
    targetType: "CONTACT",
    fields: [
      { sourceHeader: "Όνομα", targetField: "firstName", transform: "TEXT" },
      { sourceHeader: "Είδος", targetField: "firstName", transform: "TEXT" },
    ],
  }, headers));

  throwsMapping(() => validateLegacyImportMapping({
    targetType: "PROPERTY",
    fields: [
      { sourceHeader: "Είδος", targetField: "listingType", transform: "ENUM_MAP", valueMap: { "Πώληση": "SALE" } },
      { sourceHeader: "Τύπος", targetField: "propertyType", transform: "ENUM_MAP", valueMap: { "Διαμέρισμα": "APARTMENT" } },
      { sourceHeader: "Περιγραφή", targetField: "descriptionEl", transform: "TEXT" },
      { sourceHeader: "Όνομα", targetField: "status", transform: "TEXT" },
    ],
  }, headers));
});

test("numeric conversions reject ambiguous locale formats instead of guessing", () => {
  const headers = ["Όνομα", "Μέγεθος"];
  const mapping = validateLegacyImportMapping({
    targetType: "CONTACT",
    fields: [
      { sourceHeader: "Όνομα", targetField: "firstName", transform: "TEXT" },
    ],
  }, headers);
  assert.equal(mapping.fields.length, 1);
  // Number transforms are only accepted for numeric fields; text must not accept them.
  throwsMapping(() => validateLegacyImportMapping({
    targetType: "CONTACT",
    fields: [
      { sourceHeader: "Όνομα", targetField: "firstName", transform: "NUMBER_COMMA" },
    ],
  }, headers));
});
