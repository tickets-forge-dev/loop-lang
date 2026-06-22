# @loop-lang/loop

Install **Loop** — a small natural-language DSL for self-correcting, human-gated coding loops — into any repo, so **Claude Code or any agent** can author and run `.loop` files.

```sh
npx @loop-lang/loop init
```

That scaffolds, into the current repo:

- **`AGENTS.md`** — the full Loop language reference. Any agent that opens the repo (Claude Code, Cursor, Copilot, Codex…) now knows how to write a `.loop`.
- **`.claude/skills/loopflow`** — the Claude Code `/loopflow` skill (author + run loops natively in a chat).
- **`examples/fix_test.loop`** — a starter loop to run.

### Options

```
loop init [--dir <path>] [--global] [--no-skill] [--no-example]
          [--claude-md] [--cursor] [--copilot] [--all-agents] [--force]
```

- `--global` — install the skill into `~/.claude/skills` instead of the repo.
- `--all-agents` — also drop memory pointers for Cursor + Copilot (and `CLAUDE.md`).
- `--force` — overwrite an existing skill / example.

Re-running `init` is safe: the `AGENTS.md` block is managed between markers and updated in place, not duplicated.

### After install

- **Claude Code:** open a chat in the repo → `/loopflow run examples/fix_test.loop`, or just describe the work and the agent writes the `.loop`.
- **Any agent:** it reads `AGENTS.md` and can author + run loops the same way.
- **Headless:** install the full runtime for `loop run <file>`.

Learn the language: the [tutorial](https://github.com/tickets-forge-dev/loop-lang), the keyword reference, and the playable Loop Lab.
