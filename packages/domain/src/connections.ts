/**
 * Connections: one overview of every external service the CRM depends on.
 *
 * Every row uses the integration vocabulary of Settings → Portals
 * (PORTAL_STATUS_LABELS), so a status means the same thing everywhere.
 * Credentials are never part of a connection's state: only whether they are
 * set, and what the system last observed (a delivery, a sync, an error).
 */

export type ConnectionStatus = "PLANNED" | "NOT_CONFIGURED" | "CONFIGURED" | "CONNECTED" | "ERROR" | "DISABLED";

/** How a provider-backed service (email, SMS, e-signature) resolved its settings. */
export type ProviderResolution = "configured" | "environment" | "no_adapter" | "not_configured";

type When = Date | string | null | undefined;
const time = (d: When) => (d ? new Date(d).getTime() : 0);

/**
 * Status of a provider-backed connection. A provider chosen in Settings whose
 * adapter is not built yet is PLANNED: it cannot send anything.
 */
export function providerConnectionStatus(input: { state: ProviderResolution; lastSuccessAt?: When; lastErrorAt?: When }): ConnectionStatus {
  if (input.state === "not_configured") return "NOT_CONFIGURED";
  if (input.state === "no_adapter") return "PLANNED";
  const ok = time(input.lastSuccessAt);
  const err = time(input.lastErrorAt);
  if (err > ok) return "ERROR";
  return ok > 0 ? "CONNECTED" : "CONFIGURED";
}

/** Status of a server-side setting (an environment variable), optionally with evidence it works. */
export function serverSettingStatus(isSet: boolean, lastSuccessAt?: When): ConnectionStatus {
  if (!isSet) return "NOT_CONFIGURED";
  return time(lastSuccessAt) > 0 ? "CONNECTED" : "CONFIGURED";
}

/** Statuses an administrator should act on. DISABLED and PLANNED are deliberate states. */
export function connectionNeedsAttention(status: ConnectionStatus): boolean {
  return status === "ERROR" || status === "NOT_CONFIGURED";
}

export function summariseConnections(statuses: ConnectionStatus[]): { total: number; working: number; attention: number } {
  return {
    total: statuses.length,
    working: statuses.filter((s) => s === "CONNECTED" || s === "CONFIGURED").length,
    attention: statuses.filter(connectionNeedsAttention).length,
  };
}
