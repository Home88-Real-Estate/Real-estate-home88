/**
 * The assistant's tools.
 *
 * Gemini never touches the database. It can only ask for one of these typed
 * functions; the server validates the arguments, applies the same visibility
 * and age rules as the public forms, and hands back public data only. The
 * results are also what the UI renders as property cards, so a card can never
 * show a listing the model made up.
 *
 * Authorization is decided here, not by anything the model says: a tool that
 * writes records requires the visitor's explicit confirmations as arguments,
 * and the intake service independently enforces the 18+ age gate, contact
 * validation, de-duplication and idempotency.
 */

import { createHash } from "node:crypto";

import { REQUEST_FEATURES } from "@home88/domain";
import { IntakeValidationError, type Base, type IntakeOutcome, type PublicLeadIntakeService, type RequestMeta } from "@home88/intake";
import type { Locale, PublicPropertyDetail, PublicPropertySummary } from "@home88/types";
import { formatPrice, label, LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS } from "@home88/types";
import { ageGateMessage, propertyTypeSchema, RATE_LIMITS } from "@home88/validation";
import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";

import type { CompanyInfo } from "../company";
import type { SearchParams } from "../property";

export const AI_SOURCE_CHANNEL = "AI_ASSISTANT";

/** What the UI may render. Built from tool results only, never from model text. */
export type PropertyCard = {
  reference: string;
  title: string;
  listingType: string;
  status: string;
  propertyType: string;
  location: string;
  priceLabel: string;
  areaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  url: string;
  image: string | null;
};

export type ActionKind = "property_inquiry" | "viewing_request" | "buyer_request";
export type ActionRecord = { kind: ActionKind; reference: string; duplicate: boolean };

export type ToolDeps = {
  searchProperties: (locale: Locale, params: SearchParams) => Promise<{ data: PublicPropertySummary[]; total: number }>;
  getProperty: (reference: string, locale: Locale) => Promise<PublicPropertyDetail | null>;
  intake: () => PublicLeadIntakeService | null;
  company: () => Promise<CompanyInfo>;
  rateLimit: (key: string, limit: { points: number; durationSeconds: number }) => { ok: boolean };
};

export type ToolContext = {
  locale: Locale;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  /** Server-validated: only set when the reference names a real public property. */
  currentProperty: { reference: string } | null;
  /** Path of the page the chat was opened on. */
  landingPage: string | undefined;
  deps: ToolDeps;
};

export type ToolOutput = {
  /** What the model sees. Public data and status codes only. */
  result: Record<string, unknown>;
  cards?: PropertyCard[];
  action?: ActionRecord;
};

type Tool = {
  declaration: FunctionDeclaration;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutput>;
};

const REFERENCE = z.string().trim().toUpperCase().regex(/^H88-\d{6}$/);
const optNum = (max: number) => z.number().finite().min(0).max(max).optional();
const text = (max: number) => z.string().trim().max(max);

// -- mapping ---------------------------------------------------------------

function toCard(p: PublicPropertySummary, locale: Locale): PropertyCard {
  return {
    reference: p.reference,
    title: p.title,
    listingType: p.listingType,
    status: p.status,
    propertyType: label(PROPERTY_TYPE_LABELS, p.propertyType, locale),
    location: [p.neighborhood, p.areaName, p.city].filter(Boolean).join(", "),
    priceLabel: formatPrice(p.price, p.priceOnRequest, p.listingType, locale),
    areaSqm: p.area,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    url: `/property/${p.reference}`,
    image: p.primaryImage,
  };
}

/** Availability the visitor can rely on: the real status, in plain words. */
const STATUS_NOTE: Record<string, string> = {
  ACTIVE: "Available",
  UNDER_OFFER: "Under offer: an offer is being considered, so it may no longer be available",
  RESERVED: "Reserved: it may no longer be available",
};

// -- shared person / confirmation fields -----------------------------------

