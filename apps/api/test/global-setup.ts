import { execSync } from "node:child_process";
import { testDatabaseUrl } from "./db-url.js";

/** Bring the `test` schema up to the latest migration once per test run. */
export default function setup() {
  execSync("prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
}
