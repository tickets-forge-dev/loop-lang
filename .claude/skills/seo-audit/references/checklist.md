# On-page SEO checklist — full detail

Read this when you need the precise threshold, the common failure mode, or a copy-paste
example for a given item. The SKILL.md has the summary; this has the specifics.

## Table of contents
1. Title tag
2. Meta description
3. Open Graph
4. Twitter / X card
5. Canonical URL
6. Headings
7. Image alt text
8. Structured data (JSON-LD)
9. Robots directives
10. Crawlability (robots.txt, sitemap, links)
11. Technical hygiene
12. Copy-paste starter block

---

## 1. Title tag
- **Good:** unique per page, ~50–60 characters (Google truncates around 580px ≈ 60 chars),
  primary keyword/topic near the front, brand at the end (`Primary Topic — Brand`).
- **Bad:** same title on every page, empty, >70 chars (truncated in results), keyword-stuffed,
  or set only via JS so crawlers that don't run JS miss it.
- Only one `<title>` per page. In SPAs, make sure the title is set before first paint or
  server-rendered, not just updated on route change.

## 2. Meta description
- **Good:** 120–160 characters, reads like ad copy, describes what the page delivers, unique
  per page, includes the term a searcher would use.
- **Bad:** missing (Google auto-generates a worse one), duplicated across pages (the most
  common real SEO defect), truncated mid-word, or just the first sentence of body text.
- Not a ranking factor directly, but drives click-through from the results page, which is.

## 3. Open Graph (`og:`)
Required for a rich share card on LinkedIn, Facebook, Slack, Discord, iMessage:
- `og:title` — can differ from `<title>`; optimize for the share context.
- `og:description` — 2–4 sentences.
- `og:image` — **absolute** URL, ideally 1200×630 (1.91:1), under ~5MB, PNG/JPG. This is the
  single most impactful tag for social — a missing or relative `og:image` is why a shared link
  renders as a blank/text-only card.
- `og:url` — the canonical absolute URL of the page.
- `og:type` — `website` for home/landing, `article` for posts.
- Optional but nice: `og:site_name`, `og:image:alt`, `og:locale`.

## 4. Twitter / X card
- `twitter:card` — `summary_large_image` for a big image, `summary` for a small one.
- `twitter:title`, `twitter:description`, `twitter:image` — X falls back to OG tags for
  most fields, so you often only need `twitter:card` if OG is complete. Verify rather than
  assuming; add `twitter:image` explicitly if the OG image isn't picked up.
- Optional: `twitter:site` / `twitter:creator` (@handles).

## 5. Canonical URL
- `<link rel="canonical" href="https://example.com/page">` — absolute, self-referential on
  the primary version of the page.
- Prevents duplicate-content dilution across `http/https`, `www/non-www`, trailing slash,
  and tracking-param variants (`?utm_...`).
- **Bad:** canonical pointing to the wrong page, to a relative URL, to a `noindex` page, or
  every page canonicalizing to the homepage (a classic accidental de-indexing).

## 6. Headings
- Exactly one `<h1>`, describing the page's main topic.
- Don't skip levels (h1 → h2 → h3, not h1 → h4). Screen readers and crawlers use the outline.
- Headings should describe content, not be chosen for their font size — use CSS for styling.

## 7. Image alt text
- Every meaningful `<img>` needs `alt` describing the image's content/function.
- Purely decorative images: `alt=""` (empty, not missing) so assistive tech skips them.
- **Bad:** `alt="image"`, `alt="logo logo logo"`, filename dumped as alt, or no alt attribute
  at all (fails accessibility and loses image-search traffic).

## 8. Structured data (JSON-LD)
- Embed as `<script type="application/ld+json">` in the head or body.
- Match the schema.org type to the page: `Article`/`BlogPosting`, `Product` + `Offer`,
  `Organization`, `WebSite` (+ `SearchAction` for a sitelinks search box), `BreadcrumbList`,
  `FAQPage`, `HowTo`.
- Required fields vary by type — validate the shape (all required properties present, correct
  nesting) and confirm it matches visible page content (Google penalizes mismatched markup).
- Verify with Google's Rich Results Test after deploy.

## 9. Robots directives
- Check no page that should rank carries `<meta name="robots" content="noindex">` or
  `nofollow` by accident — a staging default that shipped to prod is a common cause of "my
  pages vanished from Google."
- Use `noindex` deliberately on thank-you pages, filtered/faceted URLs, internal search results.
- `X-Robots-Tag` HTTP header can also set this — in live mode check response headers too.

## 10. Crawlability
- **robots.txt** at the domain root: doesn't accidentally `Disallow: /`, and references the
  sitemap (`Sitemap: https://example.com/sitemap.xml`).
- **sitemap.xml**: exists, lists canonical URLs, valid XML, submitted in Search Console.
- **Internal links** use real `<a href>` (crawlers follow those, not `onclick` divs).
- **Content** important for ranking should be in the initial HTML, not injected only after a
  client-side fetch — if it's live mode, compare `WebFetch` output (no JS) against the
  Chrome-rendered DOM to see what a non-JS crawler misses.

## 11. Technical hygiene
- `<html lang="en">` (or correct locale) set.
- Exactly one `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- Served over HTTPS; no mixed content.
- No duplicate/conflicting meta tags (two descriptions, two canonicals).
- Reasonable performance — Core Web Vitals (LCP, CLS, INP) influence ranking; flag obviously
  heavy pages, but deep perf work is its own task.

## 12. Copy-paste starter block
A complete, correct head to diff a page against (replace values; keep URLs absolute):

```html
<title>Primary Topic — Brand</title>
<meta name="description" content="120–160 chars of compelling, page-specific copy." />
<link rel="canonical" href="https://example.com/page" />
<meta name="viewport" content="width=device-width, initial-scale=1" />

<!-- Open Graph -->
<meta property="og:type" content="website" />
<meta property="og:url" content="https://example.com/page" />
<meta property="og:title" content="Share-optimized title" />
<meta property="og:description" content="2–4 sentence summary." />
<meta property="og:image" content="https://example.com/og-image.png" />
<meta property="og:image:alt" content="Describe the image" />
<meta property="og:site_name" content="Brand" />

<!-- Twitter / X -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Share-optimized title" />
<meta name="twitter:description" content="2–4 sentence summary." />
<meta name="twitter:image" content="https://example.com/og-image.png" />

<!-- Structured data (swap type/fields to match the page) -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Brand",
  "url": "https://example.com"
}
</script>
```
