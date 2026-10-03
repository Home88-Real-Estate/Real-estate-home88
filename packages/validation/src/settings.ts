/**
 * Validation for every settings section, generated from the catalogue in
 * @home88/domain so the form a person fills in and the check the server runs
 * can never drift apart. Cross-field rules (VAT check digit, colour contrast,
 * commission split) are added per section.
 *
 * Every field is optional: an administrator fills settings in over time, and
 * an empty field is stored as null ("not configured"), never as a guess.
 */

import {
  AREA_LEVELS,
  MANDATE_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  PUBLICATION_RULE_MODES,
  TAG_COLORS,
  TEMPLATE_LOCALES,
  type SettingsField,
  type SettingsSection,
  settingsSection,
  storedFields,
} from "@home88/domain";
import { z } from "zod";

const stripUnsafe = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠﻿]/g, "");

/** Empty string, null and undefined all mean "not set". */
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

function textField(max: number, multiline: boolean) {
  return z.preprocess(
    (v) => (blank(v) ? null : typeof v === "string" ? stripUnsafe(multiline ? v.replace(/\r\n/g, "\n") : v).trim() : v),
    z.string().max(max, `Έως ${max} χαρακτήρες.`).nullable(),
  );
}

function numberField(field: SettingsField, integer: boolean) {
  const min = field.min ?? (field.type === "percent" ? 0 : undefined);
  const max = field.maxValue ?? (field.type === "percent" ? 100 : undefined);
  let n = z.number({ invalid_type_error: "Συμπληρώστε αριθμό." }).finite("Συμπληρώστε αριθμό.");
  if (integer) n = n.int("Συμπληρώστε ακέραιο αριθμό.");
  if (min !== undefined) n = n.min(min, `Τουλάχιστον ${min}.`);
  if (max !== undefined) n = n.max(max, `Έως ${max}.`);
  return z.preprocess((v) => {
    if (blank(v)) return null;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const parsed = Number(v.trim().replace(",", "."));
      return Number.isNaN(parsed) ? v : parsed;
    }
    return v;
  }, n.nullable());
}

function optionValues(field: SettingsField): [string, ...string[]] {
  const values = (field.options ?? []).map((o) => o.value);
  if (values.length === 0) throw new Error(`Field ${field.key} has no options.`);
  return values as [string, ...string[]];
}

const toList = (v: unknown): unknown[] =>
  blank(v) ? [] : Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/).filter(Boolean) : [v];

/** zod schema for one catalogue field (secrets are handled separately and never pass through here). */
export function fieldSchema(field: SettingsField): z.ZodTypeAny {
  switch (field.type) {
    case "text":
    case "tel":
      return textField(field.max ?? 200, false);
    case "textarea":
      return textField(field.max ?? 4000, true);
    case "email":
      return z.preprocess(
        (v) => (blank(v) ? null : typeof v === "string" ? v.trim().toLowerCase() : v),
        z.string().max(field.max ?? 160).email("Μη έγκυρο email.").nullable(),
      );
    case "url":
      return z.preprocess(
        (v) => (blank(v) ? null : typeof v === "string" ? v.trim() : v),
        z
          .string()
          .max(field.max ?? 500)
          .refine((s) => /^https:\/\/[^\s]+$/i.test(s) || /^\/[^\s/][^\s]*$/.test(s), "Συμπληρώστε διεύθυνση https://… ή διαδρομή /….")
          .nullable(),
      );
    case "int":
      return numberField(field, true);
    case "decimal":
    case "percent":
      return numberField(field, false);
    case "boolean":
      return z.preprocess((v) => {
        if (blank(v)) return false;
        if (v === true || v === "true" || v === "on" || v === "1") return true;
        if (v === false || v === "false" || v === "0") return false;
        return v;
      }, z.boolean());
    case "select":
      return z.preprocess((v) => (blank(v) ? null : v), z.enum(optionValues(field), { errorMap: () => ({ message: "Μη έγκυρη επιλογή." }) }).nullable());
    case "multiselect": {
      const values = optionValues(field);
      return z.preprocess(
        (v) => [...new Set(toList(v).map(String))],
        z.array(z.enum(values, { errorMap: () => ({ message: "Μη έγκυρη επιλογή." }) })).max(values.length),
      );
    }
    case "weekdays":
      return z.preprocess(
        (v) => [...new Set(toList(v).map((x) => Number(x)))].sort((a, b) => a - b),
        z.array(z.number().int().min(1).max(7)).max(7),
      );
    case "intList":
      return z.preprocess(
        (v) => [...new Set(toList(v).map((x) => Number(String(x).trim())))].sort((a, b) => a - b),
        z.array(z.number({ invalid_type_error: "Μόνο αριθμοί, χωρισμένοι με κόμμα." }).int("Μόνο ακέραιοι.").min(0).max(3650)).max(20),
      );
    case "time":
      return z.preprocess(
        (v) => (blank(v) ? null : v),
        z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ώρα σε μορφή ΩΩ:ΛΛ.").nullable(),
      );
    case "date":
      return z.preprocess(
        (v) => (blank(v) ? null : v),
        z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Ημερομηνία σε μορφή ΕΕΕΕ-ΜΜ-ΗΗ.")
          .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), "Μη έγκυρη ημερομηνία.")
          .nullable(),
      );
    case "color":
      return z.preprocess(
        (v) => (blank(v) ? null : typeof v === "string" ? v.trim().toUpperCase() : v),
        z.string().regex(/^#[0-9A-F]{6}$/, "Χρώμα σε μορφή #RRGGBB.").nullable(),
      );
    case "secret":
      throw new Error(`Secret field ${field.key} must not be validated as a stored value.`);
  }
}

