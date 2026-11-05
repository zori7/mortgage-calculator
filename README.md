# Mortgage Tracker

A small full-stack proof of concept: calculate a mortgage, save scenarios to
Postgres, and view amortization schedules (cached in Redis). It is also a test
bed for running several AI agents in parallel with self-hosted OpenHands.

**Stack:** Fastify 5 · Prisma 6 / Postgres 17 · Redis 8 · zod 4 · Vite 8 + React 19 · Vitest · pnpm workspaces

## One dev runtime, used by you and by agents

| Piece             | Defined in                          | Used by you            | Used by agents                  |
|-------------------|-------------------------------------|------------------------|---------------------------------|
| Postgres, Redis   | `infra/compose.yml`                 | slot 0                 | slots 1–9, same file and images |
| Node version      | `.node-version`                     | your Node              | installed by `scripts/setup.sh` |
| pnpm version      | `package.json#packageManager`       | your pnpm              | installed by `scripts/setup.sh` |
| Ports, URLs, names| `scripts/dev-env.sh` (from the slot)| `.env`                 | `.env` (DB host auto-detected)  |
| Setup steps       | `scripts/setup.sh`                  | `pnpm setup`           | run by the provisioner's bootstrap |

Databases always run on the host through the one compose file. Only the code and
Node toolchain live where the agent works.

## Manual development

```bash
scripts/dev-env.sh 0 && pnpm infra:up   # Postgres + Redis for slot 0
pnpm setup                              # deps, migrate, seed
pnpm dev                                # web http://localhost:5173 · api http://localhost:4001
pnpm check                              # typecheck + tests
```

## Parallel agents with self-hosted OpenHands

You write a prompt in OpenHands (from anywhere). Only **then** does a sandbox get
created, and it sets itself up: its own copy of the code, branch and database.

```
you: "Do task 5"  →  OpenHands starts a sandbox (one container per conversation)
                     │  workspace = ~/Playground/mt-launchpad (contains only AGENTS.md)
                     ▼
agent: curl host.docker.internal:7070/bootstrap.sh | bash -s 05-csv
                     │  provisioner: claims a free slot (1–9), starts its Postgres+Redis
                     │               from infra/compose.yml, hands out a git bundle of the repo
                     ▼
agent: clones into work/05-csv, setup.sh, does the task, pnpm check, commits
                     ▼
agent: curl host.docker.internal:7070/deliver.sh | bash
                        provisioner: fetches task/05-csv into this repo, deletes the DB, frees the slot
```

### Run the two host services

```bash
pnpm factory     # both at once, in one terminal (Ctrl-C stops both)

# or separately:
pnpm prov        # 1. slot provisioner (agents' only way to get a DB; they never get Docker access)
pnpm oh          # 2. OpenHands Agent Canvas, one container per conversation
```

In OpenHands (http://localhost:8000): set your LLM under **Settings → LLM**. Run
`node ops/openhands/apply-claude-profile.mjs` once: it installs the bootstrap
instructions (`ops/openhands/agent-instructions.md`) as a global OpenHands skill,
which every OpenHands agent gets, and creates the `claude-opusplan` profile
(Claude Code gets the same file as its own `~/.claude/CLAUDE.md`, because it
treats OpenHands skills as untrusted). Then just start a conversation with
either profile and prompt, for example:

> Do task 5 from TASKS.md.

Start as many conversations as you like (up to 9 at once). Agents only see
**committed** code on `main` (whatever you have checked out), so commit to main before you trigger tasks.

### Review results

Every delivery is checked again on the host, independently of what the agent
says: a throwaway worktree of the delivered commit, its own slot (fresh Postgres
and Redis, migrated from scratch), `pnpm check`. One at a time, a few minutes each.

```bash
pnpm prov:verify                       # ✅/❌ per delivered branch, with the log of failures
git log --notes=verify -1 task/05-csv  # the result is also a git note on the commit
pnpm prov:reverify task/05-csv         # run the check again

git log -p main..task/05-csv
git merge task/05-csv
```

### Operate

| Command                 | What it does                                          |
|-------------------------|-------------------------------------------------------|
| `pnpm prov:status`      | Show claimed slots                                    |
| `pnpm prov:release 3`   | Force-free slot 3 (stops its DB, deletes its data)    |
| `pnpm sandbox:gc`       | List leftovers: slots whose conversation is gone, exited agent containers, conversation data without a conversation, stale git refs, databases of deleted branches |
| `pnpm sandbox:gc --apply` | Remove them                                         |
| `pnpm services:install` | Run the provisioner, OpenHands and an hourly `sandbox:gc --apply` as background services (launchd): start at login, restart on crash, keep the Mac from idle-sleeping |
| `pnpm services:status` / `services:logs` / `services:uninstall` | Manage them |

Slots that are never delivered are released automatically after 4h (`MT_MAX_AGE_HOURS`).
With the services installed, don't also run `pnpm factory` (same ports). Docker
Desktop must be set to start at login. Deleting a conversation in OpenHands deletes
the agent's checkout, so deliver first.

### Slots

| Slot | Who   | Web  | API  | Postgres | Redis | Compose project |
|------|-------|------|------|----------|-------|-----------------|
| 0    | you   | 5173 | 4001 | 5432     | 6379  | `mt-s0`         |
| 1    | agent | 5183 | 4011 | 5442     | 6389  | `mt-s1`         |
| N    | agent | +10N | +10N | +10N     | +10N  | `mt-sN`         |

## API

| Method | Path                       | Notes                                 |
|--------|----------------------------|---------------------------------------|
| GET    | `/health`                  | `{ ok, db, redis }`                   |
| GET    | `/scenarios`               | Newest first, with summary            |
| POST   | `/scenarios`               | Body: `ScenarioCreate` (zod) → 201    |
| GET    | `/scenarios/:id`           | 404 if missing                        |
| DELETE | `/scenarios/:id`           | 204                                   |
| GET    | `/scenarios/:id/schedule`  | Full schedule; `x-cache: HIT/MISS`    |
