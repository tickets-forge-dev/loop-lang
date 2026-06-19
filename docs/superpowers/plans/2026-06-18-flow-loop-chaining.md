# `flow` — Chaining Loops Across Files: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third top-level construct `flow` that runs a sequence of `.loop` files in order, fail-fast, carrying a text summary of each step forward as context for the next.

**Architecture:** A `flow` parses to a new IR node (`Flow` with `FlowStep[]`). The engine gains `executeFlow`, which loads each referenced file via an injected `loadFile`, runs the whole file with the existing `run()`, captures a text summary of the outcome, and threads it as `upstream` context into the next file's `plan` steps. Fail-fast and per-step human gates reuse the pipeline/stage machinery. Cycle detection uses a resolved-path stack threaded through `RunOptions`.

**Tech Stack:** TypeScript 5.5 (ESM, `"type": "module"`), Node ≥18, `node --test` (tests run against built `dist/`), hand-written line-oriented parser, JSON-Schema-as-source-of-truth IR.

## Global Constraints

- **IR is additive / backward-compatible.** Do NOT bump `LOOP_VERSION` (stays `"0.1"`). `flow` is a new member of the `definitions` `oneOf`; all new fields are optional.
- **Schema is the source of truth.** `spec/loop-spec.schema.json` and `packages/parser/src/types.ts` must stay in sync.
- **Tests run against `dist/`.** Every test step is: edit `src` → `npm run build` → run the package's tests. Tests import from `../dist/index.js`.
- **Handoff payload is text only.** No structured objects, no `$var` interpolation, no field-to-field wiring — that is the deliberate guardrail keeping Loop a control language, not a data-flow language.
- **Keep the keyword surface small.** New keywords: `flow`, `run`, `then`, `with the result of`. Nothing else.
- **Follow existing parser idioms:** `tokenizeLines` / `childrenOf` / `quoted`, `ParseError(message, lineNo)`, regex-per-construct.

---

### Task 1: Parser — `flow` IR, parsing, and example files

**Files:**
- Modify: `packages/parser/src/types.ts` (add `Flow`, `FlowStep`; extend `Definition`)
- Modify: `spec/loop-spec.schema.json` (add `flow` to `definitions.oneOf` + `$defs.flow`/`$defs.flowStep`)
- Modify: `packages/parser/src/parser.ts` (parse `flow`)
- Create: `examples/ship_flow.loop`, `examples/build.loop`, `examples/test.loop`, `examples/deploy.loop`
- Test: `packages/parser/test/parser.test.js` (add cases)

**Interfaces:**
- Produces: `Flow { kind:"flow"; name:string; steps:FlowStep[] }`, `FlowStep { ref:string; name:string; gate?:{message:string}|null; fromStep?:string }`. `Definition = Pipeline | Loop | Flow`. `parse()` emits `Flow` nodes for `flow "..."` blocks.

- [ ] **Step 1: Create the example files**

`examples/ship_flow.loop`:
```loop
flow "ship":
  run "build.loop"
  then run "test.loop"
  then run "deploy.loop":
    a human approves first
```

`examples/build.loop`:
```loop
loop "build":
  goal: feature builds and unit tests pass
  done when "pnpm build" passes
  look at: src, and the last failure
  allow edits automatically
  each cycle: plan, then act, then observe
  when it fails: reflect, then plan again
  after 6 tries: stop and warn "build thrashing"
```

`examples/test.loop`:
```loop
loop "test":
  goal: integration tests green
  done when "pnpm test" passes
  allow edits automatically
  each cycle: plan, then act, then observe
  when it fails: reflect, then plan again
  after 6 tries: stop and warn "tests thrashing"
```

`examples/deploy.loop`:
```loop
loop "deploy":
  goal: deployed and healthchecks green
  done when "./scripts/health.sh" passes
  each cycle: act, then observe
```

- [ ] **Step 2: Write the failing parser tests**