// ---------------------------------------------------------------------------
// Cross-field rules
// ---------------------------------------------------------------------------

/** Greek VAT number (ΑΦΜ): 9 digits with a mod-11 check digit. */
export function isValidGreekVat(value: string): boolean {
  if (!/^\d{9}$/.test(value) || /^0{9}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(value[i]) * 2 ** (8 - i);
  return (sum % 11) % 10 === Number(value[8]);
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

type Values = Record<string, unknown>;
type Issue = { path: string; message: string };

const SECTION_RULES: Partial<Record<string, (v: Values) => Issue[]>> = {
  company: (v) =>
    typeof v.postalCode === "string" && !/^[0-9A-Za-z -]{3,10}$/.test(v.postalCode)
      ? [{ path: "postalCode", message: "Μη έγκυρος Τ.Κ." }]
      : [],
  legal: (v) => {
    const issues: Issue[] = [];
    if (typeof v.vatNumber === "string" && !isValidGreekVat(v.vatNumber)) {
      issues.push({ path: "vatNumber", message: "Ο ΑΦΜ δεν είναι έγκυρος (9 ψηφία με σωστό ψηφίο ελέγχου)." });
    }
    if (typeof v.gemiNumber === "string" && !/^\d{6,14}$/.test(v.gemiNumber)) {
      issues.push({ path: "gemiNumber", message: "Ο αριθμός ΓΕΜΗ αποτελείται από 6–14 ψηφία." });
    }
    return issues;
  },
  branding: (v) => {
    const issues: Issue[] = [];
    const white = "#FFFFFF";
    const check = (key: string, against: string, min: number, message: string) => {
      const c = v[key];
      if (typeof c === "string" && contrastRatio(c, against) < min) issues.push({ path: key, message });
    };
    check("colorPrimary", white, 4.5, "Πολύ ανοιχτό: το λευκό κείμενο πάνω του δεν θα διαβάζεται (αντίθεση κάτω από 4.5:1).");
    check("colorDark", white, 7, "Πρέπει να είναι αρκετά σκούρο για λευκό κείμενο (αντίθεση τουλάχιστον 7:1).");
    check("colorSecondary", white, 3, "Πολύ ανοιχτό για κουμπιά και εικονίδια (αντίθεση κάτω από 3:1).");
    if (typeof v.colorBackground === "string") {
      const dark = typeof v.colorDark === "string" ? v.colorDark : "#053755";
      if (contrastRatio(v.colorBackground, dark) < 7) {
        issues.push({ path: "colorBackground", message: "Το φόντο πρέπει να είναι ανοιχτό, ώστε το κείμενο να διαβάζεται (αντίθεση τουλάχιστον 7:1)." });
      }
    }
    const langs = Array.isArray(v.availableLanguages) ? (v.availableLanguages as string[]) : [];
    if (typeof v.defaultLanguage === "string" && langs.length > 0 && !langs.includes(v.defaultLanguage)) {
      issues.push({ path: "defaultLanguage", message: "Η προεπιλεγμένη γλώσσα πρέπει να είναι στις διαθέσιμες." });
    }
    return issues;
  },
  requests: (v) => {
    const keys = ["weightArea", "weightPrice", "weightSize", "weightBedrooms", "weightBathrooms", "weightFloor", "weightYear", "weightFeatures"];
    const allZero = keys.every((k) => v[k] === 0);
    return allZero ? [{ path: "weightPrice", message: "Τουλάχιστον ένα κριτήριο πρέπει να έχει βάρος." }] : [];
  },
  commissions: (v) => {
    const a = v.agentSharePct;
    const b = v.agencySharePct;
    if (typeof a === "number" && typeof b === "number" && Math.abs(a + b - 100) > 0.001) {
      return [{ path: "agencySharePct", message: "Ποσοστό συνεργάτη και γραφείου πρέπει να κάνουν μαζί 100%." }];
    }
    return [];
  },
  calendar: (v) =>
    typeof v.workdayStart === "string" && typeof v.workdayEnd === "string" && v.workdayStart >= v.workdayEnd
      ? [{ path: "workdayEnd", message: "Η λήξη πρέπει να είναι μετά την έναρξη." }]
      : [],
  email: (v) => {
    const issues: Issue[] = [];
    if (typeof v.smtpHost === "string" && v.smtpPort == null) issues.push({ path: "smtpPort", message: "Συμπληρώστε port για τον SMTP host." });
    if (typeof v.smtpHost === "string" && /[\s/]/.test(v.smtpHost)) issues.push({ path: "smtpHost", message: "Μόνο το όνομα του server, χωρίς https:// ή κενά." });
    return issues;
  },
  sms: (v) =>
    typeof v.senderName === "string" && !/^[A-Za-z0-9 ]{1,11}$/.test(v.senderName)
      ? [{ path: "senderName", message: "Έως 11 λατινικοί χαρακτήρες ή αριθμοί." }]
      : [],
  subscription: (v) =>
    typeof v.startsAt === "string" && typeof v.expiresAt === "string" && v.expiresAt < v.startsAt
      ? [{ path: "expiresAt", message: "Η λήξη πρέπει να είναι μετά την έναρξη." }]
      : [],
};

/**
 * Schema for a section's stored values. Read-only fields are forced to their
 * platform default, so a crafted request cannot change them.
 */
export function sectionValuesSchema(section: SettingsSection) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of storedFields(section)) {
    shape[field.key] = field.readOnly
      ? z.any().transform(() => field.default ?? null)
      : fieldSchema(field);
  }
  const rules = SECTION_RULES[section.key];
  return z
    .object(shape)
    .strip()
    .superRefine((values, ctx) => {
      for (const issue of rules?.(values) ?? []) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
      }
    });
}

