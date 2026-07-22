import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across tsx's dev-server hot reloads instead of
// opening a fresh connection pool on every file change.
const globalForPrisma = global as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
