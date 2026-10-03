import { redirect } from "next/navigation";

import { apiFetch } from "./api";
import { hasRole, type CurrentUser } from "./user";

export type { CurrentUser } from "./user";
export { displayName, hasRole, roleLabel } from "./user";

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const result = await apiFetch<{ user: CurrentUser; capabilities?: { settings?: boolean } }>("/api/auth/me");
  if (!result.ok) return null;
  return { ...result.data.user, canOpenSettings: result.data.capabilities?.settings === true };
}

/** Guard for authed pages. Redirects to the sign-in screen. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Guard for pages that need a minimum role. */
export async function requireRole(minimum: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasRole(user.role, minimum)) redirect("/");
  return user;
}
