import { test } from "node:test";
import assert from "node:assert/strict";
import { contextAt, completionsFor, predictNext, hoverFor } from "../dist/language.js";

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
