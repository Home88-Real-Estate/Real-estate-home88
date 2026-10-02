/**
 * The property state machine.
 *
 * Clients never set `status` directly: they ask for a transition, and the API
 * checks it here. Readiness ("can it be published", "is the legal file
 * complete") is computed from data elsewhere; it is not modelled as extra
 * statuses, so it cannot drift from the facts.
 */

import { can, PERMISSIONS, type Actor, type Permission, type PropertyScope } from "./permissions";

export const PROPERTY_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "UNDER_OFFER",
  "RESERVED",
  "SOLD",
  "RENTED",
  "INACTIVE",
  "ARCHIVED",
] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export type ListingType = "SALE" | "RENT" | "ASSIGNMENT";

/** Statuses visible on the public website and eligible for portal feeds. */
export const PUBLIC_PROPERTY_STATUSES = ["ACTIVE", "UNDER_OFFER", "RESERVED"] as const satisfies
  readonly PropertyStatus[];

export function isPublicStatus(status: string): boolean {
  return (PUBLIC_PROPERTY_STATUSES as readonly string[]).includes(status);
}

/** Where each status may go next, before listing-type and permission checks. */
const NEXT: Readonly<Record<PropertyStatus, readonly PropertyStatus[]>> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["UNDER_OFFER", "RESERVED", "SOLD", "RENTED", "INACTIVE", "ARCHIVED"],
  UNDER_OFFER: ["ACTIVE", "RESERVED", "SOLD", "RENTED", "INACTIVE", "ARCHIVED"],
  RESERVED: ["ACTIVE", "UNDER_OFFER", "SOLD", "RENTED", "INACTIVE", "ARCHIVED"],
  SOLD: ["ACTIVE", "ARCHIVED"],
  RENTED: ["ACTIVE", "ARCHIVED"],
  INACTIVE: ["ACTIVE", "DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

const CLOSED: ReadonlySet<PropertyStatus> = new Set(["SOLD", "RENTED"]);

/** The permission a given move needs; scoping to own properties is applied by `can`. */
function permissionFor(from: PropertyStatus, to: PropertyStatus): Permission {
  if (to === "ARCHIVED") return PERMISSIONS.PROPERTY_ARCHIVE;
  if (from === "ARCHIVED" || CLOSED.has(from)) return PERMISSIONS.PROPERTY_REOPEN;
  if (CLOSED.has(to)) return PERMISSIONS.PROPERTY_CLOSE;
  return PERMISSIONS.PROPERTY_UPDATE;
}

export type TransitionCheck =
  | { ok: true; permission: Permission }
  | { ok: false; code: "INVALID_TRANSITION" | "FORBIDDEN"; message: string };

export type TransitionSubject = PropertyScope & { status: string; listingType: string };

export function isPropertyStatus(value: string): value is PropertyStatus {
  return (PROPERTY_STATUSES as readonly string[]).includes(value);
}

/** Pure rule check: is `from → to` a legal move for this listing type? */
export function isAllowedTransition(
  from: PropertyStatus,
  to: PropertyStatus,
  listingType: string,
): boolean {
  if (from === to || !NEXT[from].includes(to)) return false;
  if (to === "SOLD") return listingType !== "RENT";
  if (to === "RENTED") return listingType === "RENT";
  return true;
}

/** Full check for a requested transition: rules first, then the actor's rights. */
export function checkTransition(
  actor: Actor,
  property: TransitionSubject,
  to: string,
): TransitionCheck {
  if (!isPropertyStatus(property.status) || !isPropertyStatus(to)) {
    return { ok: false, code: "INVALID_TRANSITION", message: `Unknown status ${to}.` };
  }
  if (!isAllowedTransition(property.status, to, property.listingType)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `A ${property.listingType} property cannot move from ${property.status} to ${to}.`,
    };
  }
  const permission = permissionFor(property.status, to);
  if (!can(actor, permission, property)) {
    return { ok: false, code: "FORBIDDEN", message: "You are not allowed to make this change." };
  }
  return { ok: true, permission };
}

/** The transitions this actor may make from the property's current status, for the UI. */
export function availableTransitions(actor: Actor, property: TransitionSubject): PropertyStatus[] {
  return PROPERTY_STATUSES.filter((to) => checkTransition(actor, property, to).ok);
}
