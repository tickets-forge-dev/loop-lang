# Plan — Agentic Engineering constructs for Loop

> Bringing agentic-engineering discipline into Loop.
> Branch: `claude/loop-lang-concepts-3p5tz1`. Companion pipeline: [`agentic-engineering.loop`](../examples/agentic-engineering.loop).

## Context

Agentic engineering is about how much structure, verification and judgment surround the output.
Loop already embodies the disciplined end — its `plan → act → observe` + reflect back-edge **is**
the agent loop, and `goal:` + `done when` **is** "success criteria, not step-by-step instructions".
This epic closes the remaining gaps and **names** what Loop already is.

The headline gap: **evals**. The load-bearing principle is that without both TESTS and EVALS,
verification is incomplete. Loop has TESTS (deterministic,
checked by code) and a proto-eval fused into `done when the skill … scores N` — but it is unnamed,
its rubric is invisible, and it can only judge the **output**, never the **trajectory** (*"not just
what was produced but HOW the agent got there"*). Trajectory is exactly what catches the 80%-problem
failures: *"conceptual failures that look right and may pass basic tests."*

This is **building tomorrow's Loop using today's Loop**: the companion `.loop` pipeline plans this
work as an agentic-engineering pipeline, written entirely in the *current* grammar.

## The epic → stories

Stories are grouped into four waves (deck terminology in **bold**). Each is a `stage` in the
companion pipeline. Stories run in order; a failing story halts the rest. Risky stories (IR
changes, run isolation, real concurrency) carry a human gate.

| # | Story | Wave | Gate | `done when` |
|---|---|---|---|---|
| 1 | Eval targets in the IR | 1 · Eval core | approve plan | `npm test --workspace packages/parser` |
| 2 | Capture the trajectory | 1 · Eval core | — | `npm test --workspace packages/runtime` |
| 3 | Anti-thrash + feedback wiring | 1 · Eval core | — | `npm test --workspace packages/runtime` |
| 4 | The "without both" lint | 1 · Eval core | — | `npm test --workspace packages/parser` |
| 5 | The `rigor:` dial | 2 · Dials | approve plan | `npm test --workspace packages/parser` |
| 6 | Conductor / Orchestrator `mode:` | 2 · Dials | — | `npm test --workspace packages/parser` |
| 7 | `hooks:` — lifecycle checkpoints | 3 · Harness | — | `npm test --workspaces` |
| 8 | `observe:` — trace + OpEx report | 3 · Harness | — | `npm test --workspace packages/runtime` |
| 9 | `sandbox:` — run isolation | 4 · Niche | approve plan | `npm test --workspaces` |
| 10 | `knowledge:` + `examples:` context | 4 · Niche | — | `npm test --workspace packages/parser` |
| 11 | Parallel stages | 4 · Niche | approve plan | `npm test --workspace packages/runtime` |
| 12 | Standards & identity (MCP / A2A / `runs as:`) | 4 · Niche | — | `npm test --workspaces` |
| 13 | Reframe the docs | cross-cutting | review before stop | a human confirms |

---

## Wave 1 — Eval core (the headline)

### Story 1 — Eval targets in the IR
Generalize verification from one predicate to a conjunction, and make an eval's **target** explicit.
- **Spec/IR** (`spec/loop-spec.schema.json`, `packages/parser/src/types.ts`): `Loop.doneWhen`
  becomes `Predicate[]` (all must pass — the conjunction that lets a loop require a TEST **and** an
  EVAL). Extend the `skill` predicate variant with `target?: "output" | "trajectory"` (default
  `"output"`) and `bar?: string` (the inline rubric).
- **Parser** (`packages/parser/src/parser.ts`): collect every `done when` line into the list; parse
  the `on the output` / `on the trajectory` qualifier and an indented `the bar:` block under a skill
  predicate. Back-compat: a bare skill predicate parses as an output eval.
- **`done when`** stays the single verification verb — reject a second verb. Existing `.loop` files
  are unchanged (their single predicate becomes a one-element list).
- **Gate:** human approves the plan (IR shape change ripples through parser + runtime).

### Story 2 — Capture the trajectory
The runner already parses every tool call with its inputs (`interpretStreamLine`/`toolLines`,
`runners/claudeCode.ts:77–126`) and **discards** them after the live display. Retain them.
- **Runtime** (`packages/runtime/src/engine.ts`, `runners/claudeCode.ts`, `types.ts`): accumulate
  the per-cycle activity into a trajectory record — `{ plan, toolCalls[{tool,input}], filesTouched,
  observe, reflection }`. Add `SkillVerifyInput.trajectory`.
- Route verifier context by target: **output** evals receive the diff/output (today's
  `lastActSummary`, `engine.ts:211`); **trajectory** evals receive the cycle log.
- A loop's `done` requires every predicate in the list to pass (test + output eval + trajectory eval).

### Story 3 — Anti-thrash + feedback wiring
Keep a stochastic judge from self-thrashing, and let reflection see the path.
- A **blocking** trajectory eval requires an explicit `the bar:` (no naked path-judge gates `done`).
- A borderline verdict escalates via the existing `when blocked: ask a human` path instead of retrying.
- An eval-flap counter feeds the `after N tries` thrash guard so a flaky judge alone can't burn the budget.
- Thread the trajectory into `ReflectInput` so `reflect on the path it took` fixes the path, not the artifact.

### Story 4 — The "without both" lint
Turn this principle into a check. For **code loops** only (loops with an `edit` allowance):
warn when a loop has a TEST but no EVAL (or vice-versa). Severity is wired to `rigor:` in Story 5
(warn by default; error under `rigor: agentic engineering`). Lives in the parser/validator so
`loop-run parse` surfaces it.

## Wave 2 — The dials

### Story 5 — The `rigor:` dial
Config-tier knob — `rigor: vibe coding | structured ai-assisted | agentic engineering` — that
expands to bundled defaults over existing knobs, reusing the `use the <method>` preset machinery
(`Config.use`/`useOverrides`) and the lowest-wins cascade already used for git/models. Sets the
"without both" lint severity. **Gate:** human approves the plan (touches the config cascade).

### Story 6 — Conductor / Orchestrator `mode:`
Config-tier `mode: conductor | orchestrator` — names what `/loopflow` (in-session, gates inline)
and `loop-run` (async, opens a PR) already do. Orthogonal to `rigor:`; warn on the incoherent
combo `rigor: vibe coding` + `mode: orchestrator` (the "token burn from unverified loops" anti-pattern
running unattended).

## Wave 3 — Harness completeness

### Story 7 — `hooks:` — deterministic checks at lifecycle points
A `hooks:` block binding a deterministic predicate (`passes` / `finds nothing`) to a lifecycle
point — `before each cycle · after act · on commit · on push · on stop`. A failing hook blocks
(*"hooks block unsafe commits"*), generalizing the hard-coded never-push-to-main. Carve:
success criterion → `done when`; recurring blocking checkpoint → `hooks:`; one-time polish → `also:`.

### Story 8 — `observe:` — trace + OpEx report
Per-cycle trace (plan/act/observe + tools called), token & cost metering split fast/strong, a
stop-time OpEx report (cycles, reflects, first-pass success, hit-the-guard?), and an optional
`stop and warn if cost exceeds "$N"` — an OpEx ceiling beside the thrash guard's CapEx ceiling.

## Wave 4 — Niche / standards

### Story 9 — `sandbox:` — run isolation
*"Where code runs and what it cannot reach"*: no-network / egress allowlist / CPU-mem-time caps,
declared as config rather than prose (today `examples/forge-sandbox.loop` encodes this only inside
`goal:` text). **Gate:** human approves the plan (security-sensitive).

### Story 10 — `knowledge:` + `examples:` context
Complete context engineering's six parts. `examples:` = reference patterns to imitate;
`knowledge:` = read-only reference (docs/diagrams) the agent must **not** edit (a label *and* a soft
guardrail). Distinct intents from `look at:` (understand + edit).

### Story 11 — Parallel stages
`stages in parallel:` — fan out independent stories concurrently, barrier-join before the next
stage, **a worktree per parallel branch + a merge** to avoid edit collisions. The one story with
real concurrency cost; backs *"orchestrator = multi-agent, multi-file parallel."* **Gate:** human
approves the plan.

### Story 12 — Standards & identity
Adopt open standards (CH7 orgs). `use tools from the "<server>"` names MCP servers as the Tools
surface; frame the flow **handoff** as an A2A contract (`produces:` / `consumes the … from <step>`);
add `runs as:` identity so unattended orchestrator runs have an auditable principal (the thin 5th
anatomy part, *Deployment*).

## Cross-cutting

### Story 13 — Reframe the docs
Zero-grammar framing wins, written into `AGENTS.md` + `README.md`: *"intent is the new interface"*
as Loop's one-liner; the Conductor/Orchestrator and editor/terminal/background maps
(`/loopflow` · `loop-run run` · `schedule:`+PR); the five-knobs ↔ harness table (*Agent = Model +
Harness*); static vs dynamic context and the CapEx/OpEx framing. Print the flow of each new example
`.loop`. **Gate:** a human reviews before stopping.

---

## Sequencing & dependencies

- **Wave 1 is the spine** and strictly ordered: Story 1 (IR) → 2 (capture) → 3 (safety) → 4 (lint).
- Story 4's lint severity depends on Story 5 (`rigor:`); ship the lint as warn-only, then wire
  severity once `rigor:` lands.
- Waves 2–4 are largely independent of each other and can be reordered by appetite. Story 11
  (parallel) is the only one with real concurrency/merge risk — do it deliberately, last.

## Verification (end to end)

- **Per story:** `npm test --workspace packages/<parser|runtime>` (the stage `done when`). Add a
  focused `test/*.test.js` with each story before making it pass — dogfooding the loop.
- **Round-trip:** new syntax through `loop-run parse <file>` → loop-spec JSON; keep
  `spec/loop-spec.schema.json` and `types.ts` in sync.
- **Behavioral proof for evals:** a loop that games a test green by deleting the failing assertion
  must **fail** its trajectory eval (`the bar: didn't weaken a test to go green`) while a clean path
  passes.
- **Flow rendering:** `loop-run show` renders the new constructs; print the flow for every new
  example.
- **Full sweep:** `npm test --workspaces` stays green throughout.

## Out of scope (for now)
Sub-agent spawning *within* a cycle (pipeline-level parallel covers the orchestrator need); a
typed/structured handoff beyond the A2A naming; a full cost-routing optimizer beyond `route:`.
