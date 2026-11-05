#!/usr/bin/env node
// Puts ops/openhands/system_message_suffix.md into an OpenHands agent profile, so every
// conversation started with that profile knows how to set up mortgage-tracker.
// (In Docker mode the OpenHands UI can't attach host folders, so instructions
// can't come from a mounted AGENTS.md.)
//
//   node ops/openhands/apply-profile.mjs [profile-name]     # default: "default"
//
// Reads the OpenHands session key from ~/.openhands/agent-canvas/api-key.txt.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const name = process.argv[2] ?? "default";
const base = process.env.OH_URL ?? "http://localhost:8000";
const key = readFileSync(join(homedir(), ".openhands/agent-canvas/api-key.txt"), "utf8").trim();
const suffix = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "system_message_suffix.md"), "utf8");
const headers = { "X-Session-API-Key": key, "content-type": "application/json" };

const res = await fetch(`${base}/api/agent-profiles/${name}`, { headers });
if (!res.ok) throw new Error(`GET profile ${name}: ${res.status} ${await res.text()}`);
const { profile } = await res.json();

if (profile.agent_kind !== "openhands") {
  console.error(`profile "${name}" is agent_kind=${profile.agent_kind}; only "openhands" profiles have system_message_suffix`);
  process.exit(1);
}

const save = await fetch(`${base}/api/agent-profiles/${name}`, {
  method: "POST",
  headers,
  body: JSON.stringify({ ...profile, system_message_suffix: suffix }),
});
if (!save.ok) throw new Error(`POST profile ${name}: ${save.status} ${await save.text()}`);

const check = await (await fetch(`${base}/api/agent-profiles/${name}`, { headers })).json();
const ok = check.profile.system_message_suffix === suffix;
console.log(`${ok ? "✔" : "✘"} profile "${name}" revision ${check.profile.revision}: system_message_suffix ${ok ? "set" : "NOT set"} (${suffix.length} chars)`);
process.exit(ok ? 0 : 1);