const personShape = {
  firstName: text(80).min(1),
  lastName: text(80).optional(),
  email: text(200).optional(),
  phone: text(40).optional(),
  /** YYYY-MM-DD, asked of the visitor. Used for the age check only and never stored. */
  dateOfBirth: text(10).optional(),
  ageConfirmed: z.boolean().optional(),
  processingConfirmed: z.boolean().optional(),
};

const personSchema = z.object(personShape);

const personProps = {
  firstName: { type: "string", description: "Visitor's first name, as they gave it." },
  lastName: { type: "string" },
  email: { type: "string", description: "Visitor's email. At least one of email or phone is required." },
  phone: { type: "string", description: "Visitor's phone. At least one of email or phone is required." },
  dateOfBirth: { type: "string", description: "Visitor's date of birth as YYYY-MM-DD. Ask for it; only used to confirm they are 18 or older, never stored." },
  ageConfirmed: { type: "boolean", description: "true ONLY if the visitor explicitly said they are 18 or older." },
  processingConfirmed: { type: "boolean", description: "true ONLY if the visitor explicitly agreed that HOME88 may process their details to answer this request." },
} as const;

const personRequired = ["firstName", "dateOfBirth", "ageConfirmed", "processingConfirmed"];

function failure(code: string, extra: Record<string, unknown> = {}): ToolOutput {
  return { result: { success: false, code, ...extra } };
}

/** The visitor may only act on a property they can see: the intake service itself accepts any reference. */
async function publicReference(ctx: ToolContext, reference: string): Promise<boolean> {
  return (await ctx.deps.getProperty(reference, ctx.locale)) !== null;
}

function idempotencyKey(ctx: ToolContext, tool: string, parts: unknown[]): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([ctx.sessionId, tool, ...parts]))
    .digest("base64url")
    .slice(0, 40);
  return `ai_${digest}`;
}

/** Shared by the three write tools: gates, rate limit, service call, outcome mapping. */
async function runIntake(
  tool: string,
  kind: ActionKind,
  args: Record<string, unknown>,
  ctx: ToolContext,
  keyParts: unknown[],
  call: (service: PublicLeadIntakeService, base: Base) => Promise<IntakeOutcome>,
): Promise<ToolOutput> {
  const person = personSchema.parse(args);

  // The visitor's own confirmations, not the model's judgement, unlock a write.
  if (person.processingConfirmed !== true) return failure("PROCESSING_CONSENT_REQUIRED");

  if (!ctx.deps.rateLimit(`ai-action:${ctx.ip}`, RATE_LIMITS.leadCapture).ok) return failure("RATE_LIMITED");

  const service = ctx.deps.intake();
  if (!service) return failure("UNAVAILABLE");

  const email = person.email?.toLowerCase();
  const meta: RequestMeta = {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    idempotencyKey: idempotencyKey(ctx, tool, [email ?? person.phone ?? "", ...keyParts]),
    attribution: { landingPage: ctx.landingPage },
    sourceChannel: AI_SOURCE_CHANNEL,
  };

  let outcome: IntakeOutcome;
  try {
    outcome = await call(service, {
      person: { firstName: person.firstName, lastName: person.lastName, email, phone: person.phone, locale: ctx.locale },
      age: { dateOfBirth: person.dateOfBirth, ageAffirmation: person.ageConfirmed === true },
      meta,
    });
  } catch (error) {
    if (error instanceof IntakeValidationError) return failure("INVALID_INPUT", { fields: error.fields });
    throw error;
  }

  if (outcome.status === "refused") {
    // Same neutral wording as the website forms; never the visitor's age.
    return failure(outcome.reason === "underage" ? "AGE_REQUIREMENT" : "AGE_CHECK_FAILED", { message: ageGateMessage(outcome.reason) });
  }
  const duplicate = outcome.status === "replayed";
  return {
    result: { success: true, received: true, duplicate, reference: outcome.reference },
    action: { kind, reference: outcome.reference, duplicate },
  };
}

