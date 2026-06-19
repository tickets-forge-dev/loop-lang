# Design: `flow` — chaining loops across files

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan

## Context

Loop today composes at two coarse levels: a `pipeline` runs `stage`s in order, fail-fast,
and each stage holds an *inline* loop. There is no way to reference another `.loop` file,
and the only state that crosses a stage boundary is the engine-internal reflection string —
nothing the author can name or direct.

The author wants to build a **chain of loops connected to each other**, where each link is a
whole `.loop` file, and the result of one link carries into the next. Concretely: "pipe between
loops, pipe between files, and if I point a step at a file it runs the whole file."

This keeps Loop a *control-structure* language (named, gated, verified loops with a back-edge)
rather than turning it into a data-flow / chain language (LangChain/LCEL), which pipes typed
values through stateless transforms. The deliberate guardrail: the payload that crosses a link
is **text** (a human-readable summary), not a structured object. Composition happens at the
loop level; data does not get wired field-to-field.

## Goal

Add a third top-level construct, `flow`, that runs a sequence of `.loop` files in order,
fail-fast, carrying a text summary of each step forward as context for the next.

Non-goals (explicitly out of scope for v1):
- Structured result objects or variable interpolation (`$step.output.field`).
- Parallel / fan-out execution. Steps run strictly in sequence.
- Referencing a single named loop *inside* another file (a step runs the **whole** file).
- Conditional branching between steps beyond fail-fast.

## Surface syntax

New top-level definition `flow "<name>":` — a peer of `loop` and `pipeline`.

```loop
flow "ship":
  run "build.loop"
  then run "test.loop"
  then run "deploy.loop"
```

- The first step is `run "<file>"`; every subsequent step is `then run "<file>"`.
- The file path is a string, resolved relative to the directory of the flow file.
- A step's **name** is the referenced file's basename without extension
  (`test.loop` → `test`). Names are used for handoff references and event labels.
- A step may carry a per-step human gate, reusing the existing stage-gate grammar:

  ```loop
  then run "deploy.loop":
    a human approves first
  ```

- A step may redirect its incoming handoff to a named earlier step instead of the
  immediate predecessor:

  ```loop
  then run "deploy.loop" with the result of test
  ```

## Semantics

**Run the whole file.** `run "x.loop"` parses `x.loop` and runs every top-level
definition in it, in declared order — reusing the existing `run(file, opts)` entry point in
`packages/runtime/src/engine.ts`. A step is **satisfied** only if every definition in the
referenced file is satisfied.

**Fail-fast.** If a step is not satisfied, the flow stops immediately and reports failure,
mirroring `executePipeline`'s halt-on-failed-stage behavior.

**Text handoff, auto-carry by default.** After a step completes, the engine builds a
**summary string** from its outcome — the step name, satisfied/failed, and the last observe
output or reflection captured while running it. By default the *next* step receives the
prior step's summary as upstream context.

To build that summary the engine needs the last observe output, which `LoopOutcome`
(`{satisfied, reason, attempts}`) does not currently carry. Extend `LoopOutcome` with an
optional `summary?: string` (the last observe output / reflection text); `executeLoop`
already has `observeOutput` in scope and sets it. For a multi-definition file, the step
summary concatenates each definition's `summary` in order. This is an additive,
backward-compatible field. By default the *next* step receives the
*previous* step's summary as **upstream context**: it is threaded into the `plan` input of
every loop the next file runs, so the agent planning that file's work can see "what came
before." `with the result of <name>` overrides the source of that upstream text, pulling the
named earlier step's summary instead of the immediate predecessor's. There is no way to
disable the carry in v1 (YAGNI — author can ignore it).

**Cycle detection.** The engine tracks the stack of resolved absolute file paths currently
executing. If a `run` would re-enter a file already on the stack, it errors with the chain,
e.g. `flow cycle: a.loop -> b.loop -> a.loop`.

## Components and changes

### IR (`packages/parser/src/types.ts` + `spec/loop-spec.schema.json`)

- Extend `Definition` union: `Pipeline | Loop | Flow`.
- Add:
  ```ts
  export interface Flow {
    kind: "flow";
    name: string;
    steps: FlowStep[];
  }
  export interface FlowStep {
    ref: string;                       // file path as written, e.g. "test.loop"
    name: string;                      // basename without extension, e.g. "test"
    gate?: { message: string } | null; // per-step human gate
    fromStep?: string;                 // "with the result of <name>" override
  }
  ```
