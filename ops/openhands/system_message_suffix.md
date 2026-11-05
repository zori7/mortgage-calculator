## Project: mortgage-tracker

You work on the mortgage-tracker project. Its code is NOT in /workspace when the
conversation starts. Each task gets its own private copy of the repo, its own git
branch and its own database, provided by the maintainer's slot provisioner on the
host (http://host.docker.internal:7070).

Before working on any task (e.g. "do task 3 from TASKS.md"), set up:

```bash
cd /workspace
curl -fsSO http://host.docker.internal:7070/bootstrap.sh
curl -fsSO http://host.docker.internal:7070/deliver.sh
bash bootstrap.sh <short-task-name>      # e.g. 03-yearly
```

It prints `=== READY ===` with your workdir. `cd` there. That's the repo: follow its
AGENTS.md (setup is already done) and find tasks in its TASKS.md. Commit your work
on the `task/<name>` branch.

When `pnpm check` passes and everything is committed, deliver from the workdir:

```bash
bash ../../deliver.sh
```

It must print `=== DELIVERED ===`. Always deliver, even if unfinished (commit what you
have and explain what's missing). Never run docker or install Postgres/Redis; your
database comes from the bootstrap. If the bootstrap fails, stop and report the error.
In your final message, name the delivered branch and summarize what you did.
