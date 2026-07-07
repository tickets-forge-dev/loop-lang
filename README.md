<p align="center">
  <img src="docs/gyro-icon.svg" alt="LoopFlow" width="104" height="104" />
</p>

<h1 align="center">LoopFlow</h1>

<p align="center"><b>Structured pseudocode for AI coding agents.</b></p>

<p align="center">LoopFlow turns implicit agent processes into reviewable, runnable <code>.loop</code> files:<br/>goals, context, verification, memory, human gates, composition, and stop rules.</p>

<p align="center"><img src="docs/assets/loop-demo.svg" alt="A Loop turning a failing test green: plan → act → observe (FAIL) → reflect → plan → act → observe (PASS) → done" width="760"></p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache_2.0-34e0c4.svg"></a>
  <a href="https://www.npmjs.com/package/@loop-lang/loop"><img alt="npm" src="https://img.shields.io/npm/v/@loop-lang/loop?color=84b6ff&label=%40loop-lang%2Floop"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=Loop-Lang.loopflow"><img alt="VS Code Marketplace" src="https://img.shields.io/badge/VS%20Code-marketplace-34e0c4.svg"></a>
  <img alt="Node 18+" src="https://img.shields.io/badge/node-%3E%3D18-5fd99a.svg">
</p>

<p align="center">
  <a href="https://loopflow.live/tutorial.html"><b>Tutorial</b></a> ·
  <a href="https://loopflow.live/playground.html">Playground</a> ·
  <a href="https://loopflow.live/keywords/index.html">Keywords</a> ·
  <a href="docs/MANUAL.md">Manual</a> ·
  <a href="https://loopflow.live/market/">Market</a> ·
  <a href="docs/FAQ.md">FAQ</a>
</p>

---

## Quickstart

Install the authoring package into a repo:

```bash
npx @loop-lang/loop init
```

That writes:

- `AGENTS.md` — the full LoopFlow grammar and authoring guide.
- `loop.config` — project defaults, including `live=false`.
- `.claude/skills/loopflow/` — the in-session `/loopflow` skill for Claude Code.
- `examples/fix_test.loop` — a starter loop.
- `templates/` — best-practice starter loops.

Then run a loop in-session:

```text
/loopflow run examples/fix_test.loop
```

Or run headless:

```bash
npm i -g @loop-lang/runtime
loop-run show examples/fix_test.loop
loop-run run examples/fix_test.loop
```

## The idea

A prompt is usually an implicit process:

```text
look at these files → make a change → run the test → if it fails, diagnose → try again → stop when safe
```

LoopFlow writes that process down in a small structured language. A loop is the smallest useful process; pipelines and flows compose loops into larger work.

```text
goal → context → policy → plan → act → observe → reflect → memory → stop
```

The model does the work. The `.loop` file defines what it is allowed to read/edit, how reality is checked, when it may retry, where a human gates risk, and when it must stop.

## A loop file

```loop
loop "fix billing apostrophe bug":
  goal: settings save when the company name has an apostrophe
  done when the test "billing.spec.ts::apostrophe" passes

  look at: billing/form.tsx, api/settings.ts, schema/settings.ts, and the last failure
  allow edits automatically, but ask me before migrations or pushes
  remember in "billing.memory.md"

  each cycle: plan, then act, then observe
  when it fails: reflect on which layer broke, then plan again
  when blocked: ask a human
  after 6 tries: stop and warn "thrashing"
```

## Core primitives

| Primitive | Purpose |
|---|---|
| `goal:` | Plain-English success condition. |
| `done when` | Machine or human check: tests, shell commands, scans, skill evals, review gates. |
| `look at:` | Context boundary: files, docs, examples, and `the last failure`. |
| `allow…ask me before…` | Action policy: automatic edits, gated migrations/pushes/deploys. |
| `each cycle:` | Execution cycle: `plan`, `act`, `observe`. |
| `when it fails:` | Feedback edge: reflect on the failure and re-plan. |
| `after N tries:` | Thrash guard. No unbounded agent loops. |
| `remember in` | Cross-run memory in markdown. |
| `a human…` | Human approvals and review gates. |
| `pipeline`, `flow`, `for each` | Composition: stages, chained files, and backlog fanout. |
| `git:` | Branch/worktree, commit, push, PR policy. |
| `models:` | Route phases to fast/strong model tiers. |

Full grammar: [`AGENTS.md`](AGENTS.md). Keyword reference: <https://loopflow.live/keywords/>.

## Verification is the source of truth

`done when` is how a loop knows reality. Multiple `done when` lines are conjunctive: all must pass.

```loop
done when "pnpm test checkout" passes 3 times

done when "semgrep --severity=high" finds nothing

done when the skill "code-review" approves on the trajectory
  the bar: did not weaken tests or write outside src/
```

Supported verification patterns:

- shell command exits zero: `"pnpm test" passes`
- shell command emits nothing: `"semgrep …" finds nothing`
- flake guard: `passes 3 times`
- human confirmation: `a human confirms "looks right"`
- review skill: `the skill "api-review" scores 8 or more`
- trajectory eval: judge how the agent got there, not just the output
- judge panel: `by 3 judges`

