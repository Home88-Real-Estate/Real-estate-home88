/**
 * Development seed.
 *
 * Safe to re-run: every record is either upserted on a unique key or skipped
 * when it already exists, so seeding twice does not duplicate rows. References
 * are allocated from the same counter the API uses, so demo rows do not collide
 * with real ones later.
 *
 * Run with `npm run db:seed` from the repo root after `db:migrate`.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Prisma } from "@home88/database";

import { db, disconnectDb } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/passwords";
import { allocateReference } from "../src/lib/references";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(resolve(repoRoot, ".env"));
loadEnvFile(resolve(here, "..", ".env"));

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

const DATABASE_URL = requireEnv("DATABASE_URL");
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? "admin@home88.gr").toLowerCase();
const ADMIN_PASSWORD = requireEnv("SEED_ADMIN_PASSWORD");
const STAFF_PASSWORD = process.env.SEED_AGENT_PASSWORD ?? ADMIN_PASSWORD;
const ROUNDS = Number(process.env.PASSWORD_HASH_ROUNDS ?? 12);
const FEED_TOKEN = process.env.SEED_FEED_TOKEN ?? "dev-feed-token";

const prisma = db();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type UpsertResult = "created" | "exists";

async function upsertUser(input: {
  email: string;
  firstName: string;
  lastName: string;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "AGENT" | "MARKETING" | "VIEWER";
  password: string;
  createdById?: string;
}): Promise<{ id: string; result: UpsertResult }> {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { id: existing.id, result: "exists" };

  const created = await prisma.user.create({
    data: {
      email,
      passwordHash: hashPassword(input.password, ROUNDS),
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      status: "ACTIVE",
      createdById: input.createdById,
    },
  });
  return { id: created.id, result: "created" };
}

async function upsertPortal(input: {
  code: string;
  name: string;
  transport: "API" | "XML_FEED" | "CSV_FEED" | "MANUAL";
  enabled: boolean;
  feedUrl?: string;
  settings?: Record<string, unknown>;
}): Promise<UpsertResult> {
  const existing = await prisma.portal.findUnique({ where: { code: input.code } });
  if (existing) return "exists";
  await prisma.portal.create({
    data: {
      code: input.code,
      name: input.name,
      transport: input.transport,
      enabled: input.enabled,
      feedUrl: input.feedUrl,
      settings: (input.settings ?? {}) as Prisma.InputJsonValue,
    },
  });
  return "created";
}

async function upsertContact(input: {
  firstName: string;
  lastName: string;
  company?: string;
  roles: Array<"BUYER" | "SELLER" | "LANDLORD" | "TENANT" | "OTHER">;
  email: string;
  phone: string;
}): Promise<{ id: string; reference: string; result: UpsertResult }> {
  const emailHash = sha256(input.email);
  const existing = await prisma.contact.findFirst({ where: { emailHash } });
  if (existing) return { id: existing.id, reference: existing.reference, result: "exists" };

  const created = await prisma.$transaction(async (tx) => {
    const reference = await allocateReference(tx, "contact");
    return tx.contact.create({
      data: {
        reference,
        firstName: input.firstName,
        lastName: input.lastName,
        company: input.company,
        roles: input.roles,
        emailHash,
        emailEncrypted: null,
        phoneEncrypted: null,
      },
    });
  });
  return { id: created.id, reference: created.reference, result: "created" };
}

async function upsertProperty(input: {
  key: string;
  titleEl: string;
  titleEn?: string;
  descriptionEl: string;
  listingType: "SALE" | "RENT" | "ASSIGNMENT";
  propertyType:
    | "APARTMENT"
    | "MAISONETTE"
    | "HOUSE"
    | "VILLA"
    | "STUDIO"
    | "OFFICE"
    | "SHOP";
  status: "DRAFT" | "ACTIVE" | "UNDER_OFFER" | "RESERVED" | "SOLD" | "RENTED" | "INACTIVE";
  price: number;
  area: number;
  bedrooms: number;
  bathrooms: number;
  city: string;
  neighborhood: string;
  agentId: string | null;
  ownerId: string | null;
}): Promise<{ id: string; reference: string; result: UpsertResult }> {
  const slug = `seed-${input.key}`;
  const existing = await prisma.property.findUnique({ where: { slug } });
  if (existing) return { id: existing.id, reference: existing.reference, result: "exists" };

  const created = await prisma.$transaction(async (tx) => {
    const reference = await allocateReference(tx, "property");
    return tx.property.create({
      data: {
        reference,
        slug,
        listingType: input.listingType,
        propertyType: input.propertyType,
        status: input.status,
        titleEl: input.titleEl,
        titleEn: input.titleEn,
        descriptionEl: input.descriptionEl,
        price: input.price,
        area: input.area,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        city: input.city,
        neighborhood: input.neighborhood,
        region: "Attica",
        agentId: input.agentId,
        ownerId: input.ownerId,
      },
    });
  });
  return { id: created.id, reference: created.reference, result: "created" };
}

async function upsertLead(input: {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
  propertyId: string;
  assignedToId: string | null;
}): Promise<UpsertResult> {
  const sourceUrl = `seed://${input.key}`;
  const existing = await prisma.lead.findFirst({ where: { sourceUrl } });
  if (existing) return "exists";

  await prisma.$transaction(async (tx) => {
    const reference = await allocateReference(tx, "lead");
    await tx.lead.create({
      data: {
        reference,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        message: input.message,
        source: "WEBSITE",
        sourceUrl,
        propertyId: input.propertyId,
        assignedToId: input.assignedToId,
        ageVerifiedAt: new Date(),
      },
    });
  });
  return "created";
}

async function main(): Promise<void> {
  let created = 0;
  let skipped = 0;
  const tally = (result: UpsertResult): void => {
    if (result === "created") created += 1;
    else skipped += 1;
  };

  // Demo data (and its demo SUPER_ADMIN) must never reach a real database.
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data with NODE_ENV=production.");
  }
  const realAdmin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN", email: { not: ADMIN_EMAIL } },
    select: { id: true },
  });
  if (realAdmin) {
    throw new Error(
      "Refusing to seed: this database already has a non-demo SUPER_ADMIN, so it is " +
        "not a development database. Demo data is for local/dev databases only.",
    );
  }

  console.log(`Seeding HOME88 into ${new URL(DATABASE_URL!).host} ...`);

  const admin = await upsertUser({
    email: ADMIN_EMAIL,
    firstName: "HOME88",
    lastName: "Admin",
    role: "SUPER_ADMIN",
    password: ADMIN_PASSWORD,
  });
  tally(admin.result);

  const manager = await upsertUser({
    email: "manager@home88.gr",
    firstName: "Maria",
    lastName: "Manager",
    role: "MANAGER",
    password: STAFF_PASSWORD,
    createdById: admin.id,
  });
  tally(manager.result);

  const agentA = await upsertUser({
    email: "agent.a@home88.gr",
    firstName: "Alex",
    lastName: "Agent",
    role: "AGENT",
    password: STAFF_PASSWORD,
    createdById: admin.id,
  });
  tally(agentA.result);

  const agentB = await upsertUser({
    email: "agent.b@home88.gr",
    firstName: "Elena",
    lastName: "Agent",
    role: "AGENT",
    password: STAFF_PASSWORD,
    createdById: admin.id,
  });
  tally(agentB.result);

  tally(
    await upsertPortal({
      code: "SPITOGATOS",
      name: "Spitogatos",
      transport: "XML_FEED",
      enabled: true,
      feedUrl: "http://localhost:4000/api/feeds/SPITOGATOS",
      settings: { feedToken: FEED_TOKEN, requirePhoto: true, minPhotos: 1 },
    }),
  );
  tally(
    await upsertPortal({
      code: "XE_GR",
      name: "XE.gr",
      transport: "CSV_FEED",
      enabled: true,
      feedUrl: "http://localhost:4000/api/feeds/XE_GR",
      settings: { feedToken: FEED_TOKEN, requirePhoto: true, minPhotos: 1 },
    }),
  );
  tally(
    await upsertPortal({
      code: "MANUAL",
      name: "Manual / other",
      transport: "MANUAL",
      enabled: true,
      settings: {},
    }),
  );

  const owner = await upsertContact({
    firstName: "Nikos",
    lastName: "Owner",
    roles: ["SELLER", "LANDLORD"],
    email: "owner.nikos@example.gr",
    phone: "+30 210 0000001",
  });
  tally(owner.result);

  const buyerEmail = "buyer.sofia@example.gr";
  const buyer = await upsertContact({
    firstName: "Sofia",
    lastName: "Buyer",
    roles: ["BUYER"],
    email: buyerEmail,
    phone: "+30 210 0000002",
  });
  tally(buyer.result);

  const landlord = await upsertContact({
    firstName: "Giorgos",
    lastName: "Landlord",
    company: "Attica Holdings",
    roles: ["LANDLORD"],
    email: "landlord.giorgos@example.gr",
    phone: "+30 210 0000003",
  });
  tally(landlord.result);

  const flat = await upsertProperty({
    key: "kolonaki-flat",
    titleEl: "Bright 3-bedroom apartment in Kolonaki",
    titleEn: "Bright 3-bedroom apartment in Kolonaki",
    descriptionEl:
      "Renovated third-floor apartment with a balcony, close to the metro and the national garden.",
    listingType: "SALE",
    propertyType: "APARTMENT",
    status: "ACTIVE",
    price: 520000,
    area: 118,
    bedrooms: 3,
    bathrooms: 2,
    city: "Athens",
    neighborhood: "Kolonaki",
    agentId: agentA.id,
    ownerId: owner.id,
  });
  tally(flat.result);

  const maisonette = await upsertProperty({
    key: "glyfada-maisonette",
    titleEl: "Sea-view maisonette in Glyfada",
    descriptionEl: "Four-level maisonette with garden and private parking, 600m from the beach.",
    listingType: "SALE",
    propertyType: "MAISONETTE",
    status: "RESERVED",
    price: 890000,
    area: 210,
    bedrooms: 4,
    bathrooms: 3,
    city: "Glyfada",
    neighborhood: "Kato Glyfada",
    agentId: agentA.id,
    ownerId: owner.id,
  });
  tally(maisonette.result);

  const rental = await upsertProperty({
    key: "exarchia-studio",
    titleEl: "Furnished studio for rent in Exarchia",
    descriptionEl: "Compact furnished studio, ideal for a student or young professional.",
    listingType: "RENT",
    propertyType: "STUDIO",
    status: "ACTIVE",
    price: 480,
    area: 34,
    bedrooms: 0,
    bathrooms: 1,
    city: "Athens",
    neighborhood: "Exarchia",
    agentId: agentB.id,
    ownerId: landlord.id,
  });
  tally(rental.result);

  const shop = await upsertProperty({
    key: "kifisia-shop",
    titleEl: "Corner shop on Kifisia high street",
    descriptionEl: "Ground-floor retail space with high footfall and a storage basement.",
    listingType: "RENT",
    propertyType: "SHOP",
    status: "DRAFT",
    price: 2200,
    area: 95,
    bedrooms: 0,
    bathrooms: 1,
    city: "Kifisia",
    neighborhood: "Center",
    agentId: agentB.id,
    ownerId: landlord.id,
  });
  tally(shop.result);

  tally(
    await upsertLead({
      key: "lead-flat",
      firstName: "Sofia",
      lastName: "Buyer",
      email: "buyer.sofia@example.gr",
      phone: "+30 210 0000002",
      message: "I would like to view the Kolonaki apartment this week.",
      propertyId: flat.id,
      assignedToId: agentA.id,
    }),
  );
  tally(
    await upsertLead({
      key: "lead-rental",
      firstName: "Petros",
      lastName: "Renter",
      email: "petros.renter@example.gr",
      phone: "+30 210 0000004",
      message: "Is the Exarchia studio still available from next month?",
      propertyId: rental.id,
      assignedToId: agentB.id,
    }),
  );

  const mediaExists = await prisma.propertyMedia.findFirst({ where: { propertyId: flat.id } });
  if (!mediaExists) {
    await prisma.propertyMedia.createMany({
      data: [
        {
          propertyId: flat.id,
          kind: "PHOTO",
          storageKey: `properties/${flat.id}/photo/2026/01/seed-cover.jpg`,
          originalName: "cover.jpg",
          mimeType: "image/jpeg",
          byteSize: 184320,
          width: 1600,
          height: 1067,
          altEl: "Kolonaki apartment living room",
          isPrimary: true,
          status: "pending_review",
        },
        {
          propertyId: flat.id,
          kind: "FLOOR_PLAN",
          storageKey: `properties/${flat.id}/floor_plan/2026/01/seed-plan.png`,
          originalName: "plan.png",
          mimeType: "image/png",
          byteSize: 51200,
          width: 1200,
          height: 900,
          altEl: "Floor plan",
          sortOrder: 1,
          status: "pending_review",
        },
      ],
    });
    created += 2;
  } else {
    skipped += 1;
  }

  const consentExists = await prisma.consentRecord.findFirst({
    where: { subjectHash: sha256(buyerEmail) },
  });
  if (!consentExists) {
    await prisma.consentRecord.create({
      data: {
        subjectHash: sha256(buyerEmail),
        email: buyerEmail,
        purpose: "PROPERTY_ENQUIRY",
        granted: true,
        policyVersion: "2026-01",
        source: "seed",
        grantedAt: new Date(),
      },
    });
    created += 1;
  } else {
    skipped += 1;
  }

  const suppressed = await prisma.emailSuppression.findUnique({
    where: { emailHash: sha256("unsubscribed@example.gr") },
  });
  if (!suppressed) {
    await prisma.emailSuppression.create({
      data: {
        email: "unsubscribed@example.gr",
        emailHash: sha256("unsubscribed@example.gr"),
        reason: "UNSUBSCRIBE",
        source: "seed",
      },
    });
    created += 1;
  } else {
    skipped += 1;
  }

  console.log(`Seed complete: ${created} created, ${skipped} already present.`);
  console.log(`Admin login: ${ADMIN_EMAIL}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
