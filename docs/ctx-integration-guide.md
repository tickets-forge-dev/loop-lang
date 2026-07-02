# Loop × ctx — the self-equipping coding loop

> Your loop already knows *what* to build and *how to check it's done*.
> ctx makes it know *what to bring* — the skills, agents, MCP servers, and model
> harnesses the job needs — and loads them before the first plan.

This is the complete guide to the Loop ⇄ ctx integration: what it is, why it
matters, how to set it up, and how to drive the full capability set — including
running on **your own local or API model**.

---

## 1. The 60-second pitch

A `.loop` file is a plain-English, self-correcting workflow: a goal, a way to
verify "done", human gates, and a retry edge. It already runs your agent in a
tight plan → act → observe → reflect cycle until the tests pass.

The one thing a loop *couldn't* do was **equip itself**. `use skills: a, b`
assumes `a` and `b` already exist on disk. Someone had to know the right skills,
find them, and install them by hand.

**ctx closes that gap.** Point a loop at a goal and ctx recommends the smallest
useful bundle of capabilities for it and provisions them — so the loop walks in
already holding the right tools:

- **Skills & agents** — installed straight into `~/.claude/skills`, ready for the
  loop's very first plan.
- **MCP servers** — recommended with a one-line install command (e.g. a
  filesystem or database server the goal implies).
- **Model harnesses** — when you bring your own model (local Ollama, an API
  model), ctx recommends a fitting agent harness (AutoGen, Langfuse, …) as a
  ready-to-run, **dry-run** install command.

It is **opt-in, fail-closed, and human-gated by design.** A loop with no ctx
attached runs exactly as before. Nothing heavier than a skill is ever installed
without you asking.

**The outcome you're buying:** stop hand-curating tooling for every workflow.
Describe the goal; the loop arrives equipped.

---

## 2. The problem it solves

Teams writing agentic workflows hit the same wall:

| Without ctx | With ctx |
|---|---|
| You must already know which skills a task needs. | Describe the goal; ctx recommends the bundle. |
| Skills are installed by hand, per machine, per person. | The loop installs them at run time, reproducibly. |
| MCP servers and model harnesses are wired up manually. | Recommended for the goal, with the exact install command. |
| "Bring your own model" means assembling a harness yourself. | Declare your model; ctx recommends a fitting harness. |
| Tooling drift between author's box and CI. | The `.loop` re-resolves its bundle on every headless run. |

ctx is the **provisioning layer beneath Loop**. Loop stays the driver; ctx is
the quartermaster.

---

## 3. What you get — the capability set

ctx recommends across four capability groups. A `.loop` *grants* which ones
apply (see §6). Each group behaves differently, on purpose:

| Group | Installed automatically? | What happens |
|-------|--------------------------|--------------|
| **skills** | ✅ into `~/.claude/skills` | Merged into the loop's skill set for plan/act. |
| **agents** | ✅ into `~/.claude` | Sub-agents the loop can invoke, loaded the same way. |
| **mcps** | ❌ **recommend-only** | Fitting MCP servers surfaced with a `ctx-mcp-install <name>` command. The loop never auto-registers one. |
| **harnesses** | ❌ **recommend-only, gated** | Recommended only when you declare your own model; shipped as a `ctx-harness-install <name> --dry-run` command you run. Never auto-installed. |

**Why the split?** Skills and agents are small, sandboxed, and the loop needs
them in hand to work. MCP servers and harnesses pull real software and touch your
machine's configuration — so ctx *recommends* them and hands you the exact
command, but the decision to install stays yours. That's the trust boundary that
makes this safe to run unattended.

---

## 4. How it works

```
        ┌────────────┐   grant + goal + own-model    ┌─────────────────┐
  You → │   .loop    │ ────────────────────────────► │  ctx-mcp-server │
        │  (Loop)    │ ◄──────────────────────────── │  (recommender)  │
        └─────┬──────┘   ctx.loop_adapter.v1 contract └────────┬────────┘
              │                                                │
              │ skills/agents → installed                      │ recommend_bundle
              │ mcps/harnesses → surfaced (recommend-only)     │ + harness recommender
              ▼                                                ▼
     plan → act → observe → reflect ↺              ~/.claude/skills + the graph
```

