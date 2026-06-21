import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "@loop/parser";
import { run, runDefinition, MockRunner, ScriptedHumanIO, MockArchonPlanSource } from "../dist/index.js";
import { MockGitIO } from "../dist/runners/mockGit.js";

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

test("loop outcome carries a summary of the last observe output", async () => {
  const def = parse('loop "x":\n  goal: g\n  done when "y" passes\n  each cycle: plan, then act, then observe').definitions[0];
  const outcome = await runDefinition(def, {
    runner: new MockRunner(),
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: process.cwd(),
  });
  assert.equal(outcome.satisfied, true);
  assert.equal(outcome.summary, "ok"); // SeqVerifier returns "ok" on pass
});

test("opts.upstream is threaded into the plan input", async () => {
  const def = parse('loop "x":\n  goal: g\n  done when "y" passes\n  each cycle: plan, then act, then observe').definitions[0];
  const runner = new MockRunner();
  await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: process.cwd(),
    upstream: "hello from prev step",
  });
  assert.equal(runner.planCalls[0].upstream, "hello from prev step");
});

// Helpers for flow tests: small in-memory loop files + a mock loader.
function loopSrc(name, opts = {}) {
  const guard = opts.failFast ? '\n  after 1 tries: stop and warn "nope"' : "";
  return `loop "${name}":\n  goal: ${name} goal\n  done when "cmd" passes\n  each cycle: plan, then act, then observe${guard}`;
}
function mockLoader(map) {
  return async (ref) => map[ref] ?? (() => { throw new Error("no such file " + ref); })();
}

test("flow: runs steps in order and carries the handoff forward", async () => {
  const files = { "one.loop": parse(loopSrc("one")), "two.loop": parse(loopSrc("two")) };
  const flow = parse('flow "chain":\n  run "one.loop"\n  then run "two.loop"').definitions[0];
  const runner = new MockRunner();
  const { events, onEvent } = collect();
  const outcome = await runDefinition(flow, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: "/proj",
    loadFile: mockLoader(files),
    flowStack: ["/proj/chain.loop"],
    onEvent,
  });
  assert.equal(outcome.satisfied, true);
  const starts = events.filter((e) => e.type === "flow-step-start").map((e) => e.name);
  assert.deepEqual(starts, ["one", "two"], "ran in order");
  const twoPlan = runner.planCalls.find((c) => c.goal === "two goal");
  assert.match(twoPlan.upstream, /\[one\] satisfied/, "step two received step one's summary");
});

test("flow: a failing step halts the rest", async () => {
  const files = { "one.loop": parse(loopSrc("one", { failFast: true })), "two.loop": parse(loopSrc("two")) };
  const flow = parse('flow "chain":\n  run "one.loop"\n  then run "two.loop"').definitions[0];
  const { events, onEvent } = collect();
  const outcome = await runDefinition(flow, {
    runner: new MockRunner(),
    verifier: new SeqVerifier([false]),
    human: new ScriptedHumanIO(),
    baseDir: "/proj",
    loadFile: mockLoader(files),
    flowStack: ["/proj/chain.loop"],
    onEvent,
  });
  assert.equal(outcome.satisfied, false);
  assert.deepEqual(events.filter((e) => e.type === "flow-step-start").map((e) => e.name), ["one"], "two never started");
});

test("flow: 'with the result of' pulls a named earlier step's summary", async () => {
  const files = { "a.loop": parse(loopSrc("a")), "b.loop": parse(loopSrc("b")), "c.loop": parse(loopSrc("c")) };
  const flow = parse('flow "chain":\n  run "a.loop"\n  then run "b.loop"\n  then run "c.loop" with the result of a').definitions[0];
  const runner = new MockRunner();
  await runDefinition(flow, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: "/proj",
    loadFile: mockLoader(files),
    flowStack: ["/proj/chain.loop"],
  });
  const cPlan = runner.planCalls.find((p) => p.goal === "c goal");
  assert.match(cPlan.upstream, /^\[a\] satisfied/, "c got a's summary, not b's");
});

