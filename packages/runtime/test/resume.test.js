import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "@loop-lang/parser";
import { run, buildResumePlan, MockRunner, ScriptedHumanIO } from "../dist/index.js";

/** Serialize captured events the way the file sink writes them (header + seq'd lines). */
const asLog = (events, meta) =>
  [
    JSON.stringify({ v: "loop.log.v1", runId: "r1", ts: "t", meta }),
    ...events.map((event, seq) => JSON.stringify({ seq, ts: "t", event })),
  ].join("\n") + "\n";

const PIPELINE = [
  'pipeline "ship":',
  '  stage "build":',
  "    goal: it builds",
  '    done when "build" passes',
  "    each cycle: act, then observe",
  '  stage "verify":',
  "    goal: tests pass",
  '    done when "test" passes',
  "    each cycle: act, then observe",
  '    after 1 tries: stop and warn "stuck"',
].join("\n");

/** A verifier scripted per predicate command. */
const verifierFor = (results) => ({
  verify: async (pred) => ({ passed: !!results[pred.command], output: `${pred.command}: ${results[pred.command] ? "ok" : "boom"}` }),
});

function stubs(verifier, events) {
  return {
    runner: new MockRunner(),
    verifier,
    human: new ScriptedHumanIO(),
    baseDir: "/p",
    hardCap: 2,
    readText: async () => "",
    writeText: async () => {},
    onEvent: (e) => events?.push(e),
  };
}

test("buildResumePlan: satisfied stages recorded, failed/incomplete not; nested sub-runs ignored", () => {
  const log = asLog(
    [
      { type: "pipeline-start", name: "ship" },
      { type: "stage-start", name: "build" },
      { type: "loop-start", name: "build" }, // the stage's own loop — must not count as a definition
      { type: "loop-end", name: "build", satisfied: true },
      { type: "stage-end", name: "build", satisfied: true },
      { type: "stage-start", name: "verify" },
      { type: "loop-start", name: "verify" },
      // crash here — no end events for the verify stage or the pipeline
    ],
    { loop_sha256: "abc" }
  );
  const plan = buildResumePlan(log);
  assert.deepEqual([...plan.completed], ["stage:0:build"]);
  assert.equal(plan.sourceHash, "abc");
  assert.equal(plan.runId, "r1");
});

test("buildResumePlan: a fully satisfied top-level definition becomes def:<i>", () => {
  const log = asLog([
    { type: "loop-start", name: "a" },
    { type: "loop-end", name: "a", satisfied: true },
    { type: "loop-start", name: "b" },
    { type: "loop-end", name: "b", satisfied: false },
  ]);
  assert.deepEqual([...buildResumePlan(log).completed], ["def:0"]);
});

test("buildResumePlan: flow steps keep their summaries; foreach items keyed by step+var+index", () => {
  const log = asLog([
    { type: "flow-start", name: "deliver" },
    { type: "flow-step-start", name: "design", ref: "design.loop" },
    { type: "loop-start", name: "d" }, // nested sub-file run
    { type: "loop-end", name: "d", satisfied: true },
    { type: "flow-step-end", name: "design", satisfied: true, summary: "DESIGN OK" },
    { type: "flow-step-start", name: "stories", ref: "story.loop" },
    { type: "foreach-start", var: "story", source: "sprint.yaml", count: 3 },
    { type: "foreach-item-start", var: "story", index: 0, total: 3 },
    { type: "loop-start", name: "s0" },
    { type: "loop-end", name: "s0", satisfied: true },
    { type: "foreach-item-end", var: "story", index: 0, satisfied: true },
    { type: "foreach-item-start", var: "story", index: 1, total: 3 },
    // crash mid-item 1
  ]);
  const plan = buildResumePlan(log);
  assert.deepEqual([...plan.completed].sort(), ["item:0:stories:story:0", "step:0:design"]);
  assert.equal(plan.summaries.get("step:0:design"), "DESIGN OK");
});

test("end-to-end: crash after stage 1 → resume skips stage 1, runs only stage 2", async () => {
  const file = parse(PIPELINE);

  // Run 1: build passes, verify fails (thrash guard stops it) — like a run that died mid-way.
  const events1 = [];
  const s1 = stubs(verifierFor({ build: true, test: false }), events1);
  const out1 = await run(file, s1);
  assert.equal(out1[0].satisfied, false, "first run ends unsatisfied");
  assert.equal(s1.runner.actCalls.length >= 2, true, "both stages acted in run 1");

  // Run 2: resume from run 1's log; the test is now fixed.
  const plan = buildResumePlan(asLog(events1));
  const events2 = [];
  const s2 = stubs(verifierFor({ build: true, test: true }), events2);
  const out2 = await run(file, { ...s2, resume: plan });

  assert.equal(out2[0].satisfied, true, "resumed run finishes");
  // Stage "build" must NOT re-run: every act in run 2 belongs to the verify stage.
  assert.ok(s2.runner.actCalls.length >= 1);
  assert.ok(s2.runner.actCalls.every((a) => a.goal.includes("tests pass")), "build stage never re-acted");
  const resumed = events2.find((e) => e.type === "resumed");
  assert.deepEqual({ unit: resumed.unit, name: resumed.name }, { unit: "stage", name: "build" });
});

