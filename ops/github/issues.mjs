// GitHub issues → agents. Loaded by the provisioner (ops/provisioner/server.mjs).
//
// Label an issue `factory` and the provisioner picks it up:
//
//   factory          → you: "do this one"
//   factory:running  → an OpenHands conversation is working on it (comment links it)
//   factory:review   → delivered, passed `pnpm check` on a fresh DB on the host, PR opened
//   factory:failed   → the agent stopped without delivering, or the host check failed
//                      (comment has the reason). Put `factory` back on to retry.
//
// The agent bootstraps with the name gh-<number>-<slug>, so its branch is
// task/gh-<number>-…; that prefix is how deliveries and verify results find
// their issue again. Only issues opened by MT_GH_AUTHORS are taken: the repo
// may be public, and the issue body goes into the agent's prompt.
//
// Env: MT_GH_ISSUES=0 disables it. MT_GH_REPO (default: the repo's origin),
// MT_GH_LABEL (factory), MT_GH_AUTHORS (comma list; default: the gh user and
// the repo owner), MT_GH_PROFILE (OpenHands agent profile, claude-opusplan),
// MT_GH_MAX_RUNNING (3), MT_GH_POLL_SECONDS (60), MT_GH_OPEN_PR=0 to only
// comment instead of pushing the branch and opening a PR.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LABEL = process.env.MT_GH_LABEL ?? "factory";
const L = {
  todo: LABEL,
  running: `${LABEL}:running`,
  review: `${LABEL}:review`,
  failed: `${LABEL}:failed`,
};
const LABEL_STYLE = {
  [L.todo]: ["5319e7", "Hand this issue to an agent"],
  [L.running]: ["fbca04", "An agent is working on it"],
  [L.review]: ["0e8a16", "Agent delivered; host check passed; PR open"],
  [L.failed]: ["b60205", "Agent run or host check failed; re-add the factory label to retry"],
};
const PROFILE = process.env.MT_GH_PROFILE ?? "claude-opusplan";
const MAX_RUNNING = Number(process.env.MT_GH_MAX_RUNNING ?? 3);
const POLL_MS = Number(process.env.MT_GH_POLL_SECONDS ?? 60) * 1000;
const OPEN_PR = process.env.MT_GH_OPEN_PR !== "0";
const OH = process.env.OH_URL ?? "http://localhost:8000";
// An agent that finishes without delivering gets this long before the issue is marked failed
// (ACP agents can report "finished" a moment before their deliver call lands). Errors fail at once.
const GRACE_MS = 3 * 60_000;
// After an auth error, every new conversation would fail the same way: stop picking up issues
// for a while instead of burning through the queue.
const AUTH_PAUSE_MS = 15 * 60_000;
const ACTIVE = new Set(["starting", "running", "delivered", "verifying"]);

/** task/gh-12-foo, task/gh-12-foo-2, task/gh-12-foo-delivered → 12 */
export const issueOfBranch = (branch) => {
  const m = /^task\/gh-(\d+)(?:-|$)/.exec(branch ?? "");
  return m ? Number(m[1]) : null;
};

/** Bootstrap name hint for an issue: gh-<n>-<slug>, within the provisioner's 40 chars. */
export const taskName = (number, title) => {
  const prefix = `gh-${number}-`;
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (prefix + slug).slice(0, 40).replace(/-+$/, "") || `gh-${number}`;
};

export function prompt(issue, name) {
  return `Work on GitHub issue #${issue.number} of the mortgage-tracker project.

Bootstrap with exactly this task name: \`${name}\` (the gh-${issue.number} prefix links your delivery back to the issue).
Then follow the project's AGENTS.md: implement the issue, add tests, make \`pnpm check\` pass, commit, and deliver.
If the issue is unclear or can't be done, commit what you have with an explanation and deliver anyway.

The issue, as written by the maintainer:

<issue number="${issue.number}">
# ${issue.title}

${issue.body?.trim() || "(no description)"}
</issue>`;
}

