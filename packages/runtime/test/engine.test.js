import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "@loop-lang/parser";
import { run, runDefinition, MockRunner, ScriptedHumanIO, ownModelBinaryWarning } from "../dist/index.js";
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

test("plan from file: plan read from the file, runner.plan never called", async () => {
  const def = parse(read("plan_from_file.loop")).definitions[0];
  const runner = new MockRunner();
  const reads = [];
  const planText = "Plan: escape the apostrophe in the serializer";
  const outcome = await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([false, true]),
    human: new ScriptedHumanIO({ defaults: { confirm: false } }),
    readText: async (path) => { reads.push(path); return planText; },
    baseDir: process.cwd(),
  });

  assert.equal(outcome.satisfied, true);
  assert.equal(runner.planCalls.length, 0, "agent plan bypassed — the file supplied the plan");
  assert.ok(reads.length >= 1 && reads.every((p) => p === "docs/billing-plan.md"), "read the plan file");
  // the act step received the file's plan text
  assert.match(runner.actCalls[0].plan, /escape the apostrophe/);
});

test("plan from file without a file reader throws", async () => {
  const def = parse(read("plan_from_file.loop")).definitions[0];
  await assert.rejects(
    () =>
      runDefinition(def, {
        runner: new MockRunner(),
        verifier: new SeqVerifier([true]),
        human: new ScriptedHumanIO(),
        baseDir: process.cwd(),
      }),
    /no file reader/
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

test("for each: foreach-start carries item labels for the live dashboard", async () => {
  const tmpl = parse('loop "t":\n  goal: do it\n  done when "x" passes\n  each cycle: plan, then act, then observe');
  const flow = parse('flow "f":\n  for each story in "sprint.yaml":\n    run "t.loop"').definitions[0];
  const { events, onEvent } = collect();
  await runDefinition(flow, {
    runner: new MockRunner(),
    verifier: new SeqVerifier([true, true]),
    human: new ScriptedHumanIO(),
    baseDir: "/proj",
    loadFile: async () => tmpl,
    readText: async () => "stories:\n  - title: User can log in\n  - title: User can sign up\n",
    onEvent,
  });
  const start = events.find((e) => e.type === "foreach-start");
  assert.deepEqual(start.labels, ["User can log in", "User can sign up"]);
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

test("models: flow sub-file's own models: block is honored (not silently dropped)", async () => {
  // The sub-file declares its own models policy; the parent flow has none.
  // Before the fix, opts.modelPolicy is never updated from the sub-file's config,
  // so plan/act run with undefined model. After the fix they should use haiku/opus.
  const subFileSrc = `models: fast haiku, strong opus\n\nloop "sub":\n  goal: sub goal\n  done when "x" passes\n  each cycle: plan, then act, then observe\n`;
  const subFile = parse(subFileSrc);
  const flow = parse('flow "chain":\n  run "sub.loop"').definitions[0];
  const runner = new MockRunner();
  const outcome = await runDefinition(flow, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: "/proj",
    loadFile: async () => subFile,
    flowStack: ["/proj/chain.loop"],
    // intentionally NO modelPolicy here — the parent has no models: block
  });
  assert.equal(outcome.satisfied, true);
  assert.equal(runner.actCalls[0].model, "opus", "act should use the sub-file's strong model");
  assert.equal(runner.planCalls[0].model, "haiku", "plan should use the sub-file's fast model");
});

// ---- skills + memory ----

/** In-memory text store for memory read/write without touching disk. */
function memStore(initial = {}) {
  const files = { ...initial };
  return {
    files,
    readText: async (ref) => {
      if (!(ref in files)) throw new Error("no such file " + ref);
      return files[ref];
    },
    writeText: async (ref, content) => {
      files[ref] = (files[ref] ?? "") + content;
    },
  };
}

test("memory: lessons are read into the first plan and an entry is appended on stop", async () => {
  const def = parse(read("skills_memory.loop")).definitions[0];
  const runner = new MockRunner();
  const store = memStore({ "morning-run.memory.md": "lesson: light drizzle is fine" });
  const { events, onEvent } = collect();
  const outcome = await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([true]), // unused; skill predicate routes to runner
    human: new ScriptedHumanIO(),
    baseDir: process.cwd(),
    readText: store.readText,
    writeText: store.writeText,
    onEvent,
  });
  assert.equal(outcome.satisfied, true);
  // memory threaded into the first plan
  assert.match(runner.planCalls[0].memory, /light drizzle is fine/);
  assert.ok(events.some((e) => e.type === "memory-read"));
  // an entry was appended on stop
  assert.ok(events.some((e) => e.type === "memory-write"));
  assert.match(store.files["morning-run.memory.md"], /## \d{4}-\d{2}-\d{2} — done/);
  assert.match(store.files["morning-run.memory.md"], /outcome: satisfied/);
});

test("memory: first run with no file still records an entry on stop", async () => {
  const def = parse(read("skills_memory.loop")).definitions[0];
  const runner = new MockRunner();
  const store = memStore(); // no memory file yet
  await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: process.cwd(),
    readText: store.readText,
    writeText: store.writeText,
  });
  assert.equal(runner.planCalls[0].memory, undefined, "no memory to thread on a first run");
  assert.match(store.files["morning-run.memory.md"], /outcome: satisfied/, "memory created on stop");
});

test("memory: a thrash run records the last reflection as the lesson", async () => {
  const def = parse(read("skills_memory.loop")).definitions[0];
  // skill always rejects -> the loop reflects + replans until the thrash guard fires.
  const runner = new MockRunner({
    reflectText: () => "the review wanted a firmer reason",
    skill: (input) => ({ passed: false, detail: `${input.skill}: REJECTED` }),
  });
  const store = memStore();
  const outcome = await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([false]),
    human: new ScriptedHumanIO(),
    baseDir: process.cwd(),
    readText: store.readText,
    writeText: store.writeText,
  });
  assert.equal(outcome.satisfied, false);
  assert.equal(outcome.reason, "thrash");
  assert.match(store.files["morning-run.memory.md"], /lesson: the review wanted a firmer reason/);
  assert.match(store.files["morning-run.memory.md"], /## \d{4}-\d{2}-\d{2} — thrash/);
});

