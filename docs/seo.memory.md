# seo.loop — memory

Cross-run lessons for the on-page SEO loop over the loopflow.live docs site.

## 2026-07-05 — PASSED (2 cycles)

- **Goal met:** all 30 docs pages have unique title + description, full OG + Twitter card,
  self-referential absolute canonical, one `<h1>`, and valid JSON-LD; `robots.txt`,
  `sitemap.xml` (30 URLs), and `llms.txt` added.
- **Starting state:** only `index.html` + `playground.html` had OG/Twitter; nothing had a
  canonical; keyword pages were title+desc only; `game.html` had no description and no `<h1>`.
- **What worked:** the 26 keyword pages are structurally uniform, so a Python script
  (`scratchpad/inject_seo.py`) injected canonical/OG/Twitter/BreadcrumbList by reusing each
  page's own `<title>` + description — far faster than 26 hand edits. Keep this pattern for
  any future bulk head-tag change.
- **Gotchas found by the audit:**
  - `keywords/use-method.html` had an unescaped `<X>` inside `<title>` (invalid HTML, broke
    title parsing). Escaped to `&lt;X&gt;`. Check new keyword pages whose name contains `<…>`.
  - Keyword pages linked nav + footer to a non-existent `../tutorial.html` (the homepage is
    `index.html`, which top-level pages already link as "Tutorial"). Repointed to
    `../index.html`. If a `tutorial.html` is ever added at deploy, revisit.
  - `game.html` is a JS game with no natural `<h1>`; added a visually-hidden keyword-rich
    `<h1>` after `<body>` rather than disturbing the game UI.
- **Still open (bigger levers, out of this loop's scope):** keyword pages are thin
  (one-sentence bodies) — expanding them into real reference content is the biggest ranking
  lever. Per-page OG images would lift share CTR. Both are good candidates for their own loop.
- **Next run:** re-audit after any new pages; the script is idempotent (skips pages that
  already have a canonical), so re-running is safe.
