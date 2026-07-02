# LoopFlow for VS Code

Language support for **LoopFlow** (`.loop`) — an open, natural-language DSL for loop
engineering. Describe a staged, self-correcting, human-gated agent workflow in plain
English, press ▶, and it runs on Claude Code.

```loop
loop "fix billing apostrophe bug":
  goal: settings save when the company name has an apostrophe
  done when the test "billing.spec.ts::apostrophe" passes
  look at: billing/form.tsx, api/settings.ts, and the last failure
  allow edits automatically, but ask me before migrations or pushes
  each cycle: plan, then act, then observe
  when it fails: reflect on which layer broke, then plan again
  after 6 tries: stop and warn "thrashing"
```

## What you get

- **Syntax highlighting** for the whole grammar — loops, pipelines, flows, `for each`,
  evals (`by N judges`), flake guards (`passes N times`), git policy, ctx skill lines.
- **Live error squiggles** — the real parser runs as you type; soft lint nudges when a
  loop is missing something load-bearing (a `done when`, a thrash guard).
- **Context-aware completion** (Ctrl+Space) — offers only what's valid where the cursor
  is — and **hover docs** for every keyword.
- **▶ Run buttons** above each definition — run headless into the Output panel (with
  native dialogs for human gates), or open a **Claude Code session** in the terminal.
- **New Loop from template…** — scaffold the best-practice library (bugfix, feature,
  cicd-check, security, greenfield-app, load-spec, …) from **File ▸ New File** or an
  Explorer right-click.
- A conservative **formatter** (tabs → spaces, trailing whitespace, blank-run collapse).

Inline AI prediction is intentionally left to Copilot / your editor's AI: write a `#`
comment describing intent and let it draft the `.loop`.

## Learn the language

- Tutorial + browser playground: linked from the
  [project repository](https://github.com/tickets-forge-dev/loop-lang#readme)
- Manual: [docs/MANUAL.md](https://github.com/tickets-forge-dev/loop-lang/blob/master/docs/MANUAL.md)
- Grammar reference: [AGENTS.md](https://github.com/tickets-forge-dev/loop-lang/blob/master/AGENTS.md)

## Requirements

Running loops needs the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
(`claude`) and Node 18+. Authoring works standalone. Get the runtime with
`npx @loop-lang/loop init`.

## Settings

| Setting | What it does |
|---|---|
| `loop.runMode` | What ▶ does: `ask` · `session` (Claude Code terminal) · `output` (headless panel) |
| `loop.claudePath` | Path to the Claude Code CLI (default `claude`) |
| `loop.cliPath` | Path to the `loop-run` CLI for output-panel runs (default: bundled) |
| `loop.model` | Model alias passed to Claude Code (empty = default) |

Apache-2.0 · [repo](https://github.com/tickets-forge-dev/loop-lang) · [changelog](https://github.com/tickets-forge-dev/loop-lang/blob/master/CHANGELOG.md)