test("skill predicate: routes to runSkill and its verdict drives the loop", async () => {
  const def = parse(read("skills_memory.loop")).definitions[0];
  // reject twice, then approve
  const seq = [false, false, true];
  let i = 0;
  const runner = new MockRunner({ skill: (input) => {
    const passed = seq[Math.min(i++, seq.length - 1)];
    return { passed, detail: `${input.skill}: ${passed ? "APPROVED" : "REJECTED"}` };
  }});
  const store = memStore();
  const { events, onEvent } = collect();
  const outcome = await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([false]), // would fail if the skill path were bypassed
    human: new ScriptedHumanIO(),
    baseDir: process.cwd(),
    readText: store.readText,
    writeText: store.writeText,
    onEvent,
  });
  assert.equal(outcome.satisfied, true);
  assert.equal(outcome.reason, "done");
  assert.equal(runner.skillCalls.length, 3, "the review skill was invoked each cycle");
  assert.equal(runner.skillCalls[0].skill, "workout-review");
  assert.ok(events.some((e) => e.type === "skill-verify" && e.passed === true));
  // the act summary was handed to the review as context
  assert.match(runner.skillCalls.at(-1).context, /acted on/);
});

test("skill predicate: a missing runSkill throws a clear error", async () => {
  const def = parse(read("skills_memory.loop")).definitions[0];
  const runner = new MockRunner();
  // remove runSkill to simulate a runner that doesn't support it
  runner.runSkill = undefined;
  await assert.rejects(
    () => runDefinition(def, {
      runner,
      verifier: new SeqVerifier([true]),
      human: new ScriptedHumanIO(),
      baseDir: process.cwd(),
    }),
    /has no runSkill/
  );
});

test("skill predicate: minScore threshold passes via parseSkillVerdict", async () => {
  const def = parse(read("email_review.loop")).definitions[0];
  const runner = new MockRunner({ skill: (input) => ({
    passed: input.minScore !== undefined,
    detail: `SCORE: 9 (min ${input.minScore})`,
  })});
  const outcome = await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([false]),
    human: new ScriptedHumanIO({ defaults: { review: true } }),
    baseDir: process.cwd(),
    readText: async () => { throw new Error("none"); },
    writeText: async () => {},
  });
  assert.equal(runner.skillCalls[0].minScore, 8, "minScore threaded from the predicate");
  assert.equal(outcome.satisfied, true);
});

