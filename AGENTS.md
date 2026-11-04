# AGENTS.md

Mortgage Tracker is a pnpm monorepo: a Fastify API with Prisma/Postgres and a
Redis cache, a Vite + React web app, and shared zod schemas and math.

## Layout
- `packages/shared`: zod schemas and amortization math. Used by **both** the API and the web app, so put any calculation here, never in a component or route.
- `apps/api`: Fastify 5. Routes are in `src/scenarios/routes.ts`. `src/scenarios/repo.ts` converts between dollars (API) and integer cents (DB). The schema is in `prisma/schema.prisma`.
- `apps/web`: Vite + React 19, no router or state library. The API client is `src/api.ts` and it validates responses with the shared zod schemas.
- `infra/compose.yml`: Postgres 17 and Redis 8 for **this worktree only**.

## Rules
- **Never hardcode a port, host or DB URL.** Everything comes from the root `.env` (written by `scripts/dev-env.sh <slot>`). Other worktrees run at the same time on other ports.
- Do not add `container_name` or fixed host ports to `infra/compose.yml`.
- Money is stored as integer cents in the DB and exposed as dollars everywhere else.
- Validate every request body and query string with zod. A `ZodError` becomes a 400 automatically (see `app.ts`).
- Schema changes go through `pnpm db:migrate` (Prisma creates the migration). Commit the migration folder.
- Keep the change scoped to the task. Do not reformat unrelated files.

## Commands (run from the repo root)
| Command            | What it does                                                 |
|--------------------|--------------------------------------------------------------|
| `pnpm dev`         | Runs the API and web app with hot reload                     |
| `pnpm check`       | Typecheck + all tests. **Must pass before you finish.**      |
| `pnpm db:migrate`  | Creates and applies a migration after editing `schema.prisma` |
| `pnpm db:seed`     | Resets the scenarios to 3 sample rows                        |
| `pnpm db:reset`    | Drops, re-migrates and re-seeds the dev DB                   |

API tests (`apps/api/test`) run against the real Postgres and Redis, using a
separate `test` schema and Redis db 15, so they never touch dev data. Add a test
for every new endpoint or behavior.

## Definition of done
1. `pnpm check` passes.
2. The task's acceptance criteria in `TASKS.md` are met.
3. New behavior has tests: unit tests in `packages/shared`, integration tests in `apps/api/test`.
