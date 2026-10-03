#!/usr/bin/env node
/**
 * Fails when server-only secrets machinery or secret environment names reach
 * the browser bundles of the CRM or the website. Run after `npm run build`.
 *
 *   node scripts/check-client-bundle.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Code-level markers only. Names that legitimately appear in UI text (e.g. the
 * SETTINGS_ENCRYPTION_KEY hint shown to administrators) are not secrets.
 */
const FORBIDDEN = [
  "h88-settings-secret-v1", // AAD marker of apps/api/src/settings/secret-box.ts
  "aes-256-gcm", // any server-side cipher code
  "providerCredential.", // Prisma access to the credentials table
  "process.env.DATABASE_URL",
  "process.env.JWT_SECRET",
  "process.env.PII_ENCRYPTION_KEY",
  "process.env.SETTINGS_ENCRYPTION_KEY",
  "process.env.SMTP_PASSWORD",
];

const roots = ["apps/crm/.next/static", "apps/web/.next/static"].filter((r) => existsSync(r));
if (roots.length === 0) {
  console.error("No build output found. Run the builds first.");
  process.exit(2);
}

const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(js|mjs|css|map|json|html)$/.test(name)) {
      const text = readFileSync(path, "utf8");
      for (const marker of FORBIDDEN) if (text.includes(marker)) hits.push(`${path}: ${marker}`);
    }
  }
}
roots.forEach(walk);

if (hits.length > 0) {
  console.error("Server-only material found in client bundles:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`Client bundles clean (${roots.join(", ")}).`);
