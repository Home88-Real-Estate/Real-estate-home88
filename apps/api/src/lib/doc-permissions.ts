/**
 * Server-side permission checks for showings, mandates and templates.
 *
 * The grants are the settings permission matrix (domain DEFAULT_SETTINGS_GRANTS
 * plus role overrides), so what a role may do is configured in one place.
 * Hiding a button in the CRM is never the control: every route calls these.
 *
 * Legal approval of template wording needs two things: the permission
 * (templates.approve_legal_version) AND the user being marked a legal approver.
 * No role grants that implicitly, SUPER_ADMIN included.
 */

import type { FastifyRequest } from "fastify";

import { forbidden } from "./errors";
import { db } from "./prisma";
import { settings } from "../settings";

type Role = string;

export async function hasDocPermission(role: Role, permission: string): Promise<boolean> {
  return settings().can(role, permission);
}

export async function requireDocPermission(request: FastifyRequest, permission: string, message = "Δεν έχετε δικαίωμα για αυτή την ενέργεια."): Promise<void> {
  const user = request.auth?.user;
  if (!user || !(await hasDocPermission(user.role, permission))) throw forbidden(message);
}

/** Whether the person may see full identity data (ΑΦΜ, ΑΔΤ, address) on this kind of record. */
export async function mayViewSensitive(role: Role, kind: "showings" | "mandates"): Promise<boolean> {
  return hasDocPermission(role, `${kind}.view_sensitive_data`);
}

export async function requireLegalApprover(request: FastifyRequest): Promise<void> {
  const user = request.auth?.user;
  if (!user) throw forbidden();
  if (!(await hasDocPermission(user.role, "templates.approve_legal_version"))) throw forbidden("Δεν έχετε δικαίωμα νομικής έγκρισης προτύπων.");
  const row = await db().user.findUnique({ where: { id: user.id }, select: { legalApprover: true, status: true } });
  if (!row?.legalApprover) throw forbidden("Ο λογαριασμός σας δεν έχει οριστεί ως νομικός εγκρίνων.");
}
