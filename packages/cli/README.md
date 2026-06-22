# @loop-lang/loop

**Loop** is a small natural-language DSL for *loop engineering* — a `.loop` file describes a
self-correcting, human-gated coding workflow: its goal, what it may read, how it verifies
itself, when it stops, and where a human steps in. Your agent then **runs that loop**,
cycling plan → act → observe and reflecting on failures until the goal is met.

This package drops Loop into any repo so **Claude Code — or any agent** — can author and run
`.loop` files.

```sh
npx @loop-lang/loop init
```

## What a `.loop` looks like

```loop
loop "fix the failing checkout tax test":
  goal: the tax line on the cart is correct
  look at: src/cart, and the last failure
  done when "pnpm test checkout" passes
  also: a security scan
  after 6 tries: stop and warn "still red — needs a human"
```

Plain words, but precise: `done when` is how the loop checks itself, `also:` adds a quality
pass once the goal is met, and the guard stops a thrashing loop instead of looping forever.
Bigger jobs scale up to a **`pipeline`** (an epic → ordered stages) or a **`flow`** (a chain
of whole `.loop` files — discover → design → build each story).

## What `init` scaffolds

- **`AGENTS.md`** — the full language reference. Any agent that opens the repo (Claude Code,
  Cursor, Copilot, Codex…) now knows how to write a `.loop`.
- **`.claude/skills/loopflow`** — the Claude Code **`/loopflow`** skill (author + run loops
  natively in a chat). *Invoked as `/loopflow`, not `/loop` — the latter is Claude Code's
  built-in scheduler.*
- **`CLAUDE.md`** pointer — a standing nudge so Claude Code reaches for a `.loop` instead of
  doing the work ad hoc. (Written by default; `--no-claude-md` to skip.)
- **`examples/fix_test.loop`** — a starter loop to run.

## The `/loopflow` skill — a guided tour

You don't need to know the language first. In a Claude Code chat, just describe the work:

```
/loopflow build a rate limiter — done when the burst test passes, and run a security pass
```

The skill **interviews you** — it scopes the purpose first (a one-test fix? a feature? a
whole app?), offers the quality passes worth adding (tests, security, code review, clean
architecture), then writes the `.loop` *in front of you*, naming each keyword as it goes.
By the end of one loop you've learned the language by building. Then it runs the loop right
in the chat, so you watch every step and answer any gate inline.

Already have a `.loop`? Run it directly:

```
/loopflow run examples/fix_test.loop
```

## Options

```
loop init [--dir <path>] [--global] [--no-skill] [--no-example]
          [--no-claude-md] [--cursor] [--copilot] [--all-agents] [--force]
```

- `--global` — install the skill into `~/.claude/skills` instead of the repo.
- `--no-claude-md` — skip the `CLAUDE.md` pointer (written by default).
- `--cursor` / `--copilot` / `--all-agents` — also drop memory pointers for those agents.
- `--no-skill` / `--no-example` — skip the skill or the starter loop.
- `--force` — overwrite an existing skill / example.

Re-running `init` is safe: the `AGENTS.md` block is managed between markers and updated in
place, never duplicated.

## After install

- **Claude Code:** open a chat in the repo → `/loopflow run examples/fix_test.loop`, or just
  describe the work and let the skill write the `.loop`.
- **Any agent:** it reads `AGENTS.md` and authors + runs loops the same way.
- **Headless:** install the full runtime to run loops from the CLI with `loop run <file>`.

## Learn more

The [loop-lang repo](https://github.com/tickets-forge-dev/loop-lang) — tutorial, full keyword
reference, and the playable Loop Lab.

Apache-2.0.
