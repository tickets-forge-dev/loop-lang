<p align="center">
  <img src="docs/gyro-icon.svg" alt="LoopFlow" width="104" height="104" />
</p>

<h1 align="center">LoopFlow</h1>

<p align="center"><b>An open, natural-language DSL for loop engineering.</b><br/>Describe a staged, self-correcting, human-gated agent workflow in plain English, press ▶, and it runs on Claude Code.</p>

<p align="center"><i>Stop babysitting the agent. Write the goal once — the loop plans, acts, reflects on red,<br/>and stops only when the check is green, at the gates you set.</i></p>

<p align="center"><img src="docs/assets/loop-demo.svg" alt="A Loop turning a failing test green: plan → act → observe (FAIL) → reflect → plan → act → observe (PASS) → done" width="760"></p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache_2.0-34e0c4.svg"></a>
  <a href="https://www.npmjs.com/package/@loop-lang/loop"><img alt="npm" src="https://img.shields.io/npm/v/@loop-lang/loop?color=84b6ff&label=%40loop-lang%2Floop"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=Loop-Lang.loopflow"><img alt="VS Code Marketplace" src="https://img.shields.io/visual-studio-marketplace/v/Loop-Lang.loopflow?color=34e0c4&label=VS%20Code"></a>
  <img alt="Node >=18" src="https://img.shields.io/badge/node-%3E%3D18-5fd99a.svg">
</p>

---

<p align="center">
  <a href="https://loopflow.live"><b>📖 Read the tutorial → loopflow.live</b></a>
</p>

<p align="center">
  <a href="https://loopflow.live">Tutorial</a> ·
  <a href="https://loopflow.live/playground.html">⚡ Playground</a> ·
  <a href="https://loopflow.live/workshop.html">🛠️ Workshop</a> ·
  <a href="https://loopflow.live/game.html">🎮 Lab</a> ·
  <a href="https://github.com/tickets-forge-dev/loop-lang/blob/master/docs/MANUAL.md">Manual</a> ·
  <a href="https://loopflow.live/keywords/index.html">Keywords</a> ·
  <a href="docs/FAQ.md">FAQ</a>
</p>

## Quickstart

```bash
npx @loop-lang/loop init      # installs the /loopflow skill + AGENTS.md
```

Then, in a Claude Code chat:

```
/loopflow fix the failing test — done when the suite passes
```