1. A loop that opts into ctx calls `ctx__loop_provision` **once before the first
   plan**, passing its goal, the capability grants, and (optionally) your model.
2. ctx returns a single read-only JSON contract (`ctx.loop_adapter.v1`): the
   skills/agents it installed, and the MCP servers / harnesses it recommends.
3. The loop merges skills + agents into its working set, and surfaces the
   recommend-only items on its event stream for you (or your host) to act on.
4. On a failed cycle, `top up skills from ctx` asks for *more* — the loop learns
   what it was missing from the failure and re-equips before the next plan.

If ctx isn't attached, every ctx line is inert and the loop runs unchanged. A
ctx call that fails emits one "skipped" event and the loop continues. **A loop
never fails because ctx is missing.**

---

## 5. Setup

### Prerequisites
- [Loop](https://github.com/tickets-forge-dev/loop-lang) (`.loop` runtime / the
  `/loopflow` skill in Claude Code).
- Python 3.11+ for ctx.

### Install & attach ctx

```bash
# 1. Install ctx and seed its recommendation graph
pip install claude-ctx
ctx-init --graph --model-mode skip          # extracts the recommendation graph into ~/.claude/skill-wiki

# 2. Attach ctx's tools to Claude Code over MCP
claude mcp add ctx -- ctx-mcp-server
claude mcp list                             # → ctx: ✔ Connected
```

That exposes the tools the Loop bridge uses:

- `ctx__recommend_bundle` — read-only preview of what ctx would recommend.
- `ctx__loop_provision` — recommend + install skills/agents, recommend mcps/harnesses, return the contract.
- `ctx__loop_topup` — the same, for *additional* capabilities after a failed cycle.

> **No graph yet?** ctx will return an empty (but valid) contract — the loop runs
> on whatever it already names. Re-run `ctx-init --graph` to seed or refresh.

---

## 6. The grammar

Five lines, all additive, all inert without ctx attached.

```loop
recommend skills with ctx                          # config: ctx is this file's capability source
grant ctx: skills, agents, mcps, harnesses         # config: which groups ctx may recommend (fail-closed)
ctx may use my own model "ollama/llama3.1"         # config: declare your model → unlocks harnesses

loop "stand up a local agent loop":
  goal: an MCP agent loop on local ollama with filesystem access, with passing tests
  use skills recommended by ctx for "local ollama agent loop with filesystem MCP"   # loop body
  top up skills from ctx when a step needs more                                      # loop body
  done when "pytest agent/tests/test_loop.py" passes
```

| Line | Tier | Effect |
|------|------|--------|
| `recommend skills with ctx` | config | Declares ctx as the file's capability source. |
| `grant ctx: <groups>` | config | Capability groups ctx may recommend. **Fails closed** — omit it and ctx defaults to `skills + agents`; list only what you want. |
| `ctx may use my own model "<provider>/<model>"` | config | Declares a user-owned/local/API model. Required to unlock **harness** recommendations. |
| `use skills recommended by ctx [for "<intent>"]` | loop body | Provision the bundle for the goal (or an explicit intent) before the first plan. |
| `top up skills from ctx when a step needs more` | loop body | After a failed cycle reflects, pull additional capabilities before re-planning. |

### Fail-closed permissions — what it means

`grant ctx:` is an allow-list, not a wish-list. ctx returns **only** the groups
you name:

- No `grant ctx:` line → `skills + agents` (the original, safe default).
- `grant ctx: skills` → skills only; agents/mcps/harnesses are never returned.
- `grant ctx: skills, mcps` → skills installed, MCP servers recommended; no agents, no harnesses.

A typo in a group name grants nothing for that token — it can never accidentally
widen access.

