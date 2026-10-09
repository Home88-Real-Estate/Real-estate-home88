/**
 * Who may do what, in one table.
 *
 * Routes ask `can(actor, permission, resource)` instead of comparing role
 * names, so changing what a role may do is an edit here, not a hunt through
 * every route. Some permissions are scoped: holding "property:update" lets an
 * AGENT change only properties they are assigned to or created, while
 * MANAGER and above hold the unscoped "...:any" variant.
 *
 * Authorization is always decided on the server. The CRM may call `can` to
 * hide controls, but hiding a button is never the control.
 */

export const ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "AGENT", "MARKETING", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  PROPERTY_READ: "property:read",
  PROPERTY_CREATE: "property:create",
  /** Edit details and change status of own (assigned or created) properties. */
  PROPERTY_UPDATE: "property:update",
  /** Edit details and change status of any property. */
  PROPERTY_UPDATE_ANY: "property:update:any",
  /** Mark a property SOLD or RENTED. Scoped like PROPERTY_UPDATE. */
  PROPERTY_CLOSE: "property:close",
  /** Bring a property back from SOLD, RENTED or ARCHIVED. */
  PROPERTY_REOPEN: "property:reopen",
  PROPERTY_ARCHIVE: "property:archive",
  /** Move a property into the deleted folder (soft delete). Scoped like PROPERTY_UPDATE. */
  PROPERTY_DELETE: "property:delete",
  /** Bring a property back out of the deleted folder. Scoped like PROPERTY_UPDATE. */
  PROPERTY_RESTORE: "property:restore",
  /** Permanently remove a deleted property row. Never granted below ADMIN. */
  PROPERTY_DELETE_PERMANENT: "property:delete-permanent",
  PROPERTY_PUBLISH: "property:publish",
  PROPERTY_VIEW_COMMERCIAL: "property:view-commercial",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const P = PERMISSIONS;

const AGENT: readonly Permission[] = [
  P.PROPERTY_READ,
  P.PROPERTY_CREATE,
  P.PROPERTY_UPDATE,
  P.PROPERTY_CLOSE,
  P.PROPERTY_DELETE,
  P.PROPERTY_RESTORE,
  P.PROPERTY_PUBLISH,
  P.PROPERTY_VIEW_COMMERCIAL,
];
const MANAGER: readonly Permission[] = [...AGENT, P.PROPERTY_UPDATE_ANY, P.PROPERTY_REOPEN];
const ADMIN: readonly Permission[] = [...MANAGER, P.PROPERTY_ARCHIVE, P.PROPERTY_DELETE_PERMANENT];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  SUPER_ADMIN: new Set(ADMIN),
  ADMIN: new Set(ADMIN),
  MANAGER: new Set(MANAGER),
  AGENT: new Set(AGENT),
  MARKETING: new Set([P.PROPERTY_READ, P.PROPERTY_PUBLISH]),
  VIEWER: new Set([P.PROPERTY_READ]),
};

export type Actor = { id: string; role: string };

/** The parts of a property that decide whether an actor "owns" it. */
export type PropertyScope = { agentId: string | null; createdById: string | null };

/** Permissions that, held alone, apply only to the actor's own properties. */
const SCOPED: ReadonlySet<Permission> = new Set([
  P.PROPERTY_UPDATE,
  P.PROPERTY_CLOSE,
  P.PROPERTY_DELETE,
  P.PROPERTY_RESTORE,
]);

export function hasPermission(actor: Actor, permission: Permission): boolean {
  return ROLE_PERMISSIONS[actor.role as Role]?.has(permission) ?? false;
}

function ownsProperty(actor: Actor, property: PropertyScope): boolean {
  return property.agentId === actor.id || property.createdById === actor.id;
}

/**
 * Whether `actor` may exercise `permission`, on `property` when given.
 * Scoped permissions need either the "any" grant or ownership of the property.
 */
export function can(actor: Actor, permission: Permission, property?: PropertyScope): boolean {
  if (!hasPermission(actor, permission)) return false;
  if (!SCOPED.has(permission) || !property) return true;
  return hasPermission(actor, P.PROPERTY_UPDATE_ANY) || ownsProperty(actor, property);
}

/**
 * Putting a property on the website, updating it there or taking it down.
 * Needs the publish permission; an agent may do it for their own listings, a
 * manager for any, and Marketing (which publishes but does not edit) for the
 * whole office. Looking at readiness or a preview only needs to read the property.
 */
export function canPublishWebsite(actor: Actor, property: PropertyScope): boolean {
  if (!hasPermission(actor, P.PROPERTY_PUBLISH)) return false;
  return actor.role === "MARKETING" || hasPermission(actor, P.PROPERTY_UPDATE_ANY) || ownsProperty(actor, property);
}
