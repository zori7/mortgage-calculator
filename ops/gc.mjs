#!/usr/bin/env node
// Finds what agent runs left behind and, with --apply, removes it.
//
//   pnpm sandbox:gc            # dry run: list what would be removed
//   pnpm sandbox:gc --apply    # remove it
//
// 1. Orphan slots: claimed, but the agent's checkout is gone (its OpenHands
//    conversation was deleted). Released through the provisioner, which also
//    deletes that slot's Postgres/Redis data. verify-* slots are skipped.
// 2. Exited OpenHands containers (agent-server-conversation-*).
// 3. Conversation data in ~/.openhands/runtime-data with no conversation
//    (only checked while OpenHands is running, since it needs its API).
// 4. Git: stale worktrees, and refs/delivered/<name> whose task branch is gone.
// 5. Per-branch databases in your slot-0 Postgres whose branch is gone.
//
// Never touches: running conversations, slots whose checkout still exists,
// your branches, or the main database.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROV = process.env.MT_PROVISIONER_URL ?? "http://localhost:7070";
const OH = process.env.OH_URL ?? "http://localhost:8000";
const RUNTIME = join(homedir(), ".openhands/runtime-data");

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const tryJson = async (url, init) => { try { const r = await fetch(url, init); return r.ok ? await r.json() : null; } catch { return null; } };
let found = 0;
const item = (what, detail, fn) => {
  found++;
  console.log(`  ${APPLY ? "removing" : "would remove"}: ${what}${detail ? `  (${detail})` : ""}`);
  if (APPLY) try { fn(); } catch (e) { console.log(`    failed: ${e.message.split("\n")[0]}`); }
};
const section = (t) => console.log(`\n${t}`);

// ---- 1. orphan slots ------------------------------------------------------------
section("Slots");
const slots = await tryJson(`${PROV}/slots`);
if (!slots) console.log("  provisioner not running: skipped");
else {
  const workdirs = existsSync(RUNTIME)
    ? readdirSync(RUNTIME).flatMap((id) => {
        const w = join(RUNTIME, id, "workspace/work");
        return existsSync(w) ? readdirSync(w).map((n) => [n, id]) : [];
      })
    : [];
  const owner = new Map(workdirs);
  for (const [slot, c] of Object.entries(slots)) {
    if (c.name.startsWith("verify-")) continue;
    if (owner.has(c.name)) continue;
    item(`slot ${slot} (${c.name})`, `claimed ${c.claimedAt}, its checkout no longer exists`, () =>
      sh("curl", ["-fsS", "-X", "POST", `${PROV}/release`, "-d", JSON.stringify({ slot: Number(slot) })]));
  }
}

// ---- 2. exited OpenHands containers ----------------------------------------------
section("OpenHands containers");
try {
  const exited = sh("docker", ["ps", "-a", "--filter", "name=agent-server-conversation", "--filter", "status=exited", "--format", "{{.Names}}"]).split("\n").filter(Boolean);
  for (const n of exited) item(`container ${n}`, "exited", () => sh("docker", ["rm", "-f", n]));
} catch { console.log("  docker not running: skipped"); }

// ---- 3. conversation data without a conversation ---------------------------------
section("Conversation data (~/.openhands/runtime-data)");
let key = null;
try { key = readFileSync(join(homedir(), ".openhands/agent-canvas/api-key.txt"), "utf8").trim(); } catch {}
const ids = new Set();
let ohUp = false;
if (key) {
  let page;
  do {
    const r = await tryJson(`${OH}/api/conversations/search?limit=100${page ? `&page_id=${page}` : ""}`, { headers: { "X-Session-API-Key": key } });
    if (!r) break;
    ohUp = true;
    for (const c of r.items ?? []) ids.add(c.id.replaceAll("-", ""));
    page = r.next_page_id;
  } while (page);
}
if (!ohUp) console.log("  OpenHands not running: skipped");
else if (existsSync(RUNTIME)) {
  for (const id of readdirSync(RUNTIME)) {
    if (ids.has(id.replaceAll("-", ""))) continue;
    const dir = join(RUNTIME, id);
    let size = "";
    try { size = sh("du", ["-sh", dir]).split("\t")[0]; } catch {}
    item(dir, `no such conversation${size ? `, ${size}` : ""}`, () => rmSync(dir, { recursive: true, force: true }));
  }
}

// ---- 4. git ------------------------------------------------------------------------
section("Git");
const stale = sh("git", ["worktree", "prune", "--dry-run", "--verbose"]);
if (stale) item("stale worktree entries", stale.split("\n").length + " entr(y/ies)", () => sh("git", ["worktree", "prune"]));
const heads = new Set(sh("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).split("\n"));
for (const ref of sh("git", ["for-each-ref", "--format=%(refname)", "refs/delivered"]).split("\n").filter(Boolean)) {
  const name = ref.replace("refs/delivered/", "");
  if (heads.has(`task/${name}`) || heads.has(`task/${name}-delivered`)) continue;
  item(ref, `branch task/${name} is gone`, () => sh("git", ["update-ref", "-d", ref]));
}

// ---- 5. branch databases -------------------------------------------------------------
section("Branch databases (slot 0)");
try {
  const gone = sh("bash", ["scripts/db-branches.sh"]).split("\n").filter((l) => l.includes("branch gone"));
  for (const l of gone) {
    const db = l.split(/\s+/)[0];
    item(`database ${db}`, "branch gone", () => {});
  }
  if (APPLY && gone.length) console.log(sh("bash", ["scripts/db-branches.sh", "prune"]).split("\n").filter((l) => l.startsWith("dropped")).map((l) => "    " + l).join("\n"));
} catch (e) { console.log(`  skipped: ${e.message.split("\n")[0]}`); }

console.log(found ? (APPLY ? "\ndone" : `\n${found} item(s). Run with --apply to remove them.`) : "\nnothing to clean up");
