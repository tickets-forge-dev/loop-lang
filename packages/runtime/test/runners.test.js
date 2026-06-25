import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanPrompt, claudeArgs, parseSkillVerdict } from "../dist/index.js";

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

test("buildPlanPrompt surfaces skills and memory blocks", () => {
  const p = buildPlanPrompt({
    goal: "g", files: [], includeLastFailure: false, reflection: null,
    skills: ["check-weather", "analyze-workout"], memory: "lesson: drizzle is fine", baseDir: ".",
  });
  assert.match(p, /you may use these skills.*check-weather, analyze-workout/i);
  assert.match(p, /lessons from past runs/i);
  assert.match(p, /drizzle is fine/);
});

test("parseSkillVerdict: VERDICT: APPROVED passes, REJECTED fails", () => {
  assert.equal(parseSkillVerdict("looks good\nVERDICT: APPROVED").passed, true);
  assert.equal(parseSkillVerdict("not yet\nVERDICT: REJECTED").passed, false);
});

test("parseSkillVerdict: 'not approved' is not misread as an approval", () => {
  assert.equal(parseSkillVerdict("this is not approved").passed, false);
});

test("parseSkillVerdict: a SCORE meeting the threshold passes", () => {
  assert.equal(parseSkillVerdict("SCORE: 9", 8).passed, true);
  assert.equal(parseSkillVerdict("SCORE: 7", 8).passed, false);
  assert.equal(parseSkillVerdict("no number here", 8).passed, false);
});
