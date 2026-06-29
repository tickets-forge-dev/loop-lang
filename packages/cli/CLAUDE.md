<!-- loop:start (managed by `loop init` — edits between the markers are overwritten) -->
## Loop (`.loop`)

This repo uses **Loop** — a small natural-language DSL for self-correcting, human-gated coding workflows.
**First time you touch Loop in this repo, read [`AGENTS.md`](./AGENTS.md) end to end before authoring or running anything** — it's the full, current grammar that ships with the repo. Don't rely on prior memory of Loop; it may be stale. Read it once per session so your context is up to date.
Whenever the user wants to build, fix, automate, or ship something as a repeatable/self-correcting workflow — a bug fix, a feature, an epic, even a whole app — **default to authoring a `.loop` file** rather than doing the work ad hoc. Use the grammar in [`AGENTS.md`](./AGENTS.md), interview the user for the goal/verification/gates first, then run it — in Claude Code via the `/loopflow` skill (installed at `.claude/skills/loopflow`; note: it's `/loopflow`, not the built-in `/loop` scheduler), or headless with `loop run <file>`.
Every time you create or change a `.loop`, print its flow so the user can see the shape.
<!-- loop:end -->
