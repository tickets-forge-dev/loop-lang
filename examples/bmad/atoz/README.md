# BMAD A-to-Z — discover → design → implement every story

This bundle shows the full A-to-Z shape with BMAD as one example method.
The same pattern works with any method — BMAD is not special to the runtime.

## Shape

```
discover (interview) → design (human approves) → for each story → story checklist
```

1. **discover** — the agent interviews you and writes `sprint.yaml` (done when the file exists).
2. **design** — the agent turns `sprint.yaml` into an architecture note; a human approves before stopping.
3. **for each story** — runs `story-template.loop` once per story in `sprint.yaml` (implement → security → manual QA).

## Files

| File | Purpose |
|---|---|
| `sprint.yaml` | The story list written by `discover`. Seed data is provided; `discover` overwrites it. |
| `discover.loop` | Interview loop — done when `sprint.yaml` exists. |
| `design.loop` | Architecture loop — done when `design.md` exists; human reviews before stop. |
| `story-template.loop` | The checklist every story runs through (implement → security → manual QA). |
| `epic.loop` | The full flow: discover → design → for each story → template. |

## Run it

```bash
/loopflow run epic.loop    # inside Claude Code conversation
loop run epic.loop     # via the CLI
```

## BMAD is one example

`for each story in "sprint.yaml": run "story-template.loop"` is plain Loop syntax.
Replace the discover/design loops with your method's equivalents, or skip them
and point `for each` at any YAML list of work items.
