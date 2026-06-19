# Loop — User Manual

Loop is an open-source natural-language DSL for **loop engineering**. You describe a
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
- [6. How a run works](#6-how-a-run-works)
- [7. VSCode extension](#7-vscode-extension)
- [8. Authoring with an AI agent](#8-authoring-with-an-ai-agent)
- [9. Presets (methods)](#9-presets-methods)
- [10. Exporting to Archon](#10-exporting-to-archon)
- [11. Troubleshooting](#11-troubleshooting)
- [12. The loop-spec IR](#12-the-loop-spec-ir)

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
- The **Claude Code CLI** (`claude`) installed and authenticated — `loop run` drives it.
  Other commands (`parse`, `viz`, `export`) do not need it.

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

or expose a `loop` command by linking the runtime package:

```bash
npm link --workspace @loop/runtime   # then: loop <command> <file.loop>
```

This manual writes `loop` for brevity; substitute `node packages/runtime/dist/cli.js` if
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
loop parse fix.loop          # prints the loop-spec JSON (validates syntax)
loop viz fix.loop            # writes fix.html — open it in a browser
loop run fix.loop            # drives Claude Code: plan -> act -> observe -> done
```

`loop run` works in the directory the `.loop` file lives in: it plans, edits files,
runs your `done when` check, reflects on failure, and stops when the goal is met (or at
the thrash guard).

## 4. The CLI

```
loop <run|parse|export|viz> <file.loop> [--model <alias>] [--out <path>]
```

| Command | What it does |
|---|---|
| `loop run <file>` | Execute the flow on Claude Code (plan/act/observe, reflect, verify, human gates). |
| `loop parse <file>` | Parse to the loop-spec IR and print it as JSON (use to validate syntax). |
| `loop viz <file>` | Write a self-contained HTML schematic of the flow. |
| `loop export <file>` | Compile to an Archon workflow YAML (optional interop). |

**Flags**

- `--model <alias>` — model for `run` (e.g. `opus`, `sonnet`, `haiku`); passed to Claude
  Code. Omit to use the CLI default.
- `--out <path>` — for `viz`, the HTML output file (default: the `.loop` name with an
  `.html` extension). For `export`, a directory to write `<workflow-name>.yaml` into
  (omit to print the YAML to stdout).
- `--json` — print the parsed loop-spec JSON before the command's normal work (handy with
  `run`; also works with `export`/`viz`). For `parse`, the JSON is the entire output.

**Config files.** A `.loop` file containing only a config block with `use` (and no
definitions) resolves the named preset and runs it — e.g. a `project.loop` with
`use the BMAD method`.

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

### Inside a loop / stage body

| Line | Meaning |
|---|---|
| `goal: <text>` | The objective, in plain language. **Required.** |
| `done when <predicate>` | How the loop verifies itself (see Predicates). Omit only if a human gate decides completion. |
| `look at: <a>, <b>, and the last failure` | Files the agent reads before acting. `and the last failure` feeds the previous failure forward. |
| `allow edits automatically, but ask me before <classes>` | Action policy. Auto classes run unattended; confirm classes pause for you. Classes: `edit`, `migrate`, `push`, `deploy`, `delete`. |
| `each cycle: plan, then act, then observe` | The repeated steps — any subset of `plan` / `act` / `observe`, in order. |
| `also: <pass>, <pass>` | Extra finishing passes run **after** the goal is met (skipped on failure). |
| `when it passes and the goal is met: stop` | Success transition. |
| `when it fails: reflect on <focus>, then plan again` | The feedback edge — reflect, then re-enter the cycle. |
| `when blocked: ask a human` | Pause for a person when stuck. |
| `after <N> tries: stop and warn "<msg>"` | Thrash guard — stop after N attempts. |
| `a human approves the plan first` | A person approves the plan before the agent acts. |
| `a human reviews before stopping` | A person judges the result before the loop may stop. |
| `plan from the archon project "<name>"` | Source the plan from an Archon project instead of generating it. |

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
```

The command runs in your shell with your privileges (like an npm script). Keep it fast
and deterministic.

### Config tier (top of file)

```loop
use the BMAD method      # pull in a preset (a .loop in the stdlib, or ./local.loop)
run with claude code     # runner / provider (or: `runner claude code`)
schedule: nightly        # manual · nightly · on push · cron (parsed; run is manual via the CLI)
target: ./src            # working directory the loop operates in
notify: slack            # notification destination (reserved)
```

## 6. How a run works

`loop run` maps each node to a Claude Code invocation:

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
Extension Development Host. **Package a VSIX:** `npm run build --workspace @loop/vscode`
produces a bundled `dist/extension.js`; package with `vsce package`.

Settings: `loop.cliPath` (path to the CLI for the Run button) and `loop.model`.

## 8. Authoring with an AI agent

You don't need to memorize the grammar. Drop [`AGENTS.md`](../AGENTS.md) into your repo and
ask Claude Code (or Copilot) in plain English — "set up a loop to fix the auth test and
gate the deploy." The agent reads the reference and writes the `.loop` for you. The
language travels with the project, so there's no separate generator step.

### The Claude Code skill (`/loop`)

The repo ships a Claude Code skill at `.claude/skills/loop/`. Copy it to `~/.claude/skills/`
to use it in any project (it's already active inside the loop-lang repo). Then:

```
/loop fix the failing checkout tax test, gate any migration   # creates a .loop
/loop run examples/bmad-auth.loop                             # runs one natively
```

The skill both **creates** `.loop` files from a description and **runs** them *inside your
Claude Code session* — walking plan → act → observe → reflect, honoring each `done when`
and thrash guard, and pausing for human gates by asking you in the chat. Because Claude
runs the loop itself, you see every step and answer gates inline, instead of a headless
subprocess. (The `loop run` CLI and the VSCode ▶ button remain the headless ways to run
the same files.)

## 9. Presets (methods)

A method is just a `.loop` file in the standard library. `use the BMAD method` pulls in
`BMAD.loop` (an analyze → architect → build → qa pipeline). Fork it, or point `use` at
your own `./method.loop`. The core is method-agnostic.

## 10. Exporting to Archon

If you already run [Archon](https://github.com/coleam00/Archon), export a flow to its
workflow format:

```bash
loop export file.loop --out .archon/workflows/
```

Loops become Archon **loop nodes** (`until_bash` from `done when`, `max_iterations` from
the thrash guard), pipelines become a DAG via `depends_on`, and human gates become
**approval nodes**. This is optional interop — Loop runs natively on Claude Code without it.

## 11. Troubleshooting

- **`loop run` does nothing / errors immediately** — ensure `claude` is installed and
  authenticated (`claude --version`). `run` shells out to it.
- **"parse error (line N)"** — the line doesn't match the grammar; check indentation
  (two spaces) and that the `done when` predicate is one of the supported forms.
- **The loop never stops** — add `after N tries: stop and warn "…"`; otherwise a hard cap
  of 25 iterations applies.
- **A `done when` test never passes** — the default test command is `npm test -- <target>`;
  if your runner differs, use a command predicate instead: `done when "pnpm test -- x" passes`.
- **A migration/push happened that you didn't want** — add it to the policy:
  `ask me before migrations or pushes`. Only `auto` classes run unattended.
- **`plan from archon` errors** — set `ARCHON_URL` (and `ARCHON_TOKEN` /
  `ARCHON_CODEBASE_ID` if needed) before `loop run`.

## 12. The loop-spec IR

Every `.loop` parses to a JSON **loop-spec** — the open contract defined in
[`spec/loop-spec.schema.json`](../spec/loop-spec.schema.json). Parser, runtime, visualizer,
and the Archon exporter all read it. Build your own tooling against it:

```bash
loop parse file.loop          # prints the loop-spec for a file
```

The language and the IR are an open standard (Apache-2.0) — implement against them freely.
