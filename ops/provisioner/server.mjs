#!/usr/bin/env node
// Slot provisioner: lets an OpenHands sandbox set ITSELF up after a conversation
// starts. Runs on the host, next to Docker. Zero dependencies.
//
// The agent (see ops/launchpad/AGENTS.md) talks to it over
// http://host.docker.internal:7070:
//
//   GET  /bootstrap.sh            script the agent runs first: claim + clone + setup
//   POST /claim     {name}        reserve a slot, start its Postgres+Redis → {slot, name, base}
//   GET  /repo.bundle             the repo as a single git bundle (the "copy")
//   GET  /deliver.sh              script the agent runs last: deliver + release
//   GET  /instructions.md         agent instructions (ops/openhands/agent-instructions.md),
//                                 for agents that only trust their own memory file (Claude Code)
//   POST /deliver?name=<n>        body = git bundle of task/<n> → fetched into the main repo
//   POST /release   {slot}        stop that slot's containers, delete their data, free the slot
//   GET  /slots                   current claims
//   GET  /verify[.txt]            results of the independent check of each delivery
//   POST /verify?branch=task/<n>  re-run that check
//
// The databases come from the same infra/compose.yml you use for manual dev
// (compose project mt-s<slot>, ports from the slot), so there is one definition.
// Agents never get Docker access — only these endpoints.
//
// Safety net: claims older than MAX_AGE_HOURS are released automatically, so a
// crashed or forgetful agent can't leak a slot forever.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, createWriteStream, rmSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.MT_REPO ?? join(HERE, "../.."));
const PORT = Number(process.env.MT_PROVISIONER_PORT ?? 7070);
const HOST = process.env.MT_PROVISIONER_HOST ?? "127.0.0.1";
const LAUNCHPAD = resolve(process.env.MT_LAUNCHPAD ?? join(REPO, "../mt-launchpad"));
const STATE_DIR = process.env.MT_STATE_DIR ?? join(homedir(), ".mt-provisioner");
const STATE_FILE = join(STATE_DIR, "slots.json");
const MAX_AGE_HOURS = Number(process.env.MT_MAX_AGE_HOURS ?? 4);
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // slot 0 is yours
const COMPOSE = join(REPO, "infra/compose.yml");
const PUBLIC_URL = `http://host.docker.internal:${PORT}`;

// ---------------------------------------------------------------- helpers ---