Details: [How verification works](docs/MANUAL.md#how-verification-works--what-done-actually-depends-on).

## Memory model

LoopFlow has two memory layers.

### Short-term memory: the current run

A failed check becomes the next plan’s input:

```loop
look at: src/checkout/, tests/checkout/, and the last failure
when it fails: reflect on what the test proved, then plan again
```

`reflect` summarizes the failure; `and the last failure` feeds it into the next cycle.

### Long-term memory: future runs

```loop
remember in "checkout.memory.md"
```

The loop reads that markdown file before planning and appends a dated outcome when it stops. Use it when a loop repeats, thrashes, or carries project-specific lessons.

## Compose processes

### Pipeline: ordered stages

```loop
pipeline "checkout v2":
  stage "cart totals":
    goal: totals include tax
    done when "pnpm test cart" passes

  stage "submit order":
    goal: orders submit safely
    done when "pnpm test checkout" passes
    a human approves before charging a card
```

### Flow: chain loop files

```loop
flow "ship":
  run "build.loop"
  then run "test.loop"
  then run "deploy.loop":
    a human approves first
```

### For each: run a template over a backlog

```loop
flow "bmad sprint":
  for each story in "sprint.yaml":
    run "story-template.loop"
```

The source can be YAML or Markdown. Each item becomes context for the template.

## BMAD + LoopFlow

Use LoopFlow alone for small, checkable work. For real product work, we recommend pairing LoopFlow with a method like BMAD.

BMAD gives you discovery, PRD/tech-spec, architecture, epics, stories, and sprint status. LoopFlow turns each repeatable story into a verifiable agent process.

Recommended split:

```text
BMAD decides what to build and in what order.
LoopFlow executes each story until verified.
```

Do not port all of BMAD into LoopFlow. Use BMAD for methodology and LoopFlow for execution control: `done when`, reflection, gates, memory, and try limits.

See [`examples/bmad/`](examples/bmad/) and [`examples/bmad-auth.loop`](examples/bmad-auth.loop).

## Runtime architecture

```text
.loop text
  ↓ @loop-lang/parser
loop-spec JSON IR
  ↓ @loop-lang/runtime
runner cycle: plan → act → observe → reflect
  ↓ verifier / human / skill / git / events
trace, live dashboard, logs, resume, commit
```

Runtime properties:

- deterministic parser with a JSON IR (`loop-spec`)
- shell-backed verification for commands/tests
- skill-backed eval predicates
- human gates
- event stream for live dashboards and logs
- resume from event logs
- git branch/worktree policy
- model tier routing
- optional live browser visualization

## Packages

| Package | Purpose |
|---|---|
| `@loop-lang/loop` | repo initializer: installs grammar, templates, examples, and agent skill |
| `@loop-lang/parser` | `.loop` text → `loop-spec` JSON |
| `@loop-lang/runtime` | executes loop specs and emits events |
| `@loop-lang/viz` | static diagrams and live dashboard |
| `@loop-lang/stdlib` | method presets, including `BMAD.loop` |
| `loopflow` VS Code extension | syntax, diagnostics, completions, templates, run CodeLens |

## Run headless

```bash
loop-run show file.loop                  # parse + ASCII preview
loop-run run file.loop                   # execute
loop-run run file.loop --live            # live browser dashboard
loop-run run file.loop --log run.log     # NDJSON event log
loop-run run file.loop --resume run.log  # skip what the log proves done
loop-run ls                              # list loops in repo
```

In-session dashboard is opt-in: set `live=true` in `loop.config`.

## Authoring workflow

Use a template first:

- [`templates/bugfix.loop`](templates/bugfix.loop)
- [`templates/feature.loop`](templates/feature.loop)
- [`templates/load-spec.loop`](templates/load-spec.loop)
- [`templates/security.loop`](templates/security.loop)
- [`templates/review-diff.loop`](templates/review-diff.loop)

Every `.loop` should answer:

1. What is the goal?
2. What proves done?
3. What context should the agent read?
4. What actions are automatic vs gated?
5. When does it reflect, ask, or stop?

Then run:

```bash
loop-run show file.loop
```

`show` is both the preview and the parse check.

## VS Code

Install the [LoopFlow VS Code extension](https://marketplace.visualstudio.com/items?itemName=Loop-Lang.loopflow):

```text
ext install Loop-Lang.loopflow
```

It provides highlighting, diagnostics, completions, templates, hover docs, and Run CodeLens.

## Roadmap

- runner abstraction for non-Claude/local/API models
- platform-specific skill installation flags (`--pi`, `--claude`, etc.)
- GitHub Action for loops as CI quality gates
- community method/template registry
- richer visual editor over the `loop-spec` IR

## FAQ

Straight answers to “why not YAML?”, “is this LangChain?”, “does this replace BMAD?”, “won’t better models make this pointless?”, and “does it lock me into Claude?” live in [`docs/FAQ.md`](docs/FAQ.md).

## Contributing

This is a community project and an open standard. Good first issues: templates, grammar edge cases, parser tests, runner integrations, docs, and examples.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE). The language and `loop-spec` IR are open; implement against them freely.

## Maintainer

<a href="https://www.linkedin.com/in/idan-ayalon/"><img src="docs/idan.jpg" alt="Idan Ayalon" width="104" align="left" hspace="18" vspace="4" /></a>

**Idan Ayalon** — creator and maintainer of LoopFlow. Built **Forge** with it.

📧 [bar.idan@gmail.com](mailto:bar.idan@gmail.com)  
💼 [linkedin.com/in/idan-ayalon](https://www.linkedin.com/in/idan-ayalon/)

<br clear="left" />
