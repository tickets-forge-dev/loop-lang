import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanPrompt } from "../dist/index.js";

test("buildPlanPrompt includes the upstream handoff when present", () => {
  const p = buildPlanPrompt({ goal: "g", files: [], includeLastFailure: false, reflection: null, upstream: "[build] satisfied\nok", baseDir: "." });
  assert.match(p, /previous step/i);
  assert.match(p, /\[build\] satisfied/);
});

test("buildPlanPrompt omits the upstream block when absent", () => {
  const p = buildPlanPrompt({ goal: "g", files: [], includeLastFailure: false, reflection: null, baseDir: "." });
  assert.doesNotMatch(p, /previous step/i);
});
