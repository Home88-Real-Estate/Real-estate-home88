/**
 * Client-safe user shapes and role helpers.
 *
 * Kept separate from `session.ts` (which imports `next/headers` and can only
 * run on the server) so client components can import the role helpers without
 * pulling a server-only module into the browser bundle.
 */

export type CurrentUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  locale: string;
  avatarUrl: string | null;
};

/** Mirrors ROLE_RANK in apps/api/src/plugins/auth.ts. */
export const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  MARKETING: 1,
  AGENT: 2,
  MANAGER: 3,
  ADMIN: 4,
  SUPER_ADMIN: 5,
};

export const ALL_ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "MANAGER",
  "AGENT",
  "MARKETING",
  "VIEWER",
] as const;

export function hasRole(role: string, minimum: string): boolean {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minimum] ?? Number.POSITIVE_INFINITY);
}

/** Strictly greater, matching the API: peers cannot manage each other. */
export function outranks(actorRole: string, targetRole: string): boolean {
  return (ROLE_RANK[actorRole] ?? -1) > (ROLE_RANK[targetRole] ?? Number.POSITIVE_INFINITY);
}

/** Roles an actor is permitted to assign, i.e. strictly below their own. */
export function assignableRoles(actorRole: string): string[] {
  const rank = ROLE_RANK[actorRole] ?? -1;
  return ALL_ROLES.filter((role) => (ROLE_RANK[role] ?? -1) < rank);
}

export function displayName(user: Pick<CurrentUser, "firstName" | "lastName" | "email">): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.email;
}

export function roleLabel(role: string): string {
  return role.toLowerCase().replace(/_/g, " ");
}
