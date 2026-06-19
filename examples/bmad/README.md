# BMAD → Loop: an epic of stories, each with its own checklist

You ran BMAD (discover → PRD → architecture) and ended up with an **epic**
made of **stories**. The pain: for every story you re-do the same checklist by
hand — run the tests, run the full suite, check security, do a code-review
pass, manually verify. Loop lets you write that checklist **once** and run it
for every story.

## The shape

```
epic-auth.loop          flow   — chains the story files in order, fail-fast
├─ story-login.loop      pipeline — the per-story checklist (5 stages)
└─ story-signup.loop     pipeline — same checklist, different goal + test
```

- **A story is a `pipeline`.** Its stages run top-to-bottom and fail-fast:
  `implement → tests → security → review → manual`. Each stage is a
  self-correcting loop whose `done when` is a **real command** — it can't
  mark itself done unless the tests/scanner actually pass.
- **An epic is a `flow`.** It runs each story file (`run "story-login.loop"`),
  and only moves to the next story once the current one is fully satisfied.
  Each story's result is handed to the next as context.

## Run it

```bash
loop parse examples/bmad/epic-auth.loop     # see the parsed structure
loop viz   examples/bmad/epic-auth.loop     # render the schematic
loop run   examples/bmad/epic-auth.loop     # drive it for real
```

## Make it yours

- **New story:** copy a story file, change the `goal` and the acceptance test,
  add one `then run "..."` line to `epic-auth.loop`.
- **Stop repeating the stages:** lift the 5-stage checklist into a method
  preset and pull it in with `use the <method> method` — then each story file
  is just its goal + acceptance test.
- **Tighten the gates:** change any `done when "<command>"` to your real tooling
  (`vitest`, `trivy`, `gitleaks`, `playwright`, …). Add `a human approves
  before <X>` anywhere a person must sign off.
