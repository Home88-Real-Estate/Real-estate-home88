/**
 * Fixtures for tests only: counsel-approved template wording for every document
 * kind and language, and a helper that installs it as the active version.
 * The wording is placeholder text, not legal text; it exists to exercise the
 * pipeline (merge fields, content checks, approval and checksum rules).
 */

import { createHash } from "node:crypto";

import type { PrismaClient } from "@home88/database";
import type { DocumentKind, DocumentLanguage } from "@home88/domain";

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const BODIES: Record<DocumentKind, Record<DocumentLanguage, string>> = {
  SHOWING: {
    el: "ΥΠΟΔΕΙΞΗ {{document.number}} — {{document.date}}\nΟ/Η {{client.fullName}} βεβαιώνει ότι το γραφείο {{company.legalName}} του υπέδειξε τα ακίνητα {{properties.references}}. Αμοιβή: {{fee.summary}}.",
    en: "SHOWING {{document.number}} — {{document.date}}\n{{client.fullName}} confirms that {{company.legalName}} showed the properties {{properties.references}}. Fee: {{fee.summary}}.",
  },
  SIMPLE_ASSIGNMENT: {
    el: "{{document.number}} — {{document.date}}\nΟ/Η {{principal.fullName}} αναθέτει στο γραφείο {{company.legalName}} το ακίνητο {{properties.references}}. Είδος: {{term.type}}. Διάρκεια: {{term.duration}}. Αμοιβή: {{fee.summary}}.",
    en: "{{document.number}} — {{document.date}}\n{{principal.fullName}} instructs {{company.legalName}} regarding {{properties.references}}. Type: {{term.type}}. Term: {{term.duration}}. Fee: {{fee.summary}}.",
  },
  EXCLUSIVE_ASSIGNMENT: {
    el: "{{document.number}} — {{document.date}}\nΟ/Η {{principal.fullName}} αναθέτει στο γραφείο {{company.legalName}} το ακίνητο {{properties.references}}. Είδος: {{term.type}}. Από {{term.startDate}} έως {{term.endDate}} ({{term.duration}}). Αμοιβή: {{fee.summary}}.",
    en: "{{document.number}} — {{document.date}}\n{{principal.fullName}} instructs {{company.legalName}} regarding {{properties.references}}. Type: {{term.type}}. From {{term.startDate}} to {{term.endDate}} ({{term.duration}}). Fee: {{fee.summary}}.",
  },
  MANDATE_EXTENSION: {
    el: "ΠΑΡΑΤΑΣΗ {{document.number}} της εντολής {{mandate.number}}: από {{extension.previousEndDate}} σε {{extension.newEndDate}}.",
    en: "EXTENSION {{document.number}} of mandate {{mandate.number}}: from {{extension.previousEndDate}} to {{extension.newEndDate}}.",
  },
};

export const approvedBody = (kind: DocumentKind, language: DocumentLanguage) => BODIES[kind][language];

/** Retires the active version for (kind, language) and activates a counsel-approved one. `over` overrides any column. */
export async function installApprovedTemplate(db: PrismaClient, kind: string, language: string, over: Record<string, unknown> = {}) {
  const template = await db.mandateTemplate.upsert({ where: { type_locale: { type: kind, locale: language } }, create: { type: kind, locale: language }, update: {} });
  await db.mandateTemplateVersion.updateMany({ where: { templateId: template.id, status: "ACTIVE" }, data: { status: "RETIRED", retiredAt: new Date() } });
  const last = await db.mandateTemplateVersion.aggregate({ where: { templateId: template.id }, _max: { version: true } });
  const body = (over.body as string | undefined) ?? BODIES[kind as DocumentKind]?.[language as DocumentLanguage] ?? `WORDING ${kind} ${language}`;
  const checksum = (over.checksum as string | undefined) ?? sha256(body);
  const approved = over.legalApprovedAt === null ? {} : { legalApprovedAt: new Date(), legalApprovedBy: "counsel-test", legalApprovedChecksum: sha256(body) };
  return db.mandateTemplateVersion.create({
    data: { templateId: template.id, version: (last._max.version ?? 0) + 1, status: "ACTIVE", activatedAt: new Date(), ...approved, ...over, body, checksum } as never,
  });
}

export async function installAllTemplates(db: PrismaClient) {
  for (const kind of Object.keys(BODIES)) for (const language of ["el", "en"]) await installApprovedTemplate(db, kind, language);
}
