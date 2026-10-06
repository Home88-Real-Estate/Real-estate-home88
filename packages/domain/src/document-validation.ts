/**
 * Shared shapes for document validation (showings, mandates, extensions).
 *
 * A validator returns what blocks issuing the document and what only deserves
 * a look. Nothing here is a user-interface string template: every issue has a
 * stable `code`, so a screen, a report and a test can all refer to the same
 * problem, plus a Greek message the agent can read.
 *
 * Validators are pure: they receive plain facts (including "does this party
 * have a tax id" flags rather than the tax id itself) and never touch the
 * database, so the same rules run in the API, in tests and, later, on screen.
 */

export type ValidationIssue = {
  code: string;
  message: string;
  /** The field or section the agent should look at. */
  field?: string;
  /**
   * The value itself is impossible (a negative fee, 120 %), as opposed to merely
   * not filled in yet. A draft can be saved incomplete, never with these.
   */
  integrity?: boolean;
  /** Extra machine-readable context, e.g. the reason of a COMMISSION_ANOMALY. */
  reason?: string;
};

export type CompletenessStatus = "BLOCKED" | "WARNING" | "READY";

export type DocumentCompletenessResult = {
  status: CompletenessStatus;
  /** What stops the document from being made ready, issued or sent. */
  blockingIssues: ValidationIssue[];
  warnings: ValidationIssue[];
  /** False only when an integrity problem makes even a draft unsafe to save. */
  draftSaveable: boolean;
};

export function buildCompleteness(blocking: ValidationIssue[], warnings: ValidationIssue[]): DocumentCompletenessResult {
  return {
    status: blocking.length > 0 ? "BLOCKED" : warnings.length > 0 ? "WARNING" : "READY",
    blockingIssues: blocking,
    warnings,
    draftSaveable: !blocking.some((i) => i.integrity),
  };
}

/** Combine several validators' results into one. */
export function mergeCompleteness(...parts: Array<{ blockingIssues: ValidationIssue[]; warnings: ValidationIssue[] }>): DocumentCompletenessResult {
  return buildCompleteness(
    parts.flatMap((p) => p.blockingIssues),
    parts.flatMap((p) => p.warnings),
  );
}

/** What a document needs from its template before it can be issued. */
export type TemplateCheck = {
  found: boolean;
  /** Status ACTIVE: the wording a lawyer approved for production. */
  active: boolean;
  type?: string;
  locale?: string;
  /** SHA-256 of the stored text matches the recorded checksum. */
  checksumValid: boolean;
  requiresLegalReview?: boolean;
  /** Counsel's approval is recorded against this exact text. */
  legalApproved?: boolean;
  /** Set by the server when the full issuing rules (legacy, approval, content) reject this version. */
  rejection?: { code: string; message: string };
};

/** A party's identity facts, as presence flags: the validator never sees the values. */
export type PartyFacts = {
  fullName: string;
  role?: string;
  isSignatory?: boolean;
  hasTaxId: boolean;
  hasIdNumber: boolean;
  hasTaxOffice?: boolean;
  hasAddress: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  identityVerified?: boolean;
  /** Signs for someone else: needs authority on record. */
  representativeCapacity?: string | null;
  hasAuthority?: boolean;
};

export type DocumentPropertyFacts = {
  propertyId?: string | null;
  code?: string | null;
  hasSnapshot?: boolean;
  hasAddress: boolean;
  /** Asking price or monthly rent, in euros. */
  price?: number | null;
  transactionType?: string | null;
  /** The current record is no longer on the market (sold, rented, withdrawn). */
  offMarket?: boolean;
};

const REPRESENTATIVE = new Set(["LEGAL_REPRESENTATIVE", "ATTORNEY_IN_FACT", "COMPANY_REPRESENTATIVE", "AUTHORIZED_REPRESENTATIVE"]);