- Keep the JSON Schema (`spec/loop-spec.schema.json`) as source of truth; mirror the
  TypeScript types to it. Bump nothing in `LOOP_VERSION` unless the schema review calls for it
  (additive change to a union — backward compatible).

### Parser (`packages/parser/src/parser.ts`)

- Add a top-level dispatch for `flow "<name>":` next to `loop`/`pipeline`.
- Parse body lines:
  - `run "<file>"` and `then run "<file>"` → a `FlowStep` (the leading `then` is optional
    sugar and parses identically).
  - optional trailing `with the result of <name>` → `fromStep`.
  - an indented `a human approves …` / gate line under a step → `gate` (reuse the existing
    stage-gate parsing path).
- Reject an empty `flow` (no steps) with a `ParseError`, matching how the parser validates
  other constructs.

### Engine (`packages/runtime/src/engine.ts`)

- Add `executeFlow(flow, opts, stack)` alongside `executePipeline`.
  - For each step: optionally run its gate (reuse the gate path from `executePipeline`),
    resolve+load the file via the injected loader, run it with `run(file, …)`, capture the
    outcome and build the summary, halt on failure.
  - Thread the carried summary into the next step's run as `upstream` (see RunOptions).
  - Maintain the resolved-path stack for cycle detection.
- Route `flow` from `runDefinition` (the `def.kind` switch).

### File loading (dependency injection, `packages/runtime/src/types.ts`)

- Add to `RunOptions`:
  ```ts
  loadFile?(path: string, baseDir: string): Promise<LoopFile>;
  ```
  Same DI pattern as `Runner` / `Verifier` / `ArchonPlanSource`, so the engine stays pure and
  tests inject a mock loader. The engine errors clearly if a `flow` is run without a
  `loadFile` provided.
- Add `upstream?: string` to `PlanInput`; the engine sets it from the carried summary.

### Runner (`packages/runtime/src/runners/claudeCode.ts`)

- When `PlanInput.upstream` is present, append it to the plan prompt as a clearly-labeled
  "from the previous step" section. The mock runner records it for assertions.

### CLI (`packages/runtime/src/cli.ts`)

- Wire the real `loadFile` (read file from disk + parse via `@loop/parser`).
- Ensure `loop run`, `loop parse`, and `loop viz` all handle a `flow` definition.
- Render the new events in the glyph trace and `--events` NDJSON.

### Events (`packages/runtime/src/types.ts`)

- Add `flow-start`, `flow-step-start`, `flow-step-end`, `flow-end` to the `LoopEvent` union so
  the CLI trace and the VSCode host can display a flow's progress.

### Surfaces (docs + examples + viz)

- `examples/ship_flow.loop` — a runnable 3-file chain.
- `README.md` keyword list (+1: `flow` / `run … then`), `AGENTS.md` language reference,
  `docs/MANUAL.md`.
- `@loop/viz` — render a `flow` as a left-to-right chain of file nodes.
- VSCode (`packages/vscode`): add `flow`, `run`, `then` to the tmLanguage grammar and the
  ▶ Run CodeLens so a `flow` definition is runnable.

## Testing

- **Parser** (`packages/parser` tests): `flow` → IR; `then` sugar; `with the result of`;
  per-step gate; empty-flow `ParseError`. Mirror the existing parser test style.
- **Engine** (`packages/runtime` tests, mock runner + mock loader):
  - 3-file chain runs in declared order.
  - Fail-fast: a failing step halts the rest; flow reports unsatisfied.
  - Handoff: step 2's `PlanInput.upstream` contains step 1's summary.
  - `with the result of <name>` pulls the named step's summary, not the predecessor's.
  - Per-step gate: a rejected gate halts the flow.
  - Cycle detection: `a → b → a` throws with the chain in the message.
- **End-to-end:** `loop parse examples/ship_flow.loop` emits valid IR; `loop viz` renders it.

## Verification (manual)

1. `pnpm -r build` (or the repo's build) succeeds with the new types.
2. `pnpm -r test` — all parser + runtime tests green, including the new ones.
3. `loop parse examples/ship_flow.loop` prints a `flow` IR with three steps.
4. `loop run examples/ship_flow.loop` with the mock/real runner shows steps running in order
   and stops at the first failing step.
5. `loop viz examples/ship_flow.loop` writes an HTML schematic showing the file chain.
