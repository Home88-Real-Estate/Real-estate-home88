import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { loadConfig } from "./config";
import { HttpError, isDatabaseUnavailable, isHttpError } from "./lib/errors";
import { attachAuth } from "./plugins/auth";
import { accountRoutes } from "./routes/account";
import { authRoutes } from "./routes/auth";
import { contactRoutes } from "./routes/contacts";
import { dashboardRoutes } from "./routes/dashboard";
import { documentRoutes } from "./routes/documents";
import { healthRoutes } from "./routes/health";
import { invitationRoutes } from "./routes/invitations";
import { leadRoutes } from "./routes/leads";
import { mandateDocumentRoutes } from "./routes/mandate-documents";
import { mandateRoutes } from "./routes/mandates";
import { showingRoutes } from "./routes/showings";
import { verifyRoutes } from "./routes/verify";
import { connectionRoutes } from "./routes/connections";
import { reportRoutes } from "./routes/reports";
import { automationRoutes } from "./routes/automation";
import { aiRoutes } from "./routes/ai";
import { messageRoutes } from "./routes/messages";
import { isAllowedOrigin, parseOriginList } from "./lib/origin";
import { mediaRoutes } from "./routes/media";
import { submissionRoutes } from "./routes/submissions";
import { portalRoutes } from "./routes/portals";
import { portalAccountRoutes } from "./routes/portal-accounts";
import { publicationRoutes } from "./routes/publications";
import { propertyRoutes } from "./routes/properties";
import { propertyIntakeRoutes } from "./routes/property-intake";
import { requestRoutes } from "./routes/requests";
import { sellerRoutes } from "./routes/sellers";
import { settingsRoutes } from "./routes/settings";
import { taskRoutes } from "./routes/tasks";
import { transactionRoutes } from "./routes/transactions";
import { userRoutes } from "./routes/users";
import { valuationRequestRoutes } from "./routes/valuation-requests";
import { valuationRoutes } from "./routes/valuations";
import { viewingRoutes } from "./routes/viewings";

export async function buildServer(): Promise<FastifyInstance> {
  const cfg = loadConfig();

  const app = Fastify({
    logger: { level: cfg.NODE_ENV === "production" ? "info" : "warn" },
    trustProxy: true,
  });

  await app.register(cookie);
  const allowedOrigins = [cfg.CRM_URL, cfg.SITE_URL, ...parseOriginList(cfg.CRM_PUBLIC_ORIGINS)];
  await app.register(cors, { origin: allowedOrigins, credentials: true });

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
    if (!isAllowedOrigin(origin, allowedOrigins, request.headers)) {
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
      reply.code(422).send({ error: { code: "validation_failed", message: "Μη έγκυρα στοιχεία." } });
      return;
    }

    if (isDatabaseUnavailable(error)) {
      // Name and code only: Prisma messages can echo the connection target.
      const code = (error as { errorCode?: string; code?: string }).errorCode ?? error.code;
      request.log.error({ err: { name: error.name, code } }, "database unavailable");
      reply
        .code(503)
        .header("retry-after", "30")
        .send({
          error: {
            code: "database_unavailable",
            message: "Η υπηρεσία δεν είναι προσωρινά διαθέσιμη. Παρακαλούμε δοκιμάστε ξανά αργότερα.",
          },
        });
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
        message: status >= 500 ? "Κάτι πήγε στραβά." : error.message,
      },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: "not_found", message: "Δεν βρέθηκε." } });
  });

  await app.register(healthRoutes);
  // Same checks under /api, the prefix the CRM deployment exposes publicly.
  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(authRoutes, { prefix: "/api" });
  await app.register(accountRoutes, { prefix: "/api" });
  await app.register(invitationRoutes, { prefix: "/api" });
  await app.register(propertyRoutes, { prefix: "/api" });
  await app.register(propertyIntakeRoutes, { prefix: "/api" });
  await app.register(leadRoutes, { prefix: "/api" });
  await app.register(contactRoutes, { prefix: "/api" });
  await app.register(portalRoutes, { prefix: "/api" });
  await app.register(portalAccountRoutes, { prefix: "/api" });
  await app.register(publicationRoutes, { prefix: "/api" });
  await app.register(mediaRoutes, { prefix: "/api" });
  await app.register(submissionRoutes, { prefix: "/api" });
  await app.register(userRoutes, { prefix: "/api" });
  await app.register(taskRoutes, { prefix: "/api" });
  await app.register(viewingRoutes, { prefix: "/api" });
  await app.register(requestRoutes, { prefix: "/api" });
  await app.register(dashboardRoutes, { prefix: "/api" });
  await app.register(settingsRoutes, { prefix: "/api" });
  await app.register(transactionRoutes, { prefix: "/api" });
  await app.register(sellerRoutes, { prefix: "/api" });
  await app.register(valuationRoutes, { prefix: "/api" });
  await app.register(valuationRequestRoutes, { prefix: "/api" });
  await app.register(documentRoutes, { prefix: "/api" });
  await app.register(mandateRoutes, { prefix: "/api" });
  await app.register(mandateDocumentRoutes, { prefix: "/api" });
  await app.register(showingRoutes, { prefix: "/api" });
  await app.register(verifyRoutes, { prefix: "/api" });
  await app.register(messageRoutes, { prefix: "/api" });
  await app.register(connectionRoutes, { prefix: "/api" });
  await app.register(reportRoutes, { prefix: "/api" });
  await app.register(automationRoutes, { prefix: "/api" });
  await app.register(aiRoutes, { prefix: "/api" });

  return app;
}