/** Identity checks common to showings and mandates. `label` names the party's role in the message. */
export function validateParties(parties: PartyFacts[], label: string, opts: { requireIdentity?: boolean } = {}): { blockingIssues: ValidationIssue[]; warnings: ValidationIssue[] } {
  const blocking: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const requireIdentity = opts.requireIdentity ?? true;

  if (parties.length === 0) {
    blocking.push({ code: "PARTY_MISSING", field: "parties", message: `Δεν έχει οριστεί ${label}.` });
    return { blockingIssues: blocking, warnings };
  }
  const signatories = parties.filter((p) => p.isSignatory !== false);
  if (signatories.length === 0) {
    blocking.push({ code: "SIGNATORY_MISSING", field: "parties", message: `Δεν υπάρχει υπογράφων (${label}).` });
  }

  parties.forEach((p, i) => {
    const who = p.fullName?.trim() || `${label} ${i + 1}`;
    if (!p.fullName?.trim()) blocking.push({ code: "PARTY_NAME_MISSING", field: `parties[${i}].fullName`, message: `Λείπει το ονοματεπώνυμο (${label} ${i + 1}).` });
    if (p.isSignatory !== false && requireIdentity) {
      if (!p.hasTaxId) blocking.push({ code: "PARTY_TAX_ID_MISSING", field: `parties[${i}].taxId`, message: `Λείπει ο ΑΦΜ: ${who}.` });
      if (!p.hasIdNumber) blocking.push({ code: "PARTY_ID_MISSING", field: `parties[${i}].idNumber`, message: `Λείπει ο αριθμός ταυτότητας: ${who}.` });
      if (!p.hasAddress) blocking.push({ code: "PARTY_ADDRESS_MISSING", field: `parties[${i}].address`, message: `Λείπει η διεύθυνση: ${who}.` });
      if (!p.hasPhone && !p.hasEmail) blocking.push({ code: "PARTY_CONTACT_MISSING", field: `parties[${i}].phone`, message: `Λείπει τηλέφωνο ή email: ${who}.` });
      if (p.hasTaxOffice === false) warnings.push({ code: "PARTY_TAX_OFFICE_MISSING", field: `parties[${i}].taxOffice`, message: `Λείπει η ΔΟΥ: ${who}.` });
      if (p.identityVerified === false) warnings.push({ code: "PARTY_IDENTITY_UNVERIFIED", field: `parties[${i}].identity`, message: `Η ταυτότητα δεν έχει επαληθευτεί με έγγραφο: ${who}.` });
    }
    if (p.representativeCapacity && REPRESENTATIVE.has(p.representativeCapacity) && !p.hasAuthority) {
      blocking.push({ code: "REPRESENTATIVE_AUTHORITY_MISSING", field: `parties[${i}].authority`, message: `Λείπει η εξουσιοδότηση/πληρεξουσιότητα: ${who}.` });
    }
  });
  return { blockingIssues: blocking, warnings };
}

/** The template must exist, be the approved ACTIVE wording, in the document's own language. */
export function validateTemplateCheck(t: TemplateCheck | null | undefined, expected: { type: string; locale: string }): { blockingIssues: ValidationIssue[]; warnings: ValidationIssue[] } {
  const blocking: ValidationIssue[] = [];
  if (!t || !t.found) {
    blocking.push({ code: "TEMPLATE_MISSING", field: "template", message: `Δεν υπάρχει εγκεκριμένο πρότυπο «${expected.type}» στη γλώσσα «${expected.locale}».` });
  } else {
    if (!t.active) blocking.push({ code: "TEMPLATE_NOT_ACTIVE", field: "template", message: "Το πρότυπο δεν είναι ενεργό (εγκεκριμένο)." });
    if (t.type && t.type !== expected.type) blocking.push({ code: "TEMPLATE_TYPE_MISMATCH", field: "template", message: "Το πρότυπο δεν αντιστοιχεί στον τύπο του εγγράφου." });
    if (t.locale && t.locale !== expected.locale) blocking.push({ code: "TEMPLATE_LANGUAGE_MISMATCH", field: "template", message: "Το πρότυπο δεν αντιστοιχεί στη γλώσσα του εγγράφου." });
    if (!t.checksumValid) blocking.push({ code: "TEMPLATE_CHECKSUM_INVALID", field: "template", message: "Το κείμενο του προτύπου δεν ταιριάζει με το checksum του." });
    if (t.requiresLegalReview && !t.legalApproved) blocking.push({ code: "TEMPLATE_LEGAL_APPROVAL_MISSING", field: "template", message: "Το πρότυπο απαιτεί νομικό έλεγχο που δεν έχει καταγραφεί." });
    if (t.rejection && blocking.length === 0) blocking.push({ code: t.rejection.code, field: "template", message: t.rejection.message });
  }
  return { blockingIssues: blocking, warnings: [] };
}

/** Company details the document header needs: shown as a configuration problem, never invented. */
export function validateCompanyFacts(missing: string[]): { blockingIssues: ValidationIssue[]; warnings: ValidationIssue[] } {
  return {
    blockingIssues: missing.map((m) => ({ code: "COMPANY_DATA_MISSING", field: "company", message: `Ρυθμίσεις: λείπει «${m}» (στοιχεία εταιρείας).` })),
    warnings: [],
  };
}
