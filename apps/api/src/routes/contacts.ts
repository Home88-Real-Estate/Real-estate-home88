import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import { toCsv } from "@home88/domain";

import { writeAudit } from "../lib/audit";
import { CONTACT_LIST_SELECT, contactFilterSchema, contactOrder, contactWhere, presentContact, touchContact, CONTACT_ROLES, CONTACT_STATUSES } from "../lib/contacts";
import { hasDocPermission } from "../lib/doc-permissions";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { decryptField, encryptField, hashEmail, hashPhone } from "../lib/pii";
import { db } from "../lib/prisma";
import { allocateReference } from "../lib/references";
import { requireRole, roleAtLeast } from "../plugins/auth";

const listQuerySchema = contactFilterSchema.extend({
  sort: z.enum(["createdAt", "lastActivityAt", "lastName", "firstName"]).optional(),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const email = z.string().trim().toLowerCase().email("Μη έγκυρη διεύθυνση email.").max(200);

const contactFields = {
  firstName: z.string().trim().max(100),
  lastName: z.string().trim().max(100),
  company: optionalText(200),
  email: email.optional().or(z.literal("")),
  phone: optionalText(40),
  mobile: optionalText(40),
  workPhone: optionalText(40),
  city: optionalText(100),
  postalCode: optionalText(20),
  taxId: optionalText(30),
  address: optionalText(300),
  roles: z.array(z.enum(CONTACT_ROLES)).max(5),
  preferredContactMethod: z.enum(["ANY", "EMAIL", "PHONE", "SMS", "WHATSAPP"]),
  preferredLocale: z.enum(["el", "en"]),
  assignedToId: z.string().trim().min(1).max(40).nullable(),
  status: z.enum(CONTACT_STATUSES),
};

const createSchema = z
  .object({ ...contactFields, firstName: contactFields.firstName.default(""), lastName: contactFields.lastName.default(""), roles: contactFields.roles.default([]), preferredContactMethod: contactFields.preferredContactMethod.default("ANY"), preferredLocale: contactFields.preferredLocale.default("el"), assignedToId: contactFields.assignedToId.optional(), status: contactFields.status.default("ACTIVE"), confirmDuplicate: z.boolean().default(false) })
  .refine((v) => v.firstName.trim() || v.lastName.trim() || v.company?.trim(), { message: "Συμπληρώστε όνομα, επώνυμο ή εταιρεία.", path: ["lastName"] });

const patchSchema = z.object(contactFields).partial();

const bulkSchema = z.object({
  ids: z.array(z.string().min(1).max(40)).min(1, "Επιλέξτε τουλάχιστον μία επαφή.").max(200),
  action: z.enum(["assign", "status", "marketing_opt_out", "marketing_opt_in", "sms_opt_out", "sms_opt_in"]),
  assignedToId: z.string().trim().min(1).max(40).nullable().optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
});

const linkSchema = z.object({
  propertyId: z.string().min(1).max(40),
  relation: z.enum(["OWNER", "CO_OWNER", "BUYER", "TENANT", "INTERESTED"]),
  notes: optionalText(500),
});

const str = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Name of a user for display; never their email. */
const userName = (u: { firstName: string; lastName: string } | null | undefined) => (u ? `${u.firstName} ${u.lastName}`.trim() : null);

const EXPORT_LIMIT = 5000;

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };

  async function activeUser(id: string) {
    const user = await db().user.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!user || user.status !== "ACTIVE") throw badRequest("Ο διαχειριστής πρέπει να είναι ενεργός χρήστης.");
  }

  async function requirePerm(role: string, code: string, message: string) {
    if (!(await hasDocPermission(role, code))) throw forbidden(message);
  }

  async function loadContact(id: string) {
    const c = await db().contact.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw notFound("Η επαφή δεν βρέθηκε.");
    return c;
  }

  // ---- List -------------------------------------------------------------
  app.get("/contacts", agent, async (request) => {
    const q = parseInput(listQuerySchema, request.query);
    const where = contactWhere(q);
    const [total, rows] = await db().$transaction([
      db().contact.count({ where }),
      db().contact.findMany({ where, select: CONTACT_LIST_SELECT, orderBy: contactOrder(q.sort, q.dir), skip: (q.page - 1) * q.limit, take: q.limit }),
    ]);
    return {
      data: rows.map(presentContact),
      pagination: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
    };
  });

  // What the signed-in user may do with contact lists; the CRM shows or hides the buttons from this (the routes check again).
  app.get("/contacts/permissions", agent, async (request) => {
    const role = request.auth!.user.role;
    const codes = ["contacts.export", "contacts.export_sensitive", "contacts.bulk_assign", "contacts.bulk_update"];
    const entries = await Promise.all(codes.map(async (c) => [c, await hasDocPermission(role, c)] as const));
    return { can: Object.fromEntries(entries) };
  });

  // ---- Export (CSV) -----------------------------------------------------
  // Same filters as the list. Identity data (ΑΦΜ, address) is a separate permission and an explicit choice.
  app.get("/contacts/export", agent, async (request, reply) => {
    const actor = request.auth!.user;
    await requirePerm(actor.role, "contacts.export", "Δεν έχετε δικαίωμα εξαγωγής επαφών.");
    const q = parseInput(listQuerySchema.extend({ sensitive: z.enum(["1", "0"]).optional(), ids: z.string().max(8000).optional() }), request.query);
    const withSensitive = q.sensitive === "1";
    if (withSensitive) await requirePerm(actor.role, "contacts.export_sensitive", "Δεν έχετε δικαίωμα εξαγωγής ευαίσθητων στοιχείων ταυτότητας.");

    const ids = q.ids ? q.ids.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200) : null;
    const where: Prisma.ContactWhereInput = ids ? { AND: [contactWhere(q), { id: { in: ids } }] } : contactWhere(q);
    const rows = await db().contact.findMany({
      where,
      select: { ...CONTACT_LIST_SELECT, taxIdEncrypted: true, addressEncrypted: true, city: true, postalCode: true },
      orderBy: contactOrder(q.sort, q.dir),
      take: EXPORT_LIMIT + 1,
    });
    if (rows.length > EXPORT_LIMIT) throw badRequest(`Η εξαγωγή υποστηρίζει έως ${EXPORT_LIMIT} επαφές. Περιορίστε τα φίλτρα.`);

    const ROLE_EL: Record<string, string> = { BUYER: "Αγοραστής", SELLER: "Πωλητής", LANDLORD: "Εκμισθωτής", TENANT: "Μισθωτής", OTHER: "Άλλο" };
    const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
    const view = rows.map((r) => ({ r, p: presentContact(r) }));
    const columns = [
      { header: "Κωδικός", value: (x: (typeof view)[number]) => x.p.reference },
      { header: "Όνομα", value: (x: (typeof view)[number]) => x.p.firstName },
      { header: "Επώνυμο", value: (x: (typeof view)[number]) => x.p.lastName },
      { header: "Εταιρεία", value: (x: (typeof view)[number]) => x.p.company },
      { header: "Σχέση", value: (x: (typeof view)[number]) => x.p.roles.map((s) => ROLE_EL[s] ?? s).join(", ") },
      { header: "Τηλέφωνο", value: (x: (typeof view)[number]) => x.p.mobile || x.p.phone },
      { header: "Email", value: (x: (typeof view)[number]) => x.p.email },
      { header: "Διαχειριστής", value: (x: (typeof view)[number]) => x.p.assignedTo?.name ?? "" },
      { header: "Τελευταία δραστηριότητα", value: (x: (typeof view)[number]) => date(x.p.lastActivityAt) },
      { header: "Ημερομηνία καταχώρησης", value: (x: (typeof view)[number]) => date(x.p.createdAt) },
      { header: "Κατάσταση", value: (x: (typeof view)[number]) => (x.p.status === "ACTIVE" ? "Ενεργή" : "Ανενεργή") },
      { header: "Πόλη", value: (x: (typeof view)[number]) => x.r.city },
      { header: "Τ.Κ.", value: (x: (typeof view)[number]) => x.r.postalCode },
      ...(withSensitive
        ? [
            { header: "ΑΦΜ", value: (x: (typeof view)[number]) => decryptField(x.r.taxIdEncrypted) },
            { header: "Διεύθυνση", value: (x: (typeof view)[number]) => decryptField(x.r.addressEncrypted) },
          ]
        : []),
    ];
    const csv = toCsv(columns, view);

    // The audit row records who exported what (the filter and the count), never the exported values.
    const { sort: _s, dir: _d, page: _p, limit: _l, sensitive: _x, ids: _i, ...filter } = q;
    await writeAudit({ entity: "CONTACT", entityId: "export", action: withSensitive ? "export:sensitive" : "export", changes: { count: rows.length, filter, selected: ids?.length ?? null }, actorId: actor.id, ipAddress: clientIp(request), userAgent: userAgent(request) });

    reply.header("cache-control", "no-store");
    reply.header("content-disposition", `attachment; filename="home88-contacts-${new Date().toISOString().slice(0, 10)}.csv"`);
    reply.type("text/csv; charset=utf-8");
    return csv;
  });

  // ---- Create -----------------------------------------------------------
  app.post("/contacts", agent, async (request, reply) => {
    const actor = request.auth!.user;
    const input = parseInput(createSchema, request.body);
    const assignee = input.assignedToId === undefined ? actor.id : input.assignedToId;
    if (assignee && assignee !== actor.id) {
      if (!roleAtLeast(actor.role, "MANAGER")) throw forbidden("Μόνο ένας υπεύθυνος μπορεί να αναθέσει επαφή σε άλλον.");
      await activeUser(assignee);
    }

    const emailHash = hashEmail(input.email);
    const phoneHash = hashPhone(input.mobile || input.phone);
    if (!input.confirmDuplicate && (emailHash || phoneHash)) {
      // Never merged automatically: a possible duplicate needs a person to decide.
      const dups = await db().contact.findMany({ where: { OR: [...(emailHash ? [{ emailHash }] : []), ...(phoneHash ? [{ phoneHash }] : [])] }, select: { id: true, reference: true, firstName: true, lastName: true }, take: 5 });
      if (dups.length) {
        reply.code(409);
        return { error: { code: "potential_duplicate", message: "Υπάρχει ήδη επαφή με το ίδιο email ή τηλέφωνο. Ελέγξτε πριν δημιουργήσετε νέα.", duplicates: dups } };
      }
    }

    const roles = input.roles;
    const contact = await db().$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          reference: await allocateReference(tx, "contact", "C"),
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          company: str(input.company),
          roles,
          status: input.status,
          assignedToId: assignee,
          lastActivityAt: new Date(),
          city: str(input.city),
          postalCode: str(input.postalCode),
          emailEncrypted: encryptField(str(input.email)),
          emailHash,
          phoneEncrypted: encryptField(str(input.phone)),
          mobileEncrypted: encryptField(str(input.mobile)),
          workPhoneEncrypted: encryptField(str(input.workPhone)),
          phoneHash,
          taxIdEncrypted: encryptField(str(input.taxId)),
          addressEncrypted: encryptField(str(input.address)),
          preferredContactMethod: input.preferredContactMethod,
          preferredLocale: input.preferredLocale,
        },
        select: { id: true, reference: true },
      });
      await writeAudit({ entity: "CONTACT", entityId: created.id, action: "create", changes: { roles, assignedToId: assignee, duplicateConfirmed: input.confirmDuplicate }, actorId: actor.id, ipAddress: clientIp(request), userAgent: userAgent(request) }, tx);
      return created;
    });
    reply.code(201);
    return { contact };
  });

  // ---- Bulk -------------------------------------------------------------
  app.post("/contacts/bulk", agent, async (request) => {
    const actor = request.auth!.user;
    const input = parseInput(bulkSchema, request.body);
    const isConsent = input.action.endsWith("_opt_out") || input.action.endsWith("_opt_in");
    if (input.action === "assign") {
      await requirePerm(actor.role, "contacts.bulk_assign", "Δεν έχετε δικαίωμα μαζικής ανάθεσης.");
      if (input.assignedToId === undefined) throw badRequest("Επιλέξτε διαχειριστή.");
      if (input.assignedToId) await activeUser(input.assignedToId);
    } else {
      await requirePerm(actor.role, "contacts.bulk_update", "Δεν έχετε δικαίωμα μαζικής αλλαγής.");
      if (input.action === "status" && !input.status) throw badRequest("Επιλέξτε κατάσταση.");
    }

    const ids = [...new Set(input.ids)];
    const existing = await db().contact.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const found = existing.map((c) => c.id);
    const now = new Date();
    const data: Prisma.ContactUpdateManyMutationInput & { assignedToId?: string | null } =
      input.action === "assign" ? { assignedToId: input.assignedToId ?? null }
      : input.action === "status" ? { status: input.status }
      : input.action === "marketing_opt_out" ? { marketingOptOutAt: now }
      : input.action === "marketing_opt_in" ? { marketingOptOutAt: null }
      : input.action === "sms_opt_out" ? { smsOptOutAt: now }
      : { smsOptOutAt: null };

    await db().$transaction(async (tx) => {
      await tx.contact.updateMany({ where: { id: { in: found } }, data: { ...data, lastActivityAt: now } });
      for (const id of found) {
        await writeAudit({ entity: "CONTACT", entityId: id, action: `bulk:${input.action}`, changes: { assignedToId: input.assignedToId, status: input.status, consent: isConsent ? input.action : undefined, batchSize: found.length }, actorId: actor.id, ipAddress: clientIp(request), userAgent: userAgent(request) }, tx);
      }
    });
    return { updated: found.length, skipped: ids.length - found.length };
  });

  // ---- Detail -----------------------------------------------------------
  app.get("/contacts/:id", agent, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const contact = await db().contact.findUnique({
      where: { id },
      select: {
        ...CONTACT_LIST_SELECT,
        preferredLocale: true,
        updatedAt: true,
        city: true,
        postalCode: true,
        workPhoneEncrypted: true,
        taxIdEncrypted: true,
        addressEncrypted: true,
        properties: { select: { id: true, reference: true, titleEl: true, status: true } },
        leads: { select: { id: true, reference: true, status: true, createdAt: true } },
        sellerLeads: { select: { id: true, reference: true, stage: true, listingType: true, createdAt: true }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!contact) throw notFound("Η επαφή δεν βρέθηκε.");
    const { taxIdEncrypted, addressEncrypted, workPhoneEncrypted, ...rest } = contact;
    // ΑΦΜ and address follow the same permission that governs identity data on showings and mandates.
    const sensitive = await hasDocPermission(actor.role, "showings.view_sensitive_data");
    return {
      contact: {
        ...presentContact(rest as never),
        preferredLocale: contact.preferredLocale,
        updatedAt: contact.updatedAt,
        city: contact.city,
        postalCode: contact.postalCode,
        workPhone: decryptField(workPhoneEncrypted),
        taxId: sensitive ? decryptField(taxIdEncrypted) : null,
        address: sensitive ? decryptField(addressEncrypted) : null,
        sensitiveHidden: !sensitive,
        hasTaxId: Boolean(taxIdEncrypted),
        hasAddress: Boolean(addressEncrypted),
        properties: contact.properties,
        leads: contact.leads,
        sellerLeads: contact.sellerLeads,
      },
    };
  });

  // ---- Update -----------------------------------------------------------
  app.patch("/contacts/:id", agent, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const input = parseInput(patchSchema, request.body);
    await loadContact(id);
    if (input.assignedToId !== undefined && input.assignedToId !== actor.id) {
      if (!roleAtLeast(actor.role, "MANAGER")) throw forbidden("Μόνο ένας υπεύθυνος μπορεί να αναθέσει επαφή σε άλλον.");
      if (input.assignedToId) await activeUser(input.assignedToId);
    }

    const data: Prisma.ContactUncheckedUpdateInput = { lastActivityAt: new Date() };
    if (input.firstName !== undefined) data.firstName = input.firstName.trim();
    if (input.lastName !== undefined) data.lastName = input.lastName.trim();
    if (input.company !== undefined) data.company = str(input.company);
    if (input.roles !== undefined) data.roles = input.roles;
    if (input.status !== undefined) data.status = input.status;
    if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId;
    if (input.city !== undefined) data.city = str(input.city);
    if (input.postalCode !== undefined) data.postalCode = str(input.postalCode);
    if (input.preferredContactMethod !== undefined) data.preferredContactMethod = input.preferredContactMethod;
    if (input.preferredLocale !== undefined) data.preferredLocale = input.preferredLocale;
    if (input.email !== undefined) {
      data.emailEncrypted = encryptField(str(input.email));
      data.emailHash = hashEmail(input.email);
    }
    if (input.phone !== undefined) data.phoneEncrypted = encryptField(str(input.phone));
    if (input.mobile !== undefined) data.mobileEncrypted = encryptField(str(input.mobile));
    if (input.workPhone !== undefined) data.workPhoneEncrypted = encryptField(str(input.workPhone));
    if (input.phone !== undefined || input.mobile !== undefined) {
      const cur = await db().contact.findUniqueOrThrow({ where: { id }, select: { phoneEncrypted: true, mobileEncrypted: true } });
      const mobile = input.mobile !== undefined ? str(input.mobile) : decryptField(cur.mobileEncrypted);
      const phone = input.phone !== undefined ? str(input.phone) : decryptField(cur.phoneEncrypted);
      data.phoneHash = hashPhone(mobile || phone);
    }
    if (input.taxId !== undefined) data.taxIdEncrypted = encryptField(str(input.taxId));
    if (input.address !== undefined) data.addressEncrypted = encryptField(str(input.address));

    await db().$transaction(async (tx) => {
      await tx.contact.update({ where: { id }, data });
      await writeAudit({ entity: "CONTACT", entityId: id, action: "update", changes: { fields: Object.keys(input), ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId } : {}), ...(input.status ? { status: input.status } : {}) }, actorId: actor.id, ipAddress: clientIp(request), userAgent: userAgent(request) }, tx);
    });
    return { ok: true };
  });

  // ---- Tab: properties --------------------------------------------------
  const PROPERTY_PICK = { id: true, reference: true, titleEl: true, status: true, listingType: true, propertyType: true, city: true, areaName: true, price: true, area: true } satisfies Prisma.PropertySelect;
  const REL_LABEL: Record<string, string> = { OWNER: "Ιδιοκτήτης", CO_OWNER: "Συνιδιοκτήτης", BUYER: "Αγοραστής", TENANT: "Μισθωτής", INTERESTED: "Ενδιαφερόμενος" };

  app.get("/contacts/:id/properties", agent, async (request) => {
    const { id } = request.params as { id: string };
    await loadContact(id);
    const [owned, shared, links] = await Promise.all([
      // Deleted properties live in the bin, not in a contact's tabs.
      db().property.findMany({ where: { ownerId: id, status: { not: "DELETED" } }, select: PROPERTY_PICK }),
      db().propertyOwner.findMany({ where: { contactId: id, property: { status: { not: "DELETED" } } }, select: { id: true, capacity: true, ownershipPercentage: true, property: { select: PROPERTY_PICK } } }),
      db().contactProperty.findMany({ where: { contactId: id, property: { status: { not: "DELETED" } } }, orderBy: { createdAt: "desc" }, select: { id: true, relation: true, notes: true, createdAt: true, property: { select: PROPERTY_PICK } } }),
    ]);
    const seen = new Set<string>();
    const data: Array<{ key: string; linkId: string | null; removable: boolean; relation: string; relationLabel: string; share: number | null; property: unknown }> = [];
    for (const o of shared) {
      const rel = o.capacity === "CO_OWNER" ? "CO_OWNER" : "OWNER";
      seen.add(`${o.property.id}:${rel}`);
      data.push({ key: `o:${o.id}`, linkId: null, removable: false, relation: rel, relationLabel: REL_LABEL[rel]!, share: o.ownershipPercentage ? Number(o.ownershipPercentage) : null, property: o.property });
    }
    for (const p of owned) {
      if (seen.has(`${p.id}:OWNER`) || seen.has(`${p.id}:CO_OWNER`)) continue;
      data.push({ key: `p:${p.id}`, linkId: null, removable: false, relation: "OWNER", relationLabel: REL_LABEL.OWNER!, share: null, property: p });
    }
    for (const l of links) data.push({ key: `l:${l.id}`, linkId: l.id, removable: true, relation: l.relation, relationLabel: REL_LABEL[l.relation]!, share: null, property: l.property });
    return { data };
  });

  app.post("/contacts/:id/properties", agent, async (request, reply) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const input = parseInput(linkSchema, request.body);
    await loadContact(id);
    const property = await db().property.findUnique({ where: { id: input.propertyId }, select: { id: true } });
    if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");

    if (input.relation === "OWNER" || input.relation === "CO_OWNER") {
      // Ownership has its own table (shares, signatories, authority); reuse it instead of a second source of truth.
      const already = await db().propertyOwner.findFirst({ where: { propertyId: property.id, contactId: id }, select: { id: true } });
      if (already) throw conflict("Η επαφή είναι ήδη συνδεδεμένη ως ιδιοκτήτης με αυτό το ακίνητο.");
      await db().propertyOwner.create({ data: { propertyId: property.id, contactId: id, capacity: input.relation === "OWNER" ? "OWNER" : "CO_OWNER", notes: str(input.notes) } });
    } else {
      const dup = await db().contactProperty.findUnique({ where: { contactId_propertyId_relation: { contactId: id, propertyId: property.id, relation: input.relation } }, select: { id: true } });
      if (dup) throw conflict("Η σύνδεση υπάρχει ήδη.");
      await db().contactProperty.create({ data: { contactId: id, propertyId: property.id, relation: input.relation, notes: str(input.notes), createdById: actor.id } });
    }
    await touchContact(id);
    await writeAudit({ entity: "CONTACT", entityId: id, action: "link_property", changes: { propertyId: property.id, relation: input.relation }, actorId: actor.id, ipAddress: clientIp(request), userAgent: userAgent(request) });
    reply.code(201);
    return { ok: true };
  });

  app.delete("/contacts/:id/properties/:linkId", agent, async (request) => {
    const actor = request.auth!.user;
    const { id, linkId } = request.params as { id: string; linkId: string };
    const link = await db().contactProperty.findFirst({ where: { id: linkId, contactId: id }, select: { id: true, propertyId: true, relation: true } });
    if (!link) throw notFound("Η σύνδεση δεν βρέθηκε.");
    await db().contactProperty.delete({ where: { id: link.id } });
    await writeAudit({ entity: "CONTACT", entityId: id, action: "unlink_property", changes: { propertyId: link.propertyId, relation: link.relation }, actorId: actor.id, ipAddress: clientIp(request), userAgent: userAgent(request) });
    return { ok: true };
  });

  // ---- Tab: requests ----------------------------------------------------
  app.get("/contacts/:id/requests", agent, async (request) => {
    const { id } = request.params as { id: string };
    await loadContact(id);
    const rows = await db().buyerRequest.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, reference: true, status: true, listingType: true, propertyTypes: true, areas: true, minPrice: true, maxPrice: true, minArea: true, maxArea: true, createdAt: true, assignedTo: { select: { firstName: true, lastName: true } } },
    });
    return {
      data: rows.map((r) => ({ id: r.id, reference: r.reference, status: r.status, listingType: r.listingType, propertyTypes: r.propertyTypes, areas: r.areas, minPrice: r.minPrice ? Number(r.minPrice) : null, maxPrice: r.maxPrice ? Number(r.maxPrice) : null, minArea: r.minArea ? Number(r.minArea) : null, maxArea: r.maxArea ? Number(r.maxArea) : null, createdAt: r.createdAt, agent: userName(r.assignedTo) })),
    };
  });

  // ---- Tab: showings ----------------------------------------------------
  app.get("/contacts/:id/showings", agent, async (request) => {
    const { id } = request.params as { id: string };
    await loadContact(id);
    const rows = await db().showing.findMany({
      where: { contactId: id },
      orderBy: [{ visitAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
      select: { id: true, number: true, status: true, visitAt: true, documentDate: true, comments: true, createdAt: true, responsibleUser: { select: { firstName: true, lastName: true } }, properties: { orderBy: { sortOrder: "asc" }, select: { propertyCodeSnapshot: true, addressSnapshot: true } } },
    });
    return { data: rows.map((s) => ({ id: s.id, number: s.number, status: s.status, visitAt: s.visitAt, createdAt: s.createdAt, comments: s.comments, agent: userName(s.responsibleUser), properties: s.properties.map((p) => ({ code: p.propertyCodeSnapshot, address: p.addressSnapshot })) })) };
  });

  // ---- Tab: reminders (the existing reminders module; no second system) --
  app.get("/contacts/:id/reminders", agent, async (request) => {
    const { id } = request.params as { id: string };
    await loadContact(id);
    const rows = await db().task.findMany({
      where: { OR: [{ contactId: id }, { lead: { contactId: id } }] },
      orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }],
      take: 100,
      select: { id: true, title: true, status: true, priority: true, dueAt: true, showingId: true, assignedTo: { select: { firstName: true, lastName: true } } },
    });
    return { data: rows.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt, showingId: t.showingId, assignee: userName(t.assignedTo) })) };
  });

  // ---- Tab: mandates ----------------------------------------------------
  app.get("/contacts/:id/mandates", agent, async (request) => {
    const { id } = request.params as { id: string };
    await loadContact(id);
    const parties = await db().mandateParty.findMany({
      where: { contactId: id },
      take: 100,
      orderBy: { createdAt: "desc" },
      select: { role: true, mandate: { select: { id: true, reference: true, number: true, type: true, status: true, startsAt: true, endsAt: true, createdAt: true, property: { select: { reference: true, titleEl: true } } } } },
    });
    return { data: parties.map((p) => ({ role: p.role, id: p.mandate.id, reference: p.mandate.reference, number: p.mandate.number, type: p.mandate.type, status: p.mandate.status, startsAt: p.mandate.startsAt, endsAt: p.mandate.endsAt, createdAt: p.mandate.createdAt, property: p.mandate.property })) };
  });

  // ---- Tab: documents ---------------------------------------------------
  app.get("/contacts/:id/documents", agent, async (request) => {
    const { id } = request.params as { id: string };
    await loadContact(id);
    const rows = await db().document.findMany({ where: { contactId: id }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true, category: true, mimeType: true, byteSize: true, containsPersonalData: true, createdAt: true } });
    return { data: rows };
  });

  // ---- Tab: history (chronological, from the real tables) ----------------
  app.get("/contacts/:id/timeline", agent, async (request) => {
    const { id } = request.params as { id: string };
    const contact = await db().contact.findUnique({ where: { id }, select: { id: true, createdAt: true } });
    if (!contact) throw notFound("Η επαφή δεν βρέθηκε.");
    const take = 60;
    const [showings, tasks, requests, viewings, offers, messages, mandates, audits, links, leads, owned] = await Promise.all([
      db().showing.findMany({ where: { contactId: id }, orderBy: { createdAt: "desc" }, take, select: { id: true, number: true, status: true, createdAt: true, visitAt: true, properties: { select: { id: true } } } }),
      db().task.findMany({ where: { contactId: id }, orderBy: { createdAt: "desc" }, take, select: { id: true, title: true, createdAt: true, showingId: true } }),
      db().buyerRequest.findMany({ where: { contactId: id }, orderBy: { createdAt: "desc" }, take, select: { id: true, reference: true, createdAt: true } }),
      db().viewing.findMany({ where: { contactId: id }, orderBy: { startsAt: "desc" }, take, select: { id: true, startsAt: true, status: true, property: { select: { reference: true } } } }),
      db().offer.findMany({ where: { contactId: id }, orderBy: { createdAt: "desc" }, take, select: { id: true, reference: true, createdAt: true, status: true } }),
      db().message.findMany({ where: { contactId: id }, orderBy: { createdAt: "desc" }, take, select: { id: true, channel: true, purpose: true, status: true, createdAt: true } }),
      db().mandateParty.findMany({ where: { contactId: id }, orderBy: { createdAt: "desc" }, take, select: { createdAt: true, mandate: { select: { id: true, reference: true, type: true } } } }),
      db().auditLog.findMany({ where: { entity: "CONTACT", entityId: id }, orderBy: { createdAt: "desc" }, take, select: { id: true, action: true, createdAt: true } }),
      db().contactProperty.findMany({ where: { contactId: id }, orderBy: { createdAt: "desc" }, take, select: { id: true, relation: true, createdAt: true, property: { select: { id: true, reference: true } } } }),
      db().lead.findMany({ where: { contactId: id }, orderBy: { createdAt: "desc" }, take, select: { id: true, reference: true, createdAt: true } }),
      db().propertyOwner.findMany({ where: { contactId: id }, orderBy: { createdAt: "desc" }, take, select: { capacity: true, createdAt: true, property: { select: { id: true, reference: true } } } }),
    ]);

    type Item = { at: Date; type: string; title: string; href: string | null };
    const AUDIT_EL: Record<string, string> = { update: "Ενημέρωση στοιχείων" };
    const REL_EL: Record<string, string> = { BUYER: "Αγοραστής", TENANT: "Μισθωτής", INTERESTED: "Ενδιαφερόμενος" };
    const items: Item[] = [
      ...showings.map((s) => ({ at: s.createdAt, type: "showing", title: `Υπόδειξη${s.number ? ` ${s.number}` : ""} · ${s.properties.length} ακίνητα`, href: `/showings/${s.id}` })),
      ...tasks.map((t) => ({ at: t.createdAt, type: "reminder", title: `Υπενθύμιση: ${t.title}`, href: t.showingId ? `/showings/${t.showingId}` : "/tasks" })),
      ...requests.map((r) => ({ at: r.createdAt, type: "request", title: `Ζήτηση ${r.reference}`, href: `/requests/${r.id}` })),
      ...viewings.map((v) => ({ at: v.startsAt, type: "viewing", title: `Ραντεβού επίσκεψης ${v.property.reference}`, href: null })),
      ...offers.map((o) => ({ at: o.createdAt, type: "offer", title: `Προσφορά ${o.reference}`, href: `/offers/${o.id}` })),
      ...messages.map((m) => ({ at: m.createdAt, type: "message", title: `${m.channel === "SMS" ? "SMS" : "Email"} · ${m.purpose}`, href: null })),
      ...mandates.map((m) => ({ at: m.createdAt, type: "mandate", title: `Εντολή ${m.mandate.reference}`, href: `/mandates/${m.mandate.id}` })),
      ...links.map((l) => ({ at: l.createdAt, type: "property", title: `${REL_EL[l.relation] ?? l.relation}: ακίνητο ${l.property.reference}`, href: `/properties/${l.property.id}` })),
      ...owned.map((o) => ({ at: o.createdAt, type: "property", title: `${o.capacity === "CO_OWNER" ? "Συνιδιοκτήτης" : "Ιδιοκτήτης"}: ακίνητο ${o.property.reference}`, href: `/properties/${o.property.id}` })),
      ...leads.map((l) => ({ at: l.createdAt, type: "lead", title: `Lead ${l.reference}`, href: `/leads/${l.id}` })),
      ...audits.filter((a) => AUDIT_EL[a.action]).map((a) => ({ at: a.createdAt, type: "contact", title: AUDIT_EL[a.action]!, href: null })),
    ];
    items.push({ at: contact.createdAt, type: "contact", title: "Καταχώρηση επαφής", href: null });
    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { data: items.slice(0, 150) };
  });
}