test("regression: a loop with no skills/memory behaves exactly as before", async () => {
  const def = parse(read("fix_test.loop")).definitions[0];
  const runner = new MockRunner();
  const store = memStore();
  const { events, onEvent } = collect();
  const outcome = await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([false, false, true]),
    human: new ScriptedHumanIO(),
    baseDir: process.cwd(),
    writeText: store.writeText,
    onEvent,
  });
  assert.equal(outcome.satisfied, true);
  assert.equal(runner.skillCalls.length, 0, "no skill calls without a skill predicate");
  assert.equal(runner.planCalls[0].memory, undefined, "no memory threaded");
  assert.ok(!events.some((e) => e.type === "memory-read" || e.type === "memory-write"));
  assert.deepEqual(store.files, {}, "no memory file written");
});

// ---- trajectory evals (Story 2) ----

test("trajectory eval: the captured trajectory + the bar reach the verifier", async () => {
  const def = parse(
    'loop "x":\n  goal: g\n' +
      '  done when the skill "path-review" approves on the trajectory\n' +
      '    the bar: did not weaken a test to go green\n' +
      '  after 2 tries: stop and warn "stuck"'
  ).definitions[0];
  const runner = new MockRunner({
    act: (i) => ({ summary: `acted on: ${i.goal}`, trajectory: "● Edit refunds.ts\n● Bash $ pnpm test" }),
    skill: () => ({ passed: true, detail: "APPROVED" }),
  });
  const outcome = await runDefinition(def, {
    runner, verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: "/p",
  });
  assert.equal(outcome.satisfied, true);
  const call = runner.skillCalls.at(-1);
  assert.equal(call.subject, "trajectory");
  assert.equal(call.bar, "did not weaken a test to go green");
  assert.match(call.context, /Edit refunds\.ts/, "the eval judged the trajectory, not the act summary");
});

test("output eval: receives the act summary, not the trajectory", async () => {
  const def = parse(
    'loop "x":\n  goal: g\n  done when the skill "review" approves on the output\n  after 2 tries: stop and warn "x"'
  ).definitions[0];
  const runner = new MockRunner({
    act: () => ({ summary: "ACTSUMMARY", trajectory: "TRAJ-should-not-be-used" }),
    skill: () => ({ passed: true, detail: "ok" }),
  });
  await runDefinition(def, { runner, verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: "/p" });
  const call = runner.skillCalls.at(-1);
  assert.equal(call.subject, "output");
  assert.equal(call.context, "ACTSUMMARY");
});

test("reflect sees the trajectory of the failing cycle (Story 3)", async () => {
  const def = parse(
    'loop "x":\n  goal: g\n  done when "cmd" passes\n' +
      '  when it fails: reflect, then plan again\n  after 3 tries: stop and warn "stuck"'
  ).definitions[0];
  const runner = new MockRunner({ act: () => ({ summary: "did stuff", trajectory: "● Edit a.ts\n● Bash $ cmd" }) });
  await runDefinition(def, {
    runner, verifier: new SeqVerifier([false, true]), human: new ScriptedHumanIO(), baseDir: "/p",
  });
  assert.equal(runner.reflectCalls.length, 1, "reflected on the one failure");
  assert.match(runner.reflectCalls[0].trajectory, /Edit a\.ts/, "reflect received the cycle's trajectory");
});

// ---- hooks (Story 7) ----

test("hooks: a failing before-cycle hook blocks the loop", async () => {
  const def = parse('loop "x":\n  goal: g\n  check: npm test\n  hooks:\n    before each cycle: "tsc" passes').definitions[0];
  const outcome = await runDefinition(def, {
    runner: new MockRunner(), verifier: new SeqVerifier([false]), human: new ScriptedHumanIO(), baseDir: "/p",
  });
  assert.equal(outcome.satisfied, false);
  assert.equal(outcome.reason, "blocked");
});