function run(cmd, args, { env, input, cwd = REPO, timeout } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", fail);
    p.on("close", (code, signal) => (code === 0 ? ok(out.trim()) : fail(Object.assign(
      new Error(`${cmd} ${args.join(" ")}: ${signal ? `killed (${signal}, timeout?)` : err.trim() || out.trim()}`), { out, err }))));
    if (input) p.stdin.end(input);
  });
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// All state changes go through this queue, so concurrent claims can't race.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function saveState(s) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const ports = (slot) => ({ PG_PORT: String(5432 + slot * 10), REDIS_PORT: String(6379 + slot * 10) });
const compose = (slot, ...args) => run("docker", ["compose", "-p", `mt-s${slot}`, "-f", COMPOSE, ...args], { env: ports(slot) });
// Agents always start from this branch (committed state), whatever you have
// checked out on the host. Override with MT_BASE_BRANCH.
const BASE_BRANCH = process.env.MT_BASE_BRANCH ?? "main";
const baseBranch = async () => BASE_BRANCH;
const branchExists = (b) => run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`]).then(() => true, () => false);

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

// --------------------------------------------------------------- actions ---

async function claim(rawName) {
  const hint = String(rawName ?? "task").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "task";
  return serial(async () => {
    const state = loadState();
    const slot = SLOTS.find((s) => !state[s]);
    if (!slot) throw Object.assign(new Error("all 9 agent slots are busy; try again later"), { status: 503 });

    // Unique name across active claims and existing task branches.
    const taken = new Set(Object.values(state).map((c) => c.name));
    let name = hint;
    for (let i = 2; taken.has(name) || (await branchExists(`task/${name}`)); i++) name = `${hint}-${i}`;

    state[slot] = { name, claimedAt: new Date().toISOString() };
    saveState(state);
    try {
      await compose(slot, "up", "-d", "--wait");
    } catch (e) {
      delete state[slot];
      saveState(state);
      throw e;
    }
    log(`claim  slot ${slot} → ${name}`);
    return { slot, name, base: await baseBranch() };
  });
}

async function release(slot) {
  slot = Number(slot);
  if (!SLOTS.includes(slot)) throw Object.assign(new Error("bad slot"), { status: 400 });
  return serial(async () => {
    await compose(slot, "down", "-v").catch((e) => log(`release slot ${slot}: compose down failed: ${e.message}`));
    const state = loadState();
    const was = state[slot];
    delete state[slot];
    saveState(state);
    log(`release slot ${slot}${was ? ` (${was.name})` : ""}`);
    return { released: slot };
  });
}

async function deliver(name, body) {
  if (!/^[a-z0-9-]+$/.test(name ?? "")) throw Object.assign(new Error("bad name"), { status: 400 });
  const file = join(tmpdir(), `mt-deliver-${name}-${Date.now()}.bundle`);
  writeFileSync(file, body);
  try {
    await run("git", ["bundle", "verify", file]);
    // Land in a hidden ref first: fetching straight into task/<name> fails when you
    // have that branch checked out on the host.
    const incoming = `refs/delivered/${name}`;
    const branch = `task/${name}`;
    await run("git", ["fetch", "--quiet", file, `+${branch}:${incoming}`]);
    const current = await run("git", ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => "");

    let result;
    if (current !== branch) {
      await run("git", ["update-ref", `refs/heads/${branch}`, incoming]);
      result = { branch, mode: "updated" };
    } else {
      // Checked out on the host. Fast-forward your working tree when that is safe
      // (no local edits, no local commits the delivery lacks), else park it aside.
      const clean = (await run("git", ["status", "--porcelain", "--untracked-files=no"])) === "";
      const ff = await run("git", ["merge-base", "--is-ancestor", "HEAD", incoming]).then(() => true, () => false);
      if (clean && ff) {
        await run("git", ["merge", "--ff-only", "--quiet", incoming]);
        result = { branch, mode: "fast-forwarded your checkout" };
      } else {
        const aside = `${branch}-delivered`;
        await run("git", ["update-ref", `refs/heads/${aside}`, incoming]);
        result = {
          branch: aside, mode: "parked",
          note: `${branch} is checked out on the host with ${clean ? "commits the delivery doesn't have" : "uncommitted changes"}; delivered as ${aside} instead`,
        };
      }
    }
    const ahead = await run("git", ["rev-list", "--count", `${BASE_BRANCH}..${result.branch}`]);
    log(`deliver ${result.branch} (${result.mode}, ${ahead} commit(s) ahead of base)`);
    queueVerify(result.branch, await run("git", ["rev-parse", incoming]));
    return { ...result, commitsAhead: Number(ahead), verify: "queued: the host re-runs pnpm check on a fresh database (GET /verify)" };
  } finally {
    rmSync(file, { force: true });
  }
}

// ---------------------------------------------------------------- verify ---
// Every delivery is checked again on the host, independently of what the agent
// says: a throwaway worktree of the delivered commit, its own slot (fresh
// Postgres + Redis, migrated from scratch), `pnpm check`. One at a time.
// Results: GET /verify, `git log --notes=verify <branch>`, logs in STATE_DIR/verify/.
const VERIFY_DIR = join(STATE_DIR, "verify");
const VERIFY_FILE = join(VERIFY_DIR, "results.json");
const STEP_TIMEOUT = 15 * 60_000;
const verifyJobs = [];
let verifying = false;

const loadVerify = () => { try { return JSON.parse(readFileSync(VERIFY_FILE, "utf8")); } catch { return {}; } };
function setVerify(branch, patch) {
  mkdirSync(VERIFY_DIR, { recursive: true });
  const all = loadVerify();
  all[branch] = { ...all[branch], ...patch, branch };
  writeFileSync(VERIFY_FILE, JSON.stringify(all, null, 2));
}

function queueVerify(branch, sha) {
  setVerify(branch, { sha, status: "queued", queuedAt: new Date().toISOString(), step: null, finishedAt: null });
  verifyJobs.push({ branch, sha });
  void pumpVerify();
}

async function pumpVerify() {
  if (verifying) return;
  verifying = true;
  while (verifyJobs.length) {
    const job = verifyJobs.shift();
    await verifyOne(job).catch((e) => {
      setVerify(job.branch, { status: "error", error: e.message, finishedAt: new Date().toISOString() });
      log(`verify ${job.branch}: error ${e.message}`);
    });
  }
  verifying = false;
}

async function verifyOne({ branch, sha }) {
  const slug = branch.replace(/^task\//, "").replace(/[^a-z0-9-]+/g, "-");
  let c;
  for (let i = 0; ; i++) {
    try { c = await claim(`verify-${slug}`); break; } catch (e) {
      if (e.status !== 503 || i >= 60) throw e;
      setVerify(branch, { status: "waiting for a free slot" });
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
  const dir = join(VERIFY_DIR, "work", c.name);
  const logFile = join(VERIFY_DIR, `${slug}.log`);
  writeFileSync(logFile, `verify ${branch} @ ${sha} in slot ${c.slot}\n`);
  setVerify(branch, { status: "running", startedAt: new Date().toISOString(), log: logFile });
  log(`verify ${branch} @ ${sha.slice(0, 7)} in slot ${c.slot}`);

  let failed = null;
  try {
    rmSync(dir, { recursive: true, force: true });
    await run("git", ["worktree", "prune"]);
    await run("git", ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--force", "--detach", dir, sha]);
    writeFileSync(join(dir, ".slot"), String(c.slot));
    writeFileSync(join(dir, ".env"), ""); // older branches' db-name.sh needs one in a detached checkout
    const env = { CI: "true", DB_HOST: "localhost" };
    const steps = [
      ["env", "bash", ["scripts/dev-env.sh"]],
      ["install", "pnpm", ["install", "--frozen-lockfile", "--prefer-offline"]],
      ["migrate", "pnpm", ["db:deploy"]],
      ["check", "pnpm", ["check"]],
    ];
    for (const [step, cmd, args] of steps) {
      setVerify(branch, { step });
      try {
        const out = await run(cmd, args, { cwd: dir, env, timeout: STEP_TIMEOUT });
        appendLog(logFile, `\n$ ${cmd} ${args.join(" ")}\n${out}\n`);
      } catch (e) {
        appendLog(logFile, `\n$ ${cmd} ${args.join(" ")}\n${e.out ?? ""}${e.err ?? ""}\nFAILED: ${e.message.split("\n")[0]}\n`);
        failed = step;
        break;
      }
    }
  } finally {
    await release(c.slot).catch(() => {});
    await run("git", ["worktree", "remove", "--force", dir]).catch(() => rmSync(dir, { recursive: true, force: true }));
  }

  const status = failed ? "fail" : "pass";
  const finishedAt = new Date().toISOString();
  setVerify(branch, { status, step: failed, finishedAt });
  const note = `${status.toUpperCase()}${failed ? ` (failed at: ${failed})` : ""}: pnpm check on a fresh DB, ${finishedAt}\nlog: ${logFile}`;
  await run("git", ["notes", "--ref=verify", "add", "-f", "-m", note, sha]).catch(() => {});
  log(`verify ${branch}: ${status.toUpperCase()}${failed ? ` at ${failed}` : ""}`);
}

const appendLog = (file, text) => writeFileSync(file, text, { flag: "a" });

function verifyTable() {
  const rows = Object.values(loadVerify()).sort((a, b) => (b.queuedAt ?? "").localeCompare(a.queuedAt ?? ""));
  if (!rows.length) return "no deliveries checked yet\n";
  const icon = { pass: "✅", fail: "❌", error: "⚠️ ", running: "⏳", queued: "⏳" };
  return rows.map((r) => `${icon[r.status] ?? "⏳"} ${r.status.padEnd(8)} ${r.branch.padEnd(36)} ${(r.sha ?? "").slice(0, 7)}  ${r.step ? `step: ${r.step}  ` : ""}${r.finishedAt ?? r.queuedAt ?? ""}${r.status === "fail" || r.status === "error" ? `\n    log: ${r.log ?? "-"}${r.error ? `\n    ${r.error}` : ""}` : ""}`).join("\n") + "\n";
}

async function reap() {
  const state = loadState();
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600_000;
  for (const [slot, c] of Object.entries(state)) {
    if (Date.parse(c.claimedAt) < cutoff) {
      log(`reap   slot ${slot} (${c.name}) older than ${MAX_AGE_HOURS}h`);
      await release(slot).catch((e) => log(`reap failed: ${e.message}`));
    }
  }
}

// ---------------------------------------------------------------- scripts ---

const BOOTSTRAP = `#!/usr/bin/env bash
# Written into the launchpad by the mortgage-tracker provisioner. Usage:
#   bash bootstrap.sh <short-task-name>
set -euo pipefail
P=${PUBLIC_URL}
HINT="\${1:-task}"
ROOT="\${MT_WORK_ROOT:-$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)/work}"

