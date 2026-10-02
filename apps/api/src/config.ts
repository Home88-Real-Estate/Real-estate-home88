/**
 * Environment validation for the API.
 *
 * The service is started from `index.ts`, which calls `loadConfig()` exactly
 * once. Nothing here reads the environment at import time, so tests and the
 * type-checker can import a module that happens to reference config without a
 * populated `.env` blowing up.
 *
 * Secrets are validated for length, not just presence: a 4-character
 * JWT_SECRET is worse than no secret at all because it looks configured.
 */

import { z } from "zod";

/**
 * `z.coerce.boolean()` treats any non-empty string — including "false" — as
 * true, which would silently turn a force-path-style flag on. Accept only an
 * explicit "true"/"false" and fall back to the supplied default when unset.
 */
const boolFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value === "" ? defaultValue : value.toLowerCase() === "true",
    );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // --- Networking ----------------------------------------------------------
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  /**
   * Origins allowed to send credentialed requests. The CRM is a separate
   * origin from the API, so this is a strict allow-list rather than "*":
   * a wildcard origin is incompatible with cookie auth anyway.
   */
  CRM_URL: z.string().url().default("http://localhost:3100"),
  /**
   * Path prefix the CRM is served under (`basePath` in apps/crm). Used to build
   * absolute reset links in transactional mail, e.g.
   * `${CRM_URL}${CRM_BASE_PATH}/reset-password?token=...`.
   */
  CRM_BASE_PATH: z
    .string()
    .default("/crm")
    .transform((v) => (v === "/" || v === "" ? "" : `/${v.replace(/^\/+|\/+$/g, "")}`)),
  SITE_URL: z.string().url().default("http://localhost:3000"),

  // --- Database ------------------------------------------------------------
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),

  // --- Media ---------------------------------------------------------------
  /**
   * Absolute base for public media in portal feeds. Blank falls back to
   * `${SITE_URL}/media`, because a feed consumed by an external portal cannot
   * use a root-relative URL.
   */
  MEDIA_BASE_URL: z.string().default(""),

  // --- Object storage ------------------------------------------------------
  /**
   * S3-compatible endpoint (MinIO locally, Cloudflare R2 or AWS in prod).
   * Blank disables uploads, so a misconfigured deployment fails at the route
   * with a clear message instead of half-writing rows with no object behind them.
   */
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().default(""),
  S3_SECRET_KEY: z.string().default(""),
  S3_BUCKET: z.string().default("home88-properties"),
  S3_FORCE_PATH_STYLE: boolFromEnv(true),
  S3_SIGNED_URL_TTL: z.coerce.number().int().min(30).max(604800).default(900),
  /** Largest file a signed direct upload may declare; 25 MB by default. */
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(1024 * 1024 * 1024).default(26214400),

  // --- Auth ----------------------------------------------------------------
  JWT_SECRET: z.string().default(""),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  /**
   * log2 of the scrypt cost parameter N. 12 => N=4096, 14 => N=16384.
   * Bounded below 10 so a misconfiguration cannot silently weaken hashing.
   */
  PASSWORD_HASH_ROUNDS: z.coerce.number().int().min(10).max(17).default(12),
  SESSION_COOKIE_NAME: z.string().min(1).default("h88_session"),

  // --- Personal-data protection -------------------------------------------
  PII_HASH_PEPPER: z.string().default(""),
  PII_ENCRYPTION_KEY: z.string().default(""),
  UNSUBSCRIBE_SECRET: z.string().default(""),

  // --- Legal / company -----------------------------------------------------
  POLICY_VERSION: z.string().default("2026-10-01"),
  COMPANY_LEGAL_NAME: z.string().default("HOME88"),
  COMPANY_POSTAL_ADDRESS: z.string().default(""),
  COMPANY_PRIVACY_EMAIL: z.string().default("privacy@example.com"),
  COMPANY_DMCA_EMAIL: z.string().default("dmca@example.com"),

  // --- Email ---------------------------------------------------------------
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  SMTP_FROM_EMAIL: z.string().default(""),
  SMTP_FROM_NAME: z.string().default("HOME88"),
});

export type ApiConfig = z.infer<typeof schema>;

let cached: ApiConfig | null = null;

/**
 * On Vercel the API runs inside the CRM deployment, so when CRM_URL is not set
 * the CRM's own production address (a Vercel system variable) is the right
 * origin for reset/invitation links and the CSRF origin check. Without this,
 * links would point at the localhost default.
 */
export function withPlatformDefaults(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (!env.CRM_URL?.trim() && vercelHost) {
    return { ...env, CRM_URL: `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` };
  }
  return env;
}

export type ConfigProblem = { variable: string; problem: "missing" | "too_short" | "invalid" };

/**
 * What keeps the API from starting, by variable name only: never a value, so
 * the result is safe to log and to show on a readiness check.
 */
export function configProblems(env: NodeJS.ProcessEnv = process.env): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  env = withPlatformDefaults(env);
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const variable = issue.path.join(".") || "(root)";
      const missing = env[variable] === undefined || env[variable] === "";
      problems.push({ variable, problem: missing ? "missing" : "invalid" });
    }
    return problems;
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.JWT_SECRET.length < 32) {
    problems.push({ variable: "JWT_SECRET", problem: parsed.data.JWT_SECRET ? "too_short" : "missing" });
  }
  return problems;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  if (cached) return cached;

  const parsed = schema.safeParse(withPlatformDefaults(env));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid API configuration:\n${issues}`);
  }

  const config = parsed.data;

  if (config.NODE_ENV === "production") {
    if (config.JWT_SECRET.length < 32) {
      throw new Error(
        "JWT_SECRET must be at least 32 characters in production. " +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
      );
    }
    if (!config.PII_ENCRYPTION_KEY) {
      // Not fatal, but the CRM will refuse to persist contact PII without it,
      // so surface the misconfiguration loudly at boot rather than at first use.
      console.warn(
        "[home88:api] PII_ENCRYPTION_KEY is empty: contact email/phone will not be stored.",
      );
    }
  }

  cached = config;
  return config;
}

/** Test seam: forget the memoised config. */
export function resetConfig(): void {
  cached = null;
}
