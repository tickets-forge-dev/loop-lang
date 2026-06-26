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
  assert.deepEqual(loop.doneWhen, [{ type: "test", target: "checkout.spec.ts::tax" }]);
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
  assert.deepEqual(security.loop.doneWhen, [{ type: "command", command: "semgrep --severity=high", expect: "empty" }]);

  const build = pipe.stages[1];
  assert.equal(build.loop.humanPlan, true);
  assert.deepEqual(build.loop.doneWhen, [{ type: "command", command: "pnpm test", expect: "exit-zero" }]);

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

test("plan_from_file: plan read from a file", () => {
  const file = parse(read("plan_from_file.loop"));
  const loop = file.definitions[0];
  assert.deepEqual(loop.planSource, { type: "file", path: "docs/billing-plan.md" });
  assert.deepEqual(loop.cycle, ["act", "observe"]);
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

test("file-level git block parses to config.git", () => {
  const file = parse('git:\n  work on a branch\n  commit when the goal is met\n  push when done\n  open a pull request\nloop "x":\n  goal: g\n  done when "t" passes');
  assert.deepEqual(file.config.git, { isolation: "branch", commit: "done", push: true, openPr: true });
});
test("per-loop git block parses to loop.git", () => {
  const loop = parse('loop "x":\n  goal: g\n  done when "t" passes\n  git:\n    commit each cycle').definitions[0];
  assert.deepEqual(loop.git, { commit: "cycle" });
});
test("git isolation + dial-down forms", () => {
  const a = parse('git:\n  work in a worktree "wt"\n  commit never\n  do not push').config.git;
  assert.deepEqual(a, { isolation: "worktree", branch: "wt", commit: "never", push: false });
  const b = parse('git:\n  work in place').config.git;
  assert.deepEqual(b, { isolation: "in-place" });
});

test("models: parses tiers + auto-assign on config", () => {
  const f = parse(`models: fast haiku, strong opus\n\nloop "x":\n  goal: g\n  done when "true" passes\n`);
  assert.deepEqual(f.config.models, { tiers: { fast: "haiku", strong: "opus" } });
});

test("models: per-phase override + all shorthand on a loop", () => {
  const f = parse(`loop "x":\n  goal: g\n  done when "true" passes\n  models: act fast, plan strong\n`);
  assert.deepEqual(f.definitions[0].models, { phases: { act: "fast", plan: "strong" } });
  const g = parse(`loop "y":\n  goal: g\n  done when "true" passes\n  models: all strong\n`);
  assert.deepEqual(g.definitions[0].models, { phases: { plan: "strong", act: "strong", reflect: "strong", also: "strong" } });
});

test("models: unknown phase or tier is a parse error", () => {
  assert.throws(() => parse(`loop "x":\n  goal: g\n  done when "true" passes\n  models: paln strong\n`), /unrecognized clause/i);
  assert.throws(() => parse(`models: fast haiku, mid opus\n\nloop "x":\n  goal: g\n  done when "true" passes\n`), /unrecognized clause/i);
});

test("models: observe tier is ignored (no observe model)", () => {
  const f = parse(`loop "x":\n  goal: g\n  done when "true" passes\n  models: observe fast, act strong\n`);
  assert.deepEqual(f.definitions[0].models, { phases: { act: "strong" } });
});

test("models: per-phase overrides all regardless of order", () => {
  const a = parse(`loop "x":\n  goal: g\n  done when "true" passes\n  models: act fast, all strong\n`);
  assert.deepEqual(a.definitions[0].models, { phases: { plan: "strong", act: "fast", reflect: "strong", also: "strong" } });
  const b = parse(`loop "y":\n  goal: g\n  done when "true" passes\n  models: all strong, act fast\n`);
  assert.deepEqual(b.definitions[0].models, { phases: { plan: "strong", act: "fast", reflect: "strong", also: "strong" } });
});

// ---- skills + memory ----

test("skills + memory: use skills, remember, and a skill predicate", () => {
  const file = parse(read("skills_memory.loop"));
  const loop = file.definitions[0];
  assert.equal(loop.name, "decide whether to cancel the morning run");
  assert.deepEqual(loop.skills, ["check-weather", "analyze-workout"]);
  assert.deepEqual(loop.memory, { file: "morning-run.memory.md" });
  assert.deepEqual(loop.doneWhen, [{ type: "skill", skill: "workout-review", expect: "approve" }]);
});

test("skill predicate: scores N or more carries a minScore", () => {
  const file = parse(read("email_review.loop"));
  const loop = file.definitions[0];
  assert.deepEqual(loop.skills, ["write-email"]);
  assert.deepEqual(loop.memory, { file: "launch-email.memory.md" });
  assert.deepEqual(loop.doneWhen, [{ type: "skill", skill: "email-review", expect: "approve", minScore: 8 }]);
});

test("use skills: also accepts 'and' as a separator", () => {
  const loop = parse('loop "x":\n  goal: g\n  use skills: a and b, c').definitions[0];
  assert.deepEqual(loop.skills, ["a", "b", "c"]);
});

test("memory: 'keep a memory in' is an accepted alias", () => {
  const loop = parse('loop "x":\n  goal: g\n  keep a memory in "notes.md"').definitions[0];
  assert.deepEqual(loop.memory, { file: "notes.md" });
});

test("config-tier 'each cycle:' sets the default for loops without their own", () => {
  const file = parse(
    'each cycle: act, then observe\n\nloop "x":\n  goal: g\n  done when "t" passes'
  );
  assert.deepEqual(file.config.cycle, ["act", "observe"]);
  // the loop inherits the config-tier default
  assert.deepEqual(file.definitions[0].cycle, ["act", "observe"]);
});

test("per-loop 'each cycle:' overrides the config-tier default", () => {
  const file = parse(
    'each cycle: act, then observe\n\n' +
      'loop "inherits":\n  goal: g\n  done when "t" passes\n\n' +
      'loop "overrides":\n  goal: g\n  each cycle: plan, then act, then observe\n  done when "t" passes'
  );
  assert.deepEqual(file.definitions[0].cycle, ["act", "observe"]);            // inherits
  assert.deepEqual(file.definitions[1].cycle, ["plan", "act", "observe"]);    // overrides
});

test("config-tier default cycle applies to pipeline stages too", () => {
  const file = parse(
    'each cycle: act, then observe\n\n' +
      'pipeline "p":\n  stage "a":\n    goal: g\n    done when "t" passes\n' +
      '  stage "b":\n    goal: g\n    each cycle: plan, then observe\n    done when "t" passes'
  );
  const [a, b] = file.definitions[0].stages;
  assert.deepEqual(a.loop.cycle, ["act", "observe"]);        // inherits config default
  assert.deepEqual(b.loop.cycle, ["plan", "observe"]);       // stage override wins
});

test("no config default → built-in plan/act/observe is preserved", () => {
  const loop = parse('loop "x":\n  goal: g\n  done when "t" passes').definitions[0];
  assert.deepEqual(loop.cycle, ["plan", "act", "observe"]);
});

test("config-tier default cycle is independent per loop (no shared reference)", () => {
  const file = parse(
    'each cycle: act, then observe\n\n' +
      'loop "a":\n  goal: g\n  done when "t" passes\n\n' +
      'loop "b":\n  goal: g\n  done when "t" passes'
  );
  assert.notEqual(file.definitions[0].cycle, file.definitions[1].cycle); // distinct arrays
  assert.deepEqual(file.definitions[0].cycle, file.definitions[1].cycle); // same contents
});

test("parse(opts.defaultCycle): external default seeds the cascade", () => {
  // project-level default, file has no config cycle, loop has no cycle → inherits external default
  const inherits = parse('loop "x":\n  goal: g\n  done when "t" passes', {
    defaultCycle: ["act", "observe"],
  }).definitions[0];
  assert.deepEqual(inherits.cycle, ["act", "observe"]);

  // the file's own config-tier cycle still wins over the external default
  const fileWins = parse('each cycle: plan, then observe\n\nloop "x":\n  goal: g\n  done when "t" passes', {
    defaultCycle: ["act", "observe"],
  }).definitions[0];
  assert.deepEqual(fileWins.cycle, ["plan", "observe"]);
});

test("evals: multiple done-when lines form a conjunction", () => {
  const loop = parse(
    'loop "x":\n  goal: g\n' +
      '  done when "pnpm test" passes\n' +
      '  done when the skill "review" scores 8 or more on the output'
  ).definitions[0];
  assert.equal(loop.doneWhen.length, 2);
  assert.deepEqual(loop.doneWhen[0], { type: "command", command: "pnpm test", expect: "exit-zero" });
  assert.deepEqual(loop.doneWhen[1], { type: "skill", skill: "review", expect: "approve", minScore: 8, subject: "output" });
});

test("evals: 'on the trajectory' selects the subject; default omits it", () => {
  const traj = parse('loop "x":\n  goal: g\n  done when the skill "path" approves on the trajectory').definitions[0];
  assert.deepEqual(traj.doneWhen[0], { type: "skill", skill: "path", expect: "approve", subject: "trajectory" });
  const def = parse('loop "x":\n  goal: g\n  done when the skill "out" approves').definitions[0];
  assert.deepEqual(def.doneWhen[0], { type: "skill", skill: "out", expect: "approve" }); // no subject = output
});

test("evals: an indented 'the bar:' attaches a rubric to a skill eval", () => {
  const loop = parse(
    'loop "x":\n  goal: g\n' +
      '  done when the skill "path" approves on the trajectory\n' +
      '    the bar: did not weaken a test to go green'
  ).definitions[0];
  assert.deepEqual(loop.doneWhen[0], {
    type: "skill", skill: "path", expect: "approve", subject: "trajectory",
    bar: "did not weaken a test to go green",
  });
});

test("evals: 'the bar:' on a non-skill predicate is a parse error", () => {
  assert.throws(
    () => parse('loop "x":\n  goal: g\n  done when "pnpm test" passes\n    the bar: nope'),
    /the bar:/i
  );
});

test("friendly sugar: check:/verify:, in:/files:, when it breaks", () => {
  const loop = parse(
    'loop "x":\n  goal: g\n  in: src/cart, src/tax\n  check: pnpm test cart\n  when it breaks: reflect, then plan again'
  ).definitions[0];
  assert.deepEqual(loop.context.files, ["src/cart", "src/tax"]);
  assert.deepEqual(loop.doneWhen, [{ type: "command", command: "pnpm test cart", expect: "exit-zero" }]);
  assert.equal(loop.transitions[0].on, "fail");
});

test("friendly sugar: check: also accepts a predicate phrase", () => {
  const a = parse('loop "x":\n  goal: g\n  check: the skill "review" approves on the trajectory').definitions[0];
  assert.deepEqual(a.doneWhen, [{ type: "skill", skill: "review", expect: "approve", subject: "trajectory" }]);
  const b = parse('loop "x":\n  goal: g\n  files: a.ts, b.ts').definitions[0];
  assert.deepEqual(b.context.files, ["a.ts", "b.ts"]);
});

test("rigor: agentic engineering injects a back-edge + thrash guard when omitted", () => {
  const loop = parse('rigor: agentic engineering\n\nloop "x":\n  goal: g\n  check: npm test').definitions[0];
  assert.equal(parse('rigor: agentic engineering\n\nloop "x":\n  goal: g\n  check: npm test').config.rigor, "agentic engineering");
  const fail = loop.transitions.find((t) => t.on === "fail");
  const guard = loop.transitions.find((t) => t.on === "attempts");
  assert.ok(fail, "injected a reflect-on-fail back-edge");
  assert.deepEqual(fail.do, [{ action: "reflect" }, { action: "plan" }]);
  assert.ok(guard && guard.threshold === 8, "injected a default thrash guard");
});

test("rigor: vibe coding injects nothing; author transitions are not double-added", () => {
  const vibe = parse('rigor: vibe coding\n\nloop "x":\n  goal: g\n  check: npm test').definitions[0];
  assert.deepEqual(vibe.transitions ?? [], []);
  const own = parse('rigor: agentic engineering\n\nloop "x":\n  goal: g\n  check: npm test\n  after 3 tries: stop and warn "mine"').definitions[0];
  const guards = (own.transitions ?? []).filter((t) => t.on === "attempts");
  assert.equal(guards.length, 1, "did not add a second guard");
  assert.equal(guards[0].threshold, 3, "kept the author's guard");
});

test("rigor: an unknown level is a parse error; mode: parses", () => {
  assert.throws(() => parse('rigor: yolo\n\nloop "x":\n  goal: g'), /unknown rigor/i);
  assert.equal(parse('mode: orchestrator\n\nloop "x":\n  goal: g').config.mode, "orchestrator");
});

test("hooks: a hooks block parses into lifecycle-bound checks", () => {
  const loop = parse(
    'loop "x":\n  goal: g\n  check: npm test\n  hooks:\n    before each cycle: "tsc" passes\n    on commit: "semgrep" finds nothing'
  ).definitions[0];
  assert.deepEqual(loop.hooks, [
    { at: "before-cycle", predicate: { type: "command", command: "tsc", expect: "exit-zero" } },
    { at: "on-commit", predicate: { type: "command", command: "semgrep", expect: "empty" } },
  ]);
});

test("hooks: a non-deterministic hook predicate is rejected", () => {
  assert.throws(() => parse('loop "x":\n  goal: g\n  hooks:\n    on commit: the skill "x" approves'), /deterministic/i);
});

test("observe: a config-tier observe block parses trace/meter/cost cap", () => {
  const file = parse('observe:\n  trace every cycle\n  meter tokens and cost\n  stop and warn if cost exceeds "$5"\n\nloop "x":\n  goal: g\n  check: npm test');
  assert.deepEqual(file.config.observe, { trace: true, meter: true, costCap: "$5" });
});

test("sandbox + runs as: config-tier isolation and identity", () => {
  const file = parse(
    'sandbox:\n  no network access\n  allow egress to "registry.npmjs.org" only\n  cap cpu at 2 cores, memory at 4g, time at 10m\n  cannot reach the host filesystem\nruns as: ci-bot\n\nloop "x":\n  goal: g\n  check: npm test'
  );
  assert.equal(file.config.sandbox.network, "allowlist");
  assert.deepEqual(file.config.sandbox.egress, ["registry.npmjs.org"]);
  assert.equal(file.config.sandbox.memory, "4g");
  assert.equal(file.config.sandbox.time, "10m");
  assert.equal(file.config.runsAs, "ci-bot");
});

test("knowledge/examples/tools: context + MCP keywords", () => {
  const loop = parse(
    'loop "x":\n  goal: g\n  knowledge: docs/api.md, the architecture diagram\n  examples: routes/payments.ts\n  use tools from the "github" server\n  check: npm test'
  ).definitions[0];
  assert.deepEqual(loop.context.knowledge, ["docs/api.md", "the architecture diagram"]);
  assert.deepEqual(loop.context.examples, ["routes/payments.ts"]);
  assert.deepEqual(loop.tools, ["github"]);
});

test("parallel stages: 'stages in parallel:' assigns a shared group id", () => {
  const pipe = parse(
    'pipeline "p":\n  stage "a":\n    goal: g\n    check: t\n  stages in parallel:\n    stage "b":\n      goal: g\n      check: t\n    stage "c":\n      goal: g\n      check: t'
  ).definitions[0];
  assert.equal(pipe.stages.length, 3);
  assert.equal(pipe.stages[0].parallelGroup, undefined);
  assert.equal(pipe.stages[1].parallelGroup, 1);
  assert.equal(pipe.stages[2].parallelGroup, 1);
});