---

## 7. Using your own model (the harness story)

This is the feature that turns Loop × ctx from "skill installer" into "bring your
own model agent platform".

If you run on a **local model** (Ollama, llama.cpp) or **your own API model**,
you usually need a *harness* — an agent framework like AutoGen or an
observability layer like Langfuse — wired to that model. ctx recommends one for
your goal and model, and hands you the command to install it.

### Step 1 — declare your model

```loop
ctx may use my own model "ollama/llama3.1"
```

The string is `"<provider>/<model>"`. The provider (before the first `/`) and the
full model id are both passed to ctx so it can score harnesses for your exact
setup.

### Step 2 — grant the harness group

```loop
grant ctx: skills, harnesses
```

Harnesses are **double-gated**: they're returned only when *both* `harnesses` is
granted *and* a model is declared. Grant `harnesses` without a model and ctx
fails closed with a clear warning instead of recommending something it can't fit:

```json
"warnings": ["harnesses granted but no user-owned model declared
              (set own_llm / model_provider / model) — skipping harness recs."]
```

### Step 3 — run, review, install

ctx returns the recommended harnesses with fit scores and a **dry-run** install
command:

```json
"capabilities": {
  "harnesses": [
    { "name": "autogen",  "type": "harness", "fit_score": 1.0,
      "install_command": "ctx-harness-install autogen --dry-run" },
    { "name": "langfuse", "type": "harness", "fit_score": 0.9,
      "install_command": "ctx-harness-install langfuse --dry-run" }
  ]
},
"harness_install": "ctx-harness-install autogen --dry-run"
```

The loop **never installs a harness for you.** It surfaces the command; you run
it. `--dry-run` shows exactly what would be installed before anything touches
your machine. Drop `--dry-run` when you're ready.

> **Why gated and dry-run?** A harness is the one capability that pulls a full
> framework and runs code against your model. Keeping it an explicit, previewable
> step is what lets you grant `harnesses` in a workflow that otherwise runs
> unattended.

---

## 8. A full worked example

`examples/ctx_capabilities.loop`:

```loop
recommend skills with ctx
grant ctx: skills, agents, mcps, harnesses
ctx may use my own model "ollama/llama3.1"

loop "stand up a local agent loop":
  goal: an MCP agent loop running on local ollama with filesystem access, with passing tests
  look at: agent/loop.py, agent/tests/test_loop.py
  use skills recommended by ctx for "local ollama agent loop with filesystem MCP"
  top up skills from ctx when a step needs more
  each cycle: plan, then act, then observe
  done when "pytest agent/tests/test_loop.py" passes
  when it fails: reflect on the failing assertion, then plan again
  after 6 tries: stop and warn "local agent loop still red — needs a human"
```

Print its shape:

```bash
loop show examples/ctx_capabilities.loop
```
```
loop "stand up a local agent loop"
   ↻  plan → act → observe            (each cycle)
   ↺  on fail: reflect → plan         (the back-edge)
   ✓  done when: "pytest agent/tests/test_loop.py" passes
   ⛔ guard: after 6 tries → stop & warn "local agent loop still red — needs a human"
```

Run it:

```bash
loop run examples/ctx_capabilities.loop --events
```

What happens on the first cycle:
1. ctx provisions skills + agents for the goal → installed, merged into the plan.
2. The filesystem MCP server is **recommended** (with its install command) on the
   `ctx` event — you decide whether to register it.
3. Because a model is declared, a fitting **harness** is recommended as a dry-run
   command.
4. plan → act → observe runs. If the tests fail, `top up skills from ctx` pulls
   more before the next plan.

---

## 9. The contract (for integrators)

Every provision/top-up call returns one stable, versioned JSON object. Build
against it directly if you're embedding Loop or driving ctx from another host:

