import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./test/db-url.js";

// Integration tests hit the real Postgres/Redis of this worktree, but in a
// separate `test` schema (and Redis db 15) so they never touch dev data.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    env: {
      DATABASE_URL: testDatabaseUrl(),
      REDIS_URL: `${process.env.REDIS_URL ?? "redis://localhost:6379"}/15`,
    },
    fileParallelism: false,
  },
});
