import { test } from "node:test";
import assert from "node:assert/strict";
import { contextAt, completionsFor, predictNext, hoverFor, lint } from "../dist/language.js";

const lines = (s) => s.split("\n");

test("contextAt detects top level", () => {
  assert.equal(contextAt(lines("loop \"x\":\n  goal: y\n"), 0), "top");
});

test("contextAt detects loop body", () => {
  const src = lines('loop "x":\n  goal: y\n  ');
  assert.equal(contextAt(src, 2), "loop-body");
});

test("contextAt detects pipeline (stage level) vs stage body", () => {
  const src = lines([
    'pipeline "p":',
    '  ',              // line 1: inside pipeline -> suggest stage
    '  stage "s":',
    '    ',            // line 3: inside stage body
  ].join("\n"));
  assert.equal(contextAt(src, 1), "pipeline");
  assert.equal(contextAt(src, 3), "stage-body");
});

test("completionsFor loop-body offers the core vocabulary", () => {
  const labels = completionsFor("loop-body").map((s) => s.label);
  assert.ok(labels.includes("goal:"));
  assert.ok(labels.includes("done when"));
  assert.ok(labels.includes("each cycle:"));
  assert.ok(labels.includes("when it fails:"));
  assert.ok(labels.includes("also:"));
});

test("completionsFor stage-body adds the stage gate", () => {
  const labels = completionsFor("stage-body").map((s) => s.label);
  assert.ok(labels.includes("a human approves before"));
});

test("completionsFor top and pipeline", () => {
  assert.ok(completionsFor("top").map((s) => s.label).includes("loop"));
  assert.deepEqual(completionsFor("pipeline").map((s) => s.label), ["stage"]);
});

test("completionsFor top offers best-practice templates, ranked before constructs", () => {
  const top = completionsFor("top");
  const templates = top.filter((s) => s.kind === "template");
  // a representative spread of the common patterns
  const labels = templates.map((s) => s.label).join(" | ");
  for (const want of ["bugfix", "feature", "pipeline", "flow", "for each", "A-to-Z", "git", "models"]) {
    assert.ok(labels.includes(want), `templates should include a "${want}" pattern`);
  }
  // every template is a multi-construct snippet with at least one tab stop
  for (const t of templates) {
    assert.match(t.insert, /\$\{?\d/, `${t.label} should have a tab stop`);
    assert.ok(t.insert.includes("\n"), `${t.label} should be a multi-line pattern`);
  }
  // templates come first (they carry kind:"template"); constructs follow
  const firstConstruct = top.findIndex((s) => s.kind !== "template");
  const lastTemplate = top.map((s) => s.kind).lastIndexOf("template");
  assert.ok(lastTemplate < firstConstruct, "templates should be ranked ahead of constructs");
});

test("predictNext gives the conventional next line", () => {
  assert.equal(predictNext('loop "x":'), "goal: ");
  assert.equal(predictNext("  goal: ship it"), 'done when the test "" passes');
  assert.equal(predictNext('  done when "npm test" passes'), "each cycle: plan, then act, then observe");
  assert.equal(predictNext("  each cycle: plan, then act, then observe"), "when it fails: reflect, then plan again");
  assert.equal(predictNext("  some random line"), null);
});

test("hoverFor returns docs for vocabulary, null otherwise", () => {
  assert.match(hoverFor("reflect"), /feedback edge/);
  assert.match(hoverFor("done"), /predicate/);
  assert.equal(hoverFor("banana"), null);
});

test("lint warns on an unverifiable loop (no done when, no human review)", () => {
  const src = 'loop "x":\n  goal: do the thing\n  each cycle: plan, then act, then observe';
  const file = { definitions: [{ kind: "loop", name: "x" }] };
  const w = lint(file, lines(src));
  assert.equal(w.length, 1);
  assert.match(w[0].message, /no way to verify/);
  assert.equal(w[0].line, 0);
});

test("lint warns on a self-correcting loop with no thrash guard", () => {
  const src = 'loop "y":\n  goal: g\n  done when "npm test" passes\n  when it fails: reflect, then plan again';
  const file = { definitions: [{ kind: "loop", name: "y", doneWhen: [{ type: "command" }], transitions: [{ on: "fail", do: [{ action: "reflect" }, { action: "plan" }] }] }] };
  const w = lint(file, lines(src));
  assert.equal(w.length, 1);
  assert.match(w[0].message, /thrash guard/);
});

test("lint stays silent on a complete loop", () => {
  const file = { definitions: [{ kind: "loop", name: "z", doneWhen: [{ type: "command" }], transitions: [{ on: "fail", do: [{ action: "reflect" }] }, { on: "attempts", threshold: 6, do: [{ action: "stop" }] }] }] };
  assert.deepEqual(lint(file, lines('loop "z":')), []);
});

test("lint checks loops inside a pipeline's stages", () => {
  const file = { definitions: [{ kind: "pipeline", name: "p", stages: [{ name: "s", loop: { kind: "loop", name: null } }] }] };
  const w = lint(file, lines('pipeline "p":\n  stage "s":\n    goal: g'));
  assert.equal(w.length, 1);
  assert.match(w[0].message, /no way to verify/);
});

test("lint produces zero warnings for a flow definition", () => {
  const src = 'flow "ship":\n  run "one.loop"\n  then run "two.loop"';
  const file = { definitions: [{ kind: "flow", name: "ship", steps: [{ ref: "one.loop", name: "one" }, { ref: "two.loop", name: "two" }] }] };
  const w = lint(file, lines(src));
  assert.deepEqual(w, [], "flow should produce no lint warnings");
});

test("lint nudges a trajectory eval that lacks `the bar:`", () => {
  const file = { definitions: [{ kind: "loop", name: "t",
    doneWhen: [{ type: "skill", skill: "path", subject: "trajectory" }],
    transitions: [{ on: "attempts", threshold: 5, do: [{ action: "stop" }] }] }] };
  const w = lint(file, lines('loop "t":'));
  assert.equal(w.length, 1);
  assert.match(w[0].message, /the bar:/);
});

test("lint stays silent on a trajectory eval that has `the bar:`", () => {
  const file = { definitions: [{ kind: "loop", name: "t",
    doneWhen: [{ type: "skill", skill: "path", subject: "trajectory", bar: "no test edits" }],
    transitions: [{ on: "attempts", threshold: 5, do: [{ action: "stop" }] }] }] };
  assert.deepEqual(lint(file, lines('loop "t":')), []);
});
