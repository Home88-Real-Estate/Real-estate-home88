/**
 * Choosing the wording a document is issued with.
 *
 * The choice is deterministic: document kind + language select one template,
 * and only its ACTIVE version can be used. The version must be HOME88 wording
 * (never legacy Estate+ text), counsel's approval must be recorded against the
 * exact text, the stored checksum must match the text, and the wording must not
 * contain anything that belongs to another kind of document or an unresolved
 * choice. There is no fallback to an older version: a failure here stops the
 * issue.
 */

import { createHash } from "node:crypto";
import { checkTemplateContent, type DocumentKind, type DocumentLanguage } from "@home88/domain";

import { BrokerageError } from "../errors";
import type { Db } from "../types";

export type ResolvedTemplate = {
  id: string;
  templateId: string;
  version: number;
  checksum: string;
  body: string;
  kind: DocumentKind;
  language: DocumentLanguage;
};

export class TemplateRejectedError extends BrokerageError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "TemplateRejectedError";
  }
}

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Why a template version cannot be used, or null if it can. The same rules run at issue and in tests. */
export function templateRejection(
  v: { status: string; body: string; checksum: string; source: string; requiresLegalReview: boolean; legalApprovedAt: Date | null; legalApprovedBy: string | null; legalApprovedChecksum: string | null },
  kind: DocumentKind,
): { code: string; message: string } | null {
  if (v.status !== "ACTIVE") return { code: "TEMPLATE_NOT_ACTIVE", message: "Το πρότυπο δεν είναι ενεργό." };
  if (v.source === "ESTATE_PLUS_LEGACY") return { code: "TEMPLATE_LEGACY", message: "Το πρότυπο προέρχεται από το παλιό σύστημα και δεν επιτρέπεται για έκδοση εγγράφων." };
  if (sha(v.body) !== v.checksum) return { code: "TEMPLATE_CHECKSUM_MISMATCH", message: "Το κείμενο του προτύπου δεν ταιριάζει με το checksum του." };
  if (!v.legalApprovedAt || !v.legalApprovedBy) return { code: "TEMPLATE_NOT_APPROVED", message: "Το πρότυπο δεν έχει νομική έγκριση." };
  if (v.legalApprovedChecksum !== v.checksum) return { code: "TEMPLATE_APPROVAL_MISMATCH", message: "Η νομική έγκριση αφορά διαφορετικό κείμενο από το ενεργό." };
  if (v.requiresLegalReview && !v.legalApprovedAt) return { code: "TEMPLATE_REQUIRES_REVIEW", message: "Το πρότυπο απαιτεί νομικό έλεγχο." };
  const content = checkTemplateContent(kind, v.body);
  if (content.length > 0) return { code: "TEMPLATE_CONTENT_INVALID", message: `Το κείμενο του προτύπου δεν είναι κατάλληλο: ${content.map((c) => c.message).join(" ")}` };
  return null;
}

export async function resolveApprovedTemplate(db: Db, kind: DocumentKind, language: DocumentLanguage): Promise<ResolvedTemplate> {
  const template = await db.mandateTemplate.findUnique({ where: { type_locale: { type: kind, locale: language } } });
  if (!template) throw new TemplateRejectedError("TEMPLATE_MISSING", `Δεν υπάρχει πρότυπο «${kind}» στη γλώσσα «${language}».`);
  const version = await db.mandateTemplateVersion.findFirst({ where: { templateId: template.id, status: "ACTIVE" } });
  if (!version) throw new TemplateRejectedError("TEMPLATE_MISSING", `Δεν υπάρχει ενεργό εγκεκριμένο πρότυπο «${kind}» (${language}).`);
  const reason = templateRejection(version, kind);
  if (reason) throw new TemplateRejectedError(reason.code, reason.message);
  return { id: version.id, templateId: template.id, version: version.version, checksum: version.checksum, body: version.body, kind, language };
}
