# Launchpad: mortgage-tracker

This folder is only a launchpad. **The code is not here.** Every task gets its own
private copy of the repo, its own branch and its own database, set up by you in
step 1. Several agents use this launchpad at the same time, so never work
directly in this folder and never touch another task's folder under `work/`.

(Generated from `ops/launchpad/AGENTS.md` in the mortgage-tracker repo. Edits here are overwritten.)

## Workflow, for every task

1. **Set up.** Pick a short name for the task (e.g. `05-csv`) and run, from this folder:
   ```bash
   bash bootstrap.sh <short-name>
   ```
   It prints `=== READY ===` with your **workdir**. The name may get a suffix (`05-csv-2`) if it's taken, so use the workdir it prints.
   If it says all slots are busy, wait a minute and retry. If it fails in any other way, stop and report the error.

2. **Work.** `cd` into the workdir and follow **its** `AGENTS.md`. That's the real project guide (setup is already done; skip its setup step). Tasks are described in its `TASKS.md`. Commit your work on the `task/<name>` branch.

3. **Deliver.** When `pnpm check` passes and everything is committed, run from the workdir:
   ```bash
   bash ../../deliver.sh
   ```
   It must print `=== DELIVERED ===`. This hands your branch to the maintainer and frees your database slot.
   **Always deliver**, even if you couldn't finish: commit what you have with a message explaining what's missing, then deliver.

## Rules
- Don't run `docker`, and don't install Postgres or Redis. Your database comes from step 1.
- `bootstrap.sh` and `deliver.sh` are the maintainer's own scripts. They talk to the maintainer's
  slot provisioner on the host (`host.docker.internal:7070`). Don't call its endpoints yourself.
- In your final message, say which branch you delivered and summarize what you did.
