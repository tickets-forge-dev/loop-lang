import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { init, pointer } from "../src/init.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, "..", "assets"); // populated by sync-assets (test script runs it first)
const fresh = () => mkdtemp(join(tmpdir(), "loop-init-"));

test("init scaffolds AGENTS.md, the skill, per-agent memory, and a starter loop", async () => {
  const dir = await fresh();
  const { steps } = await init(dir, { skill: "local", agents: ["claude", "cursor", "copilot"], example: true }, ASSETS);

  assert.ok(existsSync(join(dir, "AGENTS.md")), "AGENTS.md written");
  assert.ok(existsSync(join(dir, ".claude", "skills", "loop", "SKILL.md")), "skill installed");
  assert.ok(existsSync(join(dir, "CLAUDE.md")), "CLAUDE.md pointer");
  assert.ok(existsSync(join(dir, ".cursor", "rules", "loop.md")), "cursor rule");
  assert.ok(existsSync(join(dir, ".github", "copilot-instructions.md")), "copilot instructions");
  assert.ok(existsSync(join(dir, "examples", "fix_test.loop")), "starter loop");

  const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
  assert.match(agents, /loop:start/, "AGENTS.md carries the managed marker");
  assert.match(agents, /Loop/, "AGENTS.md has the language reference");
  assert.ok(steps.length >= 6, "reports each step");
});

test("init is idempotent — re-running does not duplicate the AGENTS.md block", async () => {
  const dir = await fresh();
  await init(dir, { skill: "none", agents: [], example: false }, ASSETS);
  await init(dir, { skill: "none", agents: [], example: false }, ASSETS);
  const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
  assert.equal(agents.split("loop:start").length - 1, 1, "exactly one managed block");
});

test("init merges into an existing AGENTS.md instead of clobbering it", async () => {
  const dir = await fresh();
  await writeFile(join(dir, "AGENTS.md"), "# My project rules\nKeep it tidy.\n");
  await init(dir, { skill: "none", agents: [], example: false }, ASSETS);
  const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
  assert.match(agents, /My project rules/, "preserves existing content");
  assert.match(agents, /loop:start/, "appends the managed block");
});

test("init respects skill:none and example:false", async () => {
  const dir = await fresh();
  await init(dir, { skill: "none", agents: [], example: false }, ASSETS);
  assert.equal(existsSync(join(dir, ".claude")), false, "no skill");
  assert.equal(existsSync(join(dir, "examples")), false, "no example");
});

test("pointer mentions the skill only when one is installed", () => {
  assert.match(pointer({ skill: true }), /\/loop` skill/);
  assert.doesNotMatch(pointer({ skill: false }), /\/loop` skill/);
});
