# Loop

**An open, natural-language DSL for loop engineering.** Describe a staged, self-correcting, human-gated agent workflow in plain English, press ▶, and it runs on Claude Code.

> Stop tuning prompts. Start editing the loop.

---

## Why

AI writes the code now. But you're still the conductor — kicking off manual pass after manual pass: *"fix the security issues", "now refactor", "now fix the UI."* Even strong methods leave you iterating by hand, in layers, forever.

Loop lets you describe that **movement once**. You don't type the app — you type the *loop*: the objective, the context, the allowed actions, how it verifies itself, when it stops, and where a human steps in. Then you reuse it.

A loop has five knobs — **objective, context, actions, verification, stopping rules**. Today they're buried in a prompt. Loop makes them first-class, editable, and shareable.

## The shape

One structure, two faces — the five decisions you author drive the five phases that run:

```
  DECIDE                          RUN
  objective    → goal:            plan → act → observe
  context      → look at:           ▲            │
  actions      → allow / ask          └ reflect ◄┘ (fail)
  verification → done when                 │
  stopping     → when… / after N    (pass) ▼  →  stop
```

You rarely write all five — defaults carry the simple case, and the editor *nudges*
(never blocks) when a loop is missing something load-bearing. See [the manual](docs/MANUAL.md#the-shape-of-a-loop).

## A taste

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
  after 6 tries:                        stop and warn "thrashing"
```

Compose loops into **stages** and **pipelines**, with humans wired in where judgment lives:

```loop
pipeline "ship feature":
  stage security:
    goal: no high or critical vulnerabilities
    done when "semgrep --severity=high" finds nothing
    each cycle: plan, act, observe
    when it fails: reflect, then plan again

  stage build:
    goal: feature works and tests pass
    a human approves the plan first
    then each cycle: act, observe
    done when "pnpm test" passes

  stage ui:
    goal: matches design, responsive at 375px
    each cycle: plan, act, observe
    a human reviews before stopping
```

## Finishing passes: `also`

Tack lightweight extra operations onto a loop — they run in order *after* the goal is
met (and are skipped if it fails). Polish, security check, docs — the stuff you'd
otherwise forget:

```loop
loop "fix billing":
  goal: settings save with an apostrophe
  done when the test "billing.spec.ts::apostrophe" passes
  each cycle: plan, then act, then observe
  also: polish the code, run a security check, update the docs
```

Each is a policy-gated Claude Code pass. When one needs its own verification, promote it
to a full `stage` instead.

## Chaining loops across files: `flow`

A `flow` sequences loop files, passing the text result of each one forward as context to
the next. Each step runs the whole file; a step that fails stops the chain:

```loop
flow "ship":
  run "build.loop"
  then run "test.loop"
  then run "deploy.loop":
    a human approves first
```

The result of `build.loop` is automatically handed to `test.loop` (text-only). Use
`with the result of <name>` to reference a specific step's output explicitly.

## Iterating over a plan: `for each`

Inside a `flow`, `for each` reads a list from a YAML or Markdown file and runs a template
once per entry — the item's text becomes the template's context:

```loop
flow "deliver":
  for each item in "plan.yaml":
    run "item-template.loop"
```

Each entry in `plan.yaml` triggers one full run of `item-template.loop` with that entry's
text as context. A failed item pauses the flow and asks whether to continue or stop.
See [`examples/foreach/`](examples/foreach/) for a full working bundle.

## The vocabulary (~15 words — learn it once)

`pipeline` · `stage` · `loop` · `flow` · `for each … in …` · `run … then …` · `each cycle` · `goal` · `done when` · `look at` · `allow…/ask me before…` · `also` · `when…` · `reflect` · `a human…` · `stop` · `use` · `schedule` · `git`

Power comes from **composition**, not keyword count.

## Git strategy (safe by default)

Without any `git:` block, Loop works on a branch and commits when the goal is met — it
never pushes to `main` or `master`. A `git:` block at the top of the file lets you opt
into push and a pull request:

```loop
git:
  work on a branch
  commit when the goal is met
  push when done
  open a pull request
```

See [`examples/git_policy.loop`](examples/git_policy.loop) and the [manual](docs/MANUAL.md#git-strategy) for the full set of line forms and cascade rules.

## Authoring: by hand or by agent

Write `.loop` by hand — the [VSCode extension](packages/vscode) gives syntax highlight,
context-aware Ctrl+Space autocomplete, hover docs, and live error squiggles (Copilot
fills the AI-prediction lane). Or ask an AI assistant to write it: drop
[AGENTS.md](AGENTS.md) in your repo and Claude Code / Copilot author `.loop` from a
plain-English request — the language reference travels with the project, so no special
generator is needed.

## Run it inside Claude Code

A bundled **Claude Code skill** (`.claude/skills/loopflow/`) lets you create and run loops
*inside your Claude Code conversation* — no separate process:

```
/loopflow fix the failing auth test in src/auth, gate any database migration
/loopflow run examples/bmad-auth.loop
```

Describe work and it writes the `.loop`; name a `.loop` file and it runs the loop
**natively in the session** — you watch every plan/act/observe/reflect step and answer
human gates right in the chat. Copy `.claude/skills/loopflow/` to `~/.claude/skills/` to use it
in any repo (it's already active inside this one).

## Methods are libraries, not syntax

A method like **BMAD** is just a `.loop` file in the standard library. The core is method-agnostic; `use the BMAD method` pulls in a preset, and your own method is a fork. Sharing a method is the whole flywheel.

## How it runs

Each node maps to a Claude Code invocation:

| Node | What happens |
|---|---|
| `plan` | Claude Code, plan-only, scoped to your `look at` context |
| `act` | Claude Code headless; edits gated by your policy |
| `observe` | runs the verify command, captures pass/fail |
| `reflect` | feeds the failure back as context for the next plan |
| `a human…` | pauses, waits for the person, resumes |
| `done when` | runtime checks the predicate — you can't fake "done" |

Loop runs natively on Claude Code — no extra infrastructure. The `loop-spec` IR is open,
so a `.loop` file can also be **consumed by other tooling** built against the contract.
Native is the default.

## Project layout

| Package | Purpose |
|---|---|
| `@loop-lang/parser` | `.loop` text → `loop-spec` JSON (the open IR) |
| `@loop-lang/runtime` | walks a spec, drives Claude Code, emits a live trace |
| `@loop-lang/vscode` | highlight, formatter, ▶ Play CodeLens, live gutter trace |
| `@loop-lang/stdlib` | `BMAD.loop` + starter presets |
| `@loop-lang/viz` | `loop-run viz file.loop` → self-contained HTML schematic (the cycle + reflect back-edge) |
| `spec/loop-spec.schema.json` | the open IR contract |

## Is this just another &lt;X&gt;?

"Is this another LangChain?", "why not YAML?", "won't better models make this pointless?",
"doesn't it lock me into Claude Code?" — answered straight in the [**FAQ**](docs/FAQ.md).

## Status

Early. v1 in progress: parser, runtime, VSCode extension, BMAD preset. See the [roadmap](#roadmap) and [open issues](../../issues).

## Roadmap

- **v1** — parser, single-loop + sequential pipeline runtime on Claude Code, blocking human nodes, VSCode extension, BMAD preset.
- **v2** — visual graph editor (the `loop-spec` IR is built for it), async human nodes, reactive stages, scheduling, a community preset registry (`use someone/their-method`).

## Contributing

This is a **community project** and an **open standard**. Good first issues: new presets, grammar edge cases, formatter rules. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE). The language and the `loop-spec` IR are an open standard — implement against them freely.
