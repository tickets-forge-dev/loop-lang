import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "@loop-lang/parser";
import { renderFile, renderDef, oneLine } from "../dist/show.js";

test("renderFile shows a loop's cycle, done-when, reflect and guard", () => {
  const f = parse(`loop "fix test":\n  goal: tax is right\n  done when the test "checkout.spec.ts::tax" passes\n  each cycle: plan, then act, then observe\n  when it fails: reflect, then plan again\n  after 6 tries: stop and warn "stuck"\n`);
  const out = renderFile(f);
  assert.match(out, /loop "fix test"/);
  assert.match(out, /plan → act → observe/);
  assert.match(out, /done when: test "checkout.spec.ts::tax"/);
  assert.match(out, /back-edge/);
  assert.match(out, /guard: after 6 tries/);
  assert.match(out, /stuck/);
});

test("renderFile warns when there is no done-when", () => {
  const f = parse(`loop "x":\n  goal: g\n  each cycle: plan, then act, then observe\n`);
  assert.match(renderFile(f), /no done-when/);
});

test("renderDef renders a pipeline with stage gates", () => {
  const f = parse(`pipeline "ship":\n  stage "security":\n    goal: clean\n    done when "semgrep" finds nothing\n    each cycle: plan, then act, then observe\n  stage "build":\n    goal: works\n    a human approves the plan first\n    done when "pnpm test" passes\n    each cycle: act, then observe\n`);
  const out = renderDef(f.definitions[0]);
  assert.match(out, /pipeline "ship"/);
  assert.match(out, /1\. security/);
  assert.match(out, /2\. build/);
  assert.match(out, /👤/);
  assert.match(out, /finds nothing/);
});

test("renderDef renders a flow chain with a gate", () => {
  const f = parse(`flow "ship":\n  run "build.loop"\n  then run "deploy.loop":\n    a human approves first\n`);
  const out = renderDef(f.definitions[0]);
  assert.match(out, /flow "ship"/);
  assert.match(out, /build\.loop/);
  assert.match(out, /deploy\.loop 👤/);
});

test("oneLine gives a terse shape per definition kind", () => {
  const loop = parse(`loop "y":\n  goal: g\n  done when "t" passes\n  each cycle: plan, then act, then observe\n  when it fails: reflect, then plan again\n`).definitions[0];
  assert.match(oneLine(loop), /loop "y" · plan→act→observe, reflect, done-when/);
});
