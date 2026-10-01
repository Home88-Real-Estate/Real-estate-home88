import type { FastifyInstance } from "fastify";
import { db } from "../lib/prisma";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await db().$queryRaw`SELECT 1`;
      return { status: "ready", database: "up" };
    } catch {
      reply.code(503);
      return { status: "unavailable", database: "down" };
    }
  });
}