Append to `packages/parser/test/parser.test.js`:
```js
test("ship_flow: flow of files with handoff + gate", () => {
  const file = parse(read("ship_flow.loop"));
  const flow = file.definitions[0];
  assert.equal(flow.kind, "flow");
  assert.equal(flow.name, "ship");
  assert.deepEqual(flow.steps.map((s) => s.name), ["build", "test", "deploy"]);
  assert.deepEqual(flow.steps.map((s) => s.ref), ["build.loop", "test.loop", "deploy.loop"]);
  assert.ok(flow.steps[2].gate);
  assert.match(flow.steps[2].gate.message, /approve before/i);
});

test("flow: 'with the result of' overrides the handoff source", () => {
  const flow = parse('flow "f":\n  run "a.loop"\n  then run "b.loop"\n  then run "c.loop" with the result of a').definitions[0];
  assert.equal(flow.steps[2].fromStep, "a");
});

test("flow: a flow with no steps is a parse error", () => {
  assert.throws(() => parse('flow "f":'), /has no steps/);
});
```

- [ ] **Step 3: Run the tests — verify they fail**

Run: `npm run build -w @loop/parser && npm test -w @loop/parser`
Expected: FAIL — the new tests error (`flow.kind` undefined / unrecognized top-level line `flow "ship":`).

- [ ] **Step 4: Add the IR types**

In `packages/parser/src/types.ts`, change the `Definition` union and add the interfaces:
```ts
export type Definition = Pipeline | Loop | Flow;

export interface Flow {
  kind: "flow";
  name: string;
  steps: FlowStep[];
}

export interface FlowStep {
  /** File path as written, e.g. "test.loop". Resolved relative to the flow file. */
  ref: string;
  /** Step name = ref basename without extension, e.g. "test". Used for handoff + events. */
  name: string;
  /** Per-step blocking human gate ("a human approves first"). */
  gate?: { message: string } | null;
  /** "with the result of <name>" — pull upstream text from a named earlier step. */
  fromStep?: string;
}
```

- [ ] **Step 5: Add the parser**

In `packages/parser/src/parser.ts`, import the new types (add `Flow, FlowStep` to the import from `./types.js`). Add these functions after `parsePipeline`:
```ts
function parseFlowStep(lines: Line[], start: number): { step: FlowStep; next: number } {
  const header = lines[start];
  const m = header.text.match(/^(?:then\s+)?run\s+"([^"]+)"(?:\s+with the result of\s+(.+))?$/i);
  if (!m) throw new ParseError(`expected 'run "<file>"' in flow`, header.lineNo);
  const ref = m[1];
  const name = (ref.split("/").pop() ?? ref).replace(/\.loop$/i, "");
  const step: FlowStep = { ref, name };
  if (m[2]) step.fromStep = m[2].trim();
  const { body, next } = childrenOf(lines, start + 1, header.indent);
  for (const ln of body) {
    if (/^a human approves(?:\s+(?:the plan\s+)?first)?$/i.test(ln.text)) {
      step.gate = { message: `approve before ${name}` };
      continue;
    }
    const g = ln.text.match(/^a human approves before\s+(.+)$/i);
    if (g) {
      step.gate = { message: `approve before ${g[1].trim()}` };
      continue;
    }
    throw new ParseError(`unrecognized line in flow step "${name}": "${ln.text}"`, ln.lineNo);
  }
  return { step, next };
}

function parseFlow(lines: Line[], start: number): { flow: Flow; next: number } {
  const header = lines[start];
  const name = quoted(header.text) ?? header.text.replace(/^flow\s+/i, "").replace(/:$/, "").trim();
  const { body, next } = childrenOf(lines, start + 1, header.indent);
  const steps: FlowStep[] = [];
  let i = 0;
  while (i < body.length) {
    if (!/^(?:then\s+)?run\b/i.test(body[i].text)) {
      throw new ParseError(`expected 'run "<file>"' inside flow "${name}"`, body[i].lineNo);
    }
    const { step, next: sn } = parseFlowStep(body, i);
    steps.push(step);
    i = sn;
  }
  if (steps.length === 0) throw new ParseError(`flow "${name}" has no steps`, header.lineNo);
  return { flow: { kind: "flow", name, steps }, next };
}
```

In the `parse()` dispatch loop, add a branch before the `parseConfigLine` fallback:
```ts
    } else if (/^flow\b/i.test(ln.text)) {
      const { flow, next } = parseFlow(lines, i);
      definitions.push(flow);
      i = next;
    } else if (parseConfigLine(config, ln)) {
```

- [ ] **Step 6: Update the JSON Schema**

