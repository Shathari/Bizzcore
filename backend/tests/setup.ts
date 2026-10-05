import path from "path";
import { config } from "dotenv";

// Runs in the same process as the test files (unlike globalSetup, which is
// isolated and can't inject env vars into them) — must execute before any
// test file imports src/app.ts, since that transitively reads
// process.env.JWT_SECRET etc. Vitest guarantees setupFiles run first.
config({ path: path.resolve(__dirname, "../.env.test"), override: true });

// Never inherit live email adapters from the developer's .env. Adapter tests
// explicitly provide their own fake credentials when exercising live mode.
process.env.EMAIL_PROVIDER = "smtp";
for (const key of ["RESEND_API_KEY", "SENDGRID_API_KEY", "POSTMARK_SERVER_TOKEN"]) {
  process.env[key] = "";
}
