# Publishing a loop to the market

Uploads are pull requests. Add one file under [`marketplace/loops/`](./loops/), open a
PR, and CI runs the same validator the maintainers use. Merge = published: the next
deploy rebuilds the catalog and your loop appears on
[loopflow.live/market](https://loopflow.live/market/) with your attribution.

## The bar (CI enforces every line)

1. **It parses.** Test locally: `node market/validate-marketplace.mjs` from the repo
   root — or paste your loop into the [playground](https://loopflow.live/playground.html).
2. **A machine-checkable `done when`.** At least one predicate that is a test, a shell
   command, or a skill eval. *Prose-only verification is rejected* — "the goal is met
   with evidence" is a wish, not a check. `a human confirms` may be present but never alone.
3. **A safety net.** If your loop has a reflect back-edge, it needs an
   `after N tries` ceiling.
4. **Attribution header.** First lines of the file:
   - your own concept: `# original — <your name or @handle>`
   - adapted from someone: `# concept via <author> — <https source url>`
5. **No secrets, no project-specific paths without `# TODO` markers.** Commands the
   adopter must change get a `# TODO: …` comment — see any existing loop in
   [`loops/`](./loops/) for the style.

## Style (what reviewers look for beyond CI)

- **The authoring order** — contract → boundaries → engine → safety net
  ([why](https://loopflow.live/#anatomy)).
- A goal that names an *outcome*, not an activity.
- Gates on anything irreversible (`ask me before …`).
- A `warn` message that will tell a future human what got stuck.
- Comments that teach: your loop is also documentation.

## What happens to your PR

1. CI validates (about a minute).
2. A maintainer reviews for style + usefulness — same bar as everything in the catalog.
3. Merge → published on the next deploy, full attribution, your source link on the card.

By submitting you agree your loop ships under the repo's [Apache-2.0](../LICENSE) license.