In `spec/loop-spec.schema.json`, add `{ "$ref": "#/$defs/flow" }` to `properties.definitions.items.oneOf`, and add to `$defs`:
```json
"flow": {
  "type": "object",
  "additionalProperties": false,
  "required": ["kind", "name", "steps"],
  "properties": {
    "kind": { "const": "flow" },
    "name": { "type": "string" },
    "steps": {
      "type": "array",
      "description": "Files run in order, fail-fast; each step's text summary carries to the next.",
      "items": { "$ref": "#/$defs/flowStep" }
    }
  }
},
"flowStep": {
  "type": "object",
  "additionalProperties": false,
  "required": ["ref", "name"],
  "properties": {
    "ref": { "type": "string", "description": "File path as written, resolved relative to the flow file." },
    "name": { "type": "string", "description": "Step name = ref basename without extension." },
    "gate": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "properties": { "message": { "type": "string" } }
    },
    "fromStep": { "type": "string", "description": "'with the result of <name>' — upstream source override." }
  }
}
```

- [ ] **Step 7: Run the tests — verify they pass**

Run: `npm run build -w @loop/parser && npm test -w @loop/parser`
Expected: PASS — all parser tests including the three new ones.

- [ ] **Step 8: Commit**

```bash
git add packages/parser/src/types.ts packages/parser/src/parser.ts spec/loop-spec.schema.json packages/parser/test/parser.test.js examples/ship_flow.loop examples/build.loop examples/test.loop examples/deploy.loop
git commit -m "feat(parser): add flow construct for chaining loop files"
```

---

### Task 2: Runtime — outcome summary, plan upstream, flow events

**Files:**
- Modify: `packages/runtime/src/types.ts` (`LoopOutcome.summary`, `PlanInput.upstream`, `RunOptions` fields, flow `LoopEvent`s)
- Modify: `packages/runtime/src/engine.ts` (capture last output → summary; thread `opts.upstream` into `PlanInput`)
- Test: `packages/runtime/test/engine.test.js` (add cases)

**Interfaces:**
- Consumes: `Flow`, `FlowStep`, `LoopFile` from `@loop/parser` (Task 1).
- Produces: `LoopOutcome` gains `summary?: string`. `PlanInput` gains `upstream?: string`. `RunOptions` gains `loadFile?(path:string, baseDir:string): Promise<LoopFile>`, `upstream?: string`, `flowStack?: string[]`. `LoopEvent` gains `flow-start`, `flow-step-start`, `flow-step-end`, `flow-end`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/runtime/test/engine.test.js`:
```js
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
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `npm run build -w @loop/parser -w @loop/runtime && npm test -w @loop/runtime`
Expected: FAIL — `outcome.summary` is `undefined`; `runner.planCalls[0].upstream` is `undefined`.

- [ ] **Step 3: Extend the runtime types**

In `packages/runtime/src/types.ts`:

Add the flow events to the `LoopEvent` union (next to the pipeline events):
```ts
  | { type: "flow-start"; name: string }
  | { type: "flow-step-start"; name: string; ref: string }
  | { type: "flow-step-end"; name: string; satisfied: boolean }
  | { type: "flow-end"; name: string; satisfied: boolean }
```

Add `upstream` to `PlanInput`:
```ts
export interface PlanInput {
  goal: string;
  files: string[];
  includeLastFailure: boolean;
  reflection: string | null;
  /** Text summary handed from the previous step of a flow (set by executeFlow). */
  upstream?: string;
  baseDir: string;
}
```

Add `summary` to `LoopOutcome`:
```ts
export interface LoopOutcome {
  satisfied: boolean;
  reason: StopReason;
  attempts: number;
  /** Last observe output / reflection — used as the flow handoff text. */
  summary?: string;
}
```

Extend `RunOptions` (add after `archon?`):
```ts
  /** Loads + parses a referenced .loop file. Required only when a `flow` runs. */
  loadFile?(path: string, baseDir: string): Promise<import("@loop/parser").LoopFile>;
  /** Upstream handoff text injected into each plan step (set by executeFlow). */
  upstream?: string;
  /** Resolved file paths currently executing — for flow cycle detection. */
  flowStack?: string[];
```
(`LoopFile` is referenced inline to avoid a new top-level import; alternatively add `LoopFile` to the existing `import type { Loop, Predicate } from "@loop/parser"`.)

