# LLM model-tiering policy (`models:`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `models:` policy so a `.loop` runs cheap phases (plan/reflect/also) on a fast model and `act` on a strong model, with cascade + override and a per-tier cost summary.

**Architecture:** Mirror the existing `git:` policy end-to-end. Parser turns a `models:` line into a sparse `ModelPolicy` IR on `config` and `loop`. A pure resolver (`models.ts`, twin of `git.ts`) layers file→loop over built-in defaults. The engine resolves an effective policy per loop and sets a per-call `model` on each runner node; the runner is a dumb pass-through. A pure summarizer tallies calls per tier for an end-of-run cost report.

**Tech Stack:** TypeScript (ES modules), Node built-in test runner (`node --test`, tests run against built `dist/`), npm workspaces (`@loop/parser`, `@loop/runtime`), JSON Schema (`spec/loop-spec.schema.json`).

## Global Constraints

- Loop spec version stays `0.1`; the JSON Schema (`spec/loop-spec.schema.json`) is the source of truth and the TS types in `packages/parser/src/types.ts` mirror it — keep both in sync.
- Tier names are exactly `fast` and `strong`; `all` is an override keyword. No other tier names.
- Phases that take a model: `plan`, `act`, `reflect`, `also`. `observe` is a shell verifier — never gets a model.
- Built-in phase→tier defaults: `plan→fast, act→strong, reflect→fast, also→fast`.
- Resolution precedence (most specific wins): built-in defaults → file `models:` → loop `models:` (stage-level lands on the stage's inner loop) → CLI `--model`/`loop.model` (kill switch, forces all phases).
- Tier values are pass-through model aliases/ids — never validated against a model list.
- No `models:` block anywhere → behavior unchanged (single default model). Backward-compatible.
- Tests run against compiled output: `npm run build` (tsc) before `node --test`.
- Commit message trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Work happens on branch `spec/llm-policy` (already created; the design spec is committed there).

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `spec/loop-spec.schema.json` | `modelPolicy` `$def` + attach to config & loop | 1 |
| `packages/parser/src/types.ts` | `ModelPolicy` interface; `models?` on `Config` + `Loop` | 1 |
| `packages/parser/src/parser.ts` | `parseModelsLine` + detect `models:` at loop & config scope | 1 |
| `packages/parser/test/parser.test.js` | parse + error cases | 1 |
| `packages/runtime/src/models.ts` | `resolveModels` + `modelForPhase` (pure) | 2 |
| `packages/runtime/src/index.ts` | export the resolver | 2 |
| `packages/runtime/test/models.test.js` | resolver unit tests | 2 |
| `packages/runtime/src/types.ts` | `model?` on runner inputs; `modelPolicy`/`cliModel` on `RunOptions`; `model` event | 3,4 |
| `packages/runtime/src/runners/claudeCode.ts` | pure `claudeArgs`; per-call model | 3 |
| `packages/runtime/test/runners.test.js` | `claudeArgs` model on/off | 3 |
| `packages/runtime/src/engine.ts` | resolve per loop; set node model; emit `model` event; tally | 4,5 |
| `packages/runtime/src/cli.ts` | pass `cliModel` + `modelPolicy`; drop model from runner ctor | 4 |
| `packages/runtime/test/engine.test.js` | per-node model + kill switch | 4 |
| `packages/runtime/src/summary.ts` | pure `summarizeModels(events)` | 5 |
| `packages/runtime/test/summary.test.js` | summary tally | 5 |
| `AGENTS.md`, `docs/tutorial.html`, `docs/MANUAL.md` | grammar + tutorial section + diagram + cheat sheet | 6 |

---

### Task 1: Parse `models:` → IR (parser + schema)

**Files:**
- Modify: `packages/parser/src/types.ts`
- Modify: `packages/parser/src/parser.ts`
- Modify: `spec/loop-spec.schema.json`
- Test: `packages/parser/test/parser.test.js`

**Interfaces:**
- Produces: `ModelPolicy` (`{ tiers?: { fast?: string; strong?: string }; phases?: { plan?: Tier; act?: Tier; reflect?: Tier; also?: Tier } }` where `Tier = "fast"|"strong"`), `Config.models?`, `Loop.models?`, and `parseModelsLine(text: string, lineNo: number): ModelPolicy`.

- [ ] **Step 1: Write the failing test** — append to `packages/parser/test/parser.test.js`:

```js
import { parse } from "../dist/index.js"; // (already imported at top; do not duplicate)

test("models: parses tiers + auto-assign on config", () => {
  const f = parse(`models: fast haiku, strong opus\n\nloop "x":\n  goal: g\n  done when "true" passes\n`);
  assert.deepEqual(f.config.models, { tiers: { fast: "haiku", strong: "opus" } });
});

test("models: per-phase override + all shorthand on a loop", () => {
  const f = parse(`loop "x":\n  goal: g\n  done when "true" passes\n  models: act fast, plan strong\n`);
  assert.deepEqual(f.definitions[0].models, { phases: { act: "fast", plan: "strong" } });
  const g = parse(`loop "y":\n  goal: g\n  done when "true" passes\n  models: all strong\n`);
  assert.deepEqual(g.definitions[0].models, { phases: { plan: "strong", act: "strong", reflect: "strong", also: "strong" } });
});

test("models: unknown phase or tier is a parse error", () => {
  assert.throws(() => parse(`loop "x":\n  goal: g\n  done when "true" passes\n  models: paln strong\n`), /unrecognized clause/i);
  assert.throws(() => parse(`models: fast haiku, mid opus\n\nloop "x":\n  goal: g\n  done when "true" passes\n`), /unrecognized clause/i);
});

test("models: observe tier is ignored (no observe model)", () => {
  const f = parse(`loop "x":\n  goal: g\n  done when "true" passes\n  models: observe fast, act strong\n`);
  assert.deepEqual(f.definitions[0].models, { phases: { act: "strong" } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/parser && npm run build && node --test test/parser.test.js`
Expected: FAIL — `f.config.models` is `undefined` / no `models:` handling.

- [ ] **Step 3: Add the IR types** — in `packages/parser/src/types.ts`, add after the `GitPolicy` interface (around line 22):

```ts
export type ModelTier = "fast" | "strong";
export type ModelPhase = "plan" | "act" | "reflect" | "also";
export interface ModelPolicy {
  tiers?: { fast?: string; strong?: string };
  phases?: Partial<Record<ModelPhase, ModelTier>>;
}
```

Then add `models?: ModelPolicy;` to `Config` (after `git?: GitPolicy;`, line ~31) and to `Loop` (after `git?: GitPolicy;`, line ~66).

- [ ] **Step 4: Add the parser** — in `packages/parser/src/parser.ts`, import `ModelPolicy` in the existing `@loop/parser`/types import block at the top (the file already imports `GitPolicy` at line 8 — add `ModelPolicy` beside it). Then add this function next to `parseGitBlock` (around line 218):

```ts
const MODEL_PHASES = ["plan", "act", "reflect", "also"] as const;

export function parseModelsLine(text: string, lineNo: number): ModelPolicy {
  const policy: ModelPolicy = {};
  for (const raw of text.split(",")) {
    const clause = raw.trim();
    if (!clause) continue;
    const parts = clause.split(/\s+/);
    const head = parts[0].toLowerCase();
    const tierAt = (i: number) => {
      const t = parts[i]?.toLowerCase();
      return t === "fast" || t === "strong" ? t : undefined;
    };
    if (head === "all") {
      const tier = tierAt(1);
      if (parts.length !== 2 || !tier) throw new ParseError(`models: "all" needs a tier (fast|strong): "${clause}"`, lineNo);
      policy.phases = { plan: tier, act: tier, reflect: tier, also: tier };
    } else if (head === "fast" || head === "strong") {
      if (parts.length !== 2) throw new ParseError(`models: tier "${head}" needs one model: "${clause}"`, lineNo);
      (policy.tiers ??= {})[head] = parts[1];
    } else if ((MODEL_PHASES as readonly string[]).includes(head)) {
      const tier = tierAt(1);
      if (parts.length !== 2 || !tier) throw new ParseError(`models: phase "${head}" needs a tier (fast|strong): "${clause}"`, lineNo);
      (policy.phases ??= {})[head as (typeof MODEL_PHASES)[number]] = tier;
    } else if (head === "observe") {
      continue; // observe runs a shell command — no model. ignored.
    } else {
      throw new ParseError(`models: unrecognized clause "${clause}"`, lineNo);
    }
  }
  return policy;
}
```

- [ ] **Step 5: Wire detection at both scopes** — in `packages/parser/src/parser.ts`:

In the loop body loop, immediately after the `git:` branch (after line 245), add:

```ts
    if ((m = t.match(/^models:\s*(.+)$/i))) {
      loop.models = parseModelsLine(m[1], ln.lineNo);
      i++; continue;
    }
```

In the top-level config parsing, add a branch before `else if (parseConfigLine(config, ln))` (line ~507):

```ts
    } else if (/^models:\s*.+$/i.test(ln.text)) {
      config.models = parseModelsLine(ln.text.replace(/^models:\s*/i, ""), ln.lineNo);
      i++;
```

- [ ] **Step 6: Update the schema** — in `spec/loop-spec.schema.json`, add to `$defs` (alongside `gitPolicy`):

```jsonc
"modelPolicy": {
  "type": "object",
  "additionalProperties": false,
  "description": "Per-phase model tiering. Two tiers (fast/strong) auto-assigned by phase; cascades file→loop→stage.",
  "properties": {
    "tiers": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "fast": { "type": "string", "description": "model alias/id for the fast tier" },
        "strong": { "type": "string", "description": "model alias/id for the strong tier" }
      }
    },
    "phases": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "plan": { "type": "string", "enum": ["fast", "strong"] },
        "act": { "type": "string", "enum": ["fast", "strong"] },
        "reflect": { "type": "string", "enum": ["fast", "strong"] },
        "also": { "type": "string", "enum": ["fast", "strong"] }
      }
    }
  }
}
```

Then add `"models": { "$ref": "#/$defs/modelPolicy" }` to the **root config** object's `properties` (beside its `"git"`) and to the **`loop`** `$def`'s `properties` (beside its `"git"`).

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/parser && npm run build && node --test test/parser.test.js`
Expected: PASS (all model tests + existing tests).

- [ ] **Step 8: Commit**

```bash
git add packages/parser/src/types.ts packages/parser/src/parser.ts spec/loop-spec.schema.json packages/parser/test/parser.test.js
git commit -m "feat(parser): parse models: tiering policy into the IR

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure resolver `models.ts`

**Files:**
- Create: `packages/runtime/src/models.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/models.test.js`

**Interfaces:**
- Consumes: `ModelPolicy` from `@loop/parser` (Task 1).
- Produces: `EffectiveModels` (`{ phases: Record<Phase, Tier>; tiers: { fast?: string; strong?: string } }`), `resolveModels(...levels: (ModelPolicy|null|undefined)[]): EffectiveModels`, `modelForPhase(eff: EffectiveModels, phase: Phase, cliModel?: string): string | undefined`, `BUILTIN_PHASES`. `Phase = "plan"|"act"|"reflect"|"also"`, `Tier = "fast"|"strong"`.

- [ ] **Step 1: Write the failing test** — create `packages/runtime/test/models.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npm run build && node --test test/models.test.js`
Expected: FAIL — `resolveModels` not exported.

- [ ] **Step 3: Implement the resolver** — create `packages/runtime/src/models.ts`:

```ts
import type { ModelPolicy } from "@loop/parser";

export type Tier = "fast" | "strong";
export type Phase = "plan" | "act" | "reflect" | "also";

export interface EffectiveModels {
  phases: Record<Phase, Tier>;
  tiers: { fast?: string; strong?: string };
}

export const BUILTIN_PHASES: Record<Phase, Tier> = { plan: "fast", act: "strong", reflect: "fast", also: "fast" };

export function resolveModels(...levels: (ModelPolicy | null | undefined)[]): EffectiveModels {
  const eff: EffectiveModels = { phases: { ...BUILTIN_PHASES }, tiers: {} };
  for (const lvl of levels) {
    if (!lvl) continue;
    if (lvl.tiers) {
      if (lvl.tiers.fast !== undefined) eff.tiers.fast = lvl.tiers.fast;
      if (lvl.tiers.strong !== undefined) eff.tiers.strong = lvl.tiers.strong;
    }
    if (lvl.phases) {
      for (const k of Object.keys(lvl.phases) as Phase[]) {
        const v = lvl.phases[k];
        if (v !== undefined) eff.phases[k] = v;
      }
    }
  }
  return eff;
}

export function modelForPhase(eff: EffectiveModels, phase: Phase, cliModel?: string): string | undefined {
  if (cliModel) return cliModel;
  return eff.tiers[eff.phases[phase]];
}
```

- [ ] **Step 4: Export it** — in `packages/runtime/src/index.ts`, add:

```ts
export { resolveModels, modelForPhase, BUILTIN_PHASES } from "./models.js";
export type { EffectiveModels, Tier, Phase } from "./models.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/runtime && npm run build && node --test test/models.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/models.ts packages/runtime/src/index.ts packages/runtime/test/models.test.js
git commit -m "feat(runtime): resolveModels/modelForPhase tier resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Per-call model on the runner

**Files:**
- Modify: `packages/runtime/src/types.ts`
- Modify: `packages/runtime/src/runners/claudeCode.ts`
- Test: `packages/runtime/test/runners.test.js`

**Interfaces:**
- Produces: `model?: string` on `PlanInput`, `ActInput`, `ReflectInput`; pure `claudeArgs(o: { stream: boolean; baseDir: string; model?: string; maxTurns?: number; flags: string[] }): string[]` exported from `claudeCode.ts` and re-exported via `index.ts`.
- Consumes: nothing new. `MockRunner` already records full inputs, so `model` is auto-recorded — no mock change.

- [ ] **Step 1: Write the failing test** — append to `packages/runtime/test/runners.test.js` (add `claudeArgs` to its existing `../dist/index.js` import):

```js
test("claudeArgs includes --model only when a model is given", () => {
  const withModel = claudeArgs({ stream: false, baseDir: "/x", model: "opus", flags: [] });
  assert.ok(withModel.includes("--model"));
  assert.equal(withModel[withModel.indexOf("--model") + 1], "opus");

  const noModel = claudeArgs({ stream: false, baseDir: "/x", flags: [] });
  assert.ok(!noModel.includes("--model"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npm run build && node --test test/runners.test.js`
Expected: FAIL — `claudeArgs` is not exported.

- [ ] **Step 3: Add `model?` to the runner inputs** — in `packages/runtime/src/types.ts`, add `model?: string;` to `PlanInput` (after `baseDir`), `ActInput` (after `baseDir`), and `ReflectInput` (after `baseDir`). Add a one-line doc comment on each: `/** Model alias/id for this call; set by the engine from the model policy. */`.

- [ ] **Step 4: Extract `claudeArgs` and thread the model** — in `packages/runtime/src/runners/claudeCode.ts`:

Add this exported pure function (near the existing `buildPlanPrompt` export):

```ts
export function claudeArgs(o: { stream: boolean; baseDir: string; model?: string; maxTurns?: number; flags: string[] }): string[] {
  const args = ["--add-dir", o.baseDir, "--output-format", o.stream ? "stream-json" : "json"];
  if (o.stream) args.push("--verbose");
  if (o.model) args.push("--model", o.model);
  if (o.maxTurns) args.push("--max-turns", String(o.maxTurns));
  args.push(...o.flags);
  return args;
}
```

Change the private `run` signature to accept a per-call model and use `claudeArgs`:

```ts
  private run(prompt: string, flags: string[], baseDir: string, node: AgentNode, model?: string): Promise<string> {
    const bin = this.opts.bin ?? "claude";
    const stream = !!this.opts.onActivity;
    const args = ["-p", prompt, ...claudeArgs({ stream, baseDir, model: model ?? this.opts.model, maxTurns: this.opts.maxTurns, flags })];
    // ...rest of run() unchanged (spawn, stream handling)...
```

(Delete the old inline `const args = [...]` / `args.push(...)` block that this replaces — lines ~135-140.)

Pass `input.model` from each node:

```ts
  async plan(input: PlanInput): Promise<string> {
    const prompt = buildPlanPrompt(input);
    return this.run(prompt, ["--permission-mode", "plan", "--allowedTools", ...READ_TOOLS], input.baseDir, "plan", input.model);
  }
```

Do the same for `act` (pass `input.model` as the 5th arg of its `this.run(...)`) and `reflect`.

- [ ] **Step 5: Re-export `claudeArgs`** — in `packages/runtime/src/index.ts`, add `claudeArgs` to the existing `export { ClaudeCodeRunner, interpretStreamLine, buildPlanPrompt } from "./runners/claudeCode.js";` line.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/runtime && npm run build && node --test test/runners.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/types.ts packages/runtime/src/runners/claudeCode.ts packages/runtime/src/index.ts packages/runtime/test/runners.test.js
git commit -m "feat(runtime): per-call model on runner inputs + pure claudeArgs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Engine wiring — resolve per loop, assign per-node model

**Files:**
- Modify: `packages/runtime/src/types.ts`
- Modify: `packages/runtime/src/engine.ts`
- Modify: `packages/runtime/src/cli.ts`
- Test: `packages/runtime/test/engine.test.js`

**Interfaces:**
- Consumes: `resolveModels`, `modelForPhase` (Task 2); `model?` on runner inputs (Task 3); `Loop.models` + `Config.models` (Task 1).
- Produces: `RunOptions.modelPolicy?: ModelPolicy`, `RunOptions.cliModel?: string`; `LoopEvent` variant `{ type: "model"; node: "plan"|"act"|"reflect"|"also"; tier: "fast"|"strong"; model?: string }`.

- [ ] **Step 1: Write the failing test** — append to `packages/runtime/test/engine.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npm run build && node --test test/engine.test.js`
Expected: FAIL — `planCalls[0].model` is `undefined` (engine sets no model).

- [ ] **Step 3: Extend `RunOptions` + `LoopEvent`** — in `packages/runtime/src/types.ts`:

Add to `RunOptions` (after `gitPolicy?`):

```ts
  /** File-level model policy resolved from config.models. */
  modelPolicy?: import("@loop/parser").ModelPolicy;
  /** CLI/extension --model — kill switch that forces all phases to one model. */
  cliModel?: string;
```

Add to the `LoopEvent` union:

```ts
  | { type: "model"; node: "plan" | "act" | "reflect" | "also"; tier: "fast" | "strong"; model?: string }
```

- [ ] **Step 4: Resolve + assign in the engine** — in `packages/runtime/src/engine.ts`:

At the top, add the import: `import { resolveModels, modelForPhase } from "./models.js";`

Inside the function that runs a single loop (the one holding the cycle with `opts.runner.plan/act/reflect` at lines ~111/145/226 and the `also` pass at ~401), compute once near the top of that function, after `loop` is in scope:

```ts
  const eff = resolveModels(opts.modelPolicy, loop.models);
  const pick = (phase) => modelForPhase(eff, phase, opts.cliModel); // phase: "plan"|"act"|"reflect"|"also"
```

Then at each runner call, add `model` to the constructed input and emit a `model` event right before:

- plan (~111):
```ts
  emit(opts, { type: "model", node: "plan", tier: eff.phases.plan, model: pick("plan") });
  lastPlan = await opts.runner.plan({ /* ...existing fields... */ model: pick("plan") });
```
- act (~145 and the second act site ~401):
```ts
  emit(opts, { type: "model", node: "act", tier: eff.phases.act, model: pick("act") });
  const res = await opts.runner.act({ /* ...existing fields... */ model: pick("act") });
```
- reflect (~226):
```ts
  emit(opts, { type: "model", node: "reflect", tier: eff.phases.reflect, model: pick("reflect") });
  const text = await opts.runner.reflect({ /* ...existing fields... */ model: pick("reflect") });
```
- `also` finishing pass (~401 `runAlso`): the `also` passes call `opts.runner.act({...})`. There `eff` must be in scope — `runAlso` takes `loop` + `opts`, so compute `const eff = resolveModels(opts.modelPolicy, loop.models);` at its top too, and:
```ts
  emit(opts, { type: "model", node: "also", tier: eff.phases.also, model: modelForPhase(eff, "also", opts.cliModel) });
  const res = await opts.runner.act({ /* ...existing... */ model: modelForPhase(eff, "also", opts.cliModel) });
```

> Note: `observe` (the verifier) is untouched — it never gets a model.

- [ ] **Step 5: Wire the CLI** — in `packages/runtime/src/cli.ts`:

The two `new ClaudeCodeRunner({ model, ... })` calls (lines ~170 and ~188) — remove `model` from the constructor (leave the rest). In the two `run(file, { ... })` option objects, add:

```ts
      modelPolicy: file.config?.models,
      cliModel: model,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/runtime && npm run build && node --test test/engine.test.js`
Expected: PASS (new model tests + all existing engine tests still green).

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/types.ts packages/runtime/src/engine.ts packages/runtime/src/cli.ts packages/runtime/test/engine.test.js
git commit -m "feat(runtime): engine assigns per-node tier model; --model kill switch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Cost summary — per-tier call tally

**Files:**
- Create: `packages/runtime/src/summary.ts`
- Modify: `packages/runtime/src/index.ts`
- Modify: `packages/runtime/src/cli.ts`
- Test: `packages/runtime/test/summary.test.js`

**Interfaces:**
- Consumes: `LoopEvent` (Task 4 `model` events).
- Produces: `summarizeModels(events: LoopEvent[]): TierSummary[]` where `TierSummary = { tier: "fast"|"strong"; model?: string; calls: number; byNode: Record<string, number> }`, and `formatModelSummary(s: TierSummary[]): string`.

- [ ] **Step 1: Write the failing test** — create `packages/runtime/test/summary.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeModels } from "../dist/index.js";

test("summarizeModels tallies calls per tier and node", () => {
  const events = [
    { type: "model", node: "plan", tier: "fast", model: "haiku" },
    { type: "model", node: "act", tier: "strong", model: "opus" },
    { type: "model", node: "reflect", tier: "fast", model: "haiku" },
    { type: "model", node: "plan", tier: "fast", model: "haiku" },
    { type: "observe", passed: true, output: "ok" },
  ];
  const s = summarizeModels(events);
  const fast = s.find((t) => t.tier === "fast");
  const strong = s.find((t) => t.tier === "strong");
  assert.equal(fast.calls, 3);
  assert.deepEqual(fast.byNode, { plan: 2, reflect: 1 });
  assert.equal(fast.model, "haiku");
  assert.equal(strong.calls, 1);
  assert.deepEqual(strong.byNode, { act: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npm run build && node --test test/summary.test.js`
Expected: FAIL — `summarizeModels` not exported.

- [ ] **Step 3: Implement** — create `packages/runtime/src/summary.ts`:

```ts
import type { LoopEvent } from "./types.js";

export interface TierSummary {
  tier: "fast" | "strong";
  model?: string;
  calls: number;
  byNode: Record<string, number>;
}

export function summarizeModels(events: LoopEvent[]): TierSummary[] {
  const acc: Record<string, TierSummary> = {};
  for (const e of events) {
    if (e.type !== "model") continue;
    const s = (acc[e.tier] ??= { tier: e.tier, model: e.model, calls: 0, byNode: {} });
    if (e.model && !s.model) s.model = e.model;
    s.calls++;
    s.byNode[e.node] = (s.byNode[e.node] ?? 0) + 1;
  }
  return Object.values(acc);
}

export function formatModelSummary(s: TierSummary[]): string {
  if (s.length === 0) return "";
  const total = s.reduce((n, t) => n + t.calls, 0);
  const lines = s.map((t) => {
    const nodes = Object.entries(t.byNode).map(([n, c]) => `${n} ×${c}`).join(", ");
    return `  ${t.tier}${t.model ? ` (${t.model})` : ""}: ${t.calls} call${t.calls === 1 ? "" : "s"}  ·  ${nodes}`;
  });
  return [`models — ${total} LLM call${total === 1 ? "" : "s"}:`, ...lines].join("\n");
}
```

- [ ] **Step 4: Export + print** — in `packages/runtime/src/index.ts` add:

```ts
export { summarizeModels, formatModelSummary } from "./summary.js";
export type { TierSummary } from "./summary.js";
```

In `packages/runtime/src/cli.ts`, collect events during the run (the non-`--events` `run(file, {...})` path at line ~187): add an `onEvent` that pushes into a local `const traceEvents = []`, and after the run completes print the summary:

```ts
  const summary = formatModelSummary(summarizeModels(traceEvents));
  if (summary) console.error(summary);
```

(Import `summarizeModels, formatModelSummary` from `./summary.js` at the top of `cli.ts`. If an `onEvent` already exists on that run-options object, push into `traceEvents` from inside it rather than adding a second.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/runtime && npm run build && node --test test/summary.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/summary.ts packages/runtime/src/index.ts packages/runtime/src/cli.ts packages/runtime/test/summary.test.js
git commit -m "feat(runtime): per-tier LLM call summary at end of run

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Docs — tutorial section, diagram, AGENTS.md, cheat sheet

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/tutorial.html`
- Modify: `docs/MANUAL.md`

No automated tests (docs). Verify by serving locally and eyeballing the new section + diagram.

- [ ] **Step 1: AGENTS.md grammar** — in `AGENTS.md`, in the config-tier grammar block (near the line `use the <method> method   schedule: <when>   runner: <agent>   target: <dir>`), add:

```
models: fast <model>, strong <model>   model tiering: plan/reflect/also→fast, act→strong (cascades; override e.g. `act fast`, `all strong`)
```

- [ ] **Step 2: Add the tutorial section + TOC entry** — in `docs/tutorial.html`, add a TOC entry in the **The engine** group (after `#transitions`):

```html
    <li><a href="#models">· Model policy</a></li>
```

Add the section after the transitions `</section>` (id `#transitions`), before `#also`:

```html
<section id="models">
  <h2>· Model policy — cheap where cheap is enough <span class="badge b-inter">intermediate</span></h2>
  <p>A loop is several LLM calls per cycle, so naively it could cost more than one prompt. The <code class="inl">models:</code> policy fixes that: name two tiers and the engine runs the cheap-thinking phases on the fast one and the hard <code class="inl">act</code> on the strong one — a stack of cheap calls plus one strong call, not N expensive prompts.</p>
  <pre><code class="loop">models: fast haiku, strong opus</code></pre>
  <p>Built-in mapping: <code class="inl">plan</code>, <code class="inl">reflect</code> and finishing <code class="inl">also</code> passes → <strong>fast</strong>; <code class="inl">act</code> → <strong>strong</strong>; <code class="inl">observe</code> is a shell check (no model). Override a phase or a whole scope, and it cascades file→loop→stage like the <a href="#git">git:</a> block:</p>
  <pre><code class="loop">models: fast haiku, strong opus, plan strong   # flip one phase
models: all strong                              # whole scope on one tier</code></pre>
  <p><code class="inl">--model X</code> (CLI) or <code class="inl">loop.model</code> (VS Code) is the kill switch — it forces every phase onto one model. At the end of a run Loop prints a per-tier call summary, so the spend is measurable, not a guess.</p>
</section>
```

- [ ] **Step 2b: Add a tiering diagram** — inside the new section, after the first `<pre>`, add a figure using the existing `.fig`/`.dg-*` system + shared markers already in the file (two lanes: plan/reflect/also on the fast lane, act on the strong lane):

```html
  <figure class="fig">
    <svg viewBox="0 0 720 150" role="img" aria-label="Phases split across a fast lane and a strong lane">
      <text class="dg-cap" x="360" y="14">ONE CYCLE — SPLIT ACROSS TWO MODEL TIERS</text>
      <text class="dg-el-g" x="70" y="52">fast lane</text>
      <rect class="dg-box dg-plan dg-fp" x="150" y="32" width="150" height="40" rx="9"/><text class="dg-lbl" x="225" y="57">plan</text>
      <rect class="dg-box dg-plan dg-fp" x="320" y="32" width="150" height="40" rx="9"/><text class="dg-lbl" x="395" y="57">reflect</text>
      <rect class="dg-box dg-plan dg-fp" x="490" y="32" width="150" height="40" rx="9"/><text class="dg-lbl" x="565" y="57">also</text>
      <text class="dg-el-p" x="70" y="112">strong lane</text>
      <rect class="dg-box dg-act dg-fa" x="150" y="92" width="150" height="40" rx="9"/><text class="dg-lbl" x="225" y="117">act</text>
      <text class="dg-sub" x="470" y="117">observe = shell check · no model</text>
    </svg>
    <figcaption>Cheap model for the thinking/▸summarizing phases, strong model for writing code. The end-of-run summary shows the call mix per tier.</figcaption>
  </figure>
```

- [ ] **Step 3: Cheat-sheet row** — in `docs/tutorial.html` `#cheatsheet`, add a row:

```html
    <tr><td><code>models:</code></td><td><code>models: fast haiku, strong opus</code> — tier models by phase; override <code>act fast</code> / <code>all strong</code>; cascades; <code>--model</code> overrides all.</td></tr>
```

- [ ] **Step 4: MANUAL.md** — add a short `## Model policy` subsection to `docs/MANUAL.md` mirroring the tutorial copy (grammar line, the default mapping, the kill switch, the cost summary).

- [ ] **Step 5: Verify rendering**

Run: `cd docs && python3 -m http.server 8765` then open `http://localhost:8765/tutorial.html#models` and confirm the section, the two-lane diagram, the cheat-sheet row, and the new TOC link all render. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md docs/tutorial.html docs/MANUAL.md
git commit -m "docs: model policy — tutorial section + diagram, AGENTS.md grammar, cheat sheet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7 (optional, best-effort): Real tokens + dollars in the summary

Deferred unless wanted. `claude -p --output-format json` returns `total_cost_usd` and a `usage` block. The contained change: a pure `parseUsage(jsonStr): { costUsd?: number; inputTokens?: number; outputTokens?: number }` in `claudeCode.ts`, an `onUsage?(node, usage)` callback on `ClaudeCodeRunnerOptions` invoked after each call, and `TierSummary` gaining optional `costUsd`/`tokens` that `formatModelSummary` prints when present. Test `parseUsage` over a sample claude JSON payload. The `{model,tier}` events from Task 4 already carry the per-call structure this hangs on. **Not required for the feature to ship** — Task 5's call tally already answers "how many strong vs fast calls."

---

## Self-Review

**Spec coverage:**
- Grammar (`models:`, tiers, auto-assign, `all`, per-phase override) → Task 1. ✓
- Cascade file→loop→stage + kill switch → Task 2 (resolver) + Task 4 (engine/cli). ✓
- Built-in defaults (plan/reflect/also→fast, act→strong) → `BUILTIN_PHASES` Task 2. ✓
- IR schema `modelPolicy` + attachments → Task 1 Step 6. ✓
- Runtime per-node model, runner pass-through, observe untouched → Tasks 3–4. ✓
- Cost visibility (call tally now; tokens/$ best-effort) → Task 5 (+ optional Task 7). ✓
- Docs incl. tutorial + diagram (user reminder) → Task 6. ✓
- Backward compatibility (no `models:` → unchanged) → resolver defaults + `model ?? this.opts.model` fallback; covered by existing engine tests staying green (Task 4 Step 6). ✓

**Deviation from spec (intentional, v1):** soft *warnings* (`observe <tier>`, undefined-tier) are not surfaced through a parser warning channel — `observe <tier>` is silently ignored and an undefined tier resolves to the runner default. Adding a warnings channel to the parser API is out of scope for v1; typo guards remain hard `ParseError`s.

**Placeholder scan:** none — every code step has full code; every run step has a command + expected result.

**Type consistency:** `ModelPolicy`/`ModelTier`/`ModelPhase` (parser) ↔ `Tier`/`Phase`/`EffectiveModels` (runtime) used consistently; `modelForPhase(eff, phase, cliModel?)` signature identical across Tasks 2/4/5; `model?` field name identical on inputs (Task 3) and assertions (Task 4); `{type:"model"}` event shape identical in Tasks 4 and 5.
