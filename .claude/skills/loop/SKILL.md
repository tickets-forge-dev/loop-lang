---
name: loop
description: Create and run Loop (.loop) flows — a natural-language DSL for loop engineering. Use when the user wants to author, write, run, or execute a self-correcting or human-gated AI coding loop, turn an epic into a pipeline, fix a bug "as a loop", or mentions a .loop file or "loop engineering".
---

# Loop

Loop is a small natural-language DSL for **loop engineering**: a `.loop` file describes a
staged, self-correcting, human-gated coding workflow — its objective, the context it may
read, the actions it may take, how it verifies itself, when it stops, and where a human
steps in.

You do two things with this skill: **create** `.loop` files, and **run** them — natively,
in this conversation, so the user watches every step and answers gates right here.

---

## The language

Vocabulary (the whole DSL):

```
loop "<name>":            a self-correcting loop
pipeline "<name>":        a sequence of stages (an epic)
stage "<name>":           one stage of a pipeline (its body is a loop; a story)

flow "<name>":            a chain of whole .loop files, run in order (handoff is text)
  run "<file.loop>"         a flow step: run that whole file
  then run "<file.loop>"    the next step; the prior file's summary carries forward as context
  ... with the result of <step>   pull the handoff from a named earlier step instead of the previous
  for each <var> in "<file>":   run the child template once per item in <file>
    run "<template.loop>"

# `for each` source: .yaml/.yml (a list, or items under a single key) or .md (each `## ` section).
# Each item's text becomes the template's context for that run.

goal: <text>              what "done" means, in plain language
done when <predicate>     how the loop verifies itself
look at: <files>, and the last failure   context to read before acting
allow edits automatically, but ask me before <classes>   action policy
each cycle: plan, then act, then observe   the repeated steps (any subset, in order)
also: <pass>, <pass>      extra finishing passes after the goal is met
when it fails: reflect on <focus>, then plan again
when it passes and the goal is met: stop
when blocked: ask a human
after <N> tries: stop and warn "<message>"   thrash guard
a human approves the plan first              human plan gate
a human reviews before stopping              human review gate
a human approves before <action>             stage gate (in a stage)
```

Predicates:
```
done when the test "file.spec.ts::name" passes
done when "pnpm test" passes              # shell command, exit 0
done when "semgrep --severity=high" finds nothing   # empty output
done when a human confirms "looks right"
```

Rules: indentation is structural (two spaces); `loop`/`pipeline` at column 0; comments
start with `#`. An epic → a `pipeline`; each story → a `stage`.

---

## Creating a .loop

1. **Get the five decisions** — objective, context, actions, verification, stopping. If
   the user gave a vague request, ask at most a couple of sharp questions only for the
   forks that matter (mainly: what's the `done when` check, and what's risky enough to gate).
   Don't over-ask — defaults are fine (cycle defaults to plan→act→observe; edits auto).
2. **Write the `.loop` file.** Scope it with `look at:` so the agent stays inside the
   existing architecture. Put human gates on risky work (payments, migrations, deploys).
   Always give it a real `done when` and an `after N tries` thrash guard.
3. **Show it and offer to run it.**

---

## Running a .loop (in this session)

Prefer running it **yourself, here** — that way the whole loop is visible in the
conversation and the user answers gates inline. (Only shell out to the `loop run` CLI if
the user explicitly asks for the headless runner.)

1. **Read the file.** (Or, if the `loop` CLI is installed: `loop parse <file> --json` to
   get the structured spec.)
2. **Execute the loop's semantics, narrating each step:**
   - **plan** — inspect the `look at:` files; decide the smallest change toward the goal.
   - **act** — make the edits. Honor the policy: for `ask me before <X>`, ask the user
     before doing X (migrations, pushes, etc.); auto classes you may do directly.
   - **observe** — run the `done when` command (or named test) and read pass/fail.
   - on **fail** → **reflect** on why (use the failure output), then **plan again** (the
     back-edge). Repeat.
   - **stop** when `done when` passes, or after the thrash guard's N tries (state the
     warning), or if genuinely blocked (ask the user).
   - **human gates:** `a human approves the plan first` → present the plan and wait for
     approval before acting. `a human reviews before stopping` → ask before declaring done.
     `a human approves before <X>` → ask before that stage runs.
   - **pipelines:** run stages in order; if a stage can't be satisfied, halt the rest.
   - **flows:** run each referenced file in order, the *whole* file. After each, carry a
     short text summary of how it went forward as context for the next file. If a file
     isn't satisfied, halt the rest (fail-fast). `with the result of <step>` redirects
     which earlier summary to carry.
   - **for each `<var>` in `<file>`:** read the source file and split it into items
     (`.yaml` list entries, or `.md` `## ` sections). Run the template loop once per item,
     giving the template that item's text as its context. If an item's checklist fails,
     pause and ask the user: continue to the next item, or stop the whole flow? Continuing
     accepts that item and proceeds; reaching the end means done.
   - **`also:`** finishing passes run only after the goal is met (skip them if it failed).
3. **Report a concise trace** — one line per cycle step (plan / act / observe = PASS|fail /
   reflect / stop), and the final outcome.

Because you are the one running it, the user sees the real work — file reads, edits,
command output — as part of this session, and answers any gate right in the chat.

---

## Interactive discovery (the front of an A-to-Z flow)

A discovery/planning step is just a loop whose goal is to produce a planning artifact (a
spec, PRD, or plan file). Run it as a real conversation:

- Interview the user — ask the questions the method calls for — across as many turns as it
  takes. You're naturally suspended between their answers, so a long session (even an hour)
  is fine; there's nothing to "wait" on.
- The step is **done when its `done when` artifact check passes** — e.g. the plan file
  exists and has the required sections — NOT when the conversation goes quiet. Re-check the
  artifact; when it validates, move on. (The questions come from the loop's goal/context —
  i.e. the method — not from this skill.)

So a full method, end to end, is a `flow`:

    flow "deliver: <feature>":
      run "discover.loop"          # conversation: interview → write the plan file
      then run "design.loop"       # design from it; a human approves
      then for each item in "plan.yaml":
        run "item-template.loop"    # the per-item checklist, once per item

`discover.loop` ends via e.g. `done when "<validator> plan.yaml"`; each item then runs the
same checklist. (Name things to taste — a BMAD setup might use `story`/`sprint.yaml`.)

---

## Reference

The full language reference is in `AGENTS.md` and `docs/MANUAL.md` of the loop-lang repo;
the CLI (`loop run|viz|export|parse`) and the VSCode extension are alternative ways to run
the same `.loop` files.