// -- tools -------------------------------------------------------------------

const searchSchema = z.object({
  listingType: z.enum(["SALE", "RENT"]).optional(),
  propertyType: propertyTypeSchema.optional(),
  location: text(80).optional(),
  minPrice: optNum(1e9),
  maxPrice: optNum(1e9),
  minArea: optNum(100_000),
  maxArea: optNum(100_000),
  bedrooms: z.number().int().min(0).max(20).optional(),
  parking: z.boolean().optional(),
  pool: z.boolean().optional(),
  garden: z.boolean().optional(),
  seaView: z.boolean().optional(),
  furnished: z.boolean().optional(),
  petsAllowed: z.boolean().optional(),
  newConstruction: z.boolean().optional(),
  limit: z.number().int().min(1).max(6).optional(),
});

const searchProperties: Tool = {
  declaration: {
    name: "search_properties",
    description:
      "Search HOME88's real, currently published property listings. Use this for every question about what is available. Never describe a property that did not come from this tool. Location names are matched as stored, so prefer the Greek spelling (e.g. Γλυφάδα).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        listingType: { type: "string", enum: ["SALE", "RENT"] },
        propertyType: { type: "string", enum: propertyTypeSchema.options },
        location: { type: "string", description: "City, area or neighbourhood." },
        minPrice: { type: "number", description: "Euro." },
        maxPrice: { type: "number", description: "Euro." },
        minArea: { type: "number", description: "Square metres." },
        maxArea: { type: "number" },
        bedrooms: { type: "integer", description: "Minimum bedrooms." },
        parking: { type: "boolean" },
        pool: { type: "boolean" },
        garden: { type: "boolean" },
        seaView: { type: "boolean" },
        furnished: { type: "boolean" },
        petsAllowed: { type: "boolean" },
        newConstruction: { type: "boolean" },
        limit: { type: "integer", description: "1 to 6, default 4." },
      },
    },
  },
  async run(args, ctx) {
    const a = searchSchema.parse(args);
    const { location, limit, ...rest } = a;
    const found = await ctx.deps.searchProperties(ctx.locale, { ...rest, q: location, limit: limit ?? 4, sort: "price_asc" });
    const cards = found.data.map((p) => toCard(p, ctx.locale));
    return {
      result: {
        success: true,
        totalMatches: found.total,
        shown: cards.length,
        properties: found.data.map((p, i) => ({
          reference: p.reference,
          title: p.title,
          listingType: p.listingType,
          propertyType: cards[i]!.propertyType,
          location: cards[i]!.location,
          price: cards[i]!.priceLabel,
          areaSqm: p.area,
          bedrooms: p.bedrooms,
          bathrooms: p.bathrooms,
          parking: p.parking,
          availability: STATUS_NOTE[p.status] ?? p.status,
        })),
      },
      cards,
    };
  },
};

const detailsSchema = z.object({ reference: REFERENCE.optional() });