- [ ] **Step 4: Capture the summary and thread upstream in the engine**

In `packages/runtime/src/engine.ts`, inside `executeLoop`:

Add a function-scoped accumulator near `let lastPlan = "";`:
```ts
  let lastOutput = "";
```

In the `observe` branch, after `observeOutput = v.output;`, add:
```ts
        lastOutput = v.output;
```

Change `finish` to include the summary:
```ts
  const finish = (satisfied: boolean, reason: StopReason, warn?: string): LoopOutcome => {
    emit(opts, { type: "stop", reason, ...(warn ? { warn } : {}) });
    emit(opts, { type: "loop-end", name: loop.name, satisfied });
    return { satisfied, reason, attempts, summary: lastOutput };
  };
```

In the agent `plan` branch (the `else` after the archon check), pass `upstream`:
```ts
          lastPlan = await opts.runner.plan({
            goal: loop.goal,
            files,
            includeLastFailure,
            reflection,
            upstream: opts.upstream,
            baseDir: opts.baseDir,
          });
```

In `applyActions`, the `case "stop"` return — add the summary:
```ts
        return { satisfied, reason, attempts: -1, summary: ctx.output };
```

- [ ] **Step 5: Run the tests — verify they pass**

Run: `npm run build -w @loop/parser -w @loop/runtime && npm test -w @loop/runtime`
Expected: PASS — including the two new tests. Existing tests stay green.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/types.ts packages/runtime/src/engine.ts packages/runtime/test/engine.test.js
git commit -m "feat(runtime): outcome summary + plan upstream + flow events"
```

---

### Task 3: Engine — `executeFlow`, routing, cycle detection

**Files:**
- Modify: `packages/runtime/src/engine.ts` (`executeFlow`, route in `runDefinition`, import `node:path`)
- Test: `packages/runtime/test/engine.test.js` (add cases)

**Interfaces:**
- Consumes: `RunOptions.loadFile/upstream/flowStack`, `LoopOutcome.summary`, `PlanInput.upstream` (Task 2); `Flow` (Task 1).
- Produces: `executeFlow(flow, opts)` runs steps in order, fail-fast, threads handoff; `runDefinition` routes `kind:"flow"` to it.

- [ ] **Step 1: Write the failing tests**

Append to `packages/runtime/test/engine.test.js`:
```js
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
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `npm run build -w @loop/parser -w @loop/runtime && npm test -w @loop/runtime`
Expected: FAIL — `runDefinition` does not handle `kind:"flow"` (outcome undefined / throws "unknown definition").

- [ ] **Step 3: Implement `executeFlow` and route to it**

In `packages/runtime/src/engine.ts`, add the import at the top:
```ts
import { resolve, dirname, basename } from "node:path";
```

Add `executeFlow` after `executePipeline`:
```ts
async function executeFlow(flow: Flow, opts: RunOptions): Promise<LoopOutcome> {
  emit(opts, { type: "flow-start", name: flow.name });
  const stack = opts.flowStack ?? [];
  const summaries: Record<string, string> = {};
  let carried = opts.upstream; // upstream from a parent flow, if any

  for (const step of flow.steps) {
    emit(opts, { type: "flow-step-start", name: step.name, ref: step.ref });

    if (step.gate) {
      emit(opts, { type: "human", kind: "gate", prompt: step.gate.message });
      const ok = await opts.human.gate(step.gate.message);
      if (!ok) {
        emit(opts, { type: "flow-step-end", name: step.name, satisfied: false });
        emit(opts, { type: "flow-end", name: flow.name, satisfied: false });
        return { satisfied: false, reason: "blocked", attempts: 0 };
      }
    }

    const stepPath = resolve(opts.baseDir, step.ref);
    if (stack.includes(stepPath)) {
      const chain = [...stack, stepPath].map((p) => basename(p)).join(" -> ");
      throw new Error(`flow cycle: ${chain}`);
    }
    if (!opts.loadFile) {
      throw new Error(`flow "${flow.name}" runs "${step.ref}" but no file loader was provided`);
    }

    const subFile = await opts.loadFile(step.ref, opts.baseDir);
    const stepUpstream = step.fromStep ? summaries[step.fromStep] : carried;
    const outcomes = await run(subFile, {
      ...opts,
      baseDir: dirname(stepPath),
      flowStack: [...stack, stepPath],
      upstream: stepUpstream,
    });

    const satisfied = outcomes.every((o) => o.satisfied);
    const detail = outcomes.map((o) => o.summary).filter(Boolean).map((s) => "\n" + s).join("");
    const summary = `[${step.name}] ${satisfied ? "satisfied" : "FAILED"}${detail}`;
    summaries[step.name] = summary;
    carried = summary;

    emit(opts, { type: "flow-step-end", name: step.name, satisfied });
    if (!satisfied) {
      emit(opts, { type: "flow-end", name: flow.name, satisfied: false });
      return { satisfied: false, reason: "blocked", attempts: 0, summary };
    }
  }

  emit(opts, { type: "flow-end", name: flow.name, satisfied: true });
  return { satisfied: true, reason: "done", attempts: 0 };
}
```

