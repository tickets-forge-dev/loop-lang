# Changelog

All notable changes to LoopFlow are recorded here. The packages share the `0.x`
line; the `loop-vscode` extension versions independently (it had an earlier cut).
Versions track the `@loop-lang/loop` installer package.

## [Unreleased]

## [0.5.0] — 2026-06-28

> `@loop-lang/loop` 0.5.0 · `@loop-lang/{parser,runtime,stdlib,viz}` 0.2.0

### Added
- **Live dashboard** — a real-time browser view of a run that renders the loop's
  *actual* structure (pipeline stages / flow steps / for-each items) as a turn-by-turn
  route (Waze-style): a "you are here" marker, the steps ahead, human gates flagged, and
  `for each` sprints listed by item title with live progress and a per-item
  plan/act/observe tracker.
  - Headless: `loop-run run <file> --live` opens a browser and the engine streams every
    event to it over Server-Sent Events.
  - In-session: running a loop via `/loopflow` opens the dashboard when enabled, pushing
    one event per narrated step.
- `loop-run live <file>` (dashboard server, no engine) and
  `loop-run emit <port> '<json>'` (push one event) commands.
- `loop init` now writes a `loop.config` file (`live=false` by default) that gates the
  in-session dashboard; written once and never clobbered unless `--force`. Set
  `live=true` to have `/loopflow` show the dashboard.
- `loop version` command (and `--version` / `-v`).
- `@loop-lang/viz` exports `renderLiveHtml`; `@loop-lang/runtime` adds `startLiveServer`
  and derives short item labels (`labelOf`) so headless sprints show real story titles.
- `/loopflow` integrates `superpowers:brainstorming` for the no-plan (medium/large) path.
- **Template library** — `templates/` ships best-practice, copy-and-edit starter loops for
  everyday work (bugfix, feature, brownfield-feature, refactor; cicd-check, security,
  clean-architecture, test-coverage, review-diff; greenfield-app and load-spec with their
  supporting discover/design/story-template + starter sprint.yaml/plan.md). `loop init`
  installs them (`--no-templates` to skip), and AGENTS.md + the `/loopflow` skill point the
  agent at a matching template before authoring from scratch. All validated to parse.

### Changed
- The dashboard uses a flat, Linear-style dark theme; self-contained (no external assets)
  and bound to `127.0.0.1` only.
- SSE stream tags each event with an id and replays buffered events on connect, deduping
  on reconnect via `Last-Event-ID`, plus a heartbeat so idle connections survive proxy/NAT
  timeouts — events fired before the browser connects aren't lost and a transient drop
  doesn't double-deliver.
- `loop-run run --live` keeps the dashboard alive after the run (Ctrl-C to exit) so a fast
  loop's result stays viewable; shared run wiring de-duplicated.

### Fixed
- Dashboard: a failed cycle node no longer throws (and now logs the failure); a standalone
  single-loop file activates its route leg; the "needs you" gate clears when work resumes;
  `for each` legs finalize on completion.
- `labelOf` follows YAML block scalars (`story: |`/`>`) to their body, keeps URLs/times
  (`https://`, `09:00`) intact, only strips a balanced quote pair, and truncates without
  splitting a surrogate pair.
- Cross-platform: Windows browser auto-open (`cmd /c start`), page title via
  `path.basename`, `version.test` cwd via `fileURLToPath`. HTML-escape the dashboard
  `<title>`; corrected the `embedJson` `<`-escape.

### Docs
- Tutorial (`docs/index.html`), `README.md`, `docs/MANUAL.md`, `AGENTS.md`, and the
  `/loopflow` skill document the live dashboard, the `loop.config` gate, and the
  `live`/`emit`/`--live` commands.
- The tutorial now leads with the **Claude Code chat (`/loopflow`)** as the first-class
  usage path and demotes the VS Code extension to optional hand-authoring; added a
  "Starter templates" section.

## [0.4.0] — 2026-06-27

### Added
- **Skills** — `use skills: <a>, <b>` lets a loop invoke named skills during plan/act, and
  `done when the skill "<name>" approves` / `scores N or more` turns a review skill into a
  verifiable predicate.
- **Cross-run memory** — `remember in "<file>"` reads past lessons on start and appends a
  dated outcome on stop, so a loop improves across runs.
- `/loopflow` auto-installs globally on `npm install -g @loop-lang/loop`.

## [0.2.0] — 2026-06-22

### Changed
- Unified the npm scope: the libraries moved from `@loop/*` to `@loop-lang/*`
  (`@loop-lang/parser`, `@loop-lang/runtime`, `@loop-lang/stdlib`, `@loop-lang/viz`),
  matching the installer `@loop-lang/loop`.
- The runtime CLI binary is now `loop-run` (`loop-run run`, `loop-run show`, …); the
  installer (`@loop-lang/loop`) keeps the `loop` command (`loop init`), so the two no
  longer collide on a global install.
- Renamed the Claude Code skill to `/loopflow` (avoids colliding with the built-in `/loop`
  scheduler) and rewrote the README.
- `plan from` is now a generic file source: `plan from "docs/plan.md"` reads the plan from
  a file instead of having the agent generate one. Replaces the former `plan from archon`.

### Removed
- Dropped all Archon coupling: the `@loop-lang/export-archon` package, the `loop export`
  (Archon workflow YAML) command, the `plan from archon` source, and the
  `ARCHON_URL`/`ARCHON_TOKEN`/`ARCHON_CODEBASE_ID` env vars. LoopFlow runs natively on
  Claude Code; the language no longer references any third-party tool.

### Added
- CI (`build` + `test` on Node 18/20) and a tag-driven release workflow.
- `SECURITY.md`, this changelog, and publish metadata (`publishConfig`, `repository`,
  `homepage`, `bugs`) across the published packages.

## [0.1.0]

- First public release: the LoopFlow (`.loop`) language, parser, runtime, viz, stdlib
  presets, the `loop` installer CLI, and the `loop-vscode` extension (published as `0.2.0`).
