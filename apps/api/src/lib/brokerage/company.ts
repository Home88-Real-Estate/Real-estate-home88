/**
 * Company details for document headers, from Settings → Νομικά στοιχεία and
 * Προμήθειες. A missing value is reported, never invented or hard-coded.
 */

import { createHash } from "node:crypto";

import type { Db } from "./types";

export type CompanyFacts = {
  missing: string[];
  /** What a document prints about the company, as it was when issued. */
  snapshot: Record<string, string | null>;
  configuredVatRatePct: number | null;
};

export async function loadCompanyFacts(db: Db, language: string): Promise<CompanyFacts> {
  const [legal, commission] = await Promise.all([
    db.companyLegalDetails.findUnique({ where: { id: "default" } }),
    db.commissionSettings.findUnique({ where: { id: "default" } }),
  ]);
  const en = language === "en";
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

  const snapshot = {
    legalName: clean(en ? legal?.legalNameEn || legal?.legalNameEl : legal?.legalNameEl),
    vatNumber: clean(legal?.vatNumber),
    taxOffice: clean(legal?.taxOffice),
    gemiNumber: clean(legal?.gemiNumber),
    address: clean(en ? legal?.registeredAddressEn || legal?.registeredAddressEl : legal?.registeredAddressEl),
    phone: clean(legal?.phone),
    email: clean(legal?.legalEmail),
  };
  const missing: string[] = [];
  if (!snapshot.legalName) missing.push("Επωνυμία");
  if (!snapshot.vatNumber) missing.push("ΑΦΜ");
  if (!snapshot.taxOffice) missing.push("ΔΟΥ");
  if (!snapshot.address) missing.push("Έδρα");
  if (!snapshot.phone && !snapshot.email) missing.push("Τηλέφωνο ή email");

  const rate = commission?.vatRatePct == null ? null : Number(commission.vatRatePct);
  return { missing, snapshot, configuredVatRatePct: rate };
}

/** The wording a template version holds, verified against the checksum recorded with it. */
export async function loadTemplateCheck(db: Db, type: string, locale: string) {
  const template = await db.mandateTemplate.findUnique({ where: { type_locale: { type, locale } } });
  if (!template) return { check: { found: false, active: false, checksumValid: false }, version: null };
  const version = await db.mandateTemplateVersion.findFirst({ where: { templateId: template.id, status: "ACTIVE" } });
  if (!version) return { check: { found: true, active: false, type, locale, checksumValid: false }, version: null };
  const checksumValid = createHash("sha256").update(version.body).digest("hex") === version.checksum;
  const legalApproved = !version.requiresLegalReview || (version.legalApprovedAt != null && version.legalApprovedBy != null && version.legalApprovedChecksum === version.checksum);
  return {
    check: { found: true, active: true, type, locale, checksumValid, requiresLegalReview: version.requiresLegalReview, legalApproved },
    version,
  };
}
