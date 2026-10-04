/**
 * The process-wide settings service and typed readers for the parts of the
 * system that act on settings today.
 *
 * Readers never throw: a settings table that cannot be read (database blip,
 * migration not yet applied) falls back to the platform defaults, so sign-in,
 * matching and mail keep working. The fallback is logged by name only.
 */

import { MATCH_WEIGHTS } from "@home88/domain";
import { db } from "../lib/prisma";
import { secretBoxFromEnv } from "./secret-box";
import { createSettingsService, type SettingsService } from "./service";
import { createPrismaSettingsStore } from "./store";

let service: SettingsService | null = null;

export function settings(): SettingsService {
  if (!service) {
    service = createSettingsService({ store: createPrismaSettingsStore(db), box: () => secretBoxFromEnv() });
  }
  return service;
}

/** Test seam. */
export function setSettingsService(next: SettingsService | null): void {
  service = next;
}

async function safely<T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    console.warn(`[home88:settings] ${what} unavailable (${name}); using platform defaults.`);
    return fallback;
  }
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

// --- Requests / matching -------------------------------------------------------

export type MatchWeights = { [K in keyof typeof MATCH_WEIGHTS]: number };

export type RequestConfig = {
  minMatchScore: number;
  maxMatches: number;
  priceTolerance: number;
  sizeTolerance: number;
  weights: MatchWeights;
};

export const DEFAULT_REQUEST_CONFIG: RequestConfig = {
  minMatchScore: 40,
  maxMatches: 50,
  priceTolerance: 0.05,
  sizeTolerance: 0.1,
  weights: { ...MATCH_WEIGHTS },
};

export function toRequestConfig(v: Record<string, unknown>): RequestConfig {
  const w = DEFAULT_REQUEST_CONFIG.weights;
  return {
    minMatchScore: num(v.minMatchScore, DEFAULT_REQUEST_CONFIG.minMatchScore),
    maxMatches: num(v.maxMatches, DEFAULT_REQUEST_CONFIG.maxMatches),
    priceTolerance: num(v.priceTolerancePct, 5) / 100,
    sizeTolerance: num(v.sizeTolerancePct, 10) / 100,
    weights: {
      area: num(v.weightArea, w.area),
      price: num(v.weightPrice, w.price),
      size: num(v.weightSize, w.size),
      bedrooms: num(v.weightBedrooms, w.bedrooms),
      bathrooms: num(v.weightBathrooms, w.bathrooms),
      floor: num(v.weightFloor, w.floor),
      year: num(v.weightYear, w.year),
      features: num(v.weightFeatures, w.features),
    },
  };
}

export function requestConfig(): Promise<RequestConfig> {
  return safely("request settings", async () => toRequestConfig(await settings().config("requests")), DEFAULT_REQUEST_CONFIG);
}

// --- Calendar ------------------------------------------------------------------

export type CalendarConfig = { viewingMinutes: number };

export function calendarConfig(): Promise<CalendarConfig> {
  return safely(
    "calendar settings",
    async () => {
      const v = await settings().config("calendar");
      return { viewingMinutes: num(v.viewingMinutes, 30) };
    },
    { viewingMinutes: 30 },
  );
}

// --- Security ------------------------------------------------------------------

export type SecurityConfig = {
  /** null = the environment's SESSION_TTL_HOURS. */
  sessionTimeoutHours: number | null;
  passwordMinLength: number;
  login: { points: number; durationSeconds: number };
};

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  sessionTimeoutHours: null,
  passwordMinLength: 12,
  login: { points: 8, durationSeconds: 900 },
};

export function securityConfig(): Promise<SecurityConfig> {
  return safely(
    "security settings",
    async () => {
      const v = await settings().config("security");
      return {
        sessionTimeoutHours: typeof v.sessionTimeoutHours === "number" ? v.sessionTimeoutHours : null,
        // Never weaker than the platform minimum, whatever is stored.
        passwordMinLength: Math.max(12, num(v.passwordMinLength, 12)),
        login: {
          points: num(v.maxLoginAttempts, DEFAULT_SECURITY_CONFIG.login.points),
          durationSeconds: num(v.lockoutMinutes, DEFAULT_SECURITY_CONFIG.login.durationSeconds / 60) * 60,
        },
      };
    },
    DEFAULT_SECURITY_CONFIG,
  );
}

// --- Email ---------------------------------------------------------------------

export type SmtpSettings = {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  tls: boolean;
  fromName: string | null;
  fromEmail: string;
  replyTo: string | null;
};

/** SMTP settings from the Settings screen, or null when they are not complete. */
export function smtpFromSettings(): Promise<SmtpSettings | null> {
  return safely(
    "email settings",
    async () => {
      const v = await settings().config("email");
      const host = str(v.smtpHost);
      const fromEmail = str(v.fromEmail);
      const port = typeof v.smtpPort === "number" ? v.smtpPort : null;
      if (v.mode !== "SMTP" || !host || !fromEmail || !port) return null;
      const username = str(v.smtpUsername);
      const password = username ? await settings().secret("email", "smtpPassword") : null;
      if (username && !password) return null;
      return {
        host,
        port,
        username,
        password,
        tls: v.smtpTls !== false,
        fromName: str(v.fromName),
        fromEmail,
        replyTo: str(v.replyTo),
      };
    },
    null,
  );
}

// --- Commissions -----------------------------------------------------------------

export type CommissionRulesConfig = {
  saleCommissionPct: number | null;
  rentCommissionMonths: number | null;
  assignmentCommissionPct: number | null;
  buyerSidePct: number | null;
  sellerSidePct: number | null;
  minimumFee: number | null;
  agentSharePct: number | null;
  agencySharePct: number | null;
  vatMode: string | null;
  vatRatePct: number | null;
};

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Commission rules from Settings → Προμήθειες; every value stays null until HOME88 sets it. */
export function commissionRules(): Promise<CommissionRulesConfig> {
  const empty: CommissionRulesConfig = {
    saleCommissionPct: null, rentCommissionMonths: null, assignmentCommissionPct: null, buyerSidePct: null,
    sellerSidePct: null, minimumFee: null, agentSharePct: null, agencySharePct: null, vatMode: null, vatRatePct: null,
  };
  return safely(
    "commission settings",
    async () => {
      const v = await settings().config("commissions");
      return {
        saleCommissionPct: numOrNull(v.saleCommissionPct),
        rentCommissionMonths: numOrNull(v.rentCommissionMonths),
        assignmentCommissionPct: numOrNull(v.assignmentCommissionPct),
        buyerSidePct: numOrNull(v.buyerSidePct),
        sellerSidePct: numOrNull(v.sellerSidePct),
        minimumFee: numOrNull(v.minimumFee),
        agentSharePct: numOrNull(v.agentSharePct),
        agencySharePct: numOrNull(v.agencySharePct),
        vatMode: str(v.vatMode),
        vatRatePct: numOrNull(v.vatRatePct),
      };
    },
    empty,
  );
}
