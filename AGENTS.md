# AGENTS.md — authoring Loop (`.loop`) flows

This file teaches an AI assistant (Claude Code, Copilot, Cursor, etc.) how to write
**Loop** flows. When a user asks you to design a staged, self-correcting, or human-gated
coding workflow — "set up a loop to fix X", "turn this epic into a pipeline", "automate
this multi-step task" — author a `.loop` file using the grammar below, then let the user
run it with `loop run file.loop`.

Loop is a small natural-language DSL. A `.loop` file describes the *movement* of an AI
coding loop: its objective, the context it may read, the actions it's allowed, how it
verifies itself, when it stops, and where a human steps in. The five knobs —
**objective, context, actions, verification, stopping rules** — are first-class instead
of buried in a prompt.

## When to write a `.loop`

Write one when the work is a *repeatable, verifiable* loop or a sequence of them:
bug fixes with a test, refactors gated by a check, an epic broken into stories, a
migration with a verification step. Don't write one for a one-off question or a trivial
edit — just do those directly.

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
reflect                   turn a failure into context for the next plan (the back-edge)

when it passes and the goal is met: stop
when it fails: reflect on <focus>, then plan again
when blocked: ask a human
after <N> tries: stop and warn "<message>"

a human approves the plan first        (human authors/approves the plan before acting)
a human reviews before stopping        (human judges the result before the loop stops)
a human approves before <action>       (a blocking gate before a stage, e.g. deploy)

plan from the archon project "<name>"  (source the plan from Archon instead of generating)

use the <method> method   schedule: <when>   runner: <agent>   target: <dir>   (config tier)
models: fast <model>, strong <model>   model tiering: plan/reflect/also→fast, act→strong (cascades; override e.g. `act fast`, `all strong`)
```

### Predicates (`done when …`)

```
done when the test "billing.spec.ts::apostrophe" passes   # a named test
done when "pnpm test" passes                               # a shell command, exit 0
done when "semgrep --severity=high" finds nothing          # a shell command, empty output
done when a human confirms "looks right at 375px"          # a human check
```

The command in a predicate runs in the user's shell with their privileges (like an npm
script). It IS meant to be a real command. Prefer a fast, deterministic check.

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

## Running what you wrote

- `loop run file.loop` — execute it on Claude Code (plan/act/observe, reflect on failure,
  verify with `done when`, pause at human gates).
- `loop viz file.loop` — open a visual schematic of the flow.
- `loop export file.loop` — emit an Archon workflow YAML (optional interop).

## Authoring checklist

1. One coherent objective per `loop`; one story per `stage`.
2. A real, fast `done when` predicate — never claim done without a check.
3. `look at:` the relevant files so the agent stays inside the architecture.
4. A `when it fails: reflect, then plan again` so the loop self-corrects.
5. An `after N tries` thrash guard so it can't spin forever.
6. Human gates on anything irreversible.
