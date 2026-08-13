import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // Postgres round-trips are slower than the default 5s per-test budget.
    testTimeout: 20_000,
    setupFiles: ["./vitest.integration.setup.ts"],
    // Guards and the rate limiter carry module-level in-memory state (caches,
    // counters); running each file in its own process keeps tests from
    // leaking that state into each other.
    fileParallelism: false,
  },
});
