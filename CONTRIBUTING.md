# Contributing to Loop

Loop is a community project and an open standard. Contributions of every size are welcome — a new preset, a grammar fix, docs, a runtime improvement.

## Ways to contribute

- **Presets** (easiest, highest value) — author a method as a `.loop` file in `packages/stdlib/`. This is how the ecosystem grows. See `packages/stdlib/BMAD.loop` for the pattern.
- **Grammar / parser** — handle a syntax edge case in `@loop-lang/parser`. Add a fixture under `examples/` and a snapshot test.
- **Runtime** — improve how `@loop-lang/runtime` drives Claude Code, verifies, or handles human gates.
- **Editor** — TextMate grammar, formatter rules, or CodeLens behavior in `@loop-lang/vscode`.
- **Docs** — the README, the language reference, examples.

## The open standard

The `loop-spec` IR (`spec/loop-spec.schema.json`) is the contract between parser, runtime, and editor. Changes to it are the most impactful and the most scrutinized — open an issue to discuss before a PR. Anyone may build an alternative parser, runtime, or editor against this spec.

## Development

```bash
npm install
npm run build
npm test
```

Each package builds and tests independently (`npm run test -w @loop-lang/parser`).

## Pull requests

- Keep PRs focused. One concern per PR.
- Add or update tests. Parser/grammar changes need an `examples/*.loop` fixture.
- For new vocabulary or IR changes, update `spec/loop-spec.schema.json` **and** the README vocabulary list in the same PR.
- Be kind in review. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## Good first issues

Look for the `good first issue` label. Authoring a new preset is the best entry point — no internals required, just the language.

## License

By contributing, you agree your contributions are licensed under [Apache-2.0](LICENSE).
