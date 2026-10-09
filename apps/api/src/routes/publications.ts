/**
 * Unified channel publishing for one property.
 *
 *   GET  /properties/:id/publications            the panel: website + every portal
 *   POST /properties/:id/publications/validate   judge the selected channels
 *   POST /properties/:id/publications/preview    what each channel would publish
 *   POST /properties/:id/publications/publish    publish the selected channels
 *   POST /properties/:id/publications/update     update / regenerate them
 *   POST /properties/:id/publications/unpublish  take them down
 *
 * The routes only authenticate, parse and delegate to lib/publications, which
 * combines the website service and the portal action service. Each requested
 * channel is authorised first and then runs on its own, so the response carries
 * one result per channel and a failure on one never undoes another.
 */

import type { ChannelOperation } from "@home88/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { clientIp, parseInput, userAgent } from "../lib/http";
import { loadPublications, runPublicationOperation } from "../lib/publications";
import { requireRole } from "../plugins/auth";

const channelSchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    accountId: z.string().trim().min(1).max(40).optional(),
    environment: z.enum(["TEST", "PRODUCTION"]).optional(),
  })
  .strict();

const operationSchema = z
  .object({
    channels: z.array(channelSchema).min(1).max(20),
    /** Update only: regenerate even when nothing a visitor can see has changed. */
    force: z.boolean().optional(),
  })
  .strict();

const OPERATIONS: ChannelOperation[] = ["validate", "preview", "publish", "update", "unpublish"];

export async function publicationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/properties/:id/publications", { preHandler: requireRole("AGENT") }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.auth!.user;
    return loadPublications(id, { id: user.id, role: user.role });
  });

  for (const operation of OPERATIONS) {
    app.post(`/properties/:id/publications/${operation}`, { preHandler: requireRole("AGENT") }, async (request) => {
      const { id } = request.params as { id: string };
      const user = request.auth!.user;
      const body = parseInput(operationSchema, request.body);
      return runPublicationOperation({
        propertyId: id,
        operation,
        channels: body.channels,
        force: body.force,
        viewer: { id: user.id, role: user.role },
        ctx: { actorId: user.id, requestId: request.id, ipAddress: clientIp(request), userAgent: userAgent(request) },
      });
    });
  }
}
