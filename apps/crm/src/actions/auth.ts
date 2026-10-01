"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { API_URL, SESSION_COOKIE_NAME } from "@/lib/config";

/**
 * Revokes the session on the API and clears the cookie on this origin. The API
 * call is best-effort: even if the network is down, the local cookie is gone,
 * so the browser can no longer present the session.
 */
export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
    } catch {
      // Ignore: the cookie is cleared below regardless.
    }
  }

  store.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
