import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "@loop/parser";
import { parse as parseYaml } from "yaml";
import { compileFile, exportToArchonYaml } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "..", "..", "examples");
const read = (f) => readFileSync(join(examples, f), "utf8");

const MODE_KEYS = ["prompt", "bash", "loop", "approval", "command", "script", "cancel"];
// Archon's loader runs Zod in strip mode, so a misnamed field is silently dropped, not
// rejected. Assert every emitted key is real so a typo can't ship a no-op workflow.
const WORKFLOW_KEYS = new Set(["name", "description", "provider", "model", "interactive", "nodes"]);
const NODE_KEYS = new Set(["id", "depends_on", "trigger_rule", "when", "idle_timeout", ...MODE_KEYS]);
const LOOP_KEYS = new Set(["prompt", "until", "max_iterations", "fresh_context", "until_bash", "interactive", "gate_message"]);
const APPROVAL_KEYS = new Set(["message", "capture_response", "on_reject"]);
const ID_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

function assertKnownKeys(wf) {
  for (const k of Object.keys(wf)) assert.ok(WORKFLOW_KEYS.has(k), `unknown workflow key: ${k}`);
  for (const n of wf.nodes) {
    assert.match(n.id, ID_RE, `node id "${n.id}" must be referenceable as $id.output`);
    for (const k of Object.keys(n)) assert.ok(NODE_KEYS.has(k), `unknown node key: ${k}`);
    if (n.loop) for (const k of Object.keys(n.loop)) assert.ok(LOOP_KEYS.has(k), `unknown loop key: ${k}`);
    if (n.approval) for (const k of Object.keys(n.approval)) assert.ok(APPROVAL_KEYS.has(k), `unknown approval key: ${k}`);
    // any $node.output reference inside strings must not use a hyphenated .field segment
    for (const v of Object.values(n)) {
      if (typeof v === "string") {
        for (const m of v.matchAll(/\$[a-zA-Z_][a-zA-Z0-9_-]*\.output\.([a-zA-Z0-9_-]+)/g)) {
          assert.doesNotMatch(m[1], /-/, "field segment after .output must not contain hyphens");
        }
      }
    }
  }
}
function assertExactlyOneMode(node) {
  const present = MODE_KEYS.filter((k) => k in node);
  assert.equal(present.length, 1, `node ${node.id} must have exactly one mode key, had: ${present.join(",")}`);
}
function assertValidWorkflow(wf) {
  assertKnownKeys(wf);
  assert.equal(typeof wf.name, "string");
  assert.ok(wf.name.length > 0);
  assert.equal(typeof wf.description, "string");
  assert.ok(wf.description.length > 0);
  assert.ok(Array.isArray(wf.nodes));
  const ids = new Set();
  for (const n of wf.nodes) {
    assert.ok(n.id && typeof n.id === "string", "node has id");
    assert.ok(!ids.has(n.id), `duplicate node id ${n.id}`);
    ids.add(n.id);
    assertExactlyOneMode(n);
    if ("loop" in n) {
      assert.ok(n.loop.prompt && n.loop.prompt.length > 0, "loop has prompt");
      assert.ok(n.loop.until && n.loop.until.length > 0, "loop has until (schema-required)");
      assert.ok(Number.isInteger(n.loop.max_iterations) && n.loop.max_iterations > 0, "loop max_iterations positive int");
    }
    if ("approval" in n) assert.ok(n.approval.message.length > 0, "approval has message");
    // every depends_on target exists
    for (const dep of n.depends_on ?? []) assert.ok(ids.has(dep) || wf.nodes.some((m) => m.id === dep), `dep ${dep} exists`);
  }
}

