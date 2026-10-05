import { defineConfig, devices } from "@playwright/test";

// UI contract tests stub every API request. The existing E2E global setup
// resets the application database; this isolated configuration never runs it.
export default defineConfig({
  testDir: "./e2e-purchases", workers: 1, reporter: "list",
  use: { baseURL: "http://127.0.0.1:5175", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5175 --strictPort",
    url: "http://127.0.0.1:5175", reuseExistingServer: false,
    env: { VITE_API_BASE_URL: "/api" }, timeout: 30000,
  },
});
