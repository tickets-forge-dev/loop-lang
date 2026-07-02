<!-- loop:start (managed by `loop init` — edits between the markers are overwritten) -->
## Loop (`.loop`)

This repo uses **Loop** — a small natural-language DSL for self-correcting, human-gated coding workflows.
**First time you touch Loop in this repo, read [`AGENTS.md`](./AGENTS.md) end to end before authoring or running anything** — it's the full, current grammar that ships with the repo. Don't rely on prior memory of Loop; it may be stale. Read it once per session so your context is up to date.
When the user asks to build, fix, automate, or ship something **repeatable and verifiable**, reach for a `.loop` file — gated by the four-condition test in [`AGENTS.md`](./AGENTS.md): does the task repeat? is "done" checkable? are the iterations affordable? can the loop verify itself? **All four hold → author the `.loop`** (interview the user for the goal / `done when` / gates first; start from `templates/` when one fits), then run it — in Claude Code via the `/loopflow` skill (installed at `.claude/skills/loopflow`; note: it's `/loopflow`, not the built-in `/loop` scheduler), or headless with `loop run <file>`. **Any condition fails → do the work directly** — one-off questions and trivial edits never need a loop.
Every time you create or change a `.loop`, print its flow so the user can see the shape.
<!-- loop:end -->
