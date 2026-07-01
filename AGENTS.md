# AGENTS.md — authoring LoopFlow (`.loop`) flows

This file teaches an AI assistant (Claude Code, Copilot, Cursor, etc.) how to write
**LoopFlow** flows. When a user asks you to design a staged, self-correcting, or human-gated
coding workflow — "set up a loop to fix X", "turn this epic into a pipeline", "automate
this multi-step task" — author a `.loop` file using the grammar below, then let the user
run it with `loop-run run file.loop`.

LoopFlow is a small natural-language DSL. A `.loop` file describes the *movement* of an AI
coding loop: its objective, the context it may read, the actions it's allowed, how it
verifies itself, when it stops, and where a human steps in. The five knobs —
**objective, context, actions, verification, stopping rules** — are first-class instead
of buried in a prompt.

## When to write a `.loop`

Write one when the work is a *repeatable, verifiable* loop or a sequence of them:
bug fixes with a test, refactors gated by a check, an epic broken into stories, a
migration with a verification step. Don't write one for a one-off question or a trivial
edit — just do those directly.

Before building a loop, run the four-condition test — build one only when all four hold:

1. **Does the task repeat?** A one-time task is just a normal prompt.
2. **Is there a clear definition of "done"?** You must be able to verify completion — a
   `done when` predicate (a test, a command, or a review skill). No check, no loop.
3. **Can you afford the iterations?** A loop re-prompts itself until done; that costs tokens.
   Keep the `done when` check fast and add an `after N tries` thrash guard.
4. **Does the loop have the tools to verify itself?** It needs a way to implement *and* check
   its own work — the predicate command or the review skill must actually be runnable.