need() { command -v "$1" >/dev/null || MISSING="\${MISSING:-} $2"; }
need git git; need curl curl; need openssl openssl
if [[ -n "\${MISSING:-}" ]]; then
  SUDO=""; [[ $(id -u) -ne 0 ]] && SUDO=sudo
  $SUDO apt-get update -qq >/dev/null && $SUDO apt-get install -y -qq $MISSING ca-certificates >/dev/null
fi

claim() {
  CLAIM=$(curl -fsS -X POST "$P/claim" -H 'content-type: application/json' -d "{\\"name\\":\\"$1\\"}")
  SLOT=$(echo "$CLAIM" | sed -E 's/.*"slot":([0-9]+).*/\\1/')
  NAME=$(echo "$CLAIM" | sed -E 's/.*"name":"([^"]+)".*/\\1/')
  BASE=$(echo "$CLAIM" | sed -E 's/.*"base":"([^"]+)".*/\\1/')
}
release_on_error() {
  trap 'echo "bootstrap failed; releasing slot $SLOT" >&2; curl -fsS -X POST "$P/release" -d "{\\"slot\\":$SLOT}" >/dev/null || true' ERR
}

echo "Setting up (takes 1-3 minutes). If your terminal returns before '=== READY ===',"
echo "the setup is still running: wait and check again. Running this again is safe: it resumes."

