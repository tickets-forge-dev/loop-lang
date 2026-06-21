# Loop — `models:` policy (LLM tiering) — Design

**Date:** 2026-06-21
**Status:** Approved design → ready for implementation plan
**Author:** brainstormed with the Loop maintainer

## Problem

A `.loop` run is a cycle of LLM calls — `plan` (LLM), `act` (LLM), `observe`
(shell, cheap), and `reflect` (LLM on failure) — repeated up to N times. A
naive worry follows: a loop of several calls per cycle could cost **more** than
a single straight prompt.

Today Loop has only a single global model knob (`--model <alias>` / VS Code
`loop.model`) and a `maxTurns` cap. There is no way to use a cheap model where
cheap is enough and a strong model only where it matters, and no way to *see*
what a run actually cost.

## Goal

Add an **LLM policy** that uses models *smarter*, not just *less*: run the
cheap-thinking phases on a fast/cheap model and the hard phase on a strong
model, so a stack of cheap calls plus one strong `act` is cheaper than one big
prompt — and make the spend **measurable** per run.

Chosen mechanism (from brainstorming): **model tiering by phase**, declared with
two knobs and sensible auto-assignment, with cascade + per-phase override.
Explicitly *not* in this iteration: hard token/$ budgets, adaptive escalation.

## Concept & grammar

A `.loop` declares two model **tiers** — `fast` and `strong` — and the engine
auto-assigns each run-phase to a tier.

```
models: fast haiku, strong opus
```

### Built-in phase → tier defaults

| phase | tier | why |
|---|---|---|
| `plan` | fast | read context + decide the next small step |
| `act` | **strong** | writing correct code is the hard part — pay here |
| `observe` | — | shell command (`done when`); **no LLM** |
| `reflect` | fast | summarize a failure into context |
| `also` (finishing passes) | fast | polish / docs / scan-prep |
| gates / human | — | no LLM |

`act` is the **only** strong phase by default.

### Override + `all` shorthand

```
models: fast haiku, strong opus, plan strong   # flip one phase to strong
models: all strong                              # whole scope on one tier
```

### Cascade (mirrors the `git:` block) — file → loop → stage

```
models: fast haiku, strong opus        # file default

loop "risky refactor":
  models: act strong, plan strong      # this loop overrides

  stage docs:
    models: all fast                   # this stage cheaper
```

Most specific scope wins. **No `models:` block anywhere → today's behavior,
unchanged** (single default model). Fully backward-compatible.

## Defaults & resolution

**Tier value** = a model alias passed straight to `claude --model`: a short
alias (`haiku`, `sonnet`, `opus`, `fable`) or a full id
(`claude-opus-4-8`). Loop does **not** hardcode a model list — pass-through, so
new models work with zero code change.

**Tier names are fixed: `fast` and `strong`** (plus `all` as the override
keyword). Exactly two roles — the engine must know which auto-assigns where.
Arbitrary / >2 tiers = future.

**Resolution order — most specific wins:**

```
1. built-in phase→tier defaults  (plan/reflect/also→fast, act→strong)
2. file-level    models:
3. loop-level    models:
4. stage-level   models:          (lands on the stage's inner loop)
5. CLI --model X / loop.model      ── kill switch: forces ALL phases to X
```

A phase's model = `tier-of(phase, nearest scope)` → `model-of(tier, nearest
scope)`, unless `--model` overrides everything.

**`--model` is the kill switch** — "run the whole thing on one model." The
floor/debug escape hatch; cheapest possible run = `--model haiku`. It bypasses
the tier policy entirely.

**Partial / missing:**

- No `models:` block → single default model (unchanged behavior).
- Only one tier named → the other falls back to the default model.
- A tier referenced but never defined → resolves to default model + **soft
  warning** (not fatal).

**Validation (parse-time):**

- Unknown phase in an override (`paln strong`) → **error** (typo guard).
- Unknown tier keyword (not `fast`/`strong`/`all`) → **error**.
- `observe <tier>` → **soft warning** ("observe runs a shell command, no
  model"); dropped, not fatal.
- Tier *value* is not validated against a model list (pass-through); the soft
  linter may flag an unrecognized alias.

## IR / schema additions

Mirror `gitPolicy`: `gitPolicy` is a `$def` referenced from the root config and
from `loop`; `stage` has no git of its own and inherits via its inner `loop`.
`modelPolicy` follows the same shape and attachment.

New `$def`:

```jsonc
"modelPolicy": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "tiers": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "fast":   { "type": "string", "description": "model alias/id for the fast tier" },
        "strong": { "type": "string", "description": "model alias/id for the strong tier" }
      }
    },
    "phases": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "plan":    { "type": "string", "enum": ["fast","strong"] },
        "act":     { "type": "string", "enum": ["fast","strong"] },
        "reflect": { "type": "string", "enum": ["fast","strong"] },
        "also":    { "type": "string", "enum": ["fast","strong"] }
      }
    }
  }
}
```

**Attachment points** (same as `git`):

- root **config** object → `"models": { "$ref": "#/$defs/modelPolicy" }`
- **`loop`** def → `"models": { "$ref": "#/$defs/modelPolicy" }`
- **stage** → none of its own; `stage X:\n models: all fast` parses onto the
  stage's inner **loop** `.models` (exactly how stage-level `git` works).

**IR is sparse** — each scope stores only what it declared; no built-in defaults
baked in, no `all` keyword in the IR.

**Parser normalization (surface → IR):**

- `models: fast haiku, strong opus` → `tiers:{fast:"haiku",strong:"opus"}`
- `plan strong` → `phases:{plan:"strong"}`
- `all fast` → `phases:{plan:"fast",act:"fast",reflect:"fast",also:"fast"}`
- `observe <tier>` → dropped + soft warning (no `observe` key in schema).
- `additionalProperties:false` + the `enum`s give the typo/unknown-keyword
  errors for free.
- Parser AST types (`packages/parser/src/types.ts`) gain `models?: ModelPolicy`
  on config + loop, beside the existing `git?`.

**No special handling for `flow` / `for each`** — each chained file carries its
own `models:`; the flow just runs files.

## Runtime wiring

Mirror the existing `git.ts` / `resolveGit(config.git, loop.git)` seam.

**1. New pure resolver `packages/runtime/src/models.ts`:**

```ts
const DEFAULTS = { phases:{plan:"fast",act:"strong",reflect:"fast",also:"fast"}, tiers:{} };

