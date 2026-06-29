# LoopFlow — User Manual

LoopFlow is an open-source natural-language DSL for **loop engineering**. You describe a
staged, self-correcting, human-gated AI coding workflow in plain English in a `.loop`
file, then run it natively on Claude Code. The loop's five knobs — objective, context,
actions, verification, stopping rules — are first-class and editable instead of buried in
a prompt.

- [The shape of a loop](#the-shape-of-a-loop)
- [1. Requirements](#1-requirements)
- [2. Install](#2-install)
- [3. Quickstart](#3-quickstart)
- [4. The CLI](#4-the-cli)
- [5. Language reference](#5-language-reference)
  - [Git strategy](#git-strategy)
- [6. How a run works](#6-how-a-run-works)
- [7. VSCode extension](#7-vscode-extension)
- [8. Authoring with an AI agent](#8-authoring-with-an-ai-agent)
- [9. Presets (methods)](#9-presets-methods)
- [10. Troubleshooting](#10-troubleshooting)
- [11. The loop-spec IR](#11-the-loop-spec-ir)

---

## The shape of a loop

Every loop has one structure with two faces. You **author five decisions** (the knobs);
the runtime executes **five phases** (the cycle). The knobs configure the phases.

```
        what you DECIDE                     what RUNs
        (the .loop you write)               (each iteration)

        objective   →  goal:                ┌─────────────────────────────┐
        context     →  look at:             │   plan → act → observe      │
        actions     →  allow / ask me…      │     ▲              │        │
        verification → done when            │     └── reflect ◄──┘ (fail) │
        stopping    →  when… / after N      └──────────── │ ──────────────┘
                                                     (pass) ▼
                                                          stop
```

| Knob | The line | Configures the phase |
|---|---|---|
| Objective | `goal:` | what `stop` is aiming at |
| Context | `look at:` | what `plan` may read |
| Actions | `allow … / ask me before …` | what `act` may do |
| Verification | `done when …` | what `observe` checks |
| Stopping | `when …` / `after N tries` | `stop` + the `reflect` back-edge |

You rarely write all five — sensible defaults cover the simple case (the cycle defaults to
plan→act→observe; edits default to auto). The VSCode extension nudges you when a loop is
missing something load-bearing (e.g. no way to verify "done", or a back-edge with no
thrash guard) — a warning, never an error. Structure guides; it doesn't cage.

## 1. Requirements

- **Node.js 18+**
- The **Claude Code CLI** (`claude`) installed and authenticated — `loop-run run` drives it.
  Other commands (`parse`, `viz`) do not need it.

## 2. Install

Build from source (the monorepo):

```bash
git clone <repo-url> loop-lang
cd loop-lang
npm install
npm run build        # builds every package
npm test             # optional: run the test suite
```

The CLI entry point is `packages/runtime/dist/cli.js`. Either run it directly:

```bash
node packages/runtime/dist/cli.js <command> <file.loop>
```

or expose a `loop-run` command by linking the runtime package:

```bash
npm link --workspace @loop-lang/runtime   # then: loop-run <command> <file.loop>
```

This manual writes `loop-run` for brevity; substitute `node packages/runtime/dist/cli.js` if
you did not link.

## 3. Quickstart

Create `fix.loop`:

```loop
loop "fix add":
  goal: the add function returns the sum of its two arguments
  done when "npm test" passes
  look at: src/add.js
  allow edits automatically
  each cycle: plan, then act, then observe
  when it fails: reflect on why it failed, then plan again
  after 5 tries: stop and warn "could not fix add"
```

Check it parses, see it, then run it:

```bash
loop-run parse fix.loop      # prints the loop-spec JSON (validates syntax)
loop-run viz fix.loop        # writes fix.html — open it in a browser
loop-run run fix.loop        # drives Claude Code: plan -> act -> observe -> done
```

`loop-run run` works in the directory the `.loop` file lives in: it plans, edits files,
runs your `done when` check, reflects on failure, and stops when the goal is met (or at
the thrash guard).

## 4. The CLI

```
loop-run <run|parse|viz|live|show|explain|ls|emit> <file.loop> [--model <alias>] [--live] [--out <path>]
```

| Command | What it does |
|---|---|
| `loop-run run <file>` | Execute the flow on Claude Code (plan/act/observe, reflect, verify, human gates). |
| `loop-run parse <file>` | Parse to the loop-spec IR and print it as JSON (use to validate syntax). |
| `loop-run show <file>` | Print the loop's flow as compact ASCII (the "see the shape" view). |
| `loop-run explain <file>` | Describe the loop in **plain English** — handy for non-experts to check what a `.loop` will actually do. |
| `loop-run viz <file>` | Write a self-contained HTML schematic of the flow. |
| `loop-run ls [dir]` | List every `.loop` under a directory with its one-line shape. |
| `loop-run live <file>` | Start the live dashboard server (no engine) and stay up; for driving the dashboard from an in-session run. |
| `loop-run emit <port> '<json>'` | Push one event to a running `live` server (used by the `/loopflow` skill). |

**Flags**

- `--model <alias>` — model for `run` (e.g. `opus`, `sonnet`, `haiku`); passed to Claude
  Code. Omit to use the CLI default.
- `--live` — for `run`, open a live browser dashboard and stream every step to it as the
  loop executes (see below).
- `--out <path>` — for `viz`, the HTML output file (default: the `.loop` name with an
  `.html` extension).
- `--json` — print the parsed loop-spec JSON before the command's normal work (handy with
  `run`; also works with `viz`). For `parse`, the JSON is the entire output.

**Config files.** A `.loop` file containing only a config block with `use` (and no
definitions) resolves the named preset and runs it — e.g. a `project.loop` with
`use the BMAD method`.

### Live dashboard

A real-time browser view of a run: the loop's **actual structure** as a turn-by-turn route
(pipeline stages / flow steps / for-each items), with a "you are here" marker, the steps
ahead, human gates flagged, and for-each sprints listed by item title with N/total progress.

Two ways to drive it:

- **Headless** — `loop-run run <file> --live` opens a browser tab and the engine streams
  every event to it. The terminal still prints the normal text trace.
- **In-session** — when you run a loop inside Claude Code via `/loopflow`, the dashboard is
  **opt-in via `loop.config`**: `loop init` writes `loop.config` with `live=false` (off by
  default), and the skill only opens the dashboard when you set `live=true`. When enabled it
  starts `loop-run live <file>` in the background (which prints `LOOP_LIVE_PORT=<port>` and
  opens the browser) and pushes an event per narrated step with
  `loop-run emit <port> '<event-json>'`. The headless `--live` flag is independent of this
  config.

The page connects over Server-Sent Events; each event carries an id and the server replays
on connect (and dedupes on reconnect via `Last-Event-ID`), so events fired before the browser
connects are not lost and a transient drop doesn't double-deliver. The dashboard is
self-contained (no external assets) and binds to `127.0.0.1` only.

## 5. Language reference

A `.loop` file is indentation-structured. `loop` / `pipeline` sit at column 0; their body
is indented two spaces; a `stage`'s body is indented under the stage. Comments start with
`#`.

### Definitions

- **`loop "<name>":`** — a single self-correcting loop. Requires a `goal`.
- **`pipeline "<name>":`** — a sequence of stages. Requires at least one `stage`. Stages
  run in order; a failing stage halts the rest. (An epic → a pipeline.)
- **`stage "<name>":`** — one stage of a pipeline; its body is a loop. (A story → a stage.)
- **`flow "<name>":`** — a chain of `.loop` files. Each step runs a whole file and passes
  its text result forward. Fail-fast: a step that ends unsatisfied stops the rest.

### Chaining loops across files (`flow`)

A `flow` lets you sequence independent `.loop` files into a single pipeline where the
output of one step becomes the context for the next. This is useful when each phase lives
in its own file and should be reusable independently:

```loop
flow "ship":
  run "build.loop"
  then run "test.loop"
  then run "deploy.loop":
    a human approves first
```

| Element | Meaning |
|---|---|
| `run "<file>"` | First step. Runs the whole file (plan→act→observe); text result is carried forward. |
| `then run "<file>"` | Subsequent step. Automatically receives the previous step's text summary as upstream context. |
| `a human approves first` | Optional per-step human gate — blocks until approved before the step runs. |
| `with the result of <name>` | Reference a specific named step's output instead of the automatic carry. |

**Text handoff.** Only the text summary (the last observe output or final plan) is passed
between steps — not file state. File edits made by one step are visible to the next
through the working directory as normal; the explicit channel is the text summary.

**Fail-fast.** If any step ends unsatisfied, the remaining steps are skipped and the flow
ends unsatisfied.

### Iterating over a plan (`for each`)

Inside a `flow`, `for each` reads a list from a YAML or Markdown file and runs a template
once per entry. Each entry's text becomes the template's context — what to build.

```loop
flow "deliver":
  for each item in "plan.yaml":
    run "item-template.loop"
```

| Element | Meaning |
|---|---|
| `for each <var> in "<file>":` | Read items from the file; run the body once per item. |
| `run "<template>"` | Template to run per item; the item text arrives as context. |
| Source `.yaml` | A flat list or a single-key list (e.g. `items:`). |
| Source `.md` | Splits on `## ` headings — each section is one item. |
| Failed item | The flow pauses and asks whether to continue with the next item or stop. |

**A-to-Z with any method.** `for each` is method-neutral. The same syntax works whether
the template is a BMAD story checklist, a security scan, a documentation pass, or anything
else. See [`examples/foreach/`](../examples/foreach/) for a generic bundle (implement →
security → lint, per work item) and [`examples/bmad/atoz/`](../examples/bmad/atoz/) for a
BMAD flow (discover → design → for each story) as one example method.

### Inside a loop / stage body

| Line | Meaning |
|---|---|
| `goal: <text>` | The objective, in plain language. **Required.** |
| `done when <predicate>` | How the loop verifies itself (see Predicates). **You can list several — all must pass** (a conjunction of tests and evals). Omit only if a human gate decides completion. |
| `look at: <a>, <b>, and the last failure` | Context the agent reads before acting. Items are file paths or plain-language descriptions (e.g. `the billing form`) — the agent locates the actual files from descriptions before planning. `and the last failure` feeds the previous failure forward. |
| `allow edits automatically, but ask me before <classes>` | Action policy. Auto classes run unattended; confirm classes pause for you. Classes: `edit`, `migrate`, `push`, `deploy`, `delete`. |
| `each cycle: plan, then act, then observe` | The repeated steps — any subset of `plan` / `act` / `observe`, in order. |
| `also: <pass>, <pass>` | Extra finishing passes run **after** the goal is met (skipped on failure). |
| `use skills: <a>, <b>` | Named skills the loop may invoke during `plan`/`act` — coordinate proven skills instead of one mega-prompt. |
| `remember in "<file.md>"` | Cross-run memory: read the file's lessons into the first plan, append a dated outcome entry on stop. (`keep a memory in "<file>"` also works.) |
| `when it passes and the goal is met: stop` | Success transition. |
| `when it fails: reflect on <focus>, then plan again` | The feedback edge — reflect, then re-enter the cycle. |
| `when blocked: ask a human` | Pause for a person when stuck. |
| `after <N> tries: stop and warn "<msg>"` | Thrash guard — stop after N attempts. |
| `a human approves the plan first` | A person approves the plan before the agent acts. |
| `a human reviews before stopping` | A person judges the result before the loop may stop. |
| `plan from "<file>"` | Read the loop's plan from a file you control (e.g. a hand-written `.md`) instead of having the agent generate it. Omit it and the agent writes the plan (the default). |

### Friendly shorthands

Plain-English synonyms for the lines above — write whichever reads naturally to you. They
desugar to the exact same loop-spec, so you never lose any power:

| Shorthand | Same as |
|---|---|
| `check: pnpm test` | `done when "pnpm test" passes` (a bare value is a shell command) |
| `check: the skill "review" approves` | `done when the skill "review" approves` (a predicate phrase is parsed as-is) |
| `verify: …` | same as `check:` |
| `in: src/cart, src/tax` · `files: …` · `look in: …` · `context: …` | `look at: …` |
| `when it breaks: …` | `when it fails: …` |
| `when it gets stuck: …` | `when blocked: …` |

A complete, friendly loop can be as short as:

```loop
loop "fix the cart total":
  goal: the cart total is correct with tax
  in: src/cart, src/tax
  check: pnpm test cart
  when it breaks: reflect, then plan again
  after 6 tries: stop and warn "stuck"
```

Run `loop-run explain <file>` to read any loop back in plain English and confirm it does
what you intend.

### In a stage only

| Line | Meaning |
|---|---|
| `a human approves before <action>` | A blocking gate before the stage runs (e.g. before deploy). Parses in any loop body, but only a `stage` acts on it — in a standalone `loop` it is silently ignored. |

### Predicates (`done when …`)

```loop
done when the test "billing.spec.ts::apostrophe" passes   # a named test
done when "pnpm test" passes                               # shell command, exit 0 (`succeeds` also works)
done when "semgrep --severity=high" finds nothing          # shell command, empty stdout
done when a human confirms "looks right at 375px"          # a human check
done when the skill "email-review" approves                # an eval: approved / not
done when the skill "email-review" scores 8 or more        # an eval: numeric threshold
done when the skill "api-review" scores 8 or more on the output       # an eval of WHAT was produced
done when the skill "path-review" approves on the trajectory          # an eval of HOW it got there
  the bar: didn't weaken a test to go green; no writes outside api/   # the rubric the judge scores against
```

The command runs in your shell with your privileges (like an npm script). Keep it fast
and deterministic.

#### Tests vs evals

A loop can list **several `done when` lines, and all must pass.** Use this to combine the
two kinds of verification:

- **Tests** — `test` / command predicates. Deterministic, checked by code.
- **Evals** — `skill` predicates. A rubric / LM judge for the non-deterministic parts. An
  eval names its **subject**: `on the output` (the default — judges *what* was produced) or
  `on the trajectory` (judges *how* the agent got there — its path and tool calls). An
  indented `the bar:` line states the conditions the judge must score against.

A trajectory eval catches what a green test can't — e.g. an agent that made a test pass by
weakening it. Pair a test with an eval when "done" means both *it works* and *it was built
the right way*. Build the review skill manually first and confirm it judges well, then wire
it in. See `examples/skills_memory.loop` and `examples/email_review.loop`.

### Config tier (top of file)

```loop
use the BMAD method      # pull in a preset (a .loop in the stdlib, or ./local.loop)
run with claude code     # runner / provider (or: `runner claude code`)
schedule: nightly        # manual · nightly · on push · cron (parsed; run is manual via the CLI)
target: ./src            # working directory the loop operates in
notify: slack            # notification destination (reserved)
each cycle: plan, then act, then observe   # the DEFAULT cycle for every loop in the file
```

Anything in the config tier is a **default for every loop in the file**, so you write it
once instead of repeating it per loop. A `each cycle:` here is inherited by every loop; a
loop with its own `each cycle:` overrides it. The same lowest-wins cascade governs `git:`
and `models:`.

#### Project defaults — `loop.config`

To avoid repeating config across *files*, drop a **`loop.config`** (or `.looprc`) at your
project root. It uses the same config-tier syntax (`each cycle:`, `models:`, a `git:`
block) and the runner reads it before every run, walking up from the `.loop` file to find
it. It is the **lowest** tier of the cascade, so a file's own config and a per-loop
directive both override it.

```loop
# loop.config — applies to every .loop in the repo
each cycle: plan, then act, then observe
models: fast haiku, strong opus
git:
  work on a branch
  commit when the goal is met
```

**Cascade (lowest wins):** `loop.config` → a file's config tier → a per-loop directive.

### Agentic-engineering features

These add agentic-engineering discipline to Loop. All are optional; a simple loop ignores them.

| Construct | Where | What it does |
|---|---|---|
| `rigor: vibe coding \| structured ai-assisted \| agentic engineering` | config tier | The spectrum dial. Under structured/agentic, every loop is **born with** a reflect-on-fail back-edge and a thrash guard unless it sets its own — sensible defaults, no boilerplate. Also enables the "without both [tests and evals]" lint. |
| `mode: conductor \| orchestrator` | config tier | Supervision posture — conductor (in-session, gates inline) vs orchestrator (async, opens a PR). |
| `hooks:` block | loop body | Deterministic checks at lifecycle points — `before each cycle` / `after act` / `on commit` / `on push` / `on stop`: `"<cmd>" passes` or `finds nothing`. **A failing hook blocks.** |
| `observe:` block | config tier | `trace every cycle` / `meter tokens and cost` / `stop and warn if cost exceeds "$N"`. The CLI prints a stop-time **OpEx report** (cycles, reflects, first-pass success). |
| `sandbox:` block | config tier | Run isolation: `no network access` / `allow egress to "host" only` / `cap cpu at … memory at … time at …`. |
| `runs as: <identity>` | config tier | An auditable principal for unattended runs. |
| `examples:` / `knowledge:` | loop body | `examples:` = reference patterns to imitate; `knowledge:` = read-only reference the agent must not edit. With `look at:`/`remember in:`/`use skills:`/`allow…ask`, a loop can declare all six context-engineering parts. |
| `use tools from the "<server>" server` | loop body | Name MCP servers whose tools the loop may use. |
| `stages in parallel:` | inside a pipeline | The indented stages run **concurrently** (barrier-join, fail-fast). File-safe parallel edits need a worktree per branch. |

See [`examples/agentic/`](../examples/agentic/) for one file per feature; run `loop-run explain
<file>` on any of them to read it back in plain English.

### Git strategy

A `git:` block sets the version-control strategy for the run. It can appear at the top of
the file (config tier, applying to all loops) or inside a single `loop` body (refining
the commit cadence for that loop only).

**Built-in default (no `git:` block):** LoopFlow works on a branch and commits when the goal
is met. No push happens. This default applies whenever no git block is present.

**Line forms:**

| Line | Meaning |
|---|---|
| `work in place` | Edit the current branch as-is (no new branch). |
| `work on a branch` | Create / switch to a feature branch (the default). |
| `work on a branch "name"` | Use a specific branch name. |
| `work in a worktree` | Run in an isolated git worktree. |
| `work in a worktree "name"` | Named worktree. |
| `commit when the goal is met` | One commit when the loop succeeds (the default). |
| `commit each cycle` | Commit after every plan→act→observe cycle. |
| `commit each story` | Commit after each stage in a pipeline. |
| `commit never` / `do not commit` | No automatic commits. |
| `push when done` | Push the branch when the loop finishes. |
| `do not push` | No push (the default). |
| `open a pull request` | Open a PR after pushing (requires `push when done`). |

**Cascade — settings resolve in three layers:**

1. Built-in default — branch + commit-when-done, no push.
2. File-level `git:` block — applies to all loops in the file.
3. Per-loop `git:` block — placed inside the loop body; refines the commit cadence for that loop only.

A `use the <method>` preset may carry a `git:` block at file level; the file's own block overrides it.

**Always-on safety — unconditional, not configurable:**

- **Never push to `main` or `master`.** If the current branch is protected and `push when done` is set, the error surfaces *before the loop runs*.
- **`work in place` + `push when done` on a protected branch** is likewise rejected up front.

**Example:**

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

See [`examples/git_policy.loop`](../examples/git_policy.loop) for the full working file.

### Model policy

A loop is several LLM calls per cycle, so naively it could cost more than a single prompt. The `models:` policy fixes that: name two tiers and the engine routes the cheap-thinking phases to the fast one and the hard `act` to the strong one — a stack of cheap calls plus one strong call per cycle, not N expensive prompts.

**Grammar (config tier, before any definition, or inside a loop body):**

```loop
models: fast <model>, strong <model>
```

**Built-in default mapping:**

| Phase | Tier |
|---|---|
| `plan` | fast |
| `reflect` | fast |
| `also` passes | fast |
| `act` | strong |
| `observe` | shell check — no model |

Override a single phase or a whole scope, and it cascades file→loop→stage the same way the `git:` block does:

```loop
models: fast haiku, strong opus, plan strong   # flip one phase to strong
models: all strong                              # whole scope on one tier
```

**Kill switch:** `--model X` (CLI flag) or `loop.model` (VS Code setting) forces every phase onto one model, overriding any `models:` block.

**Cost summary:** at the end of a run, LoopFlow prints a per-tier call count so the spend is measurable, not a guess.

## 6. How a run works

`loop-run run` maps each node to a Claude Code invocation:

| Node | What happens |
|---|---|
| `plan` | Claude Code in plan mode, read-only, scoped to your `look at` context. |
| `act` | Claude Code headless; edits gated by your policy (auto classes allowed; confirm classes prompt you). |
| `observe` | Runs the `done when` predicate and captures pass/fail + output. |
| `reflect` | Feeds the failure back as context for the next plan (the back-edge). |
| `a human …` | Pauses on the terminal for your `y/N` (plan approval, review, gate, confirm). |
| `done when` | The runtime checks the predicate — you cannot fake "done". |

Notes:
- The cycle repeats until `done when` passes, a thrash guard fires, or a hard safety cap
  (25 iterations) is reached.
- A `test` predicate runs `npm test -- <target>` by default.
- In a pipeline, stages run sequentially; a stage that ends unsatisfied halts the rest.
- Confirm-class actions are asked once per loop, then remembered for that run.

## 7. VSCode extension

The extension (`packages/vscode`) gives `.loop` files real editor tooling:

- **Syntax highlighting**
- **Ctrl+Space autocomplete** — context-aware (offers only what's valid where the cursor
  is: top-level vs loop body vs pipeline vs stage body)
- **Hover docs** on the vocabulary
- **Live error squiggles** — parses as you type and underlines the offending line
- **Formatter** (Format Document; runs on save only if you enable `editor.formatOnSave`)
- **▶ Run loop** CodeLens above each `loop`/`pipeline`/`flow`

Inline AI prediction is intentionally left to Copilot/your editor's AI — write a `#`
comment describing intent and let it draft the `.loop`.

**Install (development):** open `packages/vscode` in VSCode and press F5 to launch an
Extension Development Host. **Package a VSIX:** `npm run build --workspace @loop-lang/vscode`
produces a bundled `dist/extension.js`; package with `vsce package`.

Settings: `loop.cliPath` (path to the CLI for the Run button) and `loop.model`.

## 8. Authoring with an AI agent

You don't need to memorize the grammar. Drop [`AGENTS.md`](../AGENTS.md) into your repo and
ask Claude Code (or Copilot) in plain English — "set up a loop to fix the auth test and
gate the deploy." The agent reads the reference and writes the `.loop` for you. The
language travels with the project, so there's no separate generator step.

### The Claude Code skill (`/loopflow`)

The repo ships a Claude Code skill at `.claude/skills/loopflow/`. Copy it to `~/.claude/skills/`
to use it in any project (it's already active inside the loop-lang repo). Then:

```
/loopflow fix the failing checkout tax test, gate any migration   # creates a .loop
/loopflow run examples/bmad-auth.loop                             # runs one natively
```

The skill both **creates** `.loop` files from a description and **runs** them *inside your
Claude Code session* — walking plan → act → observe → reflect, honoring each `done when`
and thrash guard, and pausing for human gates by asking you in the chat. Because Claude
runs the loop itself, you see every step and answer gates inline, instead of a headless
subprocess. (The `loop-run run` CLI and the VSCode ▶ button remain the headless ways to run
the same files.)

## 9. Presets (methods)

A method is just a `.loop` file in the standard library. `use the BMAD method` pulls in
`BMAD.loop` (an analyze → architect → build → qa pipeline). Fork it, or point `use` at
your own `./method.loop`. The core is method-agnostic.

## 10. Troubleshooting

- **`loop-run run` does nothing / errors immediately** — ensure `claude` is installed and
  authenticated (`claude --version`). `run` shells out to it.
- **"parse error (line N)"** — the line doesn't match the grammar; check indentation
  (two spaces) and that the `done when` predicate is one of the supported forms.
- **The loop never stops** — add `after N tries: stop and warn "…"`; otherwise a hard cap
  of 25 iterations applies.
- **A `done when` test never passes** — the default test command is `npm test -- <target>`;
  if your runner differs, use a command predicate instead: `done when "pnpm test -- x" passes`.
- **A migration/push happened that you didn't want** — add it to the policy:
  `ask me before migrations or pushes`. Only `auto` classes run unattended.
- **`plan from "<file>"` doesn't load** — check the path is relative to the `.loop` file
  and the file exists; the loop reads its plan from that file verbatim.

## 11. The loop-spec IR

Every `.loop` parses to a JSON **loop-spec** — the open contract defined in
[`spec/loop-spec.schema.json`](../spec/loop-spec.schema.json). Parser, runtime, and
visualizer all read it. Build your own tooling against it:

```bash
loop-run parse file.loop      # prints the loop-spec for a file
```

The language and the IR are an open standard (Apache-2.0) — implement against them freely.