```jsonc
{
  "version": "ctx.loop_adapter.v1",
  "permissions": { "skills": true, "agents": true, "mcps": true, "harnesses": true },
  "use_skills": ["..."],          // skill + agent names now resolvable on disk
  "installed": ["..."],            // freshly installed this call
  "skipped":   ["..."],            // already present
  "unavailable": [{ "name": "...", "status": "not-in-wiki" }],
  "recommended": [{ "name": "...", "type": "skill", "score": 146.9 }],
  "capabilities": {
    "skills":    [{ "name": "...", "type": "skill",      "status": "installed" }],
    "agents":    [{ "name": "...", "type": "agent",      "status": "installed" }],
    "mcps":      [{ "name": "...", "type": "mcp-server", "status": "available",
                    "install_command": "ctx-mcp-install ..." }],
    "harnesses": [{ "name": "...", "type": "harness",    "fit_score": 1.0,
                    "install_command": "ctx-harness-install ... --dry-run" }]
  },
  "harness_install": "ctx-harness-install ... --dry-run",   // or null
  "warnings": []
}
```

The contract is **additive and back-compatible**: the original
`use_skills`/`installed`/`skipped` keys are unchanged, so existing skills-only
integrations keep working untouched.

MCP tool parameters (`ctx__loop_provision` / `ctx__loop_topup`):

| Param | Type | Meaning |
|-------|------|---------|
| `goal` | string | What the capabilities are for. |
| `intent` | string | Optional query override. |
| `permissions` | string[] | Granted groups. Omit → `skills + agents`. |
| `own_llm` / `model_provider` / `model` | bool / string / string | Your model — unlocks harnesses. |
| `top_k` | int | Recommendations per group (≤ 5). |
| `dry_run` | bool | Recommend without installing skills/agents. |

---

## 10. Safety & trust

Designed to be safe to grant in unattended workflows:

- **Opt-in.** No ctx attached → every ctx line is a no-op. Existing loops are unaffected.
- **Fail-closed.** Capabilities are an allow-list. Nothing outside the grant is ever returned.
- **Recommend-only for heavy capabilities.** MCP servers and harnesses are never
  auto-installed — ctx hands you the command; you run it.
- **Dry-run by default for harnesses.** See exactly what would be installed first.
- **Human-gated, double-gated for harnesses.** They require both the grant *and* a declared model.
- **Degrades quietly.** A failed ctx call emits one event and the loop continues
  with whatever it already names.
- **Reproducible.** Author-time names are baked into a literal `use skills:` line,
  while the directive re-resolves on headless runs — so CI matches the author's box.

---

## 11. FAQ

**Do I have to use ctx?** No. It's entirely optional and opt-in. Loops without
ctx lines behave identically.

**Will it install things I didn't approve?** Only skills and agents are installed
automatically, and only from groups you granted. MCP servers and harnesses are
never auto-installed.

**Can I preview before anything changes?** Yes — `ctx__recommend_bundle` is a
read-only preview, and harness/MCP recommendations are always commands you choose
to run. Use `dry_run: true` to recommend skills/agents without installing them.

**Does it work headless / in CI?** Yes. `loop run <file>` re-resolves the bundle
through the ctx MCP server, so an unattended run equips itself the same way an
author's session did.

**What if my goal needs a tool ctx doesn't know?** ctx recommends from its graph;
unknown items simply don't appear. The loop still runs with whatever it names.
Re-seed or extend the graph to teach ctx new capabilities.

**Local model or API model?** Both. Declare it with
`ctx may use my own model "<provider>/<model>"`. That's what unlocks harness
recommendations tuned to your setup.

---

## 12. Reference

- Worked examples: `examples/ctx_skills.loop` (skills only),
  `examples/ctx_capabilities.loop` (full capability set).
- Grammar in context: `AGENTS.md` → *Skill source: ctx*.
- Mechanics & contract: `docs/ctx-skill-source.md`.
- ctx itself: <https://github.com/stevesolun/ctx> (`pip install claude-ctx`).

**One line to remember:** *ctx provisions; Loop drives.* You describe the goal —
the loop arrives equipped.
