import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "..", "..", "examples");
const read = (f) => readFileSync(join(examples, f), "utf8");

test("fix_test: minimal loop", () => {
  const file = parse(read("fix_test.loop"));
  assert.equal(file.loopVersion, "0.1");
  assert.equal(file.config, null);
  assert.equal(file.definitions.length, 1);
  const loop = file.definitions[0];
  assert.equal(loop.kind, "loop");
  assert.equal(loop.name, "fix test");
  assert.deepEqual(loop.doneWhen, { type: "test", target: "checkout.spec.ts::tax" });
  assert.deepEqual(loop.cycle, ["plan", "act", "observe"]);
  assert.equal(loop.transitions.length, 1);
  assert.equal(loop.transitions[0].on, "fail");
  assert.deepEqual(loop.transitions[0].do, [{ action: "reflect" }, { action: "plan" }]);
});

test("billing_apostrophe: full power", () => {
  const file = parse(read("billing_apostrophe.loop"));
  const loop = file.definitions[0];
  assert.equal(loop.name, "fix billing apostrophe bug");
  assert.deepEqual(loop.context.files, ["billing/form.tsx", "api/settings.ts", "schema/settings.ts"]);
  assert.equal(loop.context.includeLastFailure, true);
  assert.deepEqual(loop.policy.auto, ["edit"]);
  assert.deepEqual(loop.policy.confirm, ["migrate", "push"]);

  const pass = loop.transitions.find((t) => t.on === "pass");
  assert.equal(pass.requireGoalMet, true);
  assert.deepEqual(pass.do, [{ action: "stop" }]);

  const fail = loop.transitions.find((t) => t.on === "fail");
  assert.deepEqual(fail.do, [{ action: "reflect", focus: "which layer broke" }, { action: "plan" }]);

  const blocked = loop.transitions.find((t) => t.on === "blocked");
  assert.deepEqual(blocked.do, [{ action: "ask-human" }]);

  const attempts = loop.transitions.find((t) => t.on === "attempts");
  assert.equal(attempts.threshold, 6);
  assert.deepEqual(attempts.do, [{ action: "stop", warn: "thrashing" }]);

  assert.deepEqual(loop.also, ["polish the code", "run a security check", "update the docs"]);
});

test("ship_feature: pipeline with human nodes + gate", () => {
  const file = parse(read("ship_feature.loop"));
  const pipe = file.definitions[0];
  assert.equal(pipe.kind, "pipeline");
  assert.equal(pipe.name, "ship feature");
  assert.deepEqual(pipe.stages.map((s) => s.name), ["security", "build", "ui", "deploy"]);

  const security = pipe.stages[0];
  assert.deepEqual(security.loop.doneWhen, { type: "command", command: "semgrep --severity=high", expect: "empty" });

  const build = pipe.stages[1];
  assert.equal(build.loop.humanPlan, true);
  assert.deepEqual(build.loop.doneWhen, { type: "command", command: "pnpm test", expect: "exit-zero" });

  const ui = pipe.stages[2];
  assert.equal(ui.loop.humanReviewBeforeStop, true);

  const deploy = pipe.stages[3];
  assert.ok(deploy.gate);
  assert.match(deploy.gate.message, /provisioning/);
});

test("project: config tier", () => {
  const file = parse(read("project.loop"));
  assert.deepEqual(file.config, {
    use: "BMAD",
    runner: "claude-code",
    schedule: "nightly",
    target: "./src",
    notify: "slack",
  });
  assert.equal(file.definitions.length, 0);
});

test("archon_billing: plan from archon", () => {
  const file = parse(read("archon_billing.loop"));
  const loop = file.definitions[0];
  assert.deepEqual(loop.planSource, { type: "archon", project: "billing" });
  assert.deepEqual(loop.cycle, ["act", "observe"]);
  assert.deepEqual(loop.policy.confirm, ["migrate", "push"]);
});

test("errors carry a line number", () => {
  assert.throws(() => parse('loop "x":\n  goal: y\n  done when wat'), /line 3/);
});