export function startIssues({ run, log, stateDir, repoDir, baseBranch, slots, release }) {
  if (process.env.MT_GH_ISSUES === "0") return null;
  const FILE = join(stateDir, "issues.json");
  const load = () => { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; } };
  const set = (n, patch) => {
    mkdirSync(stateDir, { recursive: true });
    const all = load();
    all[n] = { ...all[n], ...patch, number: Number(n), updatedAt: new Date().toISOString() };
    writeFileSync(FILE, JSON.stringify(all, null, 2));
    return all[n];
  };

  let repo = process.env.MT_GH_REPO ?? null;
  let authors = null;
  const gh = (...args) => run("gh", args, { cwd: repoDir, timeout: 60_000 });
  const comment = (n, body) => gh("issue", "comment", String(n), "-R", repo, "--body", scrub(body))
    .catch((e) => log(`issues #${n}: comment failed: ${e.message}`));
  const relabel = (n, add, ...remove) => gh("issue", "edit", String(n), "-R", repo, "--add-label", add,
    ...remove.flatMap((r) => ["--remove-label", r]))
    .catch((e) => log(`issues #${n}: relabel failed: ${e.message}`));

  // ------------------------------------------------------------ OpenHands ---
  const ohKey = () => readFileSync(join(homedir(), ".openhands/agent-canvas/api-key.txt"), "utf8").trim();
  async function oh(path, init = {}) {
    const r = await fetch(OH + path, {
      ...init,
      headers: { "X-Session-API-Key": ohKey(), "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw Object.assign(new Error(`OpenHands ${init.method ?? "GET"} ${path}: ${r.status} ${(await r.text()).slice(0, 300)}`), { status: r.status });
    return r.json();
  }
  async function startConversation(issue, name) {
    const { profiles } = await oh("/api/agent-profiles");
    const profile = profiles.find((p) => p.name === PROFILE);
    if (!profile) throw new Error(`no OpenHands agent profile "${PROFILE}" (run ops/openhands/apply-claude-profile.mjs)`);
    const c = await oh("/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        workspace: { working_dir: "/workspace" },
        agent_profile_id: profile.id,
        tags: { source: "github", issue: String(issue.number) },
        autotitle: false,
        initial_message: { role: "user", content: [{ type: "text", text: prompt(issue, name) }], run: true },
      }),
    });
    // Give it a recognizable title in the OpenHands sidebar; harmless if unsupported.
    await oh(`/api/conversations/${c.id}`, { method: "PATCH", body: JSON.stringify({ title: `#${issue.number} ${issue.title}`.slice(0, 80) }) }).catch(() => {});
    return c.id;
  }
  const finalResponse = (id) => oh(`/api/conversations/${id}/agent_final_response`).then((r) => r.response?.trim() ?? "", () => "");

  // ---------------------------------------------------------------- poll ---
  async function init() {
    repo ??= await gh("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner");
    const me = await gh("api", "user", "-q", ".login");
    authors = new Set((process.env.MT_GH_AUTHORS ?? `${me},${repo.split("/")[0]}`).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    for (const [name, [color, description]] of Object.entries(LABEL_STYLE))
      await gh("label", "create", name, "-R", repo, "--color", color, "--description", description, "--force");
    log(`issues: watching ${repo} for label "${L.todo}" from ${[...authors].join(", ")} (profile ${PROFILE}, max ${MAX_RUNNING} at once)`);
  }

  const skipped = new Set();
  let pausedUntil = 0;
  async function poll() {
    if (Date.now() < pausedUntil) return;
    const issues = JSON.parse(await gh("issue", "list", "-R", repo, "--state", "open", "--label", L.todo,
      "--json", "number,title,body,author,url", "--limit", "50"));
    const state = load();
    for (const issue of issues.sort((a, b) => a.number - b.number)) {
      const n = issue.number;
      if (ACTIVE.has(state[n]?.status)) continue;
      if (!authors.has(issue.author.login.toLowerCase())) {
        if (!skipped.has(n)) log(`issues #${n}: skipped, author ${issue.author.login} is not in MT_GH_AUTHORS`);
        skipped.add(n);
        continue;
      }
      const running = Object.values(load()).filter((s) => s.status === "starting" || s.status === "running").length;
      const free = 9 - Object.keys(slots()).length;
      if (running >= MAX_RUNNING || free < 2) break; // keep a slot free for host verification

      const name = taskName(n, issue.title);
      set(n, { status: "starting", title: issue.title, url: issue.url, name, branch: null, pr: null, startedAt: new Date().toISOString(), finishedAt: null, reason: null });
      await relabel(n, L.running, L.todo, L.failed, L.review);
      try {
        const conversationId = await startConversation(issue, name);
        set(n, { status: "running", conversationId });
        log(`issues #${n}: started conversation ${conversationId} (${name})`);
        await comment(n, `🤖 Picked up. Agent conversation \`${conversationId}\` (${OH}/conversations/${conversationId}), branch will be \`task/${name}\`.`);
      } catch (e) {
        log(`issues #${n}: start failed: ${e.message}`);
        await fail(n, "couldn't start an agent (details in the provisioner log).");
      }
    }
  }

  // Agents that stopped without delivering.
  async function watch() {
    for (const s of Object.values(load())) {
      if (s.status !== "running" || !s.conversationId) continue;
      let c;
      try { c = await oh(`/api/conversations/${s.conversationId}`); }
      catch (e) {
        if (e.status === 404) await fail(s.number, "its OpenHands conversation was deleted before it delivered.");
        continue;
      }
      const st = c.execution_status;
      if (st === "error" || st === "stuck") {
        const err = await lastError(s.conversationId);
        let reason = `the agent ${st === "stuck" ? "got stuck" : "hit an error"} before delivering`;
        if (err?.classification?.kind === "auth") {
          pausedUntil = Date.now() + AUTH_PAUSE_MS;
          log(`issues: agent auth failed (${err.code}); not picking up new issues for ${AUTH_PAUSE_MS / 60_000} min`);
          reason = `the agent couldn't authenticate (\`${err.code}\`). Fix the agent's login in OpenHands (for Claude: the \`CLAUDE_CODE_OAUTH_TOKEN\` secret, from \`claude setup-token\`). New issues are paused for ${AUTH_PAUSE_MS / 60_000} min`;
        } else if (err) reason += `: \`${err.code}\` ${err.detail ?? ""}`.trimEnd();
        await fail(s.number, `${reason}.`);
        continue;
      }
      if (st !== "finished") { s.stoppedAt && set(s.number, { stoppedAt: null }); continue; }
      if (!s.stoppedAt) { set(s.number, { stoppedAt: new Date().toISOString() }); continue; }
      if (Date.now() - Date.parse(s.stoppedAt) < GRACE_MS) continue;
      const said = await finalResponse(s.conversationId);
      await fail(s.number, `the agent finished without delivering.${said ? `\n\nIts last message:\n\n${quote(said)}` : ""}`);
    }
  }

  const lastError = (id) => oh(`/api/conversations/${id}/events/search?kind=ConversationErrorEvent&sort_order=TIMESTAMP_DESC&limit=1`)
    .then((r) => r.items?.[0] ?? null, () => null);

  async function fail(n, reason) {
    const s = set(n, { status: "failed", reason, finishedAt: new Date().toISOString() });
    // Free the slot the agent claimed (if it got that far); its branch was never delivered.
    if (s.status === "failed" && s.name && !s.branch)
      for (const [slot, c] of Object.entries(slots()))
        if (c.name === s.name || c.name.startsWith(`${s.name}-`)) await release(slot).catch(() => {});
    log(`issues #${n}: failed: ${reason.split("\n")[0]}`);
    await relabel(n, L.failed, L.running, L.todo);
    await comment(n, `❌ ${reason[0].toUpperCase()}${reason.slice(1)}\n\nAdd the \`${L.todo}\` label again to retry.`);
  }

  // ------------------------------------------------------ provisioner hooks ---
  async function delivered({ branch, commitsAhead }) {
    const n = issueOfBranch(branch);
    if (n == null || !load()[n]) return;
    set(n, { status: "verifying", branch });
    await comment(n, `📦 Delivered \`${branch}\` (${commitsAhead} commit(s)). Running \`pnpm check\` on a fresh database on the host…`);
  }

  async function verified({ branch, sha, status, step, logFile }) {
    const n = issueOfBranch(branch);
    const s = n == null ? null : load()[n];
    if (!s) return;
    if (status !== "pass") {
      // Only the step name goes to GitHub: the log has host paths and may be public.
      if (logFile) log(`issues #${n}: host check log ${logFile}`);
      return fail(n, `the host check of \`${branch}\` @ ${sha.slice(0, 7)} ${status === "fail" ? `failed at \`${step}\`` : "errored"}. The log is on the host: \`pnpm prov:verify\`.`);
    }
    const said = s.conversationId ? await finalResponse(s.conversationId) : "";
    if (!OPEN_PR) {
      set(n, { status: "review", finishedAt: new Date().toISOString() });
      await relabel(n, L.review, L.running);
      return comment(n, `✅ \`${branch}\` @ ${sha.slice(0, 7)} passed \`pnpm check\` on a fresh DB. Merge it locally: \`git merge ${branch}\`.${said ? `\n\nAgent summary:\n\n${quote(said)}` : ""}`);
    }
    try {
      await run("git", ["push", "--force", "--quiet", "origin", `${sha}:refs/heads/${branch}`], { cwd: repoDir, timeout: 120_000 });
      let pr = await gh("pr", "list", "-R", repo, "--head", branch, "--state", "open", "--json", "url", "-q", ".[0].url").catch(() => "");
      if (!pr) {
        const body = `Closes #${n}\n\nBuilt by an agent from the issue; delivered commit ${sha.slice(0, 7)} passed \`pnpm check\` on a fresh database on the host.${said ? `\n\n## Agent summary\n\n${said}` : ""}\n\n🤖 Generated by the mortgage-tracker agent factory`;
        pr = await gh("pr", "create", "-R", repo, "--head", branch, "--base", baseBranch, "--title", s.title, "--body", scrub(body));
      }
      set(n, { status: "review", pr, finishedAt: new Date().toISOString() });
      await relabel(n, L.review, L.running);
      await comment(n, `✅ Passed \`pnpm check\` on a fresh DB. PR: ${pr}`);
      log(`issues #${n}: PR ${pr}`);
    } catch (e) {
      log(`issues #${n}: push/PR failed: ${e.message}`);
      await fail(n, `\`${branch}\` passed the host check, but pushing it or opening the PR failed (details in the provisioner log).`);
    }
  }

  // ---------------------------------------------------------------- loop ---
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (!authors) await init();
      await watch();
      await poll();
    } catch (e) {
      log(`issues: ${e.message.split("\n")[0]}`);
    } finally { busy = false; }
  };
  setInterval(tick, POLL_MS).unref();
  void tick();

  return {
    delivered: (x) => delivered(x).catch((e) => log(`issues: delivered hook: ${e.message}`)),
    verified: (x) => verified(x).catch((e) => log(`issues: verified hook: ${e.message}`)),
    status: load,
  };
}

// Everything posted to GitHub goes through this: the repo may be public, and
// agent messages or errors can mention host paths.
const HOME = homedir();
export const scrub = (text) => String(text)
  .replaceAll(HOME, "~")
  .replace(/\/(?:Users|home)\/[^/\s`'")\]]+/g, "~")
  .replace(/\/(?:private\/)?(?:var\/folders|tmp)\/[^\s`'")\]]*/g, "<tmp>");

const quote = (s) => s.split("\n").map((l) => `> ${l}`).join("\n");
