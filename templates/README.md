# Loop templates

Copy-and-edit starting points for everyday Loop work. Each `.loop` here is a heavily commented, best-practice skeleton for a common job — fixing a bug, shipping a feature, driving CI to green, delivering a spec story by story. They are written to be cloned into your repo and customized: every line that's specific to your project is marked `# TODO` (test commands, file paths, try ceilings). All of them parse cleanly, so `show`/`run` work the moment you copy them. Don't run a template as-is — fill in the TODOs first.

## Pick a template

### Spec-driven (a whole app / a written backlog)

| Template | When to use | Shape |
| --- | --- | --- |
| `greenfield-app.loop` | Build an app from nothing, A to Z. | `flow`: `discover.loop` → `design.loop` → `for each story in "sprint.yaml"` → `story-template.loop` |
| `load-spec.loop` | You already have a spec + backlog; deliver it story by story. | `flow`: `for each story in "sprint.yaml"` → `story-template.loop` |

### Change (build / fix / restructure)

| Template | When to use | Shape |
| --- | --- | --- |
| `feature.loop` | Ship one feature with regression + security + human review. | `pipeline` (fail-fast): build → regression → security → 👤 review |
| `brownfield-feature.loop` | Add a feature to an existing codebase without breaking it. | `pipeline` (fail-fast, file-level `git:` branch/commit/no-push): build → regression (no-regression guarantee) → security → 👤 review |
| `bugfix.loop` | Fix one bug, proven by a named test. | single `loop`: reproduce → fix → verify; ↺ reflect-on-fail, ⛔ after 6 tries |
| `refactor.loop` | Improve structure with behavior unchanged. | single `loop`: full suite green = no-regression proof; no-new-deps gate; 👤 review; ⛔ after 6 |

### Quality gates (drive existing checks to green)

| Template | When to use | Shape |
| --- | --- | --- |
| `cicd-check.loop` | Make every CI check pass locally. | `pipeline` (fail-fast, `git:` branch/commit/no-push): lint → typecheck → test → build |
| `security.loop` | Run a security pass before shipping. | `pipeline` (fail-fast): sast (semgrep) → deps (npm audit) → 👤 secrets (gitleaks) |
| `clean-architecture.loop` | Enforce architecture boundaries — deps point inward, no layer leaks. | single `loop`: `done when` a boundary checker passes (or a review skill scores); ↺ reflect = invert/move, don't relax the rule; 👤 review; ⛔ after 6 |
| `test-coverage.loop` | Raise coverage to a threshold with meaningful tests. | single `loop`: `done when` coverage gate passes; ↺ reflect-on-fail; ⛔ after 6 |
| `review-diff.loop` | Review and clean the current branch diff. | single `loop`: `done when the skill "code-review" approves`; 👤 human signs off last; ⛔ after 4 |

## How to use

1. Copy the `.loop` you want into your repo and rename it.
2. Edit every `# TODO` line — your real test commands, file paths, and try counts. (The default gate strings like `pnpm test` or `npm test` are placeholders; swap in yours.)
3. Eyeball the shape, then run it:
   - `/loopflow run <file>` inside Claude Code, or
   - `loop-run run <file>` headless.
   Run `show <file>` first to sanity-check the flow before executing.

## Supporting files

- `sprint.yaml` and `plan.md` are **starter data**, not loops — a small auth-style backlog/spec to replace with your own. `load-spec.loop` and `greenfield-app.loop` iterate `sprint.yaml`; `plan.md` is the human-readable spec you keep in sync with it.
- `story-template.loop` is the per-story checklist (implement → security → 👤 manual) shared by both `load-spec.loop` and `greenfield-app.loop` — author it once, drive it with the spec.
- `discover.loop` and `design.loop` are the first two stages of `greenfield-app.loop` (interview → `sprint.yaml`, then `sprint.yaml` → `design.md`), each with its own artifact-check gate and human review.
