import { PrismaClient } from "@prisma/client";

// BigInt fields (ContentResearchLink's view/like/comment/share counts —
// Postgres INT4 can't hold real view counts on very popular reference
// videos) aren't JSON-serializable by default; this makes JSON.stringify /
// Express's res.json treat them as plain numbers instead of throwing.
// Safe: no realistic engagement count gets close to Number.MAX_SAFE_INTEGER.
if (!("toJSON" in BigInt.prototype)) {
  (BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
    return Number(this);
  };
}

// Reuse a single PrismaClient across tsx's dev-server hot reloads instead of
// opening a fresh connection pool on every file change.
const globalForPrisma = global as unknown as { prisma?: PrismaClient };

// prisma/schema.prisma is pinned to `provider = "postgresql"` for real
// dev/production, so the `@prisma/client` imported above can only ever
// accept a postgres:// URL — a real constraint baked in at `prisma
// generate` time, not something a runtime datasource override can bypass.
// The test suite runs against an isolated local SQLite database instead
// (see tests/globalSetup.ts), so under NODE_ENV=test this swaps in a
// separately-generated client built from a derived SQLite schema, rather
// than ever touching the real one.
function createClient(): PrismaClient {
  if (process.env.NODE_ENV === "test") {
    const { PrismaClient: TestPrismaClient } = require("../../prisma/test-client");
    return new TestPrismaClient() as unknown as PrismaClient;
  }
  return new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
