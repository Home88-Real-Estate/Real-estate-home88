import type { Prisma, PrismaClient } from "@home88/database";

/** Either the client or an open transaction: every helper works inside the caller's transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;

export type Actor = { id: string; name: string };