const getPropertyDetails: Tool = {
  declaration: {
    name: "get_property_details",
    description:
      "Get the public details and current availability of one published property by its HOME88 reference (H88-000123). Omit the reference to use the property the visitor is currently viewing.",
    parametersJsonSchema: { type: "object", properties: { reference: { type: "string", description: "e.g. H88-000123" } } },
  },
  async run(args, ctx) {
    const reference = detailsSchema.parse(args).reference ?? ctx.currentProperty?.reference;
    if (!reference) return failure("REFERENCE_REQUIRED");
    const p = await ctx.deps.getProperty(reference, ctx.locale);
    // Unpublished, withdrawn, sold and unknown all look the same from outside.
    if (!p) return failure("NOT_FOUND_OR_NOT_PUBLIC");
    return {
      result: {
        success: true,
        reference: p.reference,
        title: p.title,
        listingType: p.listingType,
        propertyType: label(PROPERTY_TYPE_LABELS, p.propertyType, ctx.locale),
        availability: STATUS_NOTE[p.status] ?? p.status,
        location: [p.neighborhood, p.areaName, p.city].filter(Boolean).join(", "),
        price: formatPrice(p.price, p.priceOnRequest, p.listingType, ctx.locale),
        areaSqm: p.area,
        plotAreaSqm: p.plotArea,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        floor: p.floor,
        totalFloors: p.totalFloors,
        yearBuilt: p.yearBuilt,
        condition: p.condition,
        heating: p.heating,
        energyClass: p.energyClass,
        features: {
          parking: p.parking, storage: p.storage, balcony: p.balcony, garden: p.garden, pool: p.pool,
          furnished: p.furnished, petsAllowed: p.petsAllowed, seaView: p.seaView, solar: p.hasSolar,
        },
        description: p.description.slice(0, 1500),
        // The agent's name only; contact details are never part of the public record.
        agent: p.agent?.name ?? null,
        url: `/property/${p.reference}`,
      },
      cards: [toCard(p, ctx.locale)],
    };
  },
};

const inquirySchema = z.object({ ...personShape, reference: REFERENCE.optional(), message: text(1500).optional() });

const createPropertyInquiry: Tool = {
  declaration: {
    name: "create_property_inquiry",
    description:
      "Record that the visitor is interested in a property so a HOME88 agent contacts them. Only call after the visitor has given their name, a way to contact them, their date of birth, confirmed they are 18 or older and agreed to the processing of their details. Never invent any of these values.",
    parametersJsonSchema: {
      type: "object",
      properties: { ...personProps, reference: { type: "string", description: "Property reference; defaults to the page the visitor is on." }, message: { type: "string" } },
      required: personRequired,
    },
  },
  async run(args, ctx) {
    const a = inquirySchema.parse(args);
    const reference = a.reference ?? ctx.currentProperty?.reference;
    if (!reference) return failure("REFERENCE_REQUIRED");
    if (!(await publicReference(ctx, reference))) return failure("NOT_FOUND_OR_NOT_PUBLIC");
    return runIntake("property_inquiry", "property_inquiry", args, ctx, [reference], (s, base) =>
      s.createPropertyInquiry({ ...base, propertyReference: reference, message: a.message ? `[AI Assistant] ${a.message}` : "[AI Assistant]" }),
    );
  },
};

const viewingSchema = z.object({ ...personShape, reference: REFERENCE.optional(), preferredStart: text(40).optional(), message: text(1000).optional() });

const createViewingRequest: Tool = {
  declaration: {
    name: "create_viewing_request",
    description:
      "Request a viewing of a property. This only records a REQUEST; an agent confirms it later, so never tell the visitor a viewing is booked or confirmed. Requires the same visitor details and confirmations as create_property_inquiry.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        ...personProps,
        reference: { type: "string", description: "Property reference; defaults to the page the visitor is on." },
        preferredStart: { type: "string", description: "Preferred date and time as an ISO 8601 datetime, if the visitor gave one." },
        message: { type: "string" },
      },
      required: personRequired,
    },
  },
  async run(args, ctx) {
    const a = viewingSchema.parse(args);
    const reference = a.reference ?? ctx.currentProperty?.reference;
    if (!reference) return failure("REFERENCE_REQUIRED");
    if (!(await publicReference(ctx, reference))) return failure("NOT_FOUND_OR_NOT_PUBLIC");
    return runIntake("viewing_request", "viewing_request", args, ctx, [reference, a.preferredStart ?? ""], (s, base) =>
      s.createViewingRequest({ ...base, propertyReference: reference, preferredStart: a.preferredStart ?? null, message: a.message ? `[AI Assistant] ${a.message}` : "[AI Assistant]" }),
    );
  },
};

