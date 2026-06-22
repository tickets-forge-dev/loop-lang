# Loop for VSCode

Editor tooling for the **Loop** (`.loop`) DSL — a natural-language language for loop
engineering. See the [project repo](https://github.com/tickets-forge-dev/loop-lang).

## Features

- **Syntax highlighting** for `.loop` files
- **Context-aware autocomplete** (Ctrl+Space) — offers only what's valid where the cursor
  is: top level vs loop body vs pipeline vs stage body
- **Hover docs** on the vocabulary
- **Live diagnostics** — parse errors as red squiggles, plus soft warnings (a loop with no
  way to verify "done", or a self-correcting loop with no thrash guard)
- **Formatter** (Format Document)
- **▶ Run loop** CodeLens above each `loop`/`pipeline` — runs it via the `loop` CLI

Inline AI prediction is intentionally left to Copilot / your editor's AI: write a `#`
comment describing intent and let it draft the `.loop`.

## Settings

- `loop.cliPath` — path to the `loop` CLI (`@loop-lang/runtime` `dist/cli.js`) for the Run button.
- `loop.model` — model alias passed to Claude Code on Run (e.g. `opus`, `sonnet`).

## License

Apache-2.0.