resolveModels(...scopes): EffectivePolicy   // layer file → loop (→ stage's loop) over DEFAULTS
modelForPhase(eff, phase, cliModel, defaultModel): string | undefined
  // precedence:  cliModel  ??  eff.tiers[eff.phases[phase]]  ??  defaultModel
```

Pure, no spawning, unit-testable — same as `git.ts`.

**2. Per-call model on the runner.** Add `model?: string` to `PlanInput` /
`ActInput` / `ReflectInput`. `ClaudeCodeRunner.buildArgs`: `input.model ??
this.opts.model`. `MockRunner` records it (resolution testable offline). The
runner stays a dumb pass-through — **the engine owns precedence.**

**3. Engine threads the policy** like git:

- carry `opts.modelPolicy` (= `file.config?.models`) beside `opts.gitPolicy`;
  the loop carries `loop.models`.
- once per loop: `const eff = resolveModels(opts.modelPolicy, loop.models)`.
- set the model at each call site:
  - `runner.plan(…)` (engine.ts ~111) → `model: modelForPhase(eff,"plan",…)`
  - `runner.act(…)` (~145, ~401) → `"act"`
  - `runner.reflect(…)` (~226) → `"reflect"`
  - finishing `also` passes → `"also"`
- `observe` = shell verifier — untouched, no model.

**4. Kill switch.** `--model` / `loop.model` → `opts.cliModel`, passed into
`modelForPhase` and wins over policy. It no longer sets `runner.opts.model`
directly; the runner default is the last fallback.

**5. Visibility.** Each agent-node event gains `{ model, tier }` so the trace
shows which tier ran each step.

## Cost visibility (answers the original concern)

`claude -p --output-format json` returns token usage + `total_cost_usd` per
call. The engine sums these and prints a per-tier breakdown at end of run:

```
loop done · 4 cycles
  fast (haiku):   8 calls  ·  plan ×4, reflect ×3, also ×1   ·  ~12k tok  ·  $0.01
  strong (opus):  4 calls  ·  act ×4                          ·  ~38k tok  ·  $0.21
  total: 12 calls · $0.22
```

"Does Loop cost more than one prompt?" becomes **measurable per run**, not a
guess. Included in `--json` output too.

## Docs

- `AGENTS.md` grammar — add the `models:` line to the config tier (so agents
  author it).
- Tutorial — new section **· Model policy** (in *The engine* group) + a tiering
  diagram (plan/reflect = fast lane, act = strong lane), matching the existing
  diagram style; reuse the cost framing.
- Cheat sheet row + `docs/MANUAL.md`.
- VS Code soft-linter — optional nudge if `act` is on the `fast` tier.

## Testing

- **Parser:** surface → IR for all forms (`fast x, strong y`, `plan strong`,
  `all fast`); errors (unknown phase/tier); warnings (`observe <tier>`,
  undefined tier).
- **Resolver (`models.ts`):** precedence, cascade file→loop→stage, kill switch —
  pure unit tests.
- **Engine + `MockRunner`:** assert each node ran on the resolved model.
- **Schema:** valid/invalid `modelPolicy` fixtures.

## Out of scope (future — YAGNI now)

- Hard token / dollar budgets and call caps.
- Adaptive escalation (start `fast`, escalate to `strong` after N failed tries).
- More than two tiers / custom tier names.
- Per-provider routing (multiple runners).

The `{model,tier}` events + usage summary lay the groundwork for budgets later.
