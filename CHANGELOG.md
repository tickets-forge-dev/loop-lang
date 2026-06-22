# Changelog

All notable changes to Loop are recorded here. The packages share the `0.x`
line; the `loop-vscode` extension versions independently (it had an earlier cut).

## [Unreleased]

### Changed
- Unified the npm scope: the libraries moved from `@loop/*` to `@loop-lang/*`
  (`@loop-lang/parser`, `@loop-lang/runtime`, `@loop-lang/stdlib`,
  `@loop-lang/viz`), matching the installer `@loop-lang/loop`.
- The runtime CLI binary is now `loop-run` (`loop-run run`, `loop-run show`, …);
  the installer (`@loop-lang/loop`) keeps the `loop` command (`loop init`), so the
  two no longer collide on a global install.
- `plan from` is now a generic file source: `plan from "docs/plan.md"` reads the
  plan from a file instead of having the agent generate one. Replaces the former
  `plan from archon`.

### Removed
- Dropped all Archon coupling: the `@loop-lang/export-archon` package, the
  `loop export` (Archon workflow YAML) command, the `plan from archon` source,
  and the `ARCHON_URL`/`ARCHON_TOKEN`/`ARCHON_CODEBASE_ID` env vars. Loop runs
  natively on Claude Code; the language no longer references any third-party tool.

### Added
- CI (`build` + `test` on Node 18/20) and a tag-driven release workflow.
- `SECURITY.md`, this changelog, and publish metadata (`publishConfig`,
  `repository`, `homepage`, `bugs`) across the published packages.

## [0.1.0]

- First public release: the Loop (`.loop`) language, parser, runtime, viz,
  stdlib presets, the `loop` installer CLI, and the `loop-vscode` extension
  (published as `0.2.0`).
