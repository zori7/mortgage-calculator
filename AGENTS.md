# AGENTS.md

Mortgage Tracker is a pnpm monorepo: a Fastify API with Prisma/Postgres and a
Redis cache, a Vite + React web app, and shared zod schemas and math.

## Setup
If you got here through the OpenHands launchpad, setup is **already done**.
Otherwise (or after a sandbox restart) run:
```bash
bash scripts/setup.sh
```
If `pnpm` or `node` is "not found" in your shell, run
`export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"` (setup installs them there).

This installs the pinned Node and pnpm if missing, writes `.env` for this
checkout's slot (from `.slot`), installs deps, migrates and seeds. Postgres and
Redis **already run on the host** for your slot. Do not try to start them, do
not install Postgres or Redis yourself, and do not run `docker`. If `setup.sh`
can't reach the DB, stop and report it.

## Git
- You are on branch `task/<name>`. Commit your work there with clear messages.
- Don't push (there is no remote), switch branches, rebase or edit `.slot`/`.env`.
- Finish with a clean working tree: everything committed. Then deliver (see the launchpad's AGENTS.md).

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
- Schema changes go through `pnpm db:migrate --name <snake_case_name>` (e.g. `--name add_notes`). **Always pass `--name`**: without it Prisma stops to ask for one. Commit the migration folder.
- Keep the change scoped to the task. Do not reformat unrelated files.

## Commands (run from the repo root)
| Command            | What it does                                                 |
|--------------------|--------------------------------------------------------------|
| `pnpm dev`         | Runs the API and web app with hot reload                     |
| `pnpm check`       | Typecheck + all tests. **Must pass before you finish.**      |
| `pnpm db:migrate --name <name>` | Creates and applies a migration after editing `schema.prisma` |
| `pnpm db:seed`     | Resets the scenarios to 3 sample rows                        |
| `pnpm db:reset`    | Drops, re-migrates and re-seeds the dev DB                   |

API tests (`apps/api/test`) run against the real Postgres and Redis, using a
separate `test` schema and Redis db 15, so they never touch dev data. Add a test
for every new endpoint or behavior.

## Definition of done
1. `pnpm check` passes.
2. The task's acceptance criteria in `TASKS.md` are met.
3. New behavior has tests: unit tests in `packages/shared`, integration tests in `apps/api/test`.
4. All work is committed on your `task/<name>` branch.
