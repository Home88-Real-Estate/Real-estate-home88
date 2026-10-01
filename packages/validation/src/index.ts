/**
 * Every request body that reaches the database passes through one of these.
 * The CRM and the public website share them, so a field the website accepts is
 * necessarily a field the CRM validates, and the age gate cannot be bypassed by
 * posting to the API directly.
 */

import { z } from "zod";
import { ageGateSchema } from "./age-gate";

// Re-exported so callers import the gate and the schemas from one place; a
// route that imports `leadCaptureSchema` can reach `evaluateAgeGate` without a
// second import that it might forget to add.
export * from "./age-gate";

/**
 * Strips C0 controls, DEL/C1, zero-width and bidi-override characters.
 * A zero-width or bidi override lets a stored name render as something else,
 * which matters once the name ends up on a printed contract.
 */
const stripUnsafe = (s: string) =>
  s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");

/**
 * Sanitised string that still supports .min/.max/.regex.
 * Ordering matters: the constraints are applied on the raw string first, then
 * the output is sanitised. Wrapping in .transform() before .min() would turn
 * the schema into a ZodEffects and lose those methods.
 */
const text = (max: number) => z.string().trim().max(max).transform(stripUnsafe);

const requiredText = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is required.`).max(max).transform(stripUnsafe);

const optionalText = (max: number) => text(max).optional().or(z.literal(""));

/** Accepts +30..., 210..., anything 7-15 digits once separators are stripped. */
const phoneSchema = z
  .string()
  .trim()
  .transform(stripUnsafe)
  .transform((s) => s.replace(/[\s()\-.]/g, ""))
  .refine((s) => s.length === 0 || (/^\+?\d{7,15}$/.test(s)), "Enter a valid phone number.")
  .optional()
  .or(z.literal(""));

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("Enter a valid email address.")
  .optional()
  .or(z.literal(""));

export const listingTypeSchema = z.enum(["SALE", "RENT", "ASSIGNMENT"]);
export const propertyTypeSchema = z.enum([
  "APARTMENT", "MAISONETTE", "HOUSE", "VILLA", "STUDIO", "OFFICE", "SHOP",
  "WAREHOUSE", "BUILDING", "HOTEL", "LAND", "PLOT", "PARKING", "INDUSTRIAL", "OTHER",
]);
export const propertyStatusSchema = z.enum([
  "DRAFT", "ACTIVE", "RESERVED", "SOLD", "RENTED", "INACTIVE", "ARCHIVED",
]);

/** Money as a string or number, normalised. Guards against NaN reaching SQL. */
const moneySchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? Number(v.replace(/[\s,]/g, "")) : v))
  .refine((v) => Number.isFinite(v), "Enter a number.")
  .refine((v) => v >= 0, "Cannot be negative.")
  .refine((v) => v <= 1_000_000_000, "Value out of range.")
  .optional()
  .nullable()
  .transform((v) => (v == null ? null : v));

const areaSchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? Number(v.replace(/[\s,]/g, "")) : v))
  .refine((v) => Number.isFinite(v) && v >= 0 && v <= 100_000, "Enter a valid area.")
  .optional()
  .nullable()
  .transform((v) => (v == null ? null : v));

const yearSchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? Number(v) : v))
  .refine((v) => Number.isInteger(v) && v >= 1800 && v <= new Date().getUTCFullYear() + 3,
    "Enter a valid year.")
  .optional()
  .nullable()
  .transform((v) => (v == null ? null : v));

const latitudeSchema = z.coerce.number().min(-90).max(90).optional().nullable();
const longitudeSchema = z.coerce.number().min(-180).max(180).optional().nullable();

/**
 * Public website property enquiry / lead capture.
 *
 * `consent` is separate from `ageAffirmation` on purpose: being old enough to
 * use the site is not consent to be emailed, and the two must be recorded
 * independently. `consent.analytics` and `consent.marketing` are both opt-in
 * and both default to false.
 */
export const leadCaptureSchema = z
  .object({
    ...ageGateSchema,

    firstName: requiredText(80, "First name"),
    lastName: optionalText(80),
    email: emailSchema,
    phone: phoneSchema,
    message: optionalText(4000),

    preferredContactMethod: z
      .enum(["PHONE", "EMAIL", "WHATSAPP", "SMS", "ANY"])
      .optional()
      .default("ANY"),
    locale: z.enum(["el", "en"]).optional().default("el"),

    /** Public reference of the property being enquired about, e.g. H88-000001. */
    propertyReference: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^H88-\d{6}$/, "Unknown property reference.")
      .optional(),

    budgetMin: moneySchema,
    budgetMax: moneySchema,

    consent: z
      .object({
        /** Required: needed to answer the enquiry at all. */
        necessary: z.literal(true),
        analytics: z.boolean().optional().default(false),
        marketing: z.boolean().optional().default(false),
      })
      .optional(),

    /**
     * Traps naive form spam without a CAPTCHA service. Two time fields that
     * must be internally consistent; a form filled in under a second is a bot.
     */
    hpl: z.string().optional(),
    hpt: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.budgetMin != null && val.budgetMax != null && val.budgetMin > val.budgetMax) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["budgetMax"], message: "Max is below min." });
    }
    // An enquiry with no way to reply is not actionable.
    if (!val.email && !val.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Give an email address or a phone number so we can reply.",
      });
    }
  });

export type LeadCaptureInput = z.infer<typeof leadCaptureSchema>;

/** Owner/vendor submits a property they want listed. Also age-gated. */
export const propertySubmissionSchema = z
  .object({
    ...ageGateSchema,

    titleEl: requiredText(200, "Title"),
    descriptionEl: requiredText(8000, "Description"),

    listingType: listingTypeSchema,
    propertyType: propertyTypeSchema,

    price: moneySchema,
    area: areaSchema,
    bedrooms: z.coerce.number().int().min(0).max(50).optional().nullable(),
    city: optionalText(120),
    neighborhood: optionalText(120),

    contactFirstName: requiredText(80, "First name"),
    contactLastName: optionalText(80),
    contactEmail: emailSchema,
    contactPhone: phoneSchema,

    /** How the agency may contact the owner about this submission. */
    contactConsent: z.literal(true, {
      errorMap: () => ({ message: "We need your agreement to contact you about this property." }),
    }),

    consent: z
      .object({
        necessary: z.literal(true),
        analytics: z.boolean().optional().default(false),
        marketing: z.boolean().optional().default(false),
      })
      .optional(),

    hpl: z.string().optional(),
    hpt: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.contactEmail && !val.contactPhone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contactEmail"],
        message: "Give an email address or a phone number.",
      });
    }
  });

export type PropertySubmissionInput = z.infer<typeof propertySubmissionSchema>;

/**
 * The shared shape, kept separate from its refinement so `.extend()` still
 * works: superRefine returns a ZodEffects, which is not extendable.
 */
const contactBaseSchema = z.object({
  ...ageGateSchema,
  firstName: requiredText(80, "First name"),
  lastName: optionalText(80),
  email: emailSchema,
  phone: phoneSchema,
  subject: optionalText(200),
  message: requiredText(4000, "Message"),
  locale: z.enum(["el", "en"]).optional().default("el"),
  consent: z
    .object({
      necessary: z.literal(true),
      analytics: z.boolean().optional().default(false),
      marketing: z.boolean().optional().default(false),
    })
    .optional(),
  hpl: z.string().optional(),
  hpt: z.string().optional(),
});

const requireAReachableChannel = (val: { email?: string; phone?: string }, ctx: z.RefinementCtx) => {
  if (!val.email && !val.phone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["email"],
      message: "Give an email address or a phone number so we can reply.",
    });
  }
};

/** General contact form. */
export const contactSchema = contactBaseSchema.superRefine(requireAReachableChannel);

/** "Request a property" — a buyer's brief rather than a question. */
export const buyerRequestSchema = contactBaseSchema
  .extend({
    listingType: listingTypeSchema.optional(),
    propertyType: propertyTypeSchema.optional(),
    city: optionalText(120),
    budgetMin: moneySchema,
    budgetMax: moneySchema,
    minArea: areaSchema,
    minBedrooms: z.coerce.number().int().min(0).max(50).optional().nullable(),
  })
  .superRefine(requireAReachableChannel);

/**
 * CRM property editor. Superset of the submission schema.
 *
 * The object is kept separate from its refinement so a PATCH variant can be
 * derived from it: `.superRefine()` returns a ZodEffects, which has no
 * `.partial()`.
 */
const propertyUpsertBaseSchema = z.object({
    reference: z.string().trim().toUpperCase().regex(/^H88-\d{6}$/).optional(),
    listingType: listingTypeSchema,
    propertyType: propertyTypeSchema,
    status: propertyStatusSchema.optional().default("DRAFT"),
    condition: z
      .enum(["NEW_BUILD", "RENOVATED", "GOOD", "NEEDS_RENOVATION", "UNDER_CONSTRUCTION"])
      .optional()
      .default("GOOD"),

    titleEl: requiredText(200, "Title"),
    titleEn: optionalText(200),
    descriptionEl: requiredText(20000, "Description"),
    descriptionEn: optionalText(20000),

    price: moneySchema,
    priceOnRequest: z.boolean().optional().default(false),
    monthlyRent: moneySchema,

    area: areaSchema,
    plotArea: areaSchema,
    builtArea: areaSchema,

    bedrooms: z.coerce.number().int().min(0).max(50).optional().nullable(),
    bathrooms: z.coerce.number().int().min(0).max(50).optional().nullable(),
    wc: z.coerce.number().int().min(0).max(50).optional().nullable(),
    floor: z.coerce.number().int().min(-10).max(200).optional().nullable(),
    totalFloors: z.coerce.number().int().min(-10).max(200).optional().nullable(),

    yearBuilt: yearSchema,
    yearRenovated: yearSchema,

    heating: z
      .enum(["CENTRAL", "INDIVIDUAL", "UNDERFLOOR", "HEAT_PUMP", "GAS", "NONE", "NOT_AVAILABLE"])
      .optional()
      .default("NOT_AVAILABLE"),
    energyClass: z
      .enum(["A_PLUS", "A", "B", "C", "D", "E", "F", "G", "NOT_AVAILABLE"])
      .optional()
      .default("NOT_AVAILABLE"),
    hasSolar: z.boolean().optional().default(false),

    parking: z.boolean().optional().default(false),
    parkingSpaces: z.coerce.number().int().min(0).max(100).optional().nullable(),
    storage: z.boolean().optional().default(false),
    balcony: z.boolean().optional().default(false),
    balconyArea: areaSchema,
    garden: z.boolean().optional().default(false),
    pool: z.boolean().optional().default(false),
    furnished: z.boolean().optional().default(false),
    petsAllowed: z.boolean().optional().default(false),
    seaView: z.boolean().optional().default(false),
    newConstruction: z.boolean().optional().default(false),

    region: optionalText(120),
    city: optionalText(120),
    areaName: optionalText(120),
    neighborhood: optionalText(120),
    address: optionalText(300),
    postalCode: optionalText(20),

    latitude: latitudeSchema,
    longitude: longitudeSchema,

    videoUrl: z.string().trim().url("Enter a valid URL.").max(500).optional().or(z.literal("")),
    virtualTourUrl: z.string().trim().url("Enter a valid URL.").max(500).optional().or(z.literal("")),

    publishedOnWebsite: z.boolean().optional().default(false),
    featured: z.boolean().optional().default(false),

    agentId: z.string().cuid().optional().nullable(),
    ownerId: z.string().cuid().optional().nullable(),

    commissionRatePct: z.coerce.number().min(0).max(100).optional().nullable(),
    agentCommissionPct: z.coerce.number().min(0).max(100).optional().nullable(),
  });

export const propertyUpsertSchema = propertyUpsertBaseSchema.superRefine((val, ctx) => {
    if (val.price == null && !val.priceOnRequest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "Give a price, or tick price on request.",
      });
    }
    if (val.floor != null && val.totalFloors != null && val.floor > val.totalFloors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["floor"],
        message: "Floor is above the number of floors in the building.",
      });
    }
    if (val.yearRenovated != null && val.yearBuilt != null && val.yearRenovated < val.yearBuilt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["yearRenovated"],
        message: "Renovation year is before the build year.",
      });
    }
    if (
      val.latitude != null && val.longitude == null ||
      val.longitude != null && val.latitude == null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["longitude"],
        message: "Latitude and longitude must be given together.",
      });
    }
  });

export type PropertyUpsertInput = z.infer<typeof propertyUpsertSchema>;

/**
 * PATCH body for the CRM editor: every field optional, no defaults applied.
 * Cross-field rules are checked by the caller against the merged record, so a
 * partial update is still validated as the final state it produces.
 */
export const propertyUpdateSchema = propertyUpsertBaseSchema.partial();
export type PropertyUpdateInput = z.infer<typeof propertyUpdateSchema>;

export const propertySearchSchema = z.object({
  listingType: listingTypeSchema.optional(),
  propertyType: propertyTypeSchema.optional(),
  status: propertyStatusSchema.optional(),

  city: optionalText(120),
  areaName: optionalText(120),
  neighborhood: optionalText(120),
  region: optionalText(120),

  minPrice: moneySchema,
  maxPrice: moneySchema,
  minArea: areaSchema,
  maxArea: areaSchema,

  bedrooms: z.coerce.number().int().min(0).max(50).optional().nullable(),
  bathrooms: z.coerce.number().int().min(0).max(50).optional().nullable(),

  minYearBuilt: yearSchema,
  maxYearBuilt: yearSchema,

  energyClass: z
    .enum(["A_PLUS", "A", "B", "C", "D", "E", "F", "G", "NOT_AVAILABLE"])
    .optional(),
  heating: z
    .enum(["CENTRAL", "INDIVIDUAL", "UNDERFLOOR", "HEAT_PUMP", "GAS", "NONE", "NOT_AVAILABLE"])
    .optional(),

  parking: z.coerce.boolean().optional(),
  pool: z.coerce.boolean().optional(),
  garden: z.coerce.boolean().optional(),
  seaView: z.coerce.boolean().optional(),
  furnished: z.coerce.boolean().optional(),
  petsAllowed: z.coerce.boolean().optional(),
  newConstruction: z.coerce.boolean().optional(),
  priceOnRequest: z.coerce.boolean().optional(),

  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.1).max(200).optional(),

  /** Free-text fallback for legacy URLs and portal-sourced queries. */
  q: optionalText(120),

  sort: z.enum(["newest", "price_asc", "price_desc", "area_desc", "area_asc"]).optional().default("newest"),

  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(60).optional().default(24),
});

export type PropertySearchInput = z.infer<typeof propertySearchSchema>;

/** CRM login. Credentials only; authorisation is separate. */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(200)
  .refine((v) => /[a-z]/.test(v), "Include a lowercase letter.")
  .refine((v) => /[A-Z]/.test(v), "Include an uppercase letter.")
  .refine((v) => /\d/.test(v), "Include a digit.")
  .refine((v) => /[^\w\s]/.test(v), "Include a symbol.");

export const leadStatusChangeSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "VIEWING", "OFFER", "WON", "LOST", "NOT_INTERESTED"]),
  note: optionalText(2000),
  lostReason: optionalText(500),
});

/** Marketing unsubscribe: token must be opaque and single-purpose. */
export const unsubscribeSchema = z.object({
  token: z.string().trim().min(20).max(400),
  reason: optionalText(500),
});

/** DMCA / copyright takedown notice from a rights holder. */
export const dmcaNoticeSchema = z.object({
  claimantName: requiredText(200, "Your name"),
  claimantEmail: z.string().trim().toLowerCase().email().max(254),
  claimantAddress: optionalText(500),
  originalWorkUrl: z.string().trim().url().max(1000).optional().or(z.literal("")),
  workDescription: requiredText(4000, "Description of the original work"),
  infringingUrl: optionalText(1000),
  propertyReference: z
    .string().trim().toUpperCase().regex(/^H88-\d{6}$/).optional().or(z.literal("")),
  goodFaithStatement: requiredText(2000, "Good faith statement"),
  signature: requiredText(200, "Signature"),
});

/**
 * Rate-limit budget per action. Kept next to the schemas so a new endpoint
 * cannot be added without being given a limit.
 */
export const RATE_LIMITS = {
  leadCapture: { points: 5, durationSeconds: 600 },
  propertySubmission: { points: 3, durationSeconds: 3600 },
  contact: { points: 5, durationSeconds: 600 },
  login: { points: 8, durationSeconds: 900 },
  dmcaNotice: { points: 3, durationSeconds: 3600 },
} as const;
