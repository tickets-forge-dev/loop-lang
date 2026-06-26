import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeModels } from "../dist/index.js";

test("summarizeModels tallies calls per tier and node", () => {
  const events = [
    { type: "model", node: "plan", tier: "fast", model: "haiku" },
    { type: "model", node: "act", tier: "strong", model: "opus" },
    { type: "model", node: "reflect", tier: "fast", model: "haiku" },
    { type: "model", node: "plan", tier: "fast", model: "haiku" },
    { type: "observe", passed: true, output: "ok" },
  ];
  const s = summarizeModels(events);
  const fast = s.find((t) => t.tier === "fast");
  const strong = s.find((t) => t.tier === "strong");
  assert.equal(fast.calls, 3);
  assert.deepEqual(fast.byNode, { plan: 2, reflect: 1 });
  assert.equal(fast.model, "haiku");
  assert.equal(strong.calls, 1);
  assert.deepEqual(strong.byNode, { act: 1 });
});

test("summarizeOpex: cycles, reflects, first-pass, outcome", async () => {
  const { summarizeOpex, formatOpexSummary } = await import("../dist/summary.js");
  const events = [
    { type: "observe", passed: false, output: "" },
    { type: "reflect", text: "r" },
    { type: "observe", passed: true, output: "" },
    { type: "stop", reason: "done" },
    { type: "loop-end", name: "x", satisfied: true },
  ];
  const s = summarizeOpex(events);
  assert.equal(s.cycles, 2);
  assert.equal(s.reflects, 1);
  assert.equal(s.firstPass, false);
  assert.equal(s.satisfied, true);
  assert.match(formatOpexSummary(s), /2 cycles, 1 reflect .* first-pass success: no/);
});
