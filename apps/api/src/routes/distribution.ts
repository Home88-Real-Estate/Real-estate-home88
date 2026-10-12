/**
 * Portal directory for the "Πύλες & Διανομή" workspace.
 *
 *   GET /distribution/portals   every known destination with an honest status
 *
 * Read-only. Status comes from the existing portal framework (adapter present,
 * account configured, last successful sync), never from the directory alone, and
 * no credential or feed token is part of the response.
 */

import { DISTRIBUTION_STATUSES, PORTAL_DIRECTORY, countByStatus, distributionStatus, filterDirectory, type DirectoryRow } from "@home88/domain";
import { getAdapter } from "@home88/portals";
import type { FastifyInstance } from "fastify";

import { portalView } from "./settings";
import { requireRole } from "../plugins/auth";

export async function distributionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/distribution/portals", { preHandler: requireRole("AGENT") }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const rows: DirectoryRow[] = [];
    for (const entry of PORTAL_DIRECTORY) {
      let live: DirectoryRow["live"] = null;
      let status = distributionStatus(entry, null);
      if (entry.catalogCode) {
        const view = await portalView(entry.catalogCode, false);
        status = distributionStatus(entry, { hasAdapter: Boolean(getAdapter(entry.catalogCode)), status: view.integrationStatus });
        live = { lastSuccessAt: view.lastSuccessAt, lastError: view.lastError, enabled: view.enabled };
      }
      rows.push({ ...entry, status, live });
    }
    const filtered = filterDirectory(rows, {
      q: query.q,
      country: query.country,
      market: query.market,
      method: query.method,
      status: query.status && (DISTRIBUTION_STATUSES as readonly string[]).includes(query.status) ? query.status : undefined,
      priority: query.priority,
      group: query.group,
    });
    return { data: filtered, total: rows.length, counts: countByStatus(rows) };
  });
}
