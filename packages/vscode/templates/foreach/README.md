# foreach — iterate a plan, run a template per item

This bundle shows the core `for each` pattern: a list of work items lives in
`plan.yaml`; the same checklist (`item-template.loop`) runs once per item.

## Files

| File | Purpose |
|---|---|
| `plan.yaml` | The list of work items (a YAML list under `items:`). Edit this to change the work. |
| `item-template.loop` | The checklist every item runs through (implement → security → review). |
| `deliver.loop` | The flow: `for each item in "plan.yaml": run "item-template.loop"`. |

## How `for each` works

`for each <var> in "<file>":` reads the list from the YAML file and runs the
template once per entry. Each entry's text (title + detail) becomes the template's
context — what to build. If an item fails its checklist, the runtime pauses and
asks whether to continue with the next item or stop.

## Commands

```bash
loop parse deliver.loop   # inspect the parsed AST
loop run deliver.loop     # execute — one template run per item
```