test("billing_apostrophe -> valid Archon loop workflow", () => {
  const file = parse(read("billing_apostrophe.loop"));
  const [wf] = compileFile(file);
  assertValidWorkflow(wf);
  assert.equal(wf.name, "fix-billing-apostrophe-bug");
  assert.equal(wf.interactive, true, "approval nodes present -> workflow interactive");

  const loop = wf.nodes.find((n) => "loop" in n);
  assert.equal(loop.loop.until, "LOOP_COMPLETE", "distinctive signal token (not bare 'DONE')");
  assert.match(loop.loop.until_bash, /billing\.spec\.ts::apostrophe/);
  assert.equal(loop.loop.max_iterations, 6, "after 6 tries -> max_iterations 6");
  assert.equal(loop.loop.fresh_context, true, "includeLastFailure -> fresh_context");
  assert.match(loop.loop.prompt, /<promise>LOOP_COMPLETE<\/promise>/);
  assert.doesNotMatch(loop.loop.prompt, /<promise>BLOCKED<\/promise>/, "no fake BLOCKED signal (Archon strips it / it never completes)");
  assert.match(loop.loop.prompt, /Do NOT migrate or push/i, "confirm policy -> prose");

  // 3 also passes fan out from the loop
  const alsos = wf.nodes.filter((n) => n.id.includes("-also-"));
  assert.equal(alsos.length, 3);
  for (const a of alsos) assert.deepEqual(a.depends_on, [loop.id]);

  // blocked -> failure-review approval gated on the loop NOT completing (empty output),
  // because Archon strips the completion signal from $output (comparing to it is broken).
  const failure = wf.nodes.find((n) => n.id.endsWith("-failure"));
  assert.ok(failure && "approval" in failure);
  assert.equal(failure.trigger_rule, "all_done");
  assert.match(failure.when, /\.output == ''/);

  // report join carries the thrash warning
  const report = wf.nodes.find((n) => n.id.endsWith("-report"));
  assert.ok(report && "prompt" in report);
  assert.match(report.prompt, /6-attempt limit/);
});

test("ship_feature pipeline -> linear DAG with gates", () => {
  const file = parse(read("ship_feature.loop"));
  const [wf] = compileFile(file);
  assertValidWorkflow(wf);

  // security stage loop has no upstream deps (first stage)
  const secLoop = wf.nodes.find((n) => n.id === "security-loop");
  assert.equal(secLoop.depends_on, undefined);

  // build stage uses humanPlan -> plan + approval before its loop
  assert.ok(wf.nodes.find((n) => n.id === "build-plan"));
  assert.ok(wf.nodes.find((n) => n.id === "build-plan-approval" && "approval" in n));
  const buildLoop = wf.nodes.find((n) => n.id === "build-loop");
  assert.deepEqual(buildLoop.depends_on, ["build-plan-approval"]);

  // ui stage uses humanReviewBeforeStop -> approval after its loop
  assert.ok(wf.nodes.find((n) => n.id === "ui-review" && "approval" in n));

  // deploy stage has a gate approval whose message mentions provisioning
  const gate = wf.nodes.find((n) => n.id === "deploy-gate");
  assert.ok(gate && "approval" in gate);
  assert.match(gate.approval.message, /provisioning/);
});

test("emitted YAML parses back to an equivalent object", () => {
  for (const f of ["billing_apostrophe.loop", "ship_feature.loop", "fix_test.loop"]) {
    const file = parse(read(f));
    const [out] = exportToArchonYaml(file);
    const reparsed = parseYaml(out.yaml); // throws on invalid YAML
    assertValidWorkflow(reparsed);
    // block scalar round-trips the multiline prompt
    const loop = reparsed.nodes.find((n) => n && typeof n === "object" && "loop" in n);
    if (loop) assert.ok(loop.loop.prompt.includes("\n"), "multiline prompt survived YAML round-trip");
  }
});

test("fix_test (minimal) -> single loop node, no extras", () => {
  const file = parse(read("fix_test.loop"));
  const [wf] = compileFile(file);
  assertValidWorkflow(wf);
  const loopNodes = wf.nodes.filter((n) => "loop" in n);
  assert.equal(loopNodes.length, 1);
  assert.equal(loopNodes[0].loop.max_iterations, 10, "no thrash guard -> default max_iterations");
  assert.equal(wf.interactive, undefined, "no approvals -> not interactive");
});
