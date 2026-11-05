#!/usr/bin/env node
// Creates/updates a Claude Code (ACP) agent profile that knows the bootstrap flow,
// and installs the same instructions as a global OpenHands skill.
//
//   node ops/openhands/apply-claude-profile.mjs [profile-name] [model]
//   node ops/openhands/apply-claude-profile.mjs claude-opusplan opusplan   # default
//   node ops/openhands/apply-claude-profile.mjs claude-haiku haiku
//
// Why not just the skill: for ACP agents OpenHands passes skills and system suffixes
// as <UNTRUSTED_CONTENT>, and Claude (rightly) refuses to curl+run scripts on that
// basis. Claude Code trusts its own ~/.claude/CLAUDE.md, so the profile's start
// command fetches the instructions from the provisioner (GET /instructions.md, which
// serves agent-instructions.md) into that file, then starts the ACP server.
//
// The Claude token comes from the global secret CLAUDE_CODE_OAUTH_TOKEN
// (set it once in any Claude profile's Credentials, from `claude setup-token`).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [name = "claude-opusplan", model = "opusplan"] = process.argv.slice(2);
const base = process.env.OH_URL ?? "http://localhost:8000";
const here = dirname(fileURLToPath(import.meta.url));
const key = readFileSync(join(homedir(), ".openhands/agent-canvas/api-key.txt"), "utf8").trim();
const headers = { "X-Session-API-Key": key, "content-type": "application/json" };
const ACP = "@agentclientprotocol/claude-agent-acp@0.63.0";

// 1. Global skill (always-on for OpenHands-kind agents; context for ACP ones).
const instructions = readFileSync(join(here, "agent-instructions.md"), "utf8");
mkdirSync(join(homedir(), ".openhands/skills"), { recursive: true });
writeFileSync(
  join(homedir(), ".openhands/skills/mortgage-tracker-bootstrap.md"),
  `---\nname: mortgage-tracker-bootstrap\ndescription: How to get the mortgage-tracker code, branch and database before doing any task (bootstrap via the host slot provisioner), and how to deliver.\n---\n\n${instructions}`,
);
console.log("✔ skill ~/.openhands/skills/mortgage-tracker-bootstrap.md");

// 2. Profile.
const start = [
  'mkdir -p "$HOME/.claude"',
  '&& curl -fsS --max-time 10 http://host.docker.internal:7070/instructions.md -o "$HOME/.claude/CLAUDE.md"',
  '|| echo "warning: could not fetch mortgage-tracker instructions (is pnpm prov running?)" >&2;',
  `exec npx -y --prefer-offline ${ACP}`,
].join(" ");

const existing = await fetch(`${base}/api/agent-profiles/${name}`, { headers });
const current = existing.ok ? (await existing.json()).profile : {};
const profile = {
  schema_version: 4,
  agent_kind: "acp",
  acp_server: "claude-code",
  acp_prompt_timeout: 1800,
  acp_startup_timeout: 90,
  ...current,
  name,
  acp_model: model,
  acp_command: "sh",
  acp_args: ["-c", start],
};
const save = await fetch(`${base}/api/agent-profiles/${name}`, { method: "POST", headers, body: JSON.stringify(profile) });
if (!save.ok) throw new Error(`POST profile ${name}: ${save.status} ${await save.text()}`);
const check = (await (await fetch(`${base}/api/agent-profiles/${name}`, { headers })).json()).profile;
console.log(`✔ profile "${name}" revision ${check.revision}: model ${check.acp_model}, start command writes ~/.claude/CLAUDE.md`);