const secretValue = z.string().trim().min(1, "Συμπληρώστε τιμή.").max(4000, "Πολύ μεγάλη τιμή.");

/** PUT /settings/:section body. Secrets are write-only and travel separately. */
export function sectionUpdateSchema(sectionKey: string) {
  const section = settingsSection(sectionKey);
  if (!section) throw new Error(`Unknown settings section ${sectionKey}.`);
  const secretKeys = section.fields.filter((f) => f.type === "secret").map((f) => f.key);
  const secretKey = secretKeys.length > 0 ? z.enum(secretKeys as [string, ...string[]]) : z.never();
  return z
    .object({
      values: sectionValuesSchema(section),
      secrets: z.record(secretKey, secretValue).optional(),
      clearSecrets: z.array(secretKey).max(20).optional(),
    })
    .strict();
}

// ---------------------------------------------------------------------------
// Custom screens
// ---------------------------------------------------------------------------

const label = (max: number) => z.string().trim().min(1, "Υποχρεωτικό.").max(max, `Έως ${max} χαρακτήρες.`).transform(stripUnsafe);
const optionalLabel = (max: number) =>
  z.preprocess((v) => (blank(v) ? null : v), z.string().trim().max(max).transform(stripUnsafe).nullable());

export const propertyTagSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Κωδικός με λατινικά κεφαλαία, αριθμούς και _ (π.χ. PRICE_REVIEW)."),
    labelEl: label(80),
    labelEn: optionalLabel(80),
    color: z.enum(TAG_COLORS.map((c) => c.value) as [string, ...string[]]).default("slate"),
    active: z.boolean().default(true),
  })
  .strict();