Add the import of `Flow` to the existing `@loop/parser` import line at the top of the file:
```ts
import type { Loop, Pipeline, Flow, Definition, Transition, Action, LoopFile } from "@loop/parser";
```

Route it in `runDefinition`:
```ts
export async function runDefinition(def: Definition, opts: RunOptions): Promise<LoopOutcome> {
  if (def.kind === "pipeline") return executePipeline(def, opts);
  if (def.kind === "flow") return executeFlow(def, opts);
  const outcome = await executeLoopFull(def, opts);
  await writeBackArchon(def, opts, outcome.satisfied);
  return outcome;
}
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `npm run build -w @loop/parser -w @loop/runtime && npm test -w @loop/runtime`
Expected: PASS — all five flow tests plus the existing suite.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine.ts packages/runtime/test/engine.test.js
git commit -m "feat(runtime): executeFlow — chain loop files with text handoff + cycle detection"
```

---

### Task 4: Claude runner — inject upstream into the plan prompt

**Files:**
- Modify: `packages/runtime/src/runners/claudeCode.ts` (extract + export `buildPlanPrompt`, include `upstream`)
- Modify: `packages/runtime/src/index.ts` (export `buildPlanPrompt`)
- Test: `packages/runtime/test/runners.test.js` (create)

**Interfaces:**
- Consumes: `PlanInput.upstream` (Task 2).
- Produces: `buildPlanPrompt(input: PlanInput): string` — pure, exported.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/runners.test.js`:
```js
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
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm run build -w @loop/parser -w @loop/runtime && npm test -w @loop/runtime`
Expected: FAIL — `buildPlanPrompt` is not exported (`SyntaxError`/`undefined`).

- [ ] **Step 3: Extract and export `buildPlanPrompt`**

In `packages/runtime/src/runners/claudeCode.ts`, add the exported function (above the `ClaudeCodeRunner` class):
```ts
/** Build the plan-step prompt. Pure + exported so it can be tested without spawning. */
export function buildPlanPrompt(input: PlanInput): string {
  const ctx: string[] = [];
  if (input.files.length) ctx.push(`Relevant files: ${input.files.join(", ")}.`);
  if (input.includeLastFailure) ctx.push("Account for the most recent failure.");
  if (input.reflection) ctx.push(`From the last attempt: ${input.reflection}`);
  if (input.upstream) ctx.push(`From the previous step in the flow:\n${input.upstream}`);
  return [
    `Goal: ${input.goal}.`,
    ...ctx,
    "Produce a concise, concrete step-by-step plan to achieve the goal. Do not edit files yet.",
  ].join("\n");
}
```

Replace the body of `ClaudeCodeRunner.plan` to use it:
```ts
  async plan(input: PlanInput): Promise<string> {
    const prompt = buildPlanPrompt(input);
    return this.run(prompt, ["--permission-mode", "plan", "--allowedTools", ...READ_TOOLS], input.baseDir, "plan");
  }
```

In `packages/runtime/src/index.ts`, add `buildPlanPrompt` to the claudeCode export:
```ts
export { ClaudeCodeRunner, interpretStreamLine, buildPlanPrompt } from "./runners/claudeCode.js";
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npm run build -w @loop/parser -w @loop/runtime && npm test -w @loop/runtime`
Expected: PASS — both new tests; existing suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/runners/claudeCode.ts packages/runtime/src/index.ts packages/runtime/test/runners.test.js
git commit -m "feat(runtime): surface flow upstream in the Claude plan prompt"
```

