/** Party input → stored rows: identity fields encrypted, never stored in clear. */

import { z } from "zod";

import { badRequest, conflict } from "../../errors";
import { decryptField, encryptField, hasEncryptionKey } from "../../pii";
import { db } from "../../prisma";

const text = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => (v ? v : null));

export const REPRESENTATIVE_CAPACITIES = ["LEGAL_REPRESENTATIVE", "ATTORNEY_IN_FACT", "COMPANY_REPRESENTATIVE"] as const;
export const SHOWING_PARTY_ROLES = ["BUYER", "TENANT", "JOINT_BUYER", "SPOUSE", "COMPANY_REPRESENTATIVE", "ATTORNEY_IN_FACT", "AUTHORIZED_REPRESENTATIVE", "OTHER"] as const;

export const showingPartySchema = z.object({
  contactReference: z.string().trim().toUpperCase().max(20).optional().or(z.literal("")),
  role: z.enum(SHOWING_PARTY_ROLES).default("BUYER"),
  fullName: text(160),
  taxId: text(20),
  taxOffice: text(80),
  idNumber: text(30),
  address: text(300),
  email: z.string().trim().toLowerCase().email("Δώστε έγκυρο email.").max(254).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  phone: text(40),
  isSignatory: z.boolean().default(true),
  representativeCapacity: z.enum(REPRESENTATIVE_CAPACITIES).optional().nullable(),
  authorityReference: text(200),
  /** A person has checked the identity document. */
  identityVerified: z.boolean().optional(),
});
export type ShowingPartyInput = z.infer<typeof showingPartySchema>;

/** Stored rows for a showing's parties. A linked contact fills in what the form left empty. */
export async function buildShowingParties(input: ShowingPartyInput[], actorId: string) {
  const rows = [];
  for (const [i, p] of input.entries()) {
    let contactId: string | null = null;
    let fullName = p.fullName;
    const filled = { ...p };
    if (p.contactReference) {
      const c = await db().contact.findUnique({ where: { reference: p.contactReference } });
      if (!c) throw badRequest(`Δεν βρέθηκε επαφή ${p.contactReference}.`, { parties: [`Άγνωστη επαφή ${p.contactReference}.`] });
      contactId = c.id;
      fullName ??= `${c.firstName} ${c.lastName}`.trim();
      filled.email ??= decryptField(c.emailEncrypted);
      filled.phone ??= decryptField(c.phoneEncrypted) ?? decryptField(c.mobileEncrypted);
      filled.taxId ??= decryptField(c.taxIdEncrypted);
      filled.address ??= decryptField(c.addressEncrypted);
    }
    if (!fullName) throw badRequest("Συμπληρώστε ονοματεπώνυμο.", { parties: ["Λείπει ονοματεπώνυμο."] });
    const personal = [filled.taxId, filled.taxOffice, filled.idNumber, filled.address, filled.email, filled.phone].some(Boolean);
    if (personal && !hasEncryptionKey()) throw conflict("Τα στοιχεία αποθηκεύονται μόνο κρυπτογραφημένα και η κρυπτογράφηση δεν έχει ρυθμιστεί (PII_ENCRYPTION_KEY).");
    rows.push({
      role: p.role,
      contactId,
      fullName,
      taxIdEncrypted: encryptField(filled.taxId),
      taxOfficeEncrypted: encryptField(filled.taxOffice),
      idNumberEncrypted: encryptField(filled.idNumber),
      addressEncrypted: encryptField(filled.address),
      emailEncrypted: encryptField(filled.email),
      phoneEncrypted: encryptField(filled.phone),
      isSignatory: p.isSignatory,
      representativeCapacity: p.representativeCapacity ?? null,
      authorityReference: p.authorityReference,
      identityVerifiedAt: p.identityVerified ? new Date() : null,
      identityVerifiedById: p.identityVerified ? actorId : null,
      sortOrder: i,
    });
  }
  return rows;
}

/** What a viewer without the sensitive-data permission gets for one party. */
export function maskedParty(p: { id: string; role: string; fullName: string; isSignatory: boolean; taxIdEncrypted: string | null; idNumberEncrypted: string | null; addressEncrypted: string | null; emailEncrypted: string | null; phoneEncrypted: string | null; taxOfficeEncrypted?: string | null; identityVerifiedAt?: Date | null; representativeCapacity?: string | null; authorityReference?: string | null; signedAt: Date | null }) {
  return {
    id: p.id,
    role: p.role,
    fullName: p.fullName,
    isSignatory: p.isSignatory,
    taxId: p.taxIdEncrypted ? "••••••••" : null,
    taxOffice: p.taxOfficeEncrypted ? "••••" : null,
    idNumber: p.idNumberEncrypted ? "••••••" : null,
    address: p.addressEncrypted ? "••••••••" : null,
    email: p.emailEncrypted ? "••••••••" : null,
    phone: p.phoneEncrypted ? "••••••••" : null,
    identityVerified: Boolean(p.identityVerifiedAt),
    representativeCapacity: p.representativeCapacity ?? null,
    hasAuthority: Boolean(p.authorityReference),
    signedAt: p.signedAt,
    masked: true,
  };
}

export function clearParty(p: Parameters<typeof maskedParty>[0]) {
  return {
    id: p.id,
    role: p.role,
    fullName: p.fullName,
    isSignatory: p.isSignatory,
    taxId: decryptField(p.taxIdEncrypted),
    taxOffice: decryptField(p.taxOfficeEncrypted ?? null),
    idNumber: decryptField(p.idNumberEncrypted),
    address: decryptField(p.addressEncrypted),
    email: decryptField(p.emailEncrypted),
    phone: decryptField(p.phoneEncrypted),
    identityVerified: Boolean(p.identityVerifiedAt),
    representativeCapacity: p.representativeCapacity ?? null,
    authorityReference: p.authorityReference ?? null,
    signedAt: p.signedAt,
    masked: false,
  };
}
