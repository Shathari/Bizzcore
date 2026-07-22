import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { seedBuiltInFeatures } from "../prisma/builtInFeatures";
import { seedSubscriptionPlans } from "../prisma/seedPlans";
import { seedAddOnCatalog } from "../prisma/seedAddOns";

// Runs once, before any test file or webServer-equivalent starts (Vitest's
// globalSetup executes before setupFiles/test files). Builds a fresh
// schema on the isolated test SQLite database — deletes any leftover file
// from a previous run first so tests never start against stale data.
export default async function globalSetup() {
  const backendRoot = path.resolve(__dirname, "..");
  config({ path: path.join(backendRoot, ".env.test") });

  const dbPath = path.join(backendRoot, "prisma", "test.db");
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = dbPath + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "inherit",
  });

  // The built-in Feature catalog (Products/Categories/etc.) is seeded data,
  // not part of the schema itself — every test run needs it present so
  // tests can reference built-in features by key, same as dev.db does via
  // prisma/seed.ts.
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  await seedBuiltInFeatures(prisma);
  // Same reasoning as the Feature catalog above — the 4 real plans and the
  // add-on catalog are seeded data tests need to reference by real name/
  // featureKey (e.g. "Starter AI", AI_CONTENT_GENERATION), not schema.
  await seedSubscriptionPlans(prisma);
  await seedAddOnCatalog(prisma);
  await prisma.$disconnect();
}