---

### Task 5: CLI — wire the real file loader and render flow events

**Files:**
- Modify: `packages/runtime/src/cli.ts` (real `loadFile`, seed `flowStack`, render flow events + glyphs)

**Interfaces:**
- Consumes: `RunOptions.loadFile/flowStack` (Task 2), the four flow `LoopEvent`s (Task 2), `executeFlow` routing (Task 3).
- Produces: `loop run|parse|viz` work on a `flow`.

- [ ] **Step 1: Add a real `loadFile` and seed the flow stack**

In `packages/runtime/src/cli.ts`, add a loader (after `const baseDir = dirname(path);`):
```ts
  const loadFile = (ref: string, dir: string) =>
    Promise.resolve(parse(readFileSync(resolve(dir, ref), "utf8")));
```

Pass `loadFile` and `flowStack: [path]` into **both** `run(...)` calls (the `--events` branch and the default branch). For example, the default branch becomes:
```ts
  const outcomes = await run(file, {
    runner: new ClaudeCodeRunner({ model }),
    verifier: new ShellVerifier(),
    human: new CliHumanIO(),
    archon,
    baseDir: target,
    loadFile,
    flowStack: [path],
    onEvent: (e) => {
      const line = render(e);
      if (line) console.log(line);
    },
  });
```
Add the same `loadFile,` and `flowStack: [path],` lines to the `--events` branch's `run(...)` options.

- [ ] **Step 2: Render the flow events**

In the `render(e)` switch in `cli.ts`, add cases:
```ts
    case "flow-start":
      return `→ flow "${e.name}"`;
    case "flow-step-start":
      return `  ▸ ${e.name} (${e.ref})`;
    case "flow-step-end":
      return `  ▸ ${e.name} → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "flow-end":
      return `→ flow "${e.name}" → ${e.satisfied ? "satisfied" : "FAILED"}`;
```
(Optional: add `"flow-start": "→ flow"` to the `GLYPH` map for consistency; not required for `render`.)

- [ ] **Step 3: Verify the CLI parses and visualizes a flow**

Run:
```bash
npm run build -w @loop/parser -w @loop/runtime
node packages/runtime/dist/cli.js parse examples/ship_flow.loop
```
Expected: JSON IR with `"kind": "flow"`, three `steps`, and `steps[2].gate` set. (A full `loop run` needs the `claude` binary + real repo, so it is exercised manually, not in this step.)

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/src/cli.ts
git commit -m "feat(cli): run/parse flows — real file loader + flow event trace"
```

---

### Task 6: Surfaces — viz, VSCode grammar, docs

**Files:**
- Modify: `packages/viz/src/render.ts` (render a `flow` panel)
- Modify: `packages/vscode/syntaxes/loop.tmLanguage.json` (highlight `flow`/`run`/`then`)
- Modify: `packages/vscode/src/extension.ts` (Run CodeLens header + trace lines)
- Modify: `README.md`, `AGENTS.md`, `docs/MANUAL.md` (document `flow`)

**Interfaces:**
- Consumes: `Flow`/`FlowStep` IR (Task 1), flow `LoopEvent`s (Task 2).
- Produces: a `flow` renders in `loop viz`, highlights + a Run lens in VSCode, and is documented.

- [ ] **Step 1: Render a flow in the viz**

In `packages/viz/src/render.ts`, inside the `RENDERER_JS` string's `panel(def,oy)` function, add a `flow` branch. After the `if(def.kind==="pipeline"){ ... }` block and before the closing `}else{`, change `}else{` to `}else if(def.kind==="flow"){` with this body, then keep the original loop `else`:
```js
  }else if(def.kind==="flow"){
    s+=E("text",{x:34,y:oy+18,class:"panel-title","font-size":18},esc("\\u2192 "+name));
    var fx=60,fy=top+8,steps=def.steps||[],j;
    for(j=0;j<steps.length;j++){
      if(j>0)s+=fwd(fx-GAP,fy+NH/2,fx);
      s+=node(fx,fy,trunc(steps[j].name,12),"var(--fwd)");
      if(steps[j].gate)s+=diamond(fx+NW/2,fy-18,"gate");
      fx+=NW+GAP;
    }
    width=fx;bottom=fy+NH+40;
  }else{
```
(The final `else` block — the standalone-loop renderer — is unchanged.)

