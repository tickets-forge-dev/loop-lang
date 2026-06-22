# Security Policy

## Supported versions

Loop is pre-1.0. Security fixes land on the latest release of the `0.x` line; please upgrade before reporting.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately via GitHub's [private vulnerability reporting](https://github.com/tickets-forge-dev/loop-lang/security/advisories/new) (Security → Advisories → *Report a vulnerability*). We aim to acknowledge within a few business days and will coordinate a fix and disclosure with you.

When you report, include where possible:

- the affected package (e.g. `@loop-lang/runtime`, `@loop-lang/parser`, the `loop-vscode` extension),
- a minimal reproduction or proof of concept,
- the impact you can demonstrate.

## Scope notes

Loop executes `.loop` flows by driving the local **Claude Code** CLI and running shell commands you put in `done when "<cmd>"` predicates and verifiers. Treat `.loop` files like scripts: only run flows you trust, and review the commands a flow will execute. The runtime's git and policy gates (`allow` / `ask me before`, branch protection) are guardrails, not a sandbox.
