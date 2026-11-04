/** The worktree's DATABASE_URL, pointed at the `test` schema. */
export function testDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL missing. Run `scripts/dev-env.sh <slot>` first.");
  const url = new URL(raw);
  url.searchParams.set("schema", "test");
  return url.toString();
}