- [ ] **Step 2: Verify the viz renders**

Run:
```bash
npm run build -w @loop/parser -w @loop/viz -w @loop/runtime
node packages/runtime/dist/cli.js viz examples/ship_flow.loop --out /tmp/ship_flow.html
```
Expected: `wrote /tmp/ship_flow.html`; the file contains `"kind":"flow"` in the embedded SPEC. (Open it to eyeball the chain.)

- [ ] **Step 3: Update the VSCode grammar and extension**

In `packages/vscode/syntaxes/loop.tmLanguage.json`:
- `structure.match` → `"\\b(pipeline|stage|loop|flow)\\b"`
- `flow.match` → add `run` and `then`: `"(?i)\\b(when|after|reflect|stop|warn|plan|act|observe|tries|run|then)\\b"`

In `packages/vscode/src/extension.ts`:
- Line 8: `const HEADER = /^(loop|pipeline|flow)\b/;`
- In the `traceLine`/event-render switch (mirrors the CLI), add the four flow cases (same strings as Task 5 Step 2):
```ts
    case "flow-start": return `→ flow "${e.name}"`;
    case "flow-step-start": return `  ▸ ${e.name} (${e.ref})`;
    case "flow-step-end": return `  ▸ ${e.name} → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "flow-end": return `→ flow "${e.name}" → ${e.satisfied ? "satisfied" : "FAILED"}`;
```

- [ ] **Step 4: Document `flow`**

- `README.md`: in the keyword list (the "~15 words" section), add `flow` and `run … then …`. Add a short example block mirroring `examples/ship_flow.loop` with one line on text-handoff semantics.
- `AGENTS.md`: add a `flow` entry to the language reference: the `run "<file>"` / `then run "<file>"` grammar, `with the result of <name>`, per-step `a human approves first`, "runs the whole file", fail-fast, and text-only handoff.
- `docs/MANUAL.md`: add a "Chaining loops across files" subsection covering the same.

- [ ] **Step 5: Full build + test, then commit**

Run: `npm run build && npm test`
Expected: all workspace tests pass.
```bash
git add packages/viz/src/render.ts packages/vscode/syntaxes/loop.tmLanguage.json packages/vscode/src/extension.ts README.md AGENTS.md docs/MANUAL.md
git commit -m "feat: flow surfaces — viz chain, VSCode highlight/lens, docs"
```

---

## Self-Review

**Spec coverage:**
- New `flow` construct → Task 1 ✓
- Run whole file, fail-fast → Task 3 (`executeFlow` uses `run()`, halts on unsatisfied) ✓
- Text handoff, auto-carry + `with the result of` → Task 2 (summary, upstream) + Task 3 (carry logic) ✓
- Summary capture (LoopOutcome.summary) → Task 2 ✓
- Per-step human gate → Task 1 (parse) + Task 3 (enforce) ✓
- File loader DI → Task 2 (type) + Task 3 (use) + Task 5 (real impl) ✓
- Cycle detection → Task 3 ✓
- Upstream in plan prompt → Task 4 ✓
- Flow events → Task 2 (types) + Task 5 (CLI) + Task 6 (VSCode) ✓
- IR/schema → Task 1 ✓
- viz / VSCode / docs / example → Task 1 (example) + Task 6 ✓
- Testing (parser, engine, runner, e2e parse/viz) → Tasks 1–6 ✓

**Placeholder scan:** none — every code/step shows actual content.

**Type consistency:** `Flow`/`FlowStep` field names (`ref`, `name`, `gate`, `fromStep`) consistent across types.ts, schema, parser, engine, tests. `loadFile(ref, baseDir)` signature consistent (engine calls `opts.loadFile(step.ref, opts.baseDir)`; CLI defines `(ref, dir)`). `LoopOutcome.summary` and `PlanInput.upstream` used consistently. Flow events (`flow-start/step-start/step-end/end`) identical in types, CLI, and VSCode.
