/**
 * Fills Contact.phoneHash for contacts created before phone matching existed.
 *
 * The public intake finds a returning visitor by normalised email, then by
 * normalised phone. Older contacts only have their phone encrypted, so without
 * this they can never be matched by number. It decrypts each phone in memory,
 * hashes the normalised value and stores only the hash.
 *
 *   npm run backfill:phone-hash -w @home88/api            # writes
 *   npm run backfill:phone-hash -w @home88/api -- --dry   # reports only
 *
 * Needs the same PII_ENCRYPTION_KEY and PII_HASH_PEPPER the API runs with.
 * Safe to re-run: it only touches contacts whose phoneHash is empty.
 */

import { db } from "../src/lib/prisma";
import { decryptField, hashPhone, hasEncryptionKey } from "../src/lib/pii";

async function main() {
  const dry = process.argv.includes("--dry");
  if (!hasEncryptionKey()) {
    console.error("PII_ENCRYPTION_KEY is not set; nothing can be decrypted.");
    process.exit(1);
  }

  let cursor: string | undefined;
  let scanned = 0;
  let updated = 0;
  let unusable = 0;

  for (;;) {
    const batch = await db().contact.findMany({
      where: { phoneHash: null, OR: [{ phoneEncrypted: { not: null } }, { mobileEncrypted: { not: null } }] },
      select: { id: true, phoneEncrypted: true, mobileEncrypted: true },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    for (const contact of batch) {
      scanned += 1;
      const hash = hashPhone(decryptField(contact.phoneEncrypted)) ?? hashPhone(decryptField(contact.mobileEncrypted));
      if (!hash) {
        unusable += 1; // undecryptable, empty or not a phone number: leave it, never guess
        continue;
      }
      if (!dry) await db().contact.update({ where: { id: contact.id }, data: { phoneHash: hash } });
      updated += 1;
    }
    cursor = batch[batch.length - 1]!.id;
  }

  console.log(`${dry ? "[dry run] " : ""}scanned ${scanned}, ${dry ? "would update" : "updated"} ${updated}, skipped ${unusable}`);
  await db().$disconnect();
}

main().catch((error) => {
  console.error("backfill failed:", error instanceof Error ? error.constructor.name : "unknown");
  process.exit(1);
});