if [[ -d "$ROOT/$HINT/.git" ]]; then
  # Resume: this task was bootstrapped before (interrupted, or the command was
  # re-run). Keep the checkout; make sure its slot is still ours, re-claim if not.
  NAME="$HINT"; DIR="$ROOT/$NAME"
  SLOT=$(cat "$DIR/.slot" 2>/dev/null || echo none)
  if ! curl -fsS "$P/slots" | grep -q "\\"$SLOT\\":{\\"name\\":\\"$NAME\\""; then
    claim "$NAME"
    if [[ "$NAME" != "$HINT" ]]; then
      curl -fsS -X POST "$P/release" -d "{\\"slot\\":$SLOT}" >/dev/null || true
      echo "can't resume '$HINT' (name is in use or already delivered); pick a new name" >&2; exit 1
    fi
    echo "$SLOT" > "$DIR/.slot"
    release_on_error
  fi
  echo "resuming $NAME in slot $SLOT"
  cd "$DIR"
else
  claim "$HINT"
  DIR="$ROOT/$NAME"
  # From here on, give the slot back if anything fails.
  release_on_error
  mkdir -p "$ROOT"
  curl -fsS "$P/repo.bundle" -o "/tmp/mt-$NAME.bundle"
  git clone --quiet --branch "$BASE" "/tmp/mt-$NAME.bundle" "$DIR"
  cd "$DIR"
  git remote remove origin
  git switch --quiet -c "task/$NAME"
  git config user.name  "\${GIT_AUTHOR_NAME:-OpenHands agent}"
  git config user.email "\${GIT_AUTHOR_EMAIL:-openhands@localhost}"
  git config --global --add safe.directory "$DIR" || true
  echo "$SLOT" > .slot
fi

bash scripts/setup.sh
trap - ERR

cat <<EOF

