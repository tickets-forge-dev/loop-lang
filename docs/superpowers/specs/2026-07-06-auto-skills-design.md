# Auto Skills Design

## Summary

LoopFlow should have a single source of truth for skill behavior: the `skills` keyword. The keyword should cover explicit skill use, dynamic skill discovery, human approval policy, and the option to disable skills entirely.

The feature introduces four skill modes:

```loop
skills: auto
skills: ask
skills: fixed, seo-audit
skills: none
skills: auto, seo-audit, code-review
```

`auto` lets the runtime discover and add useful skills with minimum friction. `ask` recommends additions but waits for approval. `fixed` uses only explicitly listed skills. `none` disables skills.

## Goals

- Make skill configuration simple and unified.
- Let loops improve themselves early in a run by identifying useful missing skills.
- Keep friction low for trusted, low-risk skill additions.
- Preserve user control for risky installs, unknown sources, broad capabilities, or permanent generated skills.
- Keep old `use skills:` syntax working during migration.

## Non-goals

- No dependency on external graph recommenders.
- No `.loop` syntax for choosing skill sources or generation fallback behavior.
- No requirement that every loop use skills.
- No arbitrary silent installation from untrusted URLs.

## Syntax

### Preferred short form

```loop
skills: auto
skills: ask
skills: fixed, seo-audit
skills: none
skills: auto, seo-audit, code-review
```

The first item is the mode. Remaining items are explicit baseline skills.

### Future block form

A block form may be supported later if needed, but the initial design should prefer the short form:

```loop
skills:
  mode: auto
  use: seo-audit, code-review
```

The block form is not required for the first implementation unless it already fits the parser cleanly.

## Semantics

### `skills: auto`

The runtime may discover, install, generate, and use useful skills early in the loop. It should proceed silently for trusted, low-risk additions and only interrupt the user for risk boundaries.

If explicit skills are listed, they are always included as a baseline:

```loop
skills: auto, seo-audit
```

This means: use `seo-audit`, and auto-add more if helpful.

### `skills: ask`

The runtime performs the same early capability analysis as `auto`, but asks before adding or using any missing skills.

Explicit skills are still baseline skills:

```loop
skills: ask, seo-audit
```

This means: use `seo-audit`, then ask before adding anything else.

### `skills: fixed`

The runtime uses only listed skills. It does not discover, install, or generate additional skills.

```loop
skills: fixed, seo-audit, code-review
```

`skills: fixed` with no listed skills is valid but equivalent to `skills: none` in practice.

### `skills: none`

The runtime does not use skills, discover skills, install skills, or generate skills.

`skills: none, seo-audit` should be invalid because `none` cannot be combined with explicit skill names.

## Runtime Flow

The runtime performs skill handling early in the loop, after it has enough context to understand the goal but before serious implementation begins.

1. Parse the loop's `skills` directive.
2. Load explicit baseline skills, if any.
3. If mode is `none`, skip all skill behavior.
4. If mode is `fixed`, use only explicit baseline skills.
5. If mode is `auto` or `ask`, run early capability analysis:
   - read goal, `look at` context, `done when` checks, gates, and recent failure context if present;
   - decide whether specialized skills would materially improve the loop;
   - identify missing useful skills not already installed.
6. Search trusted/default skill sources for matching skills.
7. If no good source match exists, generate a temporary per-run skill when useful.
8. For `auto`, add/use safe skills silently and log what happened.
9. For `ask`, present recommendations and wait for approval before adding/using them.
10. Continue the loop with the final approved/enabled skill set.

## Low-friction policy

`auto` should feel automatic. The user should not configure sources or fallback behavior in the `.loop` file. The runtime owns those choices.

Silent in `auto`:

- already-installed local skills;
- trusted registry or bundled skills with safe install behavior;
- temporary per-run generated skills that do not persist beyond the run;
- skill recommendations that require no additional capabilities beyond the loop's existing policy.

Ask in `auto` when crossing a risk boundary:

- unknown or untrusted external source;
- install command with broad side effects;
- permanent generated skill installation;
- skill requests dangerous capabilities;
- skill wants network, filesystem, or execution access beyond the loop policy;
- skill conflicts with `allow ... ask me before ...` gates.

## Generated skills

If no suitable existing skill is found, the runtime may generate a task-specific temporary skill. Temporary generated skills should be stored in run-local state and should not pollute the user's permanent skill directories.

Permanent promotion of a generated skill requires explicit user approval.

Generated skills should include:

- name;
- purpose;
- when to use;
- concrete procedure;
- constraints and safety notes;
- any required verification behavior.

## Compatibility

Existing syntax should continue to parse and run initially:

```loop
use skills: seo-audit, code-review
```

Compatibility mapping:

```loop
use skills: seo-audit
```

is equivalent to:

```loop
skills: fixed, seo-audit
```

Documentation should prefer the new `skills:` keyword. Deprecation of `use skills:` can be considered later, after examples and templates migrate.

## Validation Rules

- Valid modes: `auto`, `ask`, `fixed`, `none`.
- `skills: none` cannot list explicit skills.
- `skills: fixed` may list zero or more explicit skills.
- `skills: auto` and `skills: ask` may list zero or more explicit baseline skills.
- Skill names should follow the existing skill-name rules used by `use skills:`.
- A loop should have at most one `skills:` directive.
- If both old `use skills:` and new `skills:` appear in one loop, the parser or runtime should emit a clear error or warning. Preferred behavior: error, because there should be one source of truth.

## Observability

The runtime should log skill decisions so users can understand what happened without being interrupted.

Log events should capture:

- mode;
- explicit baseline skills;
- installed/local skills used;
- recommended missing skills;
- source match vs generated fallback;
- whether approval was required;
- final enabled skill set.

The live dashboard, if enabled, can show this as an early run event.

## Documentation Updates

Update:

- `README.md` skills section;
- `docs/MANUAL.md` skill syntax/reference;
- `AGENTS.md` LoopFlow authoring grammar;
- templates that currently use `use skills:`;
- examples such as `examples/skills_memory.loop` and SEO examples if appropriate.

## Open Implementation Questions

- Where should trusted/default skill sources be defined internally?
- What storage path should run-local generated skills use?
- Should the first implementation include actual generation, or start with parser/runtime events and fixed/ask/auto scaffolding?
- Should old `use skills:` plus new `skills:` be a hard parse error immediately or a runtime warning first?

## Acceptance Criteria

- `.loop` files can express `skills: auto`, `skills: ask`, `skills: fixed, ...`, and `skills: none`.
- Explicit skills plus `auto` are treated as baseline skills plus dynamic discovery.
- `none` disables all skill behavior and cannot be combined with skill names.
- Existing `use skills:` loops still work during migration.
- Docs describe the new unified model and make `skills:` the preferred syntax.
- Runtime emits observable skill-decision events before implementation begins.
