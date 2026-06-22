# Loop examples

A library of runnable `.loop` files, from one-line loops to full A-to-Z method
pipelines. **Every `.loop` file here parses** (verified with `loop-run parse`) and
can be run with:

```
loop-run run <file>  # from your shell
/loopflow run <file>     # from inside Claude Code (conversational / human-gated)
```

The headers in each file explain what it teaches; this index is the map. Files
are grouped by category folder, then the canonical root files (the test
fixtures) are listed at the end.

---

## basics/ — the core concepts, one idea per file

| File | What it shows |
| --- | --- |
| [basics/minimal.loop](basics/minimal.loop) | The smallest useful loop: the four things every loop needs (goal, done-when, cycle, fail handler). |
| [basics/predicates.loop](basics/predicates.loop) | The four forms a `done when` predicate can take, shown side by side as four small loops in one file. |
| [basics/transitions.loop](basics/transitions.loop) | All four post-pass transitions and how they are prioritized (the `after N tries` thrash guard wins first). |
| [basics/context-and-policy.loop](basics/context-and-policy.loop) | `look at:` (give the agent the right context, incl. the last failure) plus the allow / ask-me-before autonomy policy. |
| [basics/finishing-passes.loop](basics/finishing-passes.loop) | `also:` finishing passes — extra polish work that runs only after the goal is met. |

## bugfix/ — drive a failing test to green, safely

| File | What it shows |
| --- | --- |
| [bugfix/failing-test.loop](bugfix/failing-test.loop) | The smallest useful bugfix loop: drive one named, failing test to green with reflect-on-fail and a hard try limit. |
| [bugfix/flaky-test.loop](bugfix/flaky-test.loop) | Stabilize a flaky test — done only when many runs in a row all pass, not a single lucky green. |
| [bugfix/regression.loop](bugfix/regression.loop) | Fix a bug without breaking neighbors: the gate is the whole suite passing, so regressions keep it red. |

## feature/ — ship a feature as a pipeline

| File | What it shows |
| --- | --- |
| [feature/csv-export.loop](feature/csv-export.loop) | "Export to CSV" as a 4-stage fail-fast pipeline: build, test, security scan, human UI review. |
| [feature/rest-endpoint.loop](feature/rest-endpoint.loop) | A new REST endpoint as a 2-stage pipeline: an acceptance test as the gate, with ask-me-before on migrations. |

## flow/ — chain whole .loop files into a pipeline

| File | What it shows |
| --- | --- |
| [flow/lint.loop](flow/lint.loop) | The smallest useful loop: keep working until `pnpm lint` exits 0. |
| [flow/test.loop](flow/test.loop) | Same shape as lint, but the gate is the test suite. |
| [flow/deploy.loop](flow/deploy.loop) | A deploy loop whose success is a healthcheck (short `act, then observe` cycle). |
| [flow/release.loop](flow/release.loop) | A `flow` that chains lint → test → deploy, with a human gate before the deploy. |

## git/ — git policy, from safe defaults to full ship-it

| File | What it shows |
| --- | --- |
| [git/safe-default.loop](git/safe-default.loop) | No `git:` block needed: the safe default works on a branch, commits when done, never pushes. |
| [git/branch-and-pr.loop](git/branch-and-pr.loop) | The full ship-it policy: branch → commit → push → open a pull request (Loop never pushes to main). |
| [git/commit-cadence.loop](git/commit-cadence.loop) | The commit cadence options; here `commit each story` for one clean commit per pipeline stage. |
| [git/worktree.loop](git/worktree.loop) | Run in a git worktree so your working tree and uncommitted changes stay untouched. |

## human-gates/ — where a human steps in

| File | What it shows |
| --- | --- |
| [human-gates/approve-the-plan.loop](human-gates/approve-the-plan.loop) | Approve the plan before any work happens — the most common gate. |
| [human-gates/ask-when-blocked.loop](human-gates/ask-when-blocked.loop) | Hands-off until needed: the agent only interrupts a human when it gets stuck. |
| [human-gates/gate-before-deploy.loop](human-gates/gate-before-deploy.loop) | A blocking gate inside a pipeline — pause before provisioning real infra. |
| [human-gates/review-before-stop.loop](human-gates/review-before-stop.loop) | No `done when`: a human review is the finish line, for subjective UI/UX polish. |

