import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModels, modelForPhase } from "../dist/index.js";

test("built-in defaults: plan/reflect/also=fast, act=strong; tiers empty", () => {
  const eff = resolveModels();
  assert.deepEqual(eff.phases, { plan: "fast", act: "strong", reflect: "fast", also: "fast" });
  assert.deepEqual(eff.tiers, {});
  assert.equal(modelForPhase(eff, "act"), undefined); // no tier defined → runner default
});

test("file tiers map phases to models", () => {
  const eff = resolveModels({ tiers: { fast: "haiku", strong: "opus" } });
  assert.equal(modelForPhase(eff, "plan"), "haiku");
  assert.equal(modelForPhase(eff, "act"), "opus");
  assert.equal(modelForPhase(eff, "reflect"), "haiku");
});

test("loop overrides file (phase + tier)", () => {
  const eff = resolveModels({ tiers: { fast: "haiku", strong: "opus" } }, { phases: { plan: "strong" }, tiers: { strong: "sonnet" } });
  assert.equal(modelForPhase(eff, "plan"), "sonnet");
  assert.equal(modelForPhase(eff, "act"), "sonnet");
});

test("--model kill switch forces every phase", () => {
  const eff = resolveModels({ tiers: { fast: "haiku", strong: "opus" } });
  assert.equal(modelForPhase(eff, "plan", "fable"), "fable");
  assert.equal(modelForPhase(eff, "act", "fable"), "fable");
});