export const propertyTagUpdateSchema = propertyTagSchema.omit({ code: true }).partial().strict();

const levels = AREA_LEVELS.map((l) => l.value) as [string, ...string[]];

export const areaSchema = z
  .object({
    level: z.enum(levels),
    parentId: z.preprocess((v) => (blank(v) ? null : v), z.string().min(1).max(40).nullable()),
    nameEl: label(120),
    nameEn: optionalLabel(120),
    slug: z.preprocess(
      (v) => (blank(v) ? undefined : v),
      z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Μόνο λατινικά πεζά, αριθμοί και παύλες.").max(80).optional(),
    ),
    active: z.boolean().default(true),
  })
  .strict();

export const areaUpdateSchema = areaSchema.omit({ level: true }).partial().strict();

export const areaMappingsSchema = z
  .object({
    mappings: z
      .array(
        z.object({
          portalCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/),
          externalId: z.string().trim().min(1, "Υποχρεωτικό.").max(80),
        }),
      )
      .max(30),
  })
  .strict();

export const permissionGrantSchema = z
  .object({
    role: z.enum(["ADMIN", "MANAGER", "AGENT", "MARKETING", "VIEWER"]),
    permission: z.string().regex(/^settings\.[a-z]+\.(view|manage)$/),
    granted: z.boolean(),
  })
  .strict();

export const notificationToggleSchema = z
  .object({
    event: z.enum(NOTIFICATION_EVENTS.map((e) => e.value) as [string, ...string[]]),
    channel: z.enum(NOTIFICATION_CHANNELS.map((c) => c.value) as [string, ...string[]]),
    enabled: z.boolean(),
  })
  .strict();

export const mandateTypeSchema = z.enum(MANDATE_TYPES.map((t) => t.value) as [string, ...string[]]);
export const templateLocaleSchema = z.enum(TEMPLATE_LOCALES.map((l) => l.value) as [string, ...string[]]);

export const mandateTemplateDraftSchema = z
  .object({
    body: z
      .string()
      .transform((s) => stripUnsafe(s.replace(/\r\n/g, "\n")).trim())
      .pipe(z.string().min(20, "Επικολλήστε το πλήρες εγκεκριμένο κείμενο.").max(100_000)),
    notes: optionalLabel(500),
  })
  .strict();

const ruleModes = PUBLICATION_RULE_MODES.map((m) => m.value) as [string, ...string[]];

const bound = z.number().finite().nonnegative().max(1e10).nullable().optional();

/** Optional narrowing of a portal's publication rule. Bounds are data, never code. */
export const publicationConditionsSchema = z
  .object({
    listingTypes: z.array(z.enum(["SALE", "RENT", "ASSIGNMENT"])).max(3).optional(),
    propertyTypes: z.array(z.string().regex(/^[A-Z_]{2,30}$/)).max(30).optional(),
    cities: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    requireAnyTag: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/)).max(50).optional(),
    minPrice: bound,
    maxPrice: bound,
    minArea: bound,
    maxArea: bound,
  })
  .strict()
  .refine((c) => c.minPrice == null || c.maxPrice == null || c.minPrice <= c.maxPrice, { message: "Η ελάχιστη τιμή υπερβαίνει τη μέγιστη." })
  .refine((c) => c.minArea == null || c.maxArea == null || c.minArea <= c.maxArea, { message: "Το ελάχιστο εμβαδόν υπερβαίνει το μέγιστο." });

export const portalUpdateSchema = z
  .object({
    enabled: z.boolean(),
    values: z.record(z.string().regex(/^[a-zA-Z0-9]{1,40}$/), z.preprocess((v) => (blank(v) ? null : v), z.string().trim().max(300).nullable())),
    secrets: z.record(z.string().regex(/^[a-zA-Z0-9]{1,40}$/), secretValue).optional(),
    clearSecrets: z.array(z.string().regex(/^[a-zA-Z0-9]{1,40}$/)).max(20).optional(),
    rule: z
      .object({
        mode: z.enum(ruleModes),
        propertyTypes: z.array(z.string().regex(/^[A-Z_]{2,30}$/)).max(30).default([]),
        includeTags: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/)).max(50).default([]),
        excludeTags: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/)).max(50).default([]),
        conditions: publicationConditionsSchema.nullable().optional(),
      })
      .strict(),
  })
  .strict();