## methods/ — import a method shape instead of writing stages

| File | What it shows |
| --- | --- |
| [methods/use-bmad.loop](methods/use-bmad.loop) | The config tier: `use the BMAD method` to pull in a whole pipeline shape without writing any stages. |

## foreach/ — iterate a plan (run the same checklist per item)

Run `loop-run run foreach/deliver.loop`. Edit `plan.yaml` to change the work; the
loop files stay put. See also [foreach/README.md](foreach/README.md).

| File | What it shows |
| --- | --- |
| [foreach/deliver.loop](foreach/deliver.loop) | A `flow` that runs `item-template.loop` once `for each item in "plan.yaml"`. |
| [foreach/item-template.loop](foreach/item-template.loop) | The per-item pipeline: the current item arrives as context; the checks are the same for every item. |
| [foreach/plan.yaml](foreach/plan.yaml) | The plain list of work items `for each` walks. |

## bmad/ — the BMAD method, A to Z

A BMAD-shaped feature: discover → architect → per-story checklists. See
[bmad/README.md](bmad/README.md) and [bmad/atoz/README.md](bmad/atoz/README.md).

| File | What it shows |
| --- | --- |
| [bmad/epic-auth.loop](bmad/epic-auth.loop) | A BMAD epic run as a flow: chain each story `.loop` file, passing each result to the next. |
| [bmad/story-login.loop](bmad/story-login.loop) | One BMAD story as a fail-fast pipeline; every `done when` is a real command. |
| [bmad/story-signup.loop](bmad/story-signup.loop) | The same per-story shape again, proving the story checklist is reusable. |
| [bmad/atoz/epic.loop](bmad/atoz/epic.loop) | The A-to-Z flow run in conversation: discover → design → run the checklist `for each` story in `sprint.yaml`. |
| [bmad/atoz/discover.loop](bmad/atoz/discover.loop) | Interactive discovery: the agent interviews you and writes `sprint.yaml`; done when the artifact exists. |
| [bmad/atoz/design.loop](bmad/atoz/design.loop) | Turn `sprint.yaml` into an architecture note (`design.md`) that a human approves before stopping. |
| [bmad/atoz/story-template.loop](bmad/atoz/story-template.loop) | The per-story pipeline run once per story in `sprint.yaml`; the story text arrives as context. |
| [bmad/atoz/sprint.yaml](bmad/atoz/sprint.yaml) | The stories list `epic.loop` iterates. |

---

## Canonical root files (test fixtures)

The root-level files are the canonical fixtures used by the test suite. They are
small, copy-friendly starting points.

| File | What it shows |
| --- | --- |
| [fix_test.loop](fix_test.loop) | Minimal loop that drives a single named test (`checkout.spec.ts::tax`) to green. |
| [billing_apostrophe.loop](billing_apostrophe.loop) | A real-world bugfix loop: save settings when the company name has an apostrophe, gated by one acceptance test. |
| [ship_feature.loop](ship_feature.loop) | A full feature pipeline: security → build → ui → deploy, mixing objective gates and human reviews. |
| [ship_flow.loop](ship_flow.loop) | A `flow` chaining build → test → deploy, with a human approval before deploy. |
| [build.loop](build.loop) | Loop until `pnpm build` passes, with reflect-on-fail and a thrash guard. |
| [test.loop](test.loop) | Loop until `pnpm test` passes (integration suite green), with a thrash guard. |
| [deploy.loop](deploy.loop) | Tiny deploy loop gated on a healthcheck script. |
| [project.loop](project.loop) | Project-level config: use the BMAD method, run with Claude Code, schedule nightly, notify Slack. |
| [git_policy.loop](git_policy.loop) | A file-level `git:` block opting into branch → commit → push → pull request. |
| [bmad-auth.loop](bmad-auth.loop) | A BMAD-shaped feature as one pipeline: human-gated planning, per-story build stages, QA on human review. |
| [plan_from_file.loop](plan_from_file.loop) | The billing bugfix with its plan read from a file you control (`plan from "docs/plan.md"`) instead of agent-generated. |
