# Skill source: ctx

Loop names the skills a `.loop` needs by bare string — `use skills: a, b` and
`done when the skill "x" approves` — and assumes they already exist in
`~/.claude/skills`. **[ctx](https://github.com/stevesolun/ctx)** (`pip install
claude-ctx`) is the recommender that fills the gap: point it at a goal and it
recommends the smallest useful skill bundle and installs the bodies into
`~/.claude/skills`, so the names resolve.

Loop stays the top, user-facing layer; ctx is the layer beneath it that loads
skills straight into the loop. The coupling is loose — ctx is optional, reached
over MCP, and if it isn't attached the loop runs exactly as it would without it.

## Setup

```bash
pip install claude-ctx
ctx-init --graph --model-mode skip          # seed the recommendation graph
claude mcp add ctx -- ctx-mcp-server        # attach ctx's MCP tools
```

That exposes the tools the Loop bridge uses: `ctx__recommend_bundle` (preview),
`ctx__loop_provision` (recommend + install + return names), and `ctx__loop_topup`
(add more on a failing cycle). `loop_provision`/`loop_topup` accept an optional
`permissions` array (`skills, agents, mcps, harnesses`) plus `own_llm` /
`model_provider` / `model`, and return the versioned `ctx.loop_adapter.v1`
contract (see *Capability groups* below).

## Grammar

Three optional forms, all no-ops when ctx isn't attached:

```loop
recommend skills with ctx               # config tier: ctx is this file's skill source

loop "harden the stripe webhook handler":
  goal: webhook retries are idempotent and signature-checked, with tests
  use skills recommended by ctx                 # resolve a bundle for the goal
  use skills recommended by ctx for "stripe webhook idempotency"   # ...or an explicit query
  top up skills from ctx when a step needs more # run-time: pull more on a failed cycle
  done when "pnpm test api/webhooks" passes
```

| Form | Tier | Effect |
|------|------|--------|
| `recommend skills with ctx` | config | Declares ctx as the file's skill source. |
| `use skills recommended by ctx [for "<intent>"]` | loop body | Author-time: bake resolved names into `use skills:`. Run-time: re-resolve before the first plan. |
| `top up skills from ctx when a step needs more` | loop body | Run-time: after a cycle fails and reflects, pull additional skills before re-planning. |
| `grant ctx: skills, agents, mcps, harnesses` | config | Capability groups the file lets ctx recommend. Fails closed; default (no line) = skills+agents. |
| `ctx may use my own model "<provider>/<model>"` | config | Declares a user-owned/local/API model — unlocks harness recommendations (dry-run only). |

## Capability groups (beyond skills)

ctx recommends across four entity types; a `.loop` grants which ones apply. The
model **fails closed** — with no `grant ctx:` line the grant defaults to
`skills + agents` (the original behaviour), and only listed groups are ever
returned.

| Group | Installed? | Behaviour |
|-------|-----------|-----------|
| `skills` | yes → `~/.claude/skills` | Merged into the cycle's skill set, as before. |
| `agents` | yes → `~/.claude` | Loaded the same way Loop loads named (sub)agents. |
| `mcps` | **no — recommend-only** | Fitting MCP servers surfaced with a suggested `ctx-mcp-install <name>`; emitted on the `ctx` event. The runtime never auto-registers one. |
| `harnesses` | **no — recommend-only, gated** | Recommended only when the loop declares a user-owned model (`ctx may use my own model …`); shipped as an explicit `ctx-harness-install <name> --dry-run` command. Never an automatic install. |

The provision/top-up calls return the `ctx.loop_adapter.v1` contract:
`{ version, permissions, use_skills, installed, skipped, unavailable,
recommended, capabilities{skills,agents,mcps,harnesses}, harness_install,
warnings }`. The runtime merges `use_skills` (skills + agents) into the loop and
surfaces `capabilities.mcps` / `capabilities.harnesses` / `harness_install` on
the `ctx` event for the host or a human to act on — it never installs an MCP
server or a harness on its own.

See `examples/ctx_capabilities.loop` for the full-capability example.

## How it works

**Author time (`/loopflow`).** During the interview ctx recommends for the goal,
you approve, the skills are installed, and their names are written into a literal
`use skills:` line — so the `.loop` stays self-contained. The
`use skills recommended by ctx` directive is kept alongside as the regeneration
record and the run-time trigger.

**Run time (`loop run`).** The runtime detects the directive, calls the ctx MCP
server (`ctx__loop_provision`) before the first `plan`, and merges the resolved
names into the skill set the spawned `claude` cycles see. With `top up skills
from ctx`, it calls `ctx__loop_topup` with the failing cycle's reflection and
folds in any new skills before re-planning. Both emit a `ctx` event on the
`--events` / live stream, so you can see what was loaded.

**Degradation.** If the ctx MCP server isn't installed/attached, or a call
fails, the runtime logs one `ctx … (skipped)` event and continues with whatever
skills are already named. A loop never fails because ctx is missing.

## Why they compose

ctx's Claude Code integration is *passive*: it installs skills into
`~/.claude/skills` and the manifest; it never drives a model itself (its only
agent loop is the LiteLLM-based `ctx run`). Loop *is* the Claude driver — its
runtime spawns `claude -p … --allowedTools …Skill…`. Both target the **same**
`~/.claude/skills` and the same Claude Code Skill tool, so a skill ctx installs
is immediately resolvable by Loop's cycles. ctx provisions; Loop drives.

See `examples/ctx_skills.loop` for a worked example, and `AGENTS.md`
(*Skill source: ctx*) for the grammar in context.
