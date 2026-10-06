/**
 * Public document verification: given the code printed on an issued document,
 * confirm it exists and show only what is needed to tell a genuine document
 * from a forged one. No names, no ΑΦΜ, no addresses, no content.
 */

import type { FastifyInstance } from "fastify";

import { recordDocumentAudit } from "../lib/brokerage/documents/audit";
import { notFound, tooManyRequests } from "../lib/errors";
import { clientIp } from "../lib/http";
import { db } from "../lib/prisma";
import { consume } from "../lib/rate-limit";

const CODE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

export async function verifyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/verify/:code", async (request) => {
    const ip = clientIp(request);
    const limit = consume(`verify:${ip}`, { points: 30, durationSeconds: 60 });
    if (!limit.allowed) throw tooManyRequests();
    const code = String((request.params as { code: string }).code ?? "").toUpperCase();
    // The same answer for malformed and unknown codes: nothing to probe.
    if (!CODE.test(code)) throw notFound("Δεν βρέθηκε έγγραφο με αυτόν τον κωδικό.");

    const [showing, mandate, extension] = await Promise.all([
      db().showing.findUnique({ where: { verificationCode: code }, select: { id: true, number: true, status: true, issuedAt: true, pdfChecksum: true } }),
      db().mandate.findUnique({ where: { verificationCode: code }, select: { id: true, number: true, status: true, issuedAt: true, pdfChecksum: true } }),
      db().mandateExtension.findUnique({ where: { verificationCode: code }, select: { id: true, number: true, status: true, issuedAt: true, pdfChecksum: true } }),
    ]);
    const hit = showing ? { type: "SHOWING" as const, row: showing } : mandate ? { type: "MANDATE" as const, row: mandate } : extension ? { type: "MANDATE_EXTENSION" as const, row: extension } : null;
    if (!hit || !hit.row.number) throw notFound("Δεν βρέθηκε έγγραφο με αυτόν τον κωδικό.");
    await recordDocumentAudit(db(), { actorUserId: null, actorRole: "PUBLIC", ipAddress: ip, type: "DOCUMENT_VERIFIED", entityType: hit.type, entityId: hit.row.id, documentNumber: hit.row.number });
    return {
      document: {
        type: hit.type,
        number: hit.row.number,
        status: hit.row.status,
        issuedAt: hit.row.issuedAt,
        checksumPrefix: hit.row.pdfChecksum ? hit.row.pdfChecksum.slice(0, 12) : null,
      },
    };
  });
}
