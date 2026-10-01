import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { loadConfig } from "./config";
import { HttpError, isHttpError } from "./lib/errors";
import { attachAuth } from "./plugins/auth";
import { authRoutes } from "./routes/auth";
import { contactRoutes } from "./routes/contacts";
import { healthRoutes } from "./routes/health";
import { leadRoutes } from "./routes/leads";
import { portalRoutes } from "./routes/portals";
import { propertyRoutes } from "./routes/properties";

export async function buildServer(): Promise<FastifyInstance> {
  const cfg = loadConfig();

  const app = Fastify({
    logger: { level: cfg.NODE_ENV === "production" ? "info" : "warn" },
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(cors, { origin: [cfg.CRM_URL, cfg.SITE_URL], credentials: true });

  /**
   * CSRF defence for cookie-authenticated writes. A browser sends Origin on
   * cross-site requests; if it is present and not allow-listed, the request is
   * rejected. Non-browser clients (curl, server-to-server) send no Origin and
   * are unaffected — they cannot be tricked into riding a victim's cookie.
   */
  app.addHook("onRequest", async (request) => {
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    const origin = request.headers.origin;
    if (!origin) return;
    if (origin !== cfg.CRM_URL && origin !== cfg.SITE_URL) {
      throw new HttpError(403, "csrf_origin", "Origin not allowed.");
    }
  });

  app.addHook("onRequest", attachAuth);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (isHttpError(error)) {
      reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, fields: error.fields },
      });
      return;
    }
    if (error instanceof ZodError) {
      reply.code(422).send({ error: { code: "validation_failed", message: "Invalid input." } });
      return;
    }

    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      // Log server-side with the full error; the client gets a generic message.
      request.log.error(error);
    }
    reply.code(status).send({
      error: {
        code: status >= 500 ? "internal_error" : "request_error",
        message: status >= 500 ? "Something went wrong." : error.message,
      },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api" });
  await app.register(propertyRoutes, { prefix: "/api" });
  await app.register(leadRoutes, { prefix: "/api" });
  await app.register(contactRoutes, { prefix: "/api" });
  await app.register(portalRoutes, { prefix: "/api" });

  return app;
}