It plans → acts → observes, reflects on a red test, and stops only when the check is green — never pushing to `main`. Full walkthrough at **[loopflow.live](https://loopflow.live)**.

## Why

AI writes the code now. But you're still the conductor — kicking off manual pass after manual pass: *"fix the security issues", "now refactor", "now fix the UI."* Even strong methods leave you iterating by hand, in layers, forever.

LoopFlow lets you describe that **movement once**. You don't type the app — you type the *loop*: the objective, the context, the allowed actions, how it verifies itself, when it stops, and where a human steps in. Then you reuse it.

A loop has five knobs — **objective, context, actions, verification, stopping rules**. Today they're buried in a prompt. LoopFlow makes them first-class, editable, and shareable.

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

  stage "security":
    goal: no high or critical vulnerabilities
    done when "semgrep --severity=high" finds nothing
    each cycle: plan, then act, then observe
    when it fails: reflect, then plan again

  stage "build":
    goal: feature works and tests pass
    a human approves the plan first
    done when "pnpm test" passes
    each cycle: act, then observe

  stage "ui":
    goal: matches design, responsive at 375px
    each cycle: plan, then act, then observe
    a human reviews before stopping
```

## Verify like you mean it

`done when` is the loop's definition of reality — so LoopFlow gives verification real teeth.
List several checks (**all must pass**), mix deterministic tests with LM-judged evals, and
harden both sides against false greens:

```loop
loop "harden checkout":
  goal: checkout works, reliably, and was built the right way
  done when "pnpm test checkout" passes 3 times                  # flake guard: every run must pass
  done when the skill "code-review" approves by 3 judges         # judge panel: majority of 3 verdicts
  done when the skill "path-review" approves on the trajectory   # judges HOW it got there
    the bar: didn't weaken a test to go green; no writes outside src/checkout
```

- **Flake guard** — `passes N times` re-runs a test/command; one lucky green isn't "done".
- **Judge panel** — `by N judges` takes a majority of independent verdicts; one wobbly LM
  judgment isn't "done" either.
- **Trajectory evals** — catch what a green test can't: an agent that gamed the check.

Full mechanics — what a verdict is actually affected by (working dir, shell env, exit codes) —
in [How verification works](docs/MANUAL.md#how-verification-works--what-done-actually-depends-on).

## Skills and memory

Two knobs make a loop coordinate proven work and learn over time:

```loop
loop "decide whether to cancel the morning run":
  goal: a clear go / no-go call the runner trusts
  use skills: check-weather, analyze-workout     # coordinate battle-tested skills
  remember in "morning-run.memory.md"            # cross-run history + lessons learned
  each cycle: plan, then act, then observe
  done when the skill "workout-review" approves   # bridge the abstract to the verifiable
```

- **`use skills:`** names skills the loop may invoke while planning and acting — compose
  proven skills instead of one mega-prompt (skill-driven development).
- **`done when the skill "…" approves`** (or `scores N or more`) lets a review skill verify
  a goal that isn't a test or command — a good email, a sound design, a sensible call.
- **`remember in "<file>"`** gives the loop a markdown memory: it reads past lessons into its
  first plan and appends an outcome entry when it stops. `reflect` is within-run memory;
  `remember` is its across-run counterpart. See [`examples/skills_memory.loop`](examples/skills_memory.loop).

And a loop can **equip itself**: with [ctx](https://github.com/stevesolun/ctx) attached as the
skill source, `use skills recommended by ctx` resolves + installs the right skill bundle for the
goal before the first plan, and `top up skills from ctx` pulls more after a failed cycle
reflects. Opt-in, fail-closed, inert without ctx — see
[the integration guide](docs/MANUAL.md) and [`examples/ctx_capabilities.loop`](examples/ctx_capabilities.loop).

## Compose loops

Compose loops into **pipelines** (stages in order, fail-fast), chain whole files with **`flow`**, and fan out over a plan with **`for each`** — humans wired in where judgment lives. Full grammar with worked examples: the [tutorial](https://loopflow.live) and the [manual](docs/MANUAL.md).

## The vocabulary (~15 words — learn it once)

`pipeline` · `stage` · `loop` · `flow` · `for each … in …` · `run … then …` · `each cycle` · `goal` · `done when` · `look at` · `allow…/ask me before…` · `also` · `use skills` · `remember in` · `when…` · `reflect` · `a human…` · `stop` · `use` · `schedule` · `git`

Power comes from **composition**, not keyword count.

## Git strategy (safe by default)

Without any `git:` block, LoopFlow works on a branch and commits when the goal is met — it
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

Write `.loop` by hand — the [**LoopFlow VS Code extension**](https://marketplace.visualstudio.com/items?itemName=Loop-Lang.loopflow)
(`ext install Loop-Lang.loopflow` · [source](packages/vscode)) gives syntax highlight,
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

## Watch it run — live dashboard

A real-time browser view of a run, showing the loop's **actual structure** as a turn-by-turn
route (Waze-style): where you are, the steps ahead, human gates, and for-each sprints listed
by item title with live progress.

```
loop-run run file.loop --live      # headless: engine streams every step to the browser
/loopflow run file.loop            # in-session: the skill offers the dashboard, then drives it
```

When you run a loop via `/loopflow`, the skill asks if you want the dashboard and, on yes,
opens it and updates it as each step happens — pipeline stages, flow steps, and sprint stories
filling in as the loop progresses.

Prefer a file you can grep later? Persist the same event stream as NDJSON — and use it to
**resume** an interrupted run:

```
loop-run run file.loop --log run.log       # append every event to a local log (secrets scrubbed)
loop-run run file.loop --resume run.log    # skip what the log proves done; pick up where it died
```

See **Event log & telemetry** in [`docs/MANUAL.md`](docs/MANUAL.md) for the format, redaction,
resume semantics, and the `LOOP_EVENTS_URL` remote collector. Want to *feel* the language first?
Open the [**browser playground**](https://loopflow.live/playground.html) — type a `.loop`, see its
shape live, no install.

## Project layout

| Package | Purpose |
|---|---|
| `@loop-lang/parser` | `.loop` text → `loop-spec` JSON (the open IR) |
| `@loop-lang/runtime` | walks a spec, drives Claude Code, emits a live trace |
| [`loopflow` (VS Code)](https://marketplace.visualstudio.com/items?itemName=Loop-Lang.loopflow) | highlight, diagnostics, completion, templates, ▶ Run CodeLens |
| `@loop-lang/stdlib` | `BMAD.loop` + starter presets |
| `@loop-lang/viz` | `loop-run viz file.loop` → self-contained HTML schematic; also the live dashboard (`--live`) |
| `spec/loop-spec.schema.json` | the open IR contract |

## Is this just another &lt;X&gt;?

"Is this another LangChain?", "why not YAML?", "won't better models make this pointless?",
"doesn't it lock me into Claude Code?" — answered straight in the [**FAQ**](docs/FAQ.md).

## Status

Active. Shipped: parser + runtime (pipelines, flows, for-each, evals, judge panels, flake
guard), event log + `--resume`, secret-scrubbed telemetry, live dashboard, VSCode extension,
template library, browser playground, ctx skill provisioning. See the [roadmap](#roadmap)
and [open issues](../../issues).

## Roadmap

- **Next** — runner abstraction (run loops on your own local/API model), a GitHub Action
  (loops as CI quality gates), a community template registry (`use someone/their-method`).
- **Later** — visual graph editor (the `loop-spec` IR is built for it), async human nodes,
  reactive stages, scheduling.

## Built with LoopFlow

LoopFlow ships real software. **Forge** — a ticket-driven implementation platform (hand it a ticket, agents implement it) — is built with LoopFlow, including its **sandbox runner**: isolated, network-less execution of agent-written code. The pipeline that built it is [`examples/forge-sandbox.loop`](examples/forge-sandbox.loop); the walkthrough is the [case study in the tutorial](https://loopflow.live/#workflows).

## Contributing

This is a **community project** and an **open standard**. Good first issues: new presets, grammar edge cases, formatter rules. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE). The language and the `loop-spec` IR are an open standard — implement against them freely.

## Maintainer

<a href="https://www.linkedin.com/in/idan-ayalon/"><img src="docs/idan.jpg" alt="Idan Ayalon" width="104" align="left" hspace="18" vspace="4" /></a>

**Idan Ayalon** — creator &amp; maintainer of LoopFlow. Built **Forge** with it.

📧 [bar.idan@gmail.com](mailto:bar.idan@gmail.com)  
💼 [linkedin.com/in/idan-ayalon](https://www.linkedin.com/in/idan-ayalon/)

<br clear="left" />