const buyerSchema = z.object({
  ...personShape,
  listingType: z.enum(["SALE", "RENT"]),
  propertyTypes: z.array(propertyTypeSchema).max(6).optional(),
  areas: z.array(text(80)).max(8).optional(),
  minPrice: optNum(1e9),
  maxPrice: optNum(1e9),
  minArea: optNum(100_000),
  maxArea: optNum(100_000),
  minBedrooms: z.number().int().min(0).max(20).optional(),
  minBathrooms: z.number().int().min(0).max(20).optional(),
  features: z.array(z.enum(REQUEST_FEATURES)).max(12).optional(),
  notes: text(1500).optional(),
});

const createBuyerRequest: Tool = {
  declaration: {
    name: "create_buyer_request",
    description:
      "Save the visitor's property search criteria as a buyer/renter request so HOME88 can match and follow up. Requires the same visitor details and confirmations as create_property_inquiry, plus whether they want to buy or rent.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        ...personProps,
        listingType: { type: "string", enum: ["SALE", "RENT"] },
        propertyTypes: { type: "array", items: { type: "string", enum: propertyTypeSchema.options } },
        areas: { type: "array", items: { type: "string" } },
        minPrice: { type: "number" },
        maxPrice: { type: "number" },
        minArea: { type: "number" },
        maxArea: { type: "number" },
        minBedrooms: { type: "integer" },
        minBathrooms: { type: "integer" },
        features: { type: "array", items: { type: "string", enum: [...REQUEST_FEATURES] } },
        notes: { type: "string", description: "Short summary: purpose, timeframe, own use or investment." },
      },
      required: [...personRequired, "listingType"],
    },
  },
  async run(args, ctx) {
    const a = buyerSchema.parse(args);
    return runIntake("buyer_request", "buyer_request", args, ctx, [a.listingType, a.areas ?? [], a.minPrice ?? 0, a.maxPrice ?? 0, a.minBedrooms ?? 0], (s, base) =>
      s.createBuyerRequest({
        ...base,
        request: {
          listingType: a.listingType,
          propertyTypes: a.propertyTypes ?? [],
          areas: a.areas ?? [],
          minPrice: a.minPrice ?? null,
          maxPrice: a.maxPrice ?? null,
          minArea: a.minArea ?? null,
          maxArea: a.maxArea ?? null,
          minBedrooms: a.minBedrooms ?? null,
          minBathrooms: a.minBathrooms ?? null,
          features: a.features ?? [],
          notes: a.notes ? `[AI Assistant] ${a.notes}` : "[AI Assistant]",
        },
      }),
    );
  },
};

const getContactInformation: Tool = {
  declaration: {
    name: "get_home88_contact_information",
    description: "HOME88's public contact details and opening hours, from the company settings. Use instead of guessing.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  async run(_args, ctx) {
    const c = await ctx.deps.company();
    return { result: { success: true, name: c.name, phones: c.phones, email: c.email, address: c.address, hours: c.hours } };
  },
};

export const TOOLS: Record<string, Tool> = Object.fromEntries(
  [searchProperties, getPropertyDetails, createPropertyInquiry, createViewingRequest, createBuyerRequest, getContactInformation].map((t) => [t.declaration.name!, t]),
);

export const TOOL_DECLARATIONS: FunctionDeclaration[] = Object.values(TOOLS).map((t) => t.declaration);

/** Runs one model-requested call. Unknown tools and bad arguments are answered, never thrown. */
export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput & { ok: boolean }> {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined;
  if (!tool) return { ...failure("UNKNOWN_TOOL"), ok: false };
  try {
    const out = await tool.run(args, ctx);
    return { ...out, ok: out.result.success === true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ...failure("INVALID_ARGUMENTS", { fields: error.issues.map((i) => i.path.join(".")).slice(0, 6) }), ok: false };
    }
    console.error(`[home88:ai] tool ${name} failed:`, error instanceof Error ? error.constructor.name : "unknown");
    return { ...failure("TOOL_UNAVAILABLE"), ok: false };
  }
}