test("flow: a rejected per-step gate halts the flow", async () => {
  const files = { "a.loop": parse(loopSrc("a")), "b.loop": parse(loopSrc("b")) };
  const flow = parse('flow "chain":\n  run "a.loop"\n  then run "b.loop":\n    a human approves first').definitions[0];
  const runner = new MockRunner();
  const outcome = await runDefinition(flow, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO({ gate: [false] }),
    baseDir: "/proj",
    loadFile: mockLoader(files),
    flowStack: ["/proj/chain.loop"],
  });
  assert.equal(outcome.satisfied, false);
  assert.equal(runner.planCalls.some((p) => p.goal === "b goal"), false, "b never ran");
});

test("flow: success outcome carries the last step's summary", async () => {
  const files = { "one.loop": parse(loopSrc("one")), "two.loop": parse(loopSrc("two")) };
  const flow = parse('flow "chain":\n  run "one.loop"\n  then run "two.loop"').definitions[0];
  const outcome = await runDefinition(flow, {
    runner: new MockRunner(),
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: "/proj",
    loadFile: mockLoader(files),
    flowStack: ["/proj/chain.loop"],
  });
  assert.equal(outcome.satisfied, true);
  assert.match(outcome.summary, /\[two\] satisfied/, "success outcome carries the last step's summary");
});

test("flow: a cycle is detected and throws", async () => {
  const files = {
    "a.loop": parse('flow "a":\n  run "b.loop"'),
    "b.loop": parse('flow "b":\n  run "a.loop"'),
  };
  const flow = files["a.loop"].definitions[0];
  await assert.rejects(
    () =>
      runDefinition(flow, {
        runner: new MockRunner(),
        verifier: new SeqVerifier([true]),
        human: new ScriptedHumanIO(),
        baseDir: "/proj",
        loadFile: mockLoader(files),
        flowStack: ["/proj/a.loop"],
      }),
    /flow cycle: a\.loop -> b\.loop -> a\.loop/
  );
});

test("for each: runs the template once per item, item text becomes upstream", async () => {
  const tmpl = parse('loop "t":\n  goal: do it\n  done when "x" passes\n  each cycle: plan, then act, then observe');
  const flow = parse('flow "f":\n  for each item in "plan.yaml":\n    run "t.loop"').definitions[0];
  const runner = new MockRunner();
  const outcome = await runDefinition(flow, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: "/proj",
    loadFile: async () => tmpl,
    readText: async () => "- alpha\n- beta\n- gamma\n",
  });
  assert.equal(outcome.satisfied, true);
  assert.equal(runner.planCalls.length, 3, "template ran once per item");
  assert.match(runner.planCalls[0].upstream, /alpha/);
  assert.match(runner.planCalls[1].upstream, /beta/);
  assert.match(runner.planCalls[2].upstream, /gamma/);
});

test("for each: a failed item asks continue/stop — stop halts the flow", async () => {
  const tmpl = parse('loop "t":\n  goal: do it\n  done when "x" passes\n  each cycle: plan, then act, then observe\n  after 1 tries: stop and warn "nope"');
  const flow = parse('flow "f":\n  for each item in "plan.yaml":\n    run "t.loop"').definitions[0];
  const { events, onEvent } = collect();
  const outcome = await runDefinition(flow, {
    runner: new MockRunner(),
    verifier: new SeqVerifier([false]), // template never passes -> each item fails fast
    human: new ScriptedHumanIO({ gate: [false] }), // stop at first failure
    baseDir: "/proj",
    loadFile: async () => tmpl,
    readText: async () => "- alpha\n- beta\n- gamma\n",
    onEvent,
  });
  assert.equal(outcome.satisfied, false);
  const itemStarts = events.filter((e) => e.type === "foreach-item-start");
  assert.equal(itemStarts.length, 1, "stopped after the first item");
});

test("for each: continue past failures → flow proceeds, step satisfied", async () => {
  const tmpl = parse('loop "t":\n  goal: do it\n  done when "x" passes\n  each cycle: plan, then act, then observe\n  after 1 tries: stop and warn "nope"');
  const flow = parse('flow "f":\n  for each item in "plan.yaml":\n    run "t.loop"').definitions[0];
  const { events, onEvent } = collect();
  const outcome = await runDefinition(flow, {
    runner: new MockRunner(),
    verifier: new SeqVerifier([false]),
    human: new ScriptedHumanIO({ defaults: { gate: true } }), // continue every time
    baseDir: "/proj",
    loadFile: async () => tmpl,
    readText: async () => "- a\n- b\n",
    onEvent,
  });
  assert.equal(outcome.satisfied, true, "human accepted every failure");
  assert.equal(events.filter((e) => e.type === "foreach-item-start").length, 2, "attempted all items");
  assert.ok(events.some((e) => e.type === "foreach-end" && e.satisfied === true));
});

