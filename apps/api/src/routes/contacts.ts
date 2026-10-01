import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import { notFound } from "../lib/errors";
import { parseInput } from "../lib/http";
import { decryptField } from "../lib/pii";
import { db } from "../lib/prisma";
import { requireRole } from "../plugins/auth";

const listQuerySchema = z.object({
  role: z.enum(["BUYER", "SELLER", "LANDLORD", "TENANT", "OTHER"]).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * The encrypted columns are read here and replaced with their plaintext before
 * the response is built; the envelope values themselves are never sent to the
 * client, so a client-side bug cannot leak ciphertext that is stable at rest.
 */
function present<
  T extends {
    emailEncrypted: string | null;
    phoneEncrypted: string | null;
    mobileEncrypted: string | null;
  },
>(row: T) {
  const { emailEncrypted, phoneEncrypted, mobileEncrypted, ...rest } = row;
  return {
    ...rest,
    email: decryptField(emailEncrypted),
    phone: decryptField(phoneEncrypted),
    mobile: decryptField(mobileEncrypted),
  };
}

const LIST_SELECT = {
  id: true,
  reference: true,
  firstName: true,
  lastName: true,
  company: true,
  roles: true,
  emailEncrypted: true,
  phoneEncrypted: true,
  mobileEncrypted: true,
  preferredContactMethod: true,
  marketingOptOutAt: true,
  createdAt: true,
  _count: { select: { leads: true, properties: true } },
} satisfies Prisma.ContactSelect;

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.get("/contacts", { preHandler: requireRole("AGENT") }, async (request) => {
    const q = parseInput(listQuerySchema, request.query);
    const where: Prisma.ContactWhereInput = {};
    if (q.role) where.roles = { has: q.role };
    if (q.q) {
      where.OR = [
        { firstName: { contains: q.q, mode: "insensitive" } },
        { lastName: { contains: q.q, mode: "insensitive" } },
        { company: { contains: q.q, mode: "insensitive" } },
        { reference: { contains: q.q.toUpperCase() } },
      ];
    }

    const [total, rows] = await db().$transaction([
      db().contact.count({ where }),
      db().contact.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ createdAt: "desc" }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ]);

    return {
      data: rows.map(present),
      pagination: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
    };
  });

  app.get("/contacts/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    const { id } = request.params as { id: string };
    const contact = await db().contact.findUnique({
      where: { id },
      select: {
        id: true,
        reference: true,
        firstName: true,
        lastName: true,
        company: true,
        roles: true,
        emailEncrypted: true,
        phoneEncrypted: true,
        mobileEncrypted: true,
        preferredContactMethod: true,
        preferredLocale: true,
        marketingOptOutAt: true,
        createdAt: true,
        updatedAt: true,
        properties: { select: { id: true, reference: true, titleEl: true, status: true } },
        leads: { select: { id: true, reference: true, status: true, createdAt: true } },
      },
    });
    if (!contact) throw notFound("Contact not found.");
    return { contact: present(contact) };
  });
}
