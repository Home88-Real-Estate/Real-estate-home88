import { loadConfig } from "./config";
import { disconnectDb } from "./lib/prisma";
import { buildServer } from "./server";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const app = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    try {
      await app.close();
      await disconnectDb();
      process.exit(0);
    } catch (error) {
      console.error("[home88:api] error during shutdown:", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: cfg.API_HOST, port: cfg.API_PORT });
}

main().catch((error) => {
  console.error("[home88:api] failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
