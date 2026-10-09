/**
 * Integration-test harness: a real Postgres, a fake PII port, in-memory storage.
 *
 * Tests that need a database run only when INTAKE_TEST_DATABASE_URL points at a
 * scratch database with the migrations applied; otherwise they are skipped, not
 * silently passed. The tables are emptied before every test.
 */

import { createHash } from "node:crypto";
import { PrismaClient } from "@home88/database";

import { MemoryStorage } from "../memory-storage";
import type { PiiPort } from "../ports";
import { normalisePhone } from "../normalise";
import { PublicLeadIntakeService, type Base } from "../service";
import { DEFAULT_UPLOAD_LIMITS, type UploadLimits } from "../files";

export const TEST_DATABASE_URL = process.env.INTAKE_TEST_DATABASE_URL ?? "";
export const hasTestDatabase = TEST_DATABASE_URL.length > 0;

const h = (v: string) => createHash("sha256").update(`test-pepper:${v}`).digest("hex");

export const testPii: PiiPort = {
  hashEmail: (e) => (e && e.trim() ? h(`e:${e.trim().toLowerCase()}`) : null),
  hashPhone: (p) => {
    const n = normalisePhone(p);
    return n ? h(`p:${n}`) : null;
  },
  hashSubject: (v) => (v && v.trim() ? h(`s:${v.trim().toLowerCase()}`) : null),
  encrypt: (v) => (v ? `enc:${Buffer.from(v).toString("base64")}` : null),
};

let client: PrismaClient | null = null;
export function testPrisma(): PrismaClient {
  client ??= new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  return client;
}

const TABLES = [
  "intake_receipts", "intake_upload_sessions", "crm_notifications", "viewing_requests", "documents", "property_media",
  "property_submissions", "leads", "buyer_requests", "contacts", "consent_records", "audit_logs", "property_status_history",
  "property_price_history", "properties", "ReferenceCounter", "sessions", "users",
];

export async function resetDatabase(): Promise<void> {
  const prisma = testPrisma();
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export function makeService(over: { limits?: Partial<UploadLimits>; now?: () => Date; storage?: MemoryStorage } = {}) {
  const storage = over.storage ?? new MemoryStorage();
  const limits = { ...DEFAULT_UPLOAD_LIMITS, minDimension: 100, ...(over.limits ?? {}) };
  const service = new PublicLeadIntakeService({
    prisma: testPrisma(),
    pii: testPii,
    storage,
    now: over.now,
    config: { policyVersion: "test-1", ownHosts: ["home88.test"], limits },
  });
  return { service, storage, limits, prisma: testPrisma() };
}

/** An adult, so the age gate passes. */
export const ADULT = { dateOfBirth: "1985-06-15", ageAffirmation: true } as Base["age"];

export function base(over: Partial<Omit<Base, "person">> & { person?: Partial<Base["person"]> } = {}): Base {
  return {
    person: { firstName: "Μαρία", lastName: "Παπαδοπούλου", email: "maria@example.com", phone: "210 123 4567", ...(over.person ?? {}) } as Base["person"],
    age: over.age ?? ADULT,
    consent: over.consent,
    meta: over.meta ?? { ip: "203.0.113.5", userAgent: "test", attribution: { landingPage: "/submit?x=1", referrer: "https://www.google.com/" }, idempotencyKey: null },
  };
}

export const DRAFT = {
  titleEl: "Διαμέρισμα στη Γλυφάδα",
  descriptionEl: "Φωτεινό διαμέρισμα 3ου ορόφου, ανακαινισμένο.",
  listingType: "SALE" as const,
  propertyType: "APARTMENT",
  price: 450000,
  area: 105,
  bedrooms: 3,
  city: "Γλυφάδα",
  neighborhood: "Κέντρο",
};

/**
 * Puts a property on the website the way the publication service leaves it: a
 * live, selected, public, indexable publication. Tests that need a page visitors
 * can see use this (the legacy `publishedOnWebsite` flag alone no longer does).
 */
export async function publishFixture(
  property: { id: string; slug: string },
  over: Partial<{ status: "PUBLISHED" | "OUTDATED" | "UPDATE_PENDING" | "UNPUBLISHED" | "DRAFT" | "SOLD" | "RENTED" | "ARCHIVED"; enabled: boolean; visibility: "PUBLIC" | "NOINDEX" | "PRIVATE"; noIndex: boolean }> = {},
) {
  const prisma = testPrisma();
  const data = { status: "PUBLISHED" as const, enabled: true, visibility: "PUBLIC" as const, noIndex: false, ...over };
  await prisma.property.update({ where: { id: property.id }, data: { publishedOnWebsite: data.enabled && ["PUBLISHED", "OUTDATED", "UPDATE_PENDING"].includes(data.status) } });
  return prisma.websitePublication.create({
    data: { id: `wp_${property.id}`, propertyId: property.id, slug: property.slug, sitemapIncluded: data.visibility === "PUBLIC" && !data.noIndex, lastPublishedAt: new Date(), ...data },
  });
}
