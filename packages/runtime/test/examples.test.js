// Run the repo's .loop files AS tests: parse every example, then execute each standalone
// loop/pipeline through the engine with a mock runner. This is the framework's own
// "does every example shape actually run?" check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { parse } from "@loop-lang/parser";
import { runDefinition, MockRunner, ScriptedHumanIO } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

function findLoops(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) findLoops(p, acc);
    else if (e.name.endsWith(".loop")) acc.push(p);
  }
  return acc;
}

const files = [...findLoops(join(root, "examples")), join(root, "agentic-engineering.loop")];

// A verifier that always passes; human IO that always approves — so every example reaches done.
class PassVerifier { async verify() { return { passed: true, output: "ok" }; } }
const stubs = {
  runner: new MockRunner(),
  verifier: new PassVerifier(),
  human: new ScriptedHumanIO(),
  baseDir: "/p",
  hardCap: 4,
  readText: async () => "plan: do the thing",
  writeText: async () => {},
};

test("every example .loop parses", () => {
  assert.ok(files.length >= 40, `expected many examples, found ${files.length}`);
  for (const f of files) {
    try { parse(readFileSync(f, "utf8")); }
    catch (err) { assert.fail(`parse failed for ${relative(root, f)}: ${err.message}`); }
  }
});

test("every standalone loop/pipeline example runs to a terminal outcome", async () => {
  for (const f of files) {
    const file = parse(readFileSync(f, "utf8"));
    for (const def of file.definitions) {
      if (def.kind === "flow") continue; // flows chain real files — covered by parse only
      const outcome = await runDefinition(def, stubs);
      assert.ok(
        typeof outcome.satisfied === "boolean" && typeof outcome.reason === "string",
        `${relative(root, f)} :: ${def.name ?? def.kind} did not return a terminal outcome`
      );
    }
  }
});