=== READY ===
task      : $NAME   (branch task/$NAME, slot $SLOT)
workdir   : $DIR
shell     : export PATH="$HOME/.local/bin:$HOME/.local/node/bin:\\$PATH"   (run this first: pnpm lives there)
next      : cd $DIR, read AGENTS.md there, do the task, commit.
when done : cd $DIR && bash ../../deliver.sh
EOF
`;

const DELIVER = `#!/usr/bin/env bash
# Written into the launchpad by the mortgage-tracker provisioner. Run from inside
# the task's workdir:  bash ../../deliver.sh
# Sends branch task/<name> back to the main repo, then frees the slot.
set -euo pipefail
P=${PUBLIC_URL}
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$BRANCH" == task/* ]] || { echo "not on a task/* branch (on $BRANCH)" >&2; exit 1; }
NAME=\${BRANCH#task/}
SLOT=$(cat .slot)

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  echo "uncommitted changes — commit (or discard) them first, then rerun" >&2
  exit 1
fi

git bundle create "/tmp/out-$NAME.bundle" "$BRANCH" 2>/dev/null
curl -fsS -X POST --data-binary @"/tmp/out-$NAME.bundle" "$P/deliver?name=$NAME"; echo
curl -fsS -X POST "$P/release" -H 'content-type: application/json' -d "{\\"slot\\":$SLOT}"; echo
echo "=== DELIVERED (see the branch name above); slot $SLOT freed. ==="
`;

// ---------------------------------------------------------------- server ---

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/bootstrap.sh") return res.end(BOOTSTRAP);
    if (req.method === "GET" && url.pathname === "/deliver.sh") return res.end(DELIVER);
    if (req.method === "GET" && url.pathname === "/instructions.md")
      return res.end(readFileSync(join(HERE, "../openhands/agent-instructions.md")));
    if (req.method === "GET" && url.pathname === "/slots") return json(res, 200, loadState());
    if (req.method === "GET" && url.pathname === "/verify") return json(res, 200, loadVerify());
    if (req.method === "GET" && url.pathname === "/verify.txt") return res.end(verifyTable());
    if (req.method === "POST" && url.pathname === "/verify") {
      const branch = url.searchParams.get("branch") ?? "";
      if (!/^task\/[a-z0-9-]+$/.test(branch)) throw Object.assign(new Error("branch=task/<name> required"), { status: 400 });
      const sha = await run("git", ["rev-parse", "--verify", `refs/heads/${branch}`]).catch(() => null);
      if (!sha) throw Object.assign(new Error(`no branch ${branch}`), { status: 404 });
      queueVerify(branch, sha);
      return json(res, 202, { queued: branch, sha });
    }

    if (req.method === "GET" && url.pathname === "/repo.bundle") {
      const base = await baseBranch();
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const p = spawn("git", ["bundle", "create", "-", base], { cwd: REPO });
      p.stdout.pipe(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/claim") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      return json(res, 200, await claim(body.name));
    }
    if (req.method === "POST" && url.pathname === "/release") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      return json(res, 200, await release(body.slot));
    }
    if (req.method === "POST" && url.pathname === "/deliver") {
      return json(res, 200, await deliver(url.searchParams.get("name"), await readBody(req)));
    }
    json(res, 404, { error: "not_found" });
  } catch (e) {
    log(`error ${req.method} ${url.pathname}: ${e.message}`);
    json(res, e.status ?? 500, { error: e.message });
  }
});

// Keep the launchpad's AGENTS.md in sync with the template in this repo.
mkdirSync(LAUNCHPAD, { recursive: true });
copyFileSync(join(REPO, "ops/launchpad/AGENTS.md"), join(LAUNCHPAD, "AGENTS.md"));
// Claude Code (OpenHands ACP agent) reads CLAUDE.md rather than AGENTS.md.
writeFileSync(join(LAUNCHPAD, "CLAUDE.md"), "@AGENTS.md\n");
// Local copies of the scripts. Agents run `bash bootstrap.sh`, never `curl | bash`:
// OpenHands' system prompt rates pipe-to-shell from AGENTS.md as HIGH risk.
writeFileSync(join(LAUNCHPAD, "bootstrap.sh"), BOOTSTRAP, { mode: 0o755 });
writeFileSync(join(LAUNCHPAD, "deliver.sh"), DELIVER, { mode: 0o755 });
if (!existsSync(join(LAUNCHPAD, ".gitignore"))) writeFileSync(join(LAUNCHPAD, ".gitignore"), "work/\n.pnpm-store/\n");

// Verification slots are the provisioner's own: after a restart nothing uses them.
for (const [slot, c] of Object.entries(loadState()))
  if (c.name.startsWith("verify-")) void release(slot);
for (const r of Object.values(loadVerify()))
  if (!["pass", "fail", "error"].includes(r.status)) setVerify(r.branch, { status: "error", error: "interrupted (provisioner restarted); POST /verify to re-run" });

setInterval(() => void reap(), 10 * 60_000).unref();
void reap();

server.listen(PORT, HOST, () => {
  log(`provisioner on http://${HOST}:${PORT} (sandboxes: ${PUBLIC_URL})`);
  log(`repo      ${REPO} (agents start from ${BASE_BRANCH})`);
  log(`launchpad ${LAUNCHPAD}  ← use this folder as the OpenHands workspace`);
});
