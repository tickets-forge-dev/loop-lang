# LoopFlow — FAQ

Honest answers to the questions a skeptic asks first. If one of these is the reason
you'd close the tab, read that one.

- [Is this just another LangChain?](#is-this-just-another-langchain)
- [Why a new language? Why not YAML, JSON, or Python?](#why-a-new-language-why-not-yaml-json-or-python)
- [Isn't this just a prompt template with extra syntax?](#isnt-this-just-a-prompt-template-with-extra-syntax)
- [Natural language is ambiguous — how can you build a reliable language on it?](#natural-language-is-ambiguous--how-can-you-build-a-reliable-language-on-it)
- [Why not just tell Claude Code what to do directly?](#why-not-just-tell-claude-code-what-to-do-directly)
- [Claude Code already has /loop and /goal — why another thing?](#claude-code-already-has-loop-and-goal--why-another-thing)
- [Doesn't this lock me into Claude Code?](#doesnt-this-lock-me-into-claude-code)
- [xkcd 927 — isn't this just a 15th competing standard?](#xkcd-927--isnt-this-just-a-15th-competing-standard)
- [This is just a Makefile / CI pipeline for agents.](#this-is-just-a-makefile--ci-pipeline-for-agents)
- [Won't better models make this pointless?](#wont-better-models-make-this-pointless)
- [The model can just ignore your gates and constraints.](#the-model-can-just-ignore-your-gates-and-constraints)
- [Won't an unattended loop burn tokens all night?](#wont-an-unattended-loop-burn-tokens-all-night)
- [Isn't this just BMAD with extra steps?](#isnt-this-just-bmad-with-extra-steps)
- [Won't the agent just author its own loop — why do I need to?](#wont-the-agent-just-author-its-own-loop--why-do-i-need-to)
- [It's too small to be a language / it's too much to learn.](#its-too-small-to-be-a-language--its-too-much-to-learn)
- [Is it production-ready?](#is-it-production-ready)
- [What stops Anthropic from building this into the agent itself?](#what-stops-anthropic-from-building-this-into-the-agent-itself)

---

## Is this just another LangChain?

No — opposite direction. LangChain is an SDK: you `import` it and write Python/JS to wire
up model calls, memory, and tools. LoopFlow is an artifact, not a framework. There's no library
to import, no glue code, no runtime you build *against*. A `.loop` is a few lines of English
naming five decisions; it compiles to an open JSON IR and runs on an agent you already have.

LangChain abstracts the **plumbing of calling models**. LoopFlow abstracts none of that — it makes
the **control structure** (plan → act → observe → reflect, the human gates, the stop condition)
explicit and editable.

The tell: you can delete LoopFlow from your project by deleting one text file. You can't delete a
framework you've written 2,000 lines against.

## Why a new language? Why not YAML, JSON, or Python?

- **YAML/JSON** describe data, not intent. You'd immediately be stuffing English into string
  fields — `goal: "settings save when the company name has an apostrophe"` — so you've invented
  a worse natural-language format with extra quotes. The parts that matter ("ask me before
  migrations", "stop if it's thrashing") are judgment, not config.
- **Python** is a framework again — see above.
- **LoopFlow** keeps the judgment in the format that's native to it (English, which the agent reads
  fluently) and adds just enough *structure* to say where a gate goes and what counts as done.
  The parser turns it into `loop-spec` JSON so tools still get structure.

## Isn't this just a prompt template with extra syntax?

A prompt is one shot of text; a loop is a control structure. The two parts a prompt can never
have are machine-enforced: `done when "pnpm test" passes` runs your command and reads the exit
code (you can't fake green), and `after 6 tries: stop` is a hard ceiling. The difference between
a prompt and a loop is the difference between a wish and a `for` loop with an exit condition.

Full side-by-side (same task, both ways): [Prompt vs LoopFlow in the tutorial](https://loopflow.live/#vs).
The [blog](blog/i-was-the-for-loop.md) is the long version.

## Natural language is ambiguous — how can you build a reliable language on it?

Two layers, and the line between them is the whole design:

- **Structure is unambiguous and machine-enforced.** `done when "<cmd>"` is a concrete predicate
  the runtime checks. `after N tries` is a hard integer ceiling. `a human approves` is a real
  blocking pause. `allow… / ask me before…` gates actions in the policy layer. None of this is
  left to the model's interpretation.
- **Intent inside a step is handed to the model on purpose** — "reflect on which layer broke" is
  exactly the kind of judgment the model is good at.

You don't get a flaky gate, because the gate isn't natural language — only the *goal description*
is. LoopFlow draws the line where it belongs: machine where it must be, model where judgment lives.

## Why not just tell Claude Code what to do directly?

You can, and for a true one-off you should. LoopFlow is for work you do **more than once**, or
**can't sit and watch**. Typing the goal, the gates, and the stop into chat means re-typing them,
re-establishing context at every handoff, and being the for-loop yourself — holding the retry
count and the exit condition in your head at 2am. A `.loop` is that, written down once: reusable,
reviewable in a PR, and runnable unattended *because the gates and the stop live in the file, not
in your patience.*

## Claude Code already has `/loop` and `/goal` — why another thing?

Different jobs. `/loop` is a scheduler (re-run a prompt on an interval). `/goal` is the closest
cousin — keep going until a condition holds — but its condition is judged by a fast model
*reading the transcript*; it can't run your test, so "done" is claimed, not proven. A `.loop` is
`/goal` with a real check, a reflect-and-re-plan on failure, a human gate, and a file you can
review and reuse.

| | `/loop` | `/goal` | LoopFlow |
|---|---|---|---|
| What it's for | run a prompt on a schedule | loop until a condition reads true | a verified, gated, reusable workflow |
| "Done" means | never — you stop it | a model judges your condition from the transcript | a real command passes — `done when "pnpm test" passes`, can't be faked |
| On failure | fires again next interval | next turn; no introspection | **reflect** on the failure, then re-plan (the back-edge) |
| Human gate mid-run | no | no — fully autonomous | yes — `a human approves the plan first` |
| Never push to `main` | no | no | built-in, unconditional |
| Reusable / shareable | no | no — ephemeral per session | a version-controlled `.loop` — run in any repo, save to your library |
| Multi-step | — | one condition | pipelines, flows, `for each` |

When to reach for which: `/loop` for polling and cadence; `/goal` for a quick throwaway "keep
going until it looks done"; LoopFlow when "done" must be provable and the workflow is worth
keeping.

## Doesn't this lock me into Claude Code?

The runtime targets Claude Code today because it runs natively there with zero extra infra. But
the **contract is the open `loop-spec` IR** ([`spec/loop-spec.schema.json`](../spec/loop-spec.schema.json),
Apache-2.0): a `.loop` parses to plain JSON any tool can consume and any runtime can implement.
The Claude Code runtime is one implementation, not the definition. And authoring in English isn't
locked to anything — worst case, your `.loop` files are a readable record of your own process.

## xkcd 927 — isn't this just a 15th competing standard?

Fair to ask of anything that calls itself a standard. The honest answer: LoopFlow isn't competing
with LangGraph / AutoGen / CrewAI for "how to build an agent." It assumes you already have an
agent and standardizes the **one artifact none of them make first-class** — the human-authored
control loop, with its gates and its stop condition. "Adopting" it is writing one `.loop` file
you can throw away. xkcd 927 bites when standards are heavy and you can't leave; this is a text
file.

## This is just a Makefile / CI pipeline for agents.

Closest fair comparison — and `pipeline` / `stage` is deliberately Make-shaped. The difference
is the **cycle inside a step**. Make runs a target once: it passes or it fails. A LoopFlow stage
*self-corrects* — observe → reflect → re-plan until `done when` is green or it hits the retry
ceiling — and can pause for a human mid-flight. A Makefile has no notion of "try, look at why it
failed, try a different layer, and ask me before the risky part." That loop is the point; the
pipeline is just how you chain several of them.

## Won't better models make this pointless?

Better models make the **act** step better. They don't decide for you where done is, what needs
a human, or when to quit. A smarter model still doesn't know that your `done when` is "green, not
looks-done," that migrations need a human, or that six tries means stop. Those are *your* calls —
and a more capable model executing the wrong unstated goal *faster* is not an improvement. If
anything, the better the model, the more the bottleneck moves to authoring intent clearly, which
is the exact thing LoopFlow makes editable.

## The model can just ignore your gates and constraints.

The model-interpreted parts can drift — but the load-bearing parts aren't left to the model:

- `done when` is the **runtime** running your command and reading the exit code — not the model
  claiming success.
- `after N tries` is a **counter in the runtime**.
- `a human approves` is a **real blocking pause** the run cannot proceed past.
- `allow… / ask me before…` gates the edit/push actions in the **policy layer**.
- And for the failure mode where the model *games* the check — weakening a test to go green — a
  **trajectory eval** judges *how* it got there: `done when the skill "path-review" approves on
  the trajectory`. Mechanics: [How verification works](MANUAL.md#how-verification-works--what-done-actually-depends-on).

The model proposes; the runtime enforces. That separation is the reason a loop is more
trustworthy than the same instructions pasted into a prompt.

## Won't an unattended loop burn tokens all night?

No more than you allow. `after N tries: stop` is a hard runtime ceiling — the loop cannot spend
an unbounded number of cycles (and an absolute 25-cycle cap backstops it). `done when` runs your
command locally (no model call), human gates pause the run instead of letting it spin, and you
can route cheap phases to a cheap model with the [model policy](MANUAL.md#model-policy). The
one-liner that caps the bill is the last line here:

```loop
loop "fix the bug":
  goal: make the failing test pass
  done when "pnpm test" passes
  after 3 tries: stop and warn "needs a human"
```

## Isn't this just BMAD with extra steps?

LoopFlow is method-**agnostic**. BMAD is one `.loop` file in the stdlib — `use the BMAD method` pulls
it in as a preset, and your own method is a fork. LoopFlow is the *medium* methodologies are written
in, not a competitor to them. Love BMAD? Write it as a loop and share it. Have your own pipeline?
Same. The flywheel is sharing methods as files, not crowning one.

## Won't the agent just author its own loop — why do I need to?

The agent *can* draft it — describe the work and LoopFlow will write the `.loop` for you. But the loop
is the part that's **yours by definition**: where *done* is, where money or migrations need a
human, when to quit. Letting the agent propose that is fine; signing off on where judgment lives is
the authorship you don't want to fully delegate. LoopFlow's job is to make that artifact **reviewable**
instead of implicit in a prompt nobody can see.

## It's too small to be a language / it's too much to learn.

Both, on purpose.

- It's **a vocabulary you learn in an afternoon**, because the power is in *composition*
  (`loop` → `stage` → `pipeline` → `flow`), not word count.
- It's **a language** rather than a config schema because the parts that matter are sentences of
  judgment, not key–value pairs.

## Is it production-ready?

No — it's **early**. Treat it as a way to write down and run loops you'd otherwise drive by hand,
not as hardened infra. The language and the `loop-spec` IR are the stabilizing, open part; the
runtime moves fast. What's shipped and what's next: [README → Status](../README.md#status) and
[Roadmap](../README.md#roadmap).

## What stops Anthropic from building this into the agent itself?

Nothing, and that's fine — LoopFlow is an **open standard** (Apache-2.0), not a product with a moat to
defend. The language and the `loop-spec` IR are meant to be implemented against freely; a native
agent feature that reads `.loop` files would be a *win*, not a competitor. The thing worth keeping
open is the artifact — the human-authored loop — independent of whose runtime executes it.
