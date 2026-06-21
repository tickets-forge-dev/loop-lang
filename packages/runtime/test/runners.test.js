import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanPrompt, claudeArgs } from "../dist/index.js";

test("buildPlanPrompt includes the upstream handoff when present", () => {
  const p = buildPlanPrompt({ goal: "g", files: [], includeLastFailure: false, reflection: null, upstream: "[build] satisfied\nok", baseDir: "." });
  assert.match(p, /previous step/i);
  assert.match(p, /\[build\] satisfied/);
});

test("buildPlanPrompt omits the upstream block when absent", () => {
  const p = buildPlanPrompt({ goal: "g", files: [], includeLastFailure: false, reflection: null, baseDir: "." });
  assert.doesNotMatch(p, /previous step/i);
});

test("buildPlanPrompt frames context as files-or-descriptions to locate", () => {
  const p = buildPlanPrompt({ goal: "g", files: ["the billing form", "api/x.ts"], includeLastFailure: false, reflection: null, baseDir: "." });
  assert.match(p, /file or a description/i);   // tells the agent to resolve descriptions
  assert.match(p, /the billing form/);
});

test("claudeArgs includes --model only when a model is given", () => {
  const withModel = claudeArgs({ stream: false, baseDir: "/x", model: "opus", flags: [] });
  assert.ok(withModel.includes("--model"));
  assert.equal(withModel[withModel.indexOf("--model") + 1], "opus");

  const noModel = claudeArgs({ stream: false, baseDir: "/x", flags: [] });
  assert.ok(!noModel.includes("--model"));
});
