import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// NOTE: globalSetup resets the backend's dev database to a clean two-tenant
// seed before this suite runs (see e2e/global-setup.ts) — that's the same
// dev.db used by `npm run dev`, not a separate E2E database. Don't run
// this suite against a backend you care about the data in; stop any dev
// servers you're using for manual testing first, or accept they'll be
// reset. reuseExistingServer is on locally (off in CI) purely so
// iterating on a spec file doesn't pay the ~5s server-boot cost every run.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "npm run dev",
      cwd: path.resolve(__dirname, "../backend"),
      url: "http://localhost:4000/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: "npm run dev",
      cwd: __dirname,
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