**Interview the user before writing it.** Walk the five decisions, asking the
high-leverage questions and offering defaults for the rest: (1) the **goal**;
(2) the **`done when`** check (test / command / scan finds-nothing / human);
(3) **`look at`** context; (4) the **action policy** (what's risky enough to gate);
(5) **stopping** (reflect on failure + an `after N tries` guard). Then the
**human gates** and the **git strategy** (default: branch + commit when done,
never push to `main`; ask if they want a PR or a worktree). Offer the defaults
inline so a confident user can accept everything at once.

### Start from a template when one fits

This repo ships a library of **best-practice starter loops** in [`templates/`](./templates/)
(see [`templates/README.md`](./templates/README.md)). When the user's request matches one,
**reach for it first** — copy it, fill in its `# TODO` lines (test commands, paths), and
adapt — instead of authoring from a blank file. They cover the everyday jobs:

- **Spec-driven:** `greenfield-app.loop` (whole app, A-to-Z), `load-spec.loop` (deliver an
  existing `plan.md` + `sprint.yaml` backlog story by story) — with `discover.loop`,
  `design.loop`, `story-template.loop`, and starter `sprint.yaml`/`plan.md`.
- **Change:** `feature.loop`, `brownfield-feature.loop`, `bugfix.loop`, `refactor.loop`.
- **Quality gates:** `cicd-check.loop`, `security.loop`, `clean-architecture.loop`,
  `test-coverage.loop`, `review-diff.loop`.

Each is heavily commented and verified to parse. Still interview the user for the specifics
(goal, the real `done when`, what to gate) — the template is the skeleton, not the answer.

## Vocabulary (the whole language)

```
loop "<name>":            a self-correcting loop
pipeline "<name>":        a sequence of stages (an epic)
stage "<name>":           one stage of a pipeline (its body is a loop; a story)
flow "<name>":            a chain of loop files (each step runs a whole .loop file)
  run "<file>":           first step — runs the file; its text result is passed forward
  then run "<file>":      subsequent step — receives the previous result as context
    a human approves first  (optional per-step human gate before the step runs)
  with the result of <name>  (reference a named step's output instead of auto-carry)
  for each <var> in "<file>":  iterate items from a .yaml or .md file; run the template once per item
    run "<template>":     template receives the item text as context; fail → ask continue/stop

goal: <text>              what "done" means, in plain language
done when <predicate>     how the loop verifies itself (see Predicates)
look at: <files>, and the last failure   context the agent reads before acting (items are file paths or plain-language descriptions the agent resolves to files)
allow edits automatically, but ask me before <classes>   action policy
each cycle: plan, then act, then observe   the repeated steps (any subset, in order)
also: <pass>, <pass>      extra finishing passes run after the goal is met
use skills: <a>, <b>      named skills the loop may invoke during plan/act
use skills recommended by ctx        let ctx pick + install the skills for the goal (needs the ctx MCP server); add `for "<intent>"` to override the query
top up skills from ctx               run-time: pull more skills from ctx when a cycle fails and reflects (pairs with the line above)
remember in "<file.md>"   cross-run memory: read lessons on start, append an outcome on stop
reflect                   turn a failure into context for the next plan (the back-edge)

when it passes and the goal is met: stop
when it fails: reflect on <focus>, then plan again
when blocked: ask a human
after <N> tries: stop and warn "<message>"

a human approves the plan first        (human authors/approves the plan before acting)
a human reviews before stopping        (human judges the result before the loop stops)
a human approves before <action>       (a blocking gate before a stage, e.g. deploy)

plan from "<file>"        (read the plan from a file you control instead of generating it)

use the <method> method   schedule: <when>   runner: <agent>   target: <dir>   (config tier)
models: fast <model>, strong <model>   model tiering: plan/reflect/also→fast, act→strong (cascades; override e.g. `act fast`, `all strong`)
each cycle: plan, then act, then observe   (config tier: the default cycle for every loop in the file; a loop's own `each cycle:` overrides it)
rigor: vibe coding | structured ai-assisted | agentic engineering   (the spectrum dial; structured/agentic give every loop a back-edge + thrash guard for free)
mode: conductor | orchestrator   (supervision posture: in-session/sync vs async/opens-a-PR)
runs as: <identity>   (an auditable principal for unattended runs)
recommend skills with ctx   (config tier: ctx is this file's skill source — recommends + installs skills per loop goal; see "Skill source: ctx" below)
grant ctx: skills, agents, mcps, harnesses   (config tier: capability groups the file lets ctx recommend; fails closed, default skills+agents; mcps/harnesses are recommend-only)
ctx may use my own model "<provider>/<model>"   (config tier: declares a user-owned/local/API model — unlocks ctx harness recommendations, always dry-run)
observe:   (block) trace every cycle / meter tokens and cost / stop and warn if cost exceeds "$N"
sandbox:   (block) no network access / allow egress to "host" only / cap cpu at … memory at … time at …
hooks:     (loop body block) before each cycle | after act | on commit | on stop : "<cmd>" passes|finds nothing   (a failing hook blocks)
examples: <files>      (reference patterns to imitate — context engineering's 6th part)
knowledge: <files>     (read-only reference the agent must not edit)
use tools from the "<server>" server   (MCP: name servers whose tools the loop may use)
stages in parallel:    (inside a pipeline: the indented stages run concurrently)
```

### Predicates (`done when …`)

```
done when the test "billing.spec.ts::apostrophe" passes   # a named test
done when "pnpm test" passes                               # a shell command, exit 0
done when "semgrep --severity=high" finds nothing          # a shell command, empty output
done when "pnpm test flaky" passes 3 times                 # flake guard: re-run the check, EVERY run must pass
done when a human confirms "looks right at 375px"          # a human check
done when the skill "email-review" approves                # an eval: approved / not
done when the skill "email-review" scores 8 or more        # an eval: numeric threshold
done when the skill "api-review" scores 8 or more on the output       # an eval of WHAT was produced
done when the skill "path-review" approves on the trajectory          # an eval of HOW the agent got there
  the bar: didn't weaken a test to go green; no writes outside api/   # the rubric the judge scores against
```

The command in a predicate runs in the user's shell with their privileges (like an npm
script). It IS meant to be a real command. Prefer a fast, deterministic check.

**Flake guard — `passes N times`.** Append `N times` to a `test` or command predicate to re-run
it `N` times and require every run to pass (the first failure short-circuits). Reach for it when a
green can pass by luck — a timing- or order-dependent test — so "done" means "passes *reliably*",
not "passed *once*".

### Tests vs evals — list as many `done when` as you need

A loop may have **multiple `done when` lines, and ALL must pass** (a conjunction). Use this to
combine the two kinds of verification:

- **TESTS** — a `test` / command predicate. Deterministic, checked by code (`"pnpm test" passes`,
  `"semgrep …" finds nothing`).
- **EVALS** — a `skill` predicate. A rubric / LM judge for the non-deterministic parts. An eval
  names its **subject**: `on the output` (the default — judges *what* was produced) or
  `on the trajectory` (judges *how* the agent got there — the path and tool calls it took). An
  indented `the bar:` line states the conditions the judge scores against.