test("git: default applies a branch + commit on done", async () => {
  const file = parse('loop "x":\n  goal: g\n  done when "t" passes\n  each cycle: plan, then act, then observe');
  const git = new MockGitIO("loop/x");
  await run(file, { runner: new MockRunner(), verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: "/p", git });
  assert.ok(git.calls.includes("start:branch"), "started a branch");
  assert.ok(git.calls.some((c) => c.startsWith("commit:")), "committed on done");
  assert.ok(!git.calls.some((c) => c.startsWith("push:")), "no push by default");
});

test("git: push when done pushes to the safe branch", async () => {
  const file = parse('git:\n  work on a branch\n  push when done\nloop "x":\n  goal: g\n  done when "t" passes\n  each cycle: act, then observe');
  const git = new MockGitIO("loop/x");
  await run(file, { runner: new MockRunner(), verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: "/p", git });
  assert.ok(git.calls.some((c) => c === "push:loop/x"));
});

test("git: refuses to push to main (in place)", async () => {
  const file = parse('git:\n  work in place\n  push when done\nloop "x":\n  goal: g\n  done when "t" passes\n  each cycle: act, then observe');
  const git = new MockGitIO("main"); // start returns the current branch "main" for in-place
  await assert.rejects(
    () => run(file, { runner: new MockRunner(), verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: "/p", git }),
    /refusing to push to "main"/
  );
});

test("git: no GitIO → engine does no git (backward compat)", async () => {
  const def = parse('loop "x":\n  goal: g\n  done when "t" passes\n  each cycle: act, then observe').definitions[0];
  const outcome = await runDefinition(def, { runner: new MockRunner(), verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: "/p" });
  assert.equal(outcome.satisfied, true); // unchanged, nothing thrown
});

test("git: commit each cycle commits per cycle", async () => {
  const file = parse('git:\n  work on a branch\n  commit each cycle\nloop "x":\n  goal: g\n  done when "t" passes\n  each cycle: act, then observe\n  after 2 tries: stop and warn "stop"');
  const git = new MockGitIO("loop/x");
  await run(file, { runner: new MockRunner(), verifier: new SeqVerifier([false]), human: new ScriptedHumanIO(), baseDir: "/p", git });
  assert.ok(git.calls.filter((c) => c.startsWith("commit:")).length >= 2, "committed each cycle");
});

test("git: runs setup even when flowStack is seeded (CLI calling convention)", async () => {
  const file = parse('loop "x":\n  goal: g\n  done when "t" passes\n  each cycle: plan, then act, then observe');
  const git = new MockGitIO("loop/x");
  await run(file, {
    runner: new MockRunner(),
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: "/p",
    git,
    flowStack: ["/p/x.loop"],
  });
  assert.ok(git.calls.includes("start:branch"), "git setup fired even with a seeded flowStack");
  assert.ok(git.calls.some((c) => c.startsWith("commit:")), "committed on done");
});

test("models: each node runs on its resolved tier model", async () => {
  const f = parse(`models: fast haiku, strong opus\n\nloop "x":\n  goal: g\n  done when "true" passes\n  when it fails: reflect, then plan again\n`);
  const runner = new MockRunner();
  await runDefinition(f.definitions[0], {
    runner,
    verifier: new SeqVerifier([false, true]), // one fail (→reflect), then pass
    human: new ScriptedHumanIO(),
    baseDir: process.cwd(),
    modelPolicy: f.config.models,
  });
  assert.equal(runner.planCalls[0].model, "haiku");
  assert.equal(runner.actCalls[0].model, "opus");
  assert.equal(runner.reflectCalls[0].model, "haiku");
});

test("models: --model kill switch overrides the policy", async () => {
  const f = parse(`models: fast haiku, strong opus\n\nloop "x":\n  goal: g\n  done when "true" passes\n`);
  const runner = new MockRunner();
  await runDefinition(f.definitions[0], {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: process.cwd(),
    modelPolicy: f.config.models,
    cliModel: "fable",
  });
  assert.equal(runner.planCalls[0].model, "fable");
  assert.equal(runner.actCalls[0].model, "fable");
});
