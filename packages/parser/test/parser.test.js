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

test("ship_flow: flow of files with handoff + gate", () => {
  const file = parse(read("ship_flow.loop"));
  const flow = file.definitions[0];
  assert.equal(flow.kind, "flow");
  assert.equal(flow.name, "ship");
  assert.deepEqual(flow.steps.map((s) => s.name), ["build", "test", "deploy"]);
  assert.deepEqual(flow.steps.map((s) => s.ref), ["build.loop", "test.loop", "deploy.loop"]);
  assert.ok(flow.steps[2].gate);
  assert.match(flow.steps[2].gate.message, /approve before/i);
});

test("flow: 'with the result of' overrides the handoff source", () => {
  const flow = parse('flow "f":\n  run "a.loop"\n  then run "b.loop"\n  then run "c.loop" with the result of a').definitions[0];
  assert.equal(flow.steps[2].fromStep, "a");
});

test("flow: a flow with no steps is a parse error", () => {
  assert.throws(() => parse('flow "f":'), /has no steps/);
});

test("flow: for each step parses to a forEach FlowStep", () => {
  const flow = parse('flow "f":\n  for each item in "plan.yaml":\n    run "item-template.loop"').definitions[0];
  assert.equal(flow.kind, "flow");
  const step = flow.steps[0];
  assert.deepEqual(step.forEach, { var: "item", source: "plan.yaml" });
  assert.equal(step.ref, "item-template.loop");
  assert.equal(step.name, "item");
});

test("flow: for each can carry a human gate child", () => {
  const flow = parse('flow "f":\n  for each story in "sprint.yaml":\n    run "t.loop"\n    a human approves first').definitions[0];
  assert.ok(flow.steps[0].gate);
  assert.match(flow.steps[0].gate.message, /approve before story/i);
});

test("flow: for each without a run child is a parse error", () => {
  assert.throws(() => parse('flow "f":\n  for each item in "plan.yaml":\n    a human approves'), /needs a 'run/);
});

test("flow: for each with an unrecognized child line reports that line", () => {
  assert.throws(() => parse('flow "f":\n  for each item in "plan.yaml":\n    run "t.loop"\n    wat'), /unrecognized line/);
});

test("flow: plain run steps still parse alongside for each (regression)", () => {
  const flow = parse('flow "f":\n  run "a.loop"\n  then for each item in "plan.yaml":\n    run "t.loop"').definitions[0];
  assert.equal(flow.steps.length, 2);
  assert.equal(flow.steps[0].forEach, undefined);
  assert.deepEqual(flow.steps[1].forEach, { var: "item", source: "plan.yaml" });
});
