import path from "path";
import { config } from "dotenv";

// Runs in the same process as the test files (unlike globalSetup, which is
// isolated and can't inject env vars into them) — must execute before any
// test file imports src/app.ts, since that transitively reads
// process.env.JWT_SECRET etc. Vitest guarantees setupFiles run first.
config({ path: path.resolve(__dirname, "../.env.test"), override: true });
