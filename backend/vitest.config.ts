import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
    // Every test file shares one on-disk SQLite database (see
    // tests/globalSetup.ts) — SQLite serializes writes via file locks, so
    // running test files in parallel would produce flaky "database is
    // locked" failures rather than a real correctness signal. Each test
    // file uses uniquely-generated tenant/user data (see tests/helpers.ts)
    // so sequential execution is the only concurrency constraint needed.
    fileParallelism: false,
  },
});
