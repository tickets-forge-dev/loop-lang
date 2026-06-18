import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "@loop/parser";
import { runDefinition, MockRunner, ScriptedHumanIO, MockArchonPlanSource } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "..", "..", "examples");
const read = (f) => readFileSync(join(examples, f), "utf8");

/** Verifier that returns a scripted sequence of pass/fail. */
class SeqVerifier {
  constructor(seq) {
    this.seq = seq;
    this.i = 0;
  }
  async verify() {
    const pass = this.seq[Math.min(this.i++, this.seq.length - 1)];
    return { passed: pass, output: pass ? "ok" : "failure output" };
  }
}

function collect() {
  const events = [];
  return { events, onEvent: (e) => events.push(e) };
}

test("fix_test converges via the reflect back-edge", async () => {
  const def = parse(read("fix_test.loop")).definitions[0];
  const runner = new MockRunner();
  const { events, onEvent } = collect();
  const outcome = await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([false, false, true]),
    human: new ScriptedHumanIO(),
    baseDir: process.cwd(),
    onEvent,
  });

  assert.equal(outcome.satisfied, true);
  assert.equal(outcome.reason, "done");
  assert.equal(runner.reflectCalls.length, 2, "reflected on each of the two failures");
  const loopBacks = events.filter((e) => e.type === "loop-back");
  assert.ok(loopBacks.length >= 2, "the back-edge fired");
  const lastObserve = events.filter((e) => e.type === "observe").at(-1);
  assert.equal(lastObserve.passed, true, "real done-when pass, not a faked stop");
});

test("also: finishing passes run in order only after the goal is met", async () => {
  const def = parse(read("billing_apostrophe.loop")).definitions[0];
  const runner = new MockRunner();
  const { events, onEvent } = collect();
  const outcome = await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([true]), // goal met on first observe
    human: new ScriptedHumanIO({ defaults: { confirm: false } }),
    baseDir: process.cwd(),
    onEvent,
  });
  assert.equal(outcome.satisfied, true);
  const also = events.filter((e) => e.type === "also");
  assert.deepEqual(also.map((e) => e.action), ["polish the code", "run a security check", "update the docs"]);
  // each `also` ran after the loop-end (finishing passes)
  const loopEndIdx = events.findIndex((e) => e.type === "loop-end");
  const firstAlsoIdx = events.findIndex((e) => e.type === "also");
  assert.ok(firstAlsoIdx > loopEndIdx);
});

test("also: finishing passes are skipped when the loop fails", async () => {
  const def = parse(read("billing_apostrophe.loop")).definitions[0];
  const { events, onEvent } = collect();
  await runDefinition(def, {
    runner: new MockRunner(),
    verifier: new SeqVerifier([false]), // never passes -> thrash
    human: new ScriptedHumanIO({ defaults: { confirm: false } }),
    baseDir: process.cwd(),
    onEvent,
  });
  assert.equal(events.filter((e) => e.type === "also").length, 0);
});

test("policy gate: confirm-class actions pause and are withheld when denied", async () => {
  const def = parse(read("billing_apostrophe.loop")).definitions[0];
  const runner = new MockRunner();
  const human = new ScriptedHumanIO({ defaults: { confirm: false } }); // deny migrate + push
  const outcome = await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([false]), // never passes -> thrash guard
    human,
    baseDir: process.cwd(),
  });

  const confirmed = human.calls.filter((c) => c.kind === "confirm").map((c) => c.arg);
  assert.deepEqual(confirmed.sort(), ["migrate", "push"], "paused to confirm both confirm-classes");
  assert.deepEqual(runner.actCalls[0].allowedClasses, ["edit"], "denied classes withheld; only auto edit granted");
  assert.equal(outcome.reason, "thrash");
  assert.equal(outcome.satisfied, false);
});

test("human review blocks the stop until approved", async () => {
  const def = parse('loop "ui":\n  goal: looks right\n  each cycle: plan, then act, then observe\n  a human reviews before stopping').definitions[0];
  const human = new ScriptedHumanIO({ review: [false, true] }); // reject once, then approve
  const outcome = await runDefinition(def, {
    runner: new MockRunner(),
    verifier: new SeqVerifier([false]),
    human,
    baseDir: process.cwd(),
  });
  const reviews = human.calls.filter((c) => c.kind === "review");
  assert.equal(reviews.length, 2, "blocked on review, looped once, approved on second");
  assert.equal(outcome.satisfied, true);
  assert.equal(outcome.reason, "human-approved");
});

test("plan from archon: plan pulled from Archon, runner.plan never called, status written back", async () => {
  const def = parse(read("archon_billing.loop")).definitions[0];
  const runner = new MockRunner();
  const archon = new MockArchonPlanSource(["Archon task: escape the apostrophe in the serializer"]);
  const outcome = await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([false, true]),
    human: new ScriptedHumanIO({ defaults: { confirm: false } }),
    archon,
    baseDir: process.cwd(),
  });

  assert.equal(outcome.satisfied, true);
  assert.equal(runner.planCalls.length, 0, "agent plan bypassed — Archon supplied the plan");
  assert.ok(archon.fetched.length >= 1, "fetched plan from Archon");
  // the act step received Archon's plan text
  assert.match(runner.actCalls[0].plan, /escape the apostrophe/);
  assert.deepEqual(archon.completed.at(-1), { project: "billing", goal: def.goal, satisfied: true });
});

test("plan from archon without a source throws", async () => {
  const def = parse(read("archon_billing.loop")).definitions[0];
  await assert.rejects(
    () =>
      runDefinition(def, {
        runner: new MockRunner(),
        verifier: new SeqVerifier([true]),
        human: new ScriptedHumanIO(),
        baseDir: process.cwd(),
      }),
    /no Archon plan source/
  );
});

test("pipeline halts when a stage fails", async () => {
  const src = [
    'pipeline "p":',
    "  stage one:",
    "    goal: g1",
    '    done when "x" passes',
    "    each cycle: plan, then act, then observe",
    "    when it fails: reflect, then plan again",
    '    after 1 tries: stop and warn "nope"',
    "  stage two:",
    "    goal: g2",
    '    done when "y" passes',
    "    each cycle: act, then observe",
  ].join("\n");
  const def = parse(src).definitions[0];
  const { events, onEvent } = collect();
  const outcome = await runDefinition(def, {
    runner: new MockRunner(),
    verifier: new SeqVerifier([false]),
    human: new ScriptedHumanIO(),
    baseDir: process.cwd(),
    onEvent,
  });
  assert.equal(outcome.satisfied, false);
  const stageStarts = events.filter((e) => e.type === "stage-start").map((e) => e.name);
  assert.deepEqual(stageStarts, ["one"], "second stage never started");
  const pipeEnd = events.find((e) => e.type === "pipeline-end");
  assert.equal(pipeEnd.satisfied, false);
});