test("end-to-end: a wholly satisfied definition is skipped via def:<i>", async () => {
  const src = 'loop "one":\n  goal: g\n  done when "ok" passes\n  each cycle: act, then observe';
  const file = parse(src);
  const events1 = [];
  const s1 = stubs(verifierFor({ ok: true }), events1);
  await run(file, s1);

  const plan = buildResumePlan(asLog(events1));
  assert.ok(plan.completed.has("def:0"));
  const s2 = stubs(verifierFor({ ok: true }));
  const out = await run(file, { ...s2, resume: plan });
  assert.equal(out[0].satisfied, true);
  assert.equal(s2.runner.actCalls.length, 0, "nothing re-ran");
});

test("flow resume: skipped step's recorded summary is restored as the next step's upstream", async () => {
  const flowSrc = ['flow "ship":', '  run "a.loop"', '  then run "b.loop"'].join("\n");
  const subA = 'loop "a":\n  goal: step a\n  done when "a-ok" passes\n  each cycle: act, then observe';
  const subB = 'loop "b":\n  goal: step b\n  done when "b-ok" passes\n  each cycle: plan, then act, then observe\n  after 1 tries: stop and warn "stuck"';
  const loadFile = async (ref) => parse(ref === "a.loop" ? subA : subB);

  // Run 1: a succeeds, b fails → flow stops. The log records a's summary on its step-end.
  const events1 = [];
  const s1 = { ...stubs(verifierFor({ "a-ok": true, "b-ok": false }), events1), loadFile, flowStack: ["/p/f.loop"] };
  const out1 = await run(parse(flowSrc), s1);
  assert.equal(out1[0].satisfied, false);
  const aEnd = events1.find((e) => e.type === "flow-step-end" && e.satisfied);
  assert.ok(aEnd.summary, "step end carries its summary for future resumes");

  // Run 2: resume — step a skipped, step b runs with a's recorded summary as upstream.
  const plan = buildResumePlan(asLog(events1));
  const s2 = { ...stubs(verifierFor({ "a-ok": true, "b-ok": true })), loadFile, flowStack: ["/p/f.loop"] };
  const out2 = await run(parse(flowSrc), { ...s2, resume: plan });
  assert.equal(out2[0].satisfied, true);
  assert.ok(s2.runner.actCalls.every((a) => a.goal === "step b"), "step a never re-ran");
  assert.equal(s2.runner.planCalls[0].upstream, aEnd.summary, "carry-forward restored from the log");
});

test("foreach resume: delivered items are skipped, the failed one re-runs", async () => {
  const flowSrc = ['flow "deliver":', '  for each story in "sprint.yaml":', '    run "story.loop"'].join("\n");
  const tmpl = 'loop "story":\n  goal: build it\n  done when "story-ok" passes\n  each cycle: act, then observe\n  after 1 tries: stop and warn "stuck"';
  const loadFile = async () => parse(tmpl);
  const readText = async () => "- login\n- signup\n- reset\n";

  // Run 1: item 0 passes, item 1 fails and the human stops the flow.
  let call = 0;
  const flaky = { verify: async () => ({ passed: call++ === 0, output: "x" }) };
  const events1 = [];
  const human1 = new ScriptedHumanIO({ defaults: { gate: false } }); // stop at the failed item
  const s1 = { ...stubs(flaky, events1), human: human1, loadFile, readText, flowStack: ["/p/f.loop"] };
  const out1 = await run(parse(flowSrc), s1);
  assert.equal(out1[0].satisfied, false);

  // Run 2: resume — item 0 skipped, items 1..2 run (verifier green now).
  const plan = buildResumePlan(asLog(events1));
  assert.ok([...plan.completed].some((k) => k.startsWith("item:")), "item 0 recorded");
  const green = { verify: async () => ({ passed: true, output: "ok" }) };
  const events2 = [];
  const s2 = { ...stubs(green, events2), loadFile, readText, flowStack: ["/p/f.loop"] };
  const out2 = await run(parse(flowSrc), { ...s2, resume: plan });
  assert.equal(out2[0].satisfied, true);
  const skipped = events2.filter((e) => e.type === "resumed" && e.unit === "foreach-item");
  assert.deepEqual(skipped.map((e) => e.index), [0], "exactly item 0 skipped");
  assert.equal(s2.runner.actCalls.length, 2, "items 1 and 2 ran, item 0 did not");
});
