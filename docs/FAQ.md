# Loop — FAQ & the hard questions

Honest answers to the questions a skeptic asks first. If one of these is the reason
you'd close the tab, read that one.

- [Is this just another LangChain?](#is-this-just-another-langchain)
- [Why a new language? Why not YAML, JSON, or Python?](#why-a-new-language-why-not-yaml-json-or-python)
- [Isn't this just a prompt template with extra syntax?](#isnt-this-just-a-prompt-template-with-extra-syntax)
- [Natural language is ambiguous — how can you build a reliable language on it?](#natural-language-is-ambiguous--how-can-you-build-a-reliable-language-on-it)
- [Why not just tell Claude Code what to do directly?](#why-not-just-tell-claude-code-what-to-do-directly)
- [Doesn't this lock me into Claude Code?](#doesnt-this-lock-me-into-claude-code)
- [xkcd 927 — isn't this just a 15th competing standard?](#xkcd-927--isnt-this-just-a-15th-competing-standard)
- [This is just a Makefile / CI pipeline for agents.](#this-is-just-a-makefile--ci-pipeline-for-agents)
- [Won't better models make this pointless?](#wont-better-models-make-this-pointless)
- [The model can just ignore your gates and constraints.](#the-model-can-just-ignore-your-gates-and-constraints)
- [Isn't this just BMAD with extra steps?](#isnt-this-just-bmad-with-extra-steps)
- [Won't the agent just author its own loop — why do I need to?](#wont-the-agent-just-author-its-own-loop--why-do-i-need-to)
- [It's too small to be a language / it's too much to learn.](#its-too-small-to-be-a-language--its-too-much-to-learn)
- [Is it production-ready?](#is-it-production-ready)
- [What stops Anthropic from building this into the agent itself?](#what-stops-anthropic-from-building-this-into-the-agent-itself)

---

## Is this just another LangChain?

No — opposite direction. LangChain is an SDK: you `import` it and write Python/JS to wire
up model calls, memory, and tools. Loop is an artifact, not a framework. There's no library
to import, no glue code, no runtime you build *against*. A `.loop` is a few lines of English
naming five decisions; it compiles to an open JSON IR and runs on an agent you already have.

LangChain abstracts the **plumbing of calling models**. Loop abstracts none of that — it makes
the **control structure** (plan → act → observe → reflect, the human gates, the stop condition)
explicit and editable. If LangChain is "a framework for building agents," Loop is "a way to
write down the loop you're already running by hand."

The tell: you can delete Loop from your project by deleting one text file. You can't delete a
framework you've written 2,000 lines against.

## Why a new language? Why not YAML, JSON, or Python?

- **YAML/JSON** describe data, not intent. You'd immediately be stuffing English into string
  fields — `goal: "settings save when the company name has an apostrophe"` — so you've invented
  a worse natural-language format with extra quotes. The parts that matter ("ask me before
  migrations", "stop if it's thrashing") are judgment, not config.
- **Python** is a framework again — see above.
- **Loop** keeps the judgment in the format that's native to it (English, which the agent reads
  fluently) and adds just enough *structure* to say where a gate goes and what counts as done.
  The parser turns it into `loop-spec` JSON so tools still get structure. You author in English;
  machines consume the IR. Both, not either.

## Isn't this just a prompt template with extra syntax?

A prompt is one shot of text. A loop is a control structure:

- it **iterates** — `each cycle: plan, act, observe`
- it **branches on failure** — `when it fails: reflect, then plan again`
- it **enforces a machine-checked exit** — `done when "pnpm test" passes` runs your command and
  reads the exit code; you can't fake green
- it **stops honestly** — `after 6 tries: stop`
- it **pauses for a human** — `a human approves before charging the card`

The difference between a prompt and a loop is the difference between a wish and a `for` loop
with an exit condition. The [blog](blog/i-was-the-for-loop.md) is the long version: the value was
never the prompt text, it's the loop *anatomy* around it.

## Natural language is ambiguous — how can you build a reliable language on it?

Two layers, and the line between them is the whole design:

- **Structure is unambiguous and machine-enforced.** `done when "<cmd>"` is a concrete predicate
  the runtime checks. `after N tries` is a hard integer ceiling. `a human approves` is a real
  blocking pause. `allow… / ask me before…` gates actions in the policy layer. None of this is
  left to the model's interpretation.
- **Intent inside a step is handed to the model on purpose** — "reflect on which layer broke" is
  exactly the kind of judgment the model is good at.

You don't get a flaky gate, because the gate isn't natural language — only the *goal description*
is. Loop draws the line where it belongs: machine where it must be, model where judgment lives.

## Why not just tell Claude Code what to do directly?

You can, and for a true one-off you should. Loop is for work you do **more than once**, or
**can't sit and watch**. Typing the five decisions into chat means re-typing them, re-establishing
context at every handoff, and being the for-loop yourself — holding the retry count and the exit
condition in your head at 2am. A `.loop` is that, written down once: reusable, reviewable in a PR,
and runnable unattended *because the gates and the stop live in the file, not in your patience.*

## Doesn't this lock me into Claude Code?

The runtime targets Claude Code today because it runs natively there with zero extra infra. But
the **contract is the open `loop-spec` IR** ([`spec/loop-spec.schema.json`](../spec/loop-spec.schema.json),
Apache-2.0): a `.loop` parses to plain JSON any tool can consume and any runtime can implement.
The Claude Code runtime is one implementation, not the definition. And authoring in English isn't
locked to anything — worst case, your `.loop` files are a readable record of your own process.

## xkcd 927 — isn't this just a 15th competing standard?

Fair to ask of anything that calls itself a standard. The honest answer: Loop isn't competing
with LangGraph / AutoGen / CrewAI for "how to build an agent." It assumes you already have an
agent and standardizes the **one artifact none of them make first-class** — the human-authored
control loop, with its gates and its stop condition. "Adopting" it is writing one `.loop` file
you can throw away. xkcd 927 bites when standards are heavy and you can't leave; this is a text
file.

## This is just a Makefile / CI pipeline for agents.

Closest fair comparison — and `pipeline` / `stage` is deliberately Make-shaped. The difference
is the **cycle inside a step**. Make runs a target once: it passes or it fails. A Loop stage
*self-corrects* — observe → reflect → re-plan until `done when` is green or it hits the retry
ceiling — and can pause for a human mid-flight. A Makefile has no notion of "try, look at why it
failed, try a different layer, and ask me before the risky part." That loop is the point; the
pipeline is just how you chain several of them.

## Won't better models make this pointless?

Better models make the **act** step better. They don't promote the five decisions to you. A
smarter model still doesn't know that your `done when` is "green, not looks-done," that migrations
need a human, or that six tries means stop. Those are *your* calls — and a more capable model
executing the wrong unstated goal *faster* is not an improvement. If anything, the better the
model, the more the bottleneck moves to authoring intent clearly, which is the exact thing Loop
makes editable. (The blog's lesson: turning the AI off was the dead end; the missing part was
authorship, not typing.)

## The model can just ignore your gates and constraints.

The model-interpreted parts can drift — but the load-bearing parts aren't left to the model:

- `done when` is the **runtime** running your command and reading the exit code — not the model
  claiming success.
- `after N tries` is a **counter in the runtime**.
- `a human approves` is a **real blocking pause** the run cannot proceed past.
- `allow… / ask me before…` gates the edit/push actions in the **policy layer**.

The model proposes; the runtime enforces. That separation is the reason a loop is more
trustworthy than the same instructions pasted into a prompt.

## Isn't this just BMAD with extra steps?

Loop is method-**agnostic**. BMAD is one `.loop` file in the stdlib — `use the BMAD method` pulls
it in as a preset, and your own method is a fork. Loop is the *medium* methodologies are written
in, not a competitor to them. Love BMAD? Write it as a loop and share it. Have your own pipeline?
Same. The flywheel is sharing methods as files, not crowning one.

## Won't the agent just author its own loop — why do I need to?

The agent *can* draft it — describe the work and Loop will write the `.loop` for you. But the loop
is the part that's **yours by definition**: where *done* is, where money or migrations need a
human, when to quit. Letting the agent propose that is fine; signing off on where judgment lives is
the authorship you don't want to fully delegate. Loop's job is to make that artifact **reviewable**
instead of implicit in a prompt nobody can see.

## It's too small to be a language / it's too much to learn.

Both, on purpose.

- It's **~15 keywords** because the power is in *composition* (`loop` → `stage` → `pipeline` →
  `flow`), not vocabulary. You learn it once in an afternoon.
- It's **a language** rather than a config schema because the parts that matter are sentences of
  judgment, not key–value pairs.

If it feels too small, that's the feature: the smallest thing that makes the five decisions
first-class.

## Is it production-ready?

No — it's **early** (v1 in progress: parser, runtime, VSCode extension, BMAD preset). Treat it as
a way to write down and run loops you'd otherwise drive by hand, not as hardened infra. The
language and the `loop-spec` IR are the stabilizing, open part; the runtime is moving fast. See the
[roadmap](../README.md#roadmap).

## What stops Anthropic from building this into the agent itself?

Nothing, and that's fine — Loop is an **open standard** (Apache-2.0), not a product with a moat to
defend. The language and the `loop-spec` IR are meant to be implemented against freely; a native
agent feature that reads `.loop` files would be a *win*, not a competitor. The thing worth keeping
open is the artifact — the human-authored loop — independent of whose runtime executes it.