test("hooks: a passing before-cycle hook lets the loop proceed to done", async () => {
  const def = parse('loop "x":\n  goal: g\n  check: npm test\n  hooks:\n    before each cycle: "tsc" passes\n  after 2 tries: stop and warn "x"').definitions[0];
  const outcome = await runDefinition(def, {
    runner: new MockRunner(), verifier: new SeqVerifier([true, true]), human: new ScriptedHumanIO(), baseDir: "/p",
  });
  assert.equal(outcome.satisfied, true);
});

// ---- parallel stages (Story 11) ----

test("parallel stages run concurrently and all must satisfy", async () => {
  const def = parse(
    'pipeline "p":\n  stages in parallel:\n    stage "a":\n      goal: g\n      check: t\n    stage "b":\n      goal: g\n      check: t'
  ).definitions[0];
  const order = [];
  const runner = new MockRunner({ act: (i) => { order.push(i.goal); return { summary: "ok" }; } });
  const outcome = await runDefinition(def, {
    runner, verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: "/p",
  });
  assert.equal(outcome.satisfied, true);
});

// ---- ctx skill provisioning ----

/** Records provision/topup calls; returns scripted skill names + recommend-only capabilities. */
class MockCtxAdapter {
  constructor({ provisionSkills = [], topupSkills = [], capabilities, harnessInstall, warnings } = {}) {
    this.provisionCalls = [];
    this.topupCalls = [];
    this._p = provisionSkills;
    this._t = topupSkills;
    this._caps = capabilities;
    this._harness = harnessInstall;
    this._warnings = warnings;
  }
  _result(useSkills) {
    return { useSkills, capabilities: this._caps, harnessInstall: this._harness, warnings: this._warnings };
  }
  async provision(input) { this.provisionCalls.push(input); return this._result(this._p); }
  async topup(input) { this.topupCalls.push(input); return this._result(this._t); }
}

test("ctx: provision merges recommended skills into the first plan", async () => {
  const def = parse('loop "x":\n  goal: harden webhooks\n  use skills recommended by ctx for "stripe"\n  done when "t" passes').definitions[0];
  const runner = new MockRunner();
  const ctx = new MockCtxAdapter({ provisionSkills: ["webhook-idempotency", "signature-check"] });
  const { events, onEvent } = collect();
  const outcome = await runDefinition(def, {
    runner, verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: process.cwd(), ctx, onEvent,
  });
  assert.equal(ctx.provisionCalls.length, 1, "provisioned once before the first plan");
  assert.equal(ctx.provisionCalls[0].intent, "stripe", "passed the explicit intent");
  assert.deepEqual(runner.planCalls[0].skills, ["webhook-idempotency", "signature-check"]);
  const ev = events.find((e) => e.type === "ctx" && e.action === "provision");
  assert.ok(ev && ev.ok === true, "emitted a successful provision event");
  assert.deepEqual(ev.skills, ["webhook-idempotency", "signature-check"]);
  assert.equal(outcome.satisfied, true);
});

test("ctx: a discovery loop runs without a ctx adapter (degrades)", async () => {
  const def = parse('loop "x":\n  goal: g\n  use skills recommended by ctx\n  done when "t" passes').definitions[0];
  const runner = new MockRunner();
  const { events, onEvent } = collect();
  const outcome = await runDefinition(def, {
    runner, verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: process.cwd(), onEvent,
  });
  const ev = events.find((e) => e.type === "ctx");
  assert.ok(ev && ev.ok === false, "emitted a skipped ctx event");
  assert.deepEqual(runner.planCalls[0].skills, [], "no skills, but the loop still ran");
  assert.equal(outcome.satisfied, true);
});

test("ctx: provisioned skills extend the hand-named use skills list (dedup)", async () => {
  const def = parse('loop "x":\n  goal: g\n  use skills: hand-a\n  use skills recommended by ctx\n  done when "t" passes').definitions[0];
  const runner = new MockRunner();
  const ctx = new MockCtxAdapter({ provisionSkills: ["hand-a", "ctx-b"] }); // hand-a is a duplicate
  await runDefinition(def, {
    runner, verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: process.cwd(), ctx,
  });
  assert.deepEqual(runner.planCalls[0].skills, ["hand-a", "ctx-b"], "deduped against the named skill");
});

