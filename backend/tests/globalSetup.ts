import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { config } from "dotenv";
import type { PrismaClient } from "@prisma/client";
import { seedBuiltInFeatures } from "../prisma/builtInFeatures";
import { seedSubscriptionPlans } from "../prisma/seedPlans";
import { seedAddOnCatalog } from "../prisma/seedAddOns";

// prisma/schema.prisma is pinned to `provider = "postgresql"` for real
// dev/production (see render-build script + that file's own header
// comment on swapping providers) — tests can't just run `prisma db push`
// against that schema with a `file:...` DATABASE_URL, Prisma rejects the
// URL/provider mismatch outright. Rather than mutate the committed schema
// (and the app's own generated `@prisma/client`, shared by every non-test
// import of src/lib/prisma.ts) for the duration of a test run, this derives
// a throwaway SQLite variant — same models, swapped datasource + a
// dedicated generator `output` so its generated client never collides with
// the real one — regenerated fresh every run so it can never drift from
// the real schema. Both derived files are gitignored; nothing here is
// meant to be committed. See src/lib/prisma.ts for the matching
// NODE_ENV==="test" branch that imports the client this produces.
function writeTestSchema(backendRoot: string): string {
  const schemaPath = path.join(backendRoot, "prisma", "schema.prisma");
  const testSchemaPath = path.join(backendRoot, "prisma", "schema.test.prisma");

  const source = fs.readFileSync(schemaPath, "utf8");
  const testSchema = source
    .replace(/provider\s*=\s*"postgresql"[^\n]*/, 'provider = "sqlite"')
    .replace(/generator client \{/, 'generator client {\n  output   = "./test-client"');

  fs.writeFileSync(testSchemaPath, testSchema);
  return testSchemaPath;
}

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

  const testSchemaPath = writeTestSchema(backendRoot);
  const testEnv = { ...process.env, DATABASE_URL: `file:${dbPath}` };

  execSync(`npx prisma generate --schema="${testSchemaPath}"`, { cwd: backendRoot, env: testEnv, stdio: "inherit" });
  execSync(`npx prisma db push --schema="${testSchemaPath}" --skip-generate --accept-data-loss`, {
    cwd: backendRoot,
    env: testEnv,
    stdio: "inherit",
  });

  // Generated fresh by the `prisma generate` call above (into
  // prisma/test-client, per writeTestSchema's output override) — only
  // requirable after that point, so this import has to be dynamic rather
  // than a static top-level one.
  const { PrismaClient: TestPrismaClient } = await import(path.join(backendRoot, "prisma", "test-client", "index.js"));

  // The built-in Feature catalog (Products/Categories/etc.) is seeded data,
  // not part of the schema itself — every test run needs it present so
  // tests can reference built-in features by key, same as dev.db does via
  // prisma/seed.ts. Cast: this is the SQLite-generated client, structurally
  // identical to (but a distinct nominal type from) the real `PrismaClient`
  // the seed helpers are typed against — the schema is deliberately written
  // to produce the same model shape on either provider (see schema.prisma's
  // header comment), so this is safe.
  const prisma = new TestPrismaClient({ datasources: { db: { url: `file:${dbPath}` } } }) as unknown as PrismaClient;
  await seedBuiltInFeatures(prisma);
  // Same reasoning as the Feature catalog above — the 4 real plans and the
  // add-on catalog are seeded data tests need to reference by real name/
  // featureKey (e.g. "Starter AI", AI_CONTENT_GENERATION), not schema.
  await seedSubscriptionPlans(prisma);
  await seedAddOnCatalog(prisma);
  await prisma.$disconnect();
}
