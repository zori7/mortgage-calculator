# Mortgage Tracker

A small full-stack proof of concept: calculate a mortgage, save scenarios to
Postgres, and view amortization schedules (cached in Redis).

**Stack:** Fastify 5 · Prisma 6 / Postgres 17 · Redis 8 · zod 4 · Vite 8 + React 19 · Vitest · pnpm workspaces

It is built to be **parallel-safe**: any number of worktrees (yours or AI
agents') can run their own full stack side by side without colliding.

## Quick start

```bash
pnpm install
scripts/dev-env.sh 0     # writes .env for slot 0
pnpm infra:up            # Postgres + Redis for this worktree
pnpm db:migrate && pnpm db:seed
pnpm dev                 # web http://localhost:5173 · api http://localhost:3001
pnpm check               # typecheck + tests
```

## How parallel isolation works

Everything that could collide is derived from a **slot** number (0–9):

| Slot | Web  | API  | Postgres | Redis | Compose project      |
|------|------|------|----------|-------|----------------------|
| 0    | 5173 | 3001 | 5432     | 6379  | `mt-mortgage-tracker` |
| 3    | 5203 | 3031 | 5462     | 6409  | `mt-mortgage-tracker-task-03` |

- `infra/compose.yml` has no `container_name` and no fixed ports. Docker namespaces containers, volumes and networks by `COMPOSE_PROJECT_NAME`.
- The API, web app and Prisma all read the root `.env`. No port is hardcoded.
- Vite uses `strictPort`, so a port clash fails loudly instead of silently moving to another port.
- Tests use a separate Postgres schema and Redis db, so `pnpm check` never wipes your dev data.

### One isolated workspace per agent

```bash
pnpm agent:new task-03-yearly 3   # worktree ../mortgage-tracker-task-03-yearly + own DB, migrated & seeded
cd ../mortgage-tracker-task-03-yearly && pnpm dev
pnpm agent:rm task-03-yearly      # removes containers, volumes and worktree; keeps the branch
```

(`git worktree` needs at least one commit on the current branch.)

### With OpenHands

The OpenHands sandbox has no Docker, so run each slot's Postgres and Redis on the host and let the sandbox connect to them:

1. On the host: `pnpm agent:new task-05-csv 5` (this creates the worktree and starts the DB).
2. Start an OpenHands session with that worktree mounted as the workspace and `SLOT=5` in the sandbox env.
3. `.openhands/setup.sh` runs automatically. It writes `.env` pointing at `host.docker.internal`, installs deps and migrates.

Each agent then has its own code, DB and ports. See `TASKS.md` for ten test tasks.

## API

| Method | Path                       | Notes                                 |
|--------|----------------------------|---------------------------------------|
| GET    | `/health`                  | `{ ok, db, redis }`                   |
| GET    | `/scenarios`               | Newest first, with summary            |
| POST   | `/scenarios`               | Body: `ScenarioCreate` (zod) → 201    |
| GET    | `/scenarios/:id`           | 404 if missing                        |
| DELETE | `/scenarios/:id`           | 204                                   |
| GET    | `/scenarios/:id/schedule`  | Full schedule; `x-cache: HIT/MISS`    |