test("ctx: top up pulls more skills after a reflection", async () => {
  const def = parse(
    'loop "x":\n  goal: g\n  use skills recommended by ctx\n  top up skills from ctx when a step needs more\n' +
    '  done when "t" passes\n  when it fails: reflect, then plan again'
  ).definitions[0];
  const runner = new MockRunner();
  const ctx = new MockCtxAdapter({ provisionSkills: ["base"], topupSkills: ["extra"] });
  const { events, onEvent } = collect();
  const outcome = await runDefinition(def, {
    runner, verifier: new SeqVerifier([false, true]), human: new ScriptedHumanIO(), baseDir: process.cwd(), ctx, onEvent,
  });
  assert.ok(ctx.topupCalls.length >= 1, "topup fired after the failure");
  assert.deepEqual(runner.planCalls[0].skills, ["base"], "first plan saw the provisioned base skill");
  assert.deepEqual(runner.planCalls[1].skills, ["base", "extra"], "second plan saw the topped-up skill");
  const topupEv = events.find((e) => e.type === "ctx" && e.action === "topup");
  assert.ok(topupEv && topupEv.ok === true);
  assert.deepEqual(topupEv.skills, ["extra"]);
  assert.equal(outcome.satisfied, true);
});

test("ctx: no top up when a loop does not ask for it", async () => {
  const def = parse(
    'loop "x":\n  goal: g\n  use skills recommended by ctx\n' +
    '  done when "t" passes\n  when it fails: reflect, then plan again'
  ).definitions[0];
  const runner = new MockRunner();
  const ctx = new MockCtxAdapter({ provisionSkills: ["base"], topupSkills: ["extra"] });
  await runDefinition(def, {
    runner, verifier: new SeqVerifier([false, true]), human: new ScriptedHumanIO(), baseDir: process.cwd(), ctx,
  });
  assert.equal(ctx.topupCalls.length, 0, "no top up without `top up skills from ctx`");
});

test("ctx: own-model binary warning fires only for a missing LOCAL provider binary", () => {
  const ollama = { provider: "ollama", model: "ollama/llama3.1" };
  // local provider, binary missing -> warn
  assert.match(ownModelBinaryWarning(ollama, () => false), /`ollama` binary isn't on PATH/);
  // local provider, binary present -> silent
  assert.equal(ownModelBinaryWarning(ollama, () => true), null);
  // API/unknown provider has no local binary -> silent even if onPath is false
  assert.equal(ownModelBinaryWarning({ provider: "openai", model: "gpt-4o" }, () => false), null);
  // no own-model declared -> silent
  assert.equal(ownModelBinaryWarning(undefined, () => false), null);
});

test("ctx: grants + own model thread to provision; mcps/harnesses surface but never merge into skills", async () => {
  const def = parse('loop "x":\n  goal: build a local agent loop\n  use skills recommended by ctx\n  done when "t" passes').definitions[0];
  const runner = new MockRunner();
  const ctx = new MockCtxAdapter({
    provisionSkills: ["fastapi-patterns"],
    capabilities: { mcps: ["local-ollama-files"], harnesses: ["autogen"] },
    harnessInstall: "ctx-harness-install autogen --dry-run",
    warnings: [],
  });
  const { events, onEvent } = collect();
  const outcome = await runDefinition(def, {
    runner, verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: process.cwd(), ctx, onEvent,
    ctxGrants: ["skills", "agents", "mcps", "harnesses"],
    ownModel: { provider: "ollama", model: "ollama/llama3.1" },
  });
  // The engine threads the file's grants + own model into the provision input.
  assert.deepEqual(ctx.provisionCalls[0].permissions, ["skills", "agents", "mcps", "harnesses"]);
  assert.deepEqual(ctx.provisionCalls[0].ownModel, { provider: "ollama", model: "ollama/llama3.1" });
  // Skills merge into the plan; mcps/harnesses are recommend-only and must NOT enter the skill set.
  assert.deepEqual(runner.planCalls[0].skills, ["fastapi-patterns"]);
  const ev = events.find((e) => e.type === "ctx" && e.action === "provision");
  assert.deepEqual(ev.mcps, ["local-ollama-files"]);
  assert.deepEqual(ev.harnesses, ["autogen"]);
  assert.equal(ev.harnessInstall, "ctx-harness-install autogen --dry-run");
  assert.equal(outcome.satisfied, true);
});
