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
