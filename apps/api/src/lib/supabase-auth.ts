/**
 * First sign-in through the linked identity provider (Supabase Auth).
 *
 * A bootstrapped staff account can exist with no CRM password yet, linked to
 * its owner's Supabase Auth user by `authUid`. When that person signs in, the
 * password is checked against Supabase Auth (the standard password grant with
 * the project's publishable key). It counts only if Supabase confirms the
 * credentials AND the returned user id is exactly the linked `authUid`. The
 * caller then stores its own scrypt hash, so later sign-ins are local.
 *
 * The password is sent only to Supabase over HTTPS and is never logged.
 */

export type SupabaseAuthConfig = { url: string; apiKey: string };

/** Project URL from SUPABASE_URL, or derived from a Supabase DATABASE_URL. */
export function supabaseAuthConfig(env: NodeJS.ProcessEnv = process.env): SupabaseAuthConfig | null {
  const apiKey = (
    env.SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.NEXT_ANON_SB ||
    ""
  ).trim();
  if (!apiKey) return null;

  let url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!url) {
    const ref = projectRefFromDatabaseUrl(env.DATABASE_URL ?? "");
    if (!ref) return null;
    url = `https://${ref}.supabase.co`;
  }
  return { url, apiKey };
}

/** "postgres.<ref>@…pooler.supabase.com" or "@db.<ref>.supabase.co". */
export function projectRefFromDatabaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const fromUser = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username));
    if (fromUser) return fromUser[1]!;
    const fromHost = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
    if (fromHost) return fromHost[1]!;
  } catch {
    // Not a URL: no project ref.
  }
  return null;
}

export async function verifyWithSupabaseAuth(input: {
  config: SupabaseAuthConfig;
  email: string;
  password: string;
  expectedUid: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const response = await doFetch(`${input.config.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: input.config.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ email: input.email, password: input.password }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { user?: { id?: unknown } };
    return typeof body.user?.id === "string" && body.user.id.toLowerCase() === input.expectedUid.toLowerCase();
  } catch {
    console.error("[home88:api] identity provider sign-in check could not be completed.");
    return false;
  }
}
