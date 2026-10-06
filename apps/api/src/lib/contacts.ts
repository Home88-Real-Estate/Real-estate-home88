/**
 * Contact workspace helpers: the list filter, "last activity" bookkeeping and
 * the shape a contact takes in lists. Email and phone are held encrypted, so
 * they are searched by their peppered hash (exact match on the whole value)
 * and only decrypted for the response.
 */

import { z } from "zod";
import type { Prisma } from "@home88/database";

import { decryptField, hashEmail, hashPhone } from "./pii";
import { db } from "./prisma";

export const CONTACT_ROLES = ["BUYER", "SELLER", "LANDLORD", "TENANT", "OTHER"] as const;
export const CONTACT_STATUSES = ["ACTIVE", "INACTIVE"] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας ΕΕΕΕ-ΜΜ-ΗΗ.");

export const contactFilterSchema = z.object({
  role: z.enum(CONTACT_ROLES).optional(),
  q: z.string().trim().max(120).optional(),
  /** User id, or "none" for contacts nobody looks after. */
  assignedToId: z.string().trim().min(1).max(40).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  createdFrom: day.optional(),
  createdTo: day.optional(),
  activeFrom: day.optional(),
  activeTo: day.optional(),
  /** Contacts with nothing recorded in the last N days. */
  inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
});
export type ContactFilter = z.infer<typeof contactFilterSchema>;

export const CONTACT_SORTS = ["createdAt", "lastActivityAt", "lastName", "firstName"] as const;

const startOf = (d: string) => new Date(`${d}T00:00:00.000Z`);
const endOf = (d: string) => new Date(`${d}T23:59:59.999Z`);

export function contactWhere(f: ContactFilter): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];
  if (f.role) and.push({ roles: { has: f.role } });
  if (f.status) and.push({ status: f.status });
  if (f.assignedToId) and.push(f.assignedToId === "none" ? { assignedToId: null } : { assignedToId: f.assignedToId });
  if (f.createdFrom || f.createdTo) and.push({ createdAt: { ...(f.createdFrom ? { gte: startOf(f.createdFrom) } : {}), ...(f.createdTo ? { lte: endOf(f.createdTo) } : {}) } });
  if (f.activeFrom || f.activeTo) and.push({ lastActivityAt: { ...(f.activeFrom ? { gte: startOf(f.activeFrom) } : {}), ...(f.activeTo ? { lte: endOf(f.activeTo) } : {}) } });
  if (f.inactiveDays) {
    const cutoff = new Date(Date.now() - f.inactiveDays * 86_400_000);
    and.push({ OR: [{ lastActivityAt: { lt: cutoff } }, { lastActivityAt: null, createdAt: { lt: cutoff } }] });
  }
  if (f.email) {
    const hash = hashEmail(f.email);
    and.push(hash ? { emailHash: hash } : { id: "__none__" });
  }
  if (f.phone) {
    const hash = hashPhone(f.phone);
    and.push(hash ? { phoneHash: hash } : { id: "__none__" });
  }
  if (f.q) {
    const text = f.q;
    const or: Prisma.ContactWhereInput[] = [
      { firstName: { contains: text, mode: "insensitive" } },
      { lastName: { contains: text, mode: "insensitive" } },
      { company: { contains: text, mode: "insensitive" } },
      { reference: { contains: text.toUpperCase() } },
    ];
    // "Μαρία Παπα" → first and last name each match one of the words.
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      or.push({ AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: "insensitive" as const } }, { lastName: { contains: w, mode: "insensitive" as const } }] })) });
    }
    if (text.includes("@")) {
      const h = hashEmail(text);
      if (h) or.push({ emailHash: h });
    } else if (/^[+\d\s()-]{6,}$/.test(text)) {
      const h = hashPhone(text);
      if (h) or.push({ phoneHash: h });
    }
    and.push({ OR: or });
  }
  return and.length ? { AND: and } : {};
}

/** Order of a list: newest first unless asked otherwise. */
export function contactOrder(sort: string | undefined, dir: "asc" | "desc"): Prisma.ContactOrderByWithRelationInput[] {
  const key = (CONTACT_SORTS as readonly string[]).includes(sort ?? "") ? (sort as (typeof CONTACT_SORTS)[number]) : "createdAt";
  if (key === "lastActivityAt") return [{ lastActivityAt: { sort: dir, nulls: "last" } }, { createdAt: "desc" }];
  return [{ [key]: dir }, { id: "asc" }] as Prisma.ContactOrderByWithRelationInput[];
}

export const CONTACT_LIST_SELECT = {
  id: true,
  reference: true,
  firstName: true,
  lastName: true,
  company: true,
  roles: true,
  status: true,
  emailEncrypted: true,
  phoneEncrypted: true,
  mobileEncrypted: true,
  preferredContactMethod: true,
  marketingOptOutAt: true,
  smsOptOutAt: true,
  lastActivityAt: true,
  createdAt: true,
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { leads: true, properties: true, showings: true } },
} satisfies Prisma.ContactSelect;

type Row = Prisma.ContactGetPayload<{ select: typeof CONTACT_LIST_SELECT }>;

/** Encrypted columns are replaced with their plaintext; the envelope never reaches the client. */
export function presentContact(row: Row) {
  const { emailEncrypted, phoneEncrypted, mobileEncrypted, assignedTo, ...rest } = row;
  return {
    ...rest,
    email: decryptField(emailEncrypted),
    phone: decryptField(phoneEncrypted),
    mobile: decryptField(mobileEncrypted),
    assignedTo: assignedTo ? { id: assignedTo.id, name: `${assignedTo.firstName} ${assignedTo.lastName}`.trim() } : null,
  };
}

/** Record that something happened with the contact. Never throws: it must not break the action that caused it. */
export async function touchContact(contactId: string | null | undefined, client: Pick<Prisma.TransactionClient, "contact"> = db(), at: Date = new Date()): Promise<void> {
  if (!contactId) return;
  try {
    await client.contact.updateMany({ where: { id: contactId }, data: { lastActivityAt: at } });
  } catch {
    /* bookkeeping only */
  }
}