A trajectory eval is what catches the failures a green test can't — e.g. an agent that made a test
pass by weakening it. Pair a test with an eval when "done" means both "it works" and "it was built
the right way."

The **skill** predicate bridges an abstract goal to a verifiable one: when "done" isn't a
test or a command (a good email, a sound design), have a review skill return an
approved/rejected verdict or a numeric score. Build that review skill manually first and
confirm it judges well, then wire it in as the loop's check.

### `use skills` — coordinate proven skills

Instead of one giant prompt, a loop can name skills it may call while planning and acting:

```loop
loop "decide whether to cancel the morning run":
  goal: a clear go / no-go call the runner trusts
  use skills: check-weather, analyze-workout
  done when the skill "workout-review" approves
```

This is **skill-driven development**: build and battle-test each skill on its own first,
then have the loop coordinate them. Don't invent a loop around skills that don't exist yet —
prove the skill manually, then wire it in (as an execution skill via `use skills:`, or as a
verifier via `done when the skill "…" approves`). See `examples/skills_memory.loop`.

### Skill source: ctx — let a recommender pick + install the skills

`use skills:` assumes the skills already exist in `~/.claude/skills`. **ctx**
([claude-ctx](https://github.com/stevesolun/ctx)) is the recommender that fills that gap:
point it at a goal and it recommends the smallest useful bundle and installs the skill bodies
into `~/.claude/skills` — so the names resolve. ctx is the layer beneath Loop; Loop stays the
top, user-facing layer.

```loop
recommend skills with ctx               # config tier: ctx is this file's skill source

loop "harden the stripe webhook handler":
  goal: webhook retries are idempotent and signature-checked, with tests
  use skills recommended by ctx for "stripe webhook idempotency"   # bake at author time, resolve at run time
  top up skills from ctx when a step needs more                    # pull more on a failing cycle
  done when "pnpm test api/webhooks" passes
```

- **Author time** (`/loopflow`): ctx recommends for the goal, you approve, the names are
  installed and written into a `use skills:` line so the `.loop` stays self-contained.
- **Run time** (`loop run`): the runtime resolves `use skills recommended by ctx` via the ctx
  MCP server before the first plan, and `top up skills from ctx` after a failed cycle reflects.
- **No ctx attached?** The lines are inert — the loop runs exactly as it would without them.

**Beyond skills — the full capability set.** By default ctx provisions only `skills`
(and the agents Loop loads the same way). A `grant ctx:` line widens what ctx may recommend to
any of `skills, agents, mcps, harnesses`, **failing closed** — only listed groups are returned:

```loop
recommend skills with ctx
grant ctx: skills, agents, mcps, harnesses          # capability grants (fail-closed)
ctx may use my own model "ollama/llama3.1"          # unlocks harness recs (dry-run only)

loop "stand up a local agent loop":
  goal: an MCP agent loop running on local ollama with filesystem access
  use skills recommended by ctx
  done when "pytest tests/agent_loop" passes
```

- **skills / agents** install into `~/.claude/skills` (as before) and merge into the cycle's
  skill set.
- **mcps** are **recommend-only**: ctx surfaces fitting MCP servers + a suggested
  `ctx-mcp-install <name>`; the runtime emits them on a `ctx` event, it never auto-registers one.
- **harnesses** (autogen, langfuse, …) recommend **only** when you declare a user-owned model
  (`ctx may use my own model "…"`), and ship as an explicit `ctx-harness-install <name> --dry-run`
  command — never an automatic install. This is the one capability that pulls real software, so it
  stays human-gated by design.

Setup: `claude mcp add ctx -- ctx-mcp-server` (needs `pip install claude-ctx`). See
`examples/ctx_skills.loop`, `examples/ctx_capabilities.loop`, and `docs/ctx-skill-source.md`.
Full customer-facing walkthrough (setup, own-model, the capability model): `docs/ctx-integration-guide.md`.

### `remember in` — cross-run memory

A loop forgets everything between runs unless you give it a memory file. `remember in` makes
the loop read the file's lessons into its first plan and append a dated outcome entry when it
stops — so it improves run over run instead of repeating mistakes.

```loop
loop "...":
  goal: ...
  remember in "morning-run.memory.md"
```

`reflect` is *within-run* memory (a failure feeds the next plan); `remember` is its
*across-run* counterpart. The file is plain markdown — readable and editable by a human.

### `flow` — chaining loops across files

A `flow` sequences multiple `.loop` files. Each step runs the whole file (plan→act→observe
cycle) and passes its text result forward as context for the next step. The chain is
fail-fast: a step that ends unsatisfied stops the rest.

```loop
flow "ship":
  run "build.loop"
  then run "test.loop"
  then run "deploy.loop":
    a human approves first
```

- `run "<file>"` — first step; the file path is relative to the flow file.
- `then run "<file>"` — subsequent steps; automatically receive the previous step's text summary.
- `a human approves first` — optional per-step gate; blocks until approved.
- `with the result of <name>` — reference a named step's output explicitly instead of auto-carry.

### `for each` — iterate a plan, run a template per item

Inside a `flow`, `for each` reads a list from a YAML or Markdown file and runs a template
once per entry. The entry's text becomes the template's context (what to build).

```loop
flow "deliver":
  for each item in "plan.yaml":
    run "item-template.loop"
```

- `for each <var> in "<file>":` — source must be a `.yaml` file (a list or a single-key
  list like `items:`) or a `.md` file (splits on `## ` sections).
- `run "<template>"` — the template runs once per item; the item text arrives as context.
- A failed item pauses the flow and asks whether to continue with the next item or stop.
- Method-neutral: works with any checklist, not only BMAD. See `examples/foreach/` for a
  generic bundle and `examples/bmad/atoz/` for BMAD as one example method.

## Rules

- **Indentation matters.** `loop` / `pipeline` / `flow` at column 0; their body indented
  two spaces; a `stage`'s body indented under the stage.
- A `loop` needs a `goal`. A `pipeline` needs at least one `stage`.
- **An epic → a `pipeline`; each story → a `stage`.** Stages run in order; a failing
  stage halts the rest.
- **Scope each loop with `look at:`** so the agent follows the existing architecture and
  makes the smallest change, instead of writing greenfield code. Items can be exact file
  paths or plain-language descriptions (e.g. `the billing form`) — the agent resolves
  descriptions to the actual files before planning.
- **Put human gates on risky work** — payments, migrations, deploys, anything
  irreversible. Use `ask me before …` for action policy, `a human approves before …`
  for a hard stage gate.
- Output only valid `.loop` syntax. Comments start with `#`.
- **Friendly shorthands** (all desugar to the lines above — use freely): `check:` / `verify:`
  = `done when` (a bare value is a shell command; a predicate phrase parses as-is); `in:` /
  `look in:` / `files:` / `context:` = `look at:`; `when it breaks` = `when it fails`;
  `when it gets stuck` = `when blocked`.

## Example — a single loop

```loop
loop "fix billing apostrophe bug":
  goal: settings save when the company name has an apostrophe
  done when the test "billing.spec.ts::apostrophe" passes

  look at: billing/form.tsx, api/settings.ts, schema/settings.ts, and the last failure
  allow edits automatically, but ask me before migrations or pushes

  each cycle: plan, then act, then observe
  when it passes and the goal is met:  stop
  when it fails:                        reflect on which layer broke, then plan again
  when blocked:                         ask a human
  also:                                 polish the code, run a security check
  after 6 tries:                        stop and warn "thrashing"
```

## Example — an epic with stories

```loop
pipeline "epic: checkout v2":

  stage "story: cart totals":
    goal: cart shows correct totals with tax
    look at: src/cart/, src/tax/
    done when "pnpm test cart" passes
    each cycle: plan, then act, then observe
    when it fails: reflect, then plan again

  stage "story: checkout submit":
    goal: order submits and payment is captured
    a human approves before charging the card
    done when "pnpm test checkout" passes
    each cycle: act, then observe
```

## Git strategy

A `git:` block sets the version-control strategy for the whole file (config tier, before
any definition) or for a single loop (inside the loop body).

**Built-in default (no `git:` block):** work on a branch, commit when the goal is met,
no push. This applies whenever no git block is present at any level.

### Line forms

```
work in place                    # edit the current branch as-is
work on a branch                 # create / switch to a feature branch (default)
work on a branch "my-feature"    # explicit branch name
work in a worktree               # isolated git worktree
work in a worktree "my-worktree" # named worktree

commit when the goal is met      # one commit on success (default)
commit each cycle                # commit after every cycle
commit each story                # commit after each stage
commit never / do not commit     # no automatic commits

push when done                   # push the branch on completion
do not push                      # no push (default)

open a pull request              # open a PR after pushing
```

### Cascade (lowest wins)

1. Built-in default — branch + commit-when-done, no push.
2. File-level `git:` block — applies to all loops in the file.
3. Per-loop `git:` block — refines commit cadence for that loop only.

A `use the <method>` preset may carry a `git:` block at file level; the file's own block
overrides it.

### Always-on safety

- **Never push to `main` or `master`.** This is unconditional — no `git:` block can
  override it. A `push when done` directive with the current branch being protected is an
  error that surfaces before the loop runs.
- **`work in place` + `push when done` on a protected branch** is also an up-front error.

### Example

```loop
git:
  work on a branch
  commit when the goal is met
  push when done
  open a pull request

loop "add a healthcheck endpoint":
  goal: GET /healthz returns 200 with a JSON status
  done when "pnpm test health" passes
  look at: the http server and the routes module, and the last failure
  each cycle: plan, then act, then observe
  when it fails: reflect, then plan again
  after 6 tries: stop and warn "healthcheck stuck"
```

## Config defaults & the project config file

Anything in the **config tier** (the top of the file, before any definition) sets a default for
every loop in that file — so you write it once instead of repeating it per loop. The most common
repeater is the cycle:

```loop
each cycle: plan, then act, then observe   # the default for every loop below
models: fast haiku, strong opus

pipeline "epic: ship it":
  stage "story: build":
    goal: it builds
    done when "pnpm build" passes            # no `each cycle:` — inherits the default
  stage "story: verify":
    goal: tests pass
    each cycle: act, then observe            # overrides just this stage
    done when "pnpm test" passes
```

### `loop.config` — defaults for the whole repo

To avoid repeating config across *files*, drop a **`loop.config`** (or `.looprc`) at your project
root. It is written in the same config-tier syntax — `each cycle:`, `models:`, a `git:` block — and
the runner reads it before every run, walking up from the `.loop` file to find it. It is the
**lowest** tier of the cascade, so a file's own config (and a per-loop directive) overrides it.

```loop
# loop.config — applies to every .loop in the repo
each cycle: plan, then act, then observe
models: fast haiku, strong opus
git:
  work on a branch
  commit when the goal is met
```

**Cascade (lowest wins):** `loop.config` → a file's config tier → a per-loop directive.
The same rule already governs `git:` and `models:`.

## Show the flow — every time it changes

Whenever you create or edit a `.loop`, print its flow so the user sees the shape.
Run `loop-run show file.loop`, or render the compact ASCII yourself: the cycle
(`plan → act → observe`), the `↺` reflect back-edge, the `✓ done when` check, the
`⛔` thrash guard, and any `👤` gates. For a pipeline, list stages in order; for a
flow, show the file chain. `loop-run ls` lists every loop in the repo.

## Running what you wrote

- `loop-run run file.loop` — execute it on Claude Code (plan/act/observe, reflect on failure,
  verify with `done when`, pause at human gates).
- `loop-run show file.loop` — print the loop's flow as compact ASCII (and `loop-run ls` to list them).
- `loop-run explain file.loop` — describe the loop in plain English (a friendly check of what it will do).
- `loop-run viz file.loop` — open a visual HTML schematic of the flow.

### Live visual — opt-in via `loop.config`

The in-session dashboard is **off by default**. Before running a loop **in this session**,
read `loop.config` at the repo root: only if it has `live=true` do you start the dashboard
and drive it as you narrate. With `live=false` (the default written by `loop init`) or no
config, run normally in the chat — don't open anything, don't ask. (The headless
`loop-run run <file> --live` flag below is independent of this config.) When enabled:

- `loop-run live file.loop` — start the dashboard server (opens the browser, prints
  `LOOP_LIVE_PORT=<port>`), run it in the **background**, keep the port.
- `loop-run emit <port> '<event-json>'` — push one event per narrated step so the browser
  animates in real time: the active cycle node pulses, flow steps light up, and a
  `for each` (sprint) progress bar fills item by item — the user always sees where in the
  loop and where in the plan the run is.
- `loop-run run file.loop --live` — headless alternative: the engine itself streams every
  event to the browser (no manual `emit`), gates answered in the terminal.

The `/loopflow` skill has the full event cheat-sheet for the in-session push protocol.

## Authoring checklist

1. One coherent objective per `loop`; one story per `stage`.
2. A real, fast `done when` predicate — never claim done without a check.
3. `look at:` the relevant files so the agent stays inside the architecture.
4. A `when it fails: reflect, then plan again` so the loop self-corrects.
5. An `after N tries` thrash guard so it can't spin forever.
6. Human gates on anything irreversible.
