#!/usr/bin/env python3
"""Content-depth gate for the loopflow.live keyword reference pages.

A keyword page is a real reference (not a stub) when its <main> has enough prose,
more than one worked example, a pitfalls/gotchas section, and related links. This
script is the `done when` check for the keyword-content loop: it prints every page
that falls short and exits non-zero, so the loop keeps working until all pass.

Usage:  python3 docs/tools/check_content.py
Exit 0 = every keyword page clears the bar (loop may stop).
Exit 1 = at least one page is still thin (offenders printed).
"""
import glob, os, re, sys

DOCS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MIN_WORDS = 220          # substantial prose, not a one-liner
MIN_EXAMPLES = 2         # more than a single snippet
PITFALL_RE = re.compile(r"pitfall|common mistake|gotcha|when not|watch out|avoid", re.I)

def main_html(src):
    m = re.search(r"<main>(.*?)</main>", src, re.S)
    return m.group(1) if m else src

def check(path):
    src = open(path, encoding="utf-8").read()
    body = main_html(src)
    words = len(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body)).split())
    examples = len(re.findall(r"<pre", body))
    headings = " ".join(re.findall(r"<h2[^>]*>(.*?)</h2>", body, re.S))
    has_pitfalls = bool(PITFALL_RE.search(re.sub(r"<[^>]+>", " ", headings)))
    has_related = 'class="related"' in body or "Related" in headings
    fails = []
    if words < MIN_WORDS:       fails.append(f"words {words}<{MIN_WORDS}")
    if examples < MIN_EXAMPLES: fails.append(f"examples {examples}<{MIN_EXAMPLES}")
    if not has_pitfalls:        fails.append("no pitfalls/gotchas section")
    if not has_related:         fails.append("no Related links")
    return fails

def main():
    pages = sorted(p for p in glob.glob(os.path.join(DOCS, "keywords", "*.html"))
                   if not p.endswith("index.html"))
    offenders = []
    for p in pages:
        fails = check(p)
        if fails:
            offenders.append((os.path.relpath(p, DOCS), fails))
    if offenders:
        print(f"{len(offenders)}/{len(pages)} keyword pages below the content bar:\n")
        for name, fails in offenders:
            print(f"  {name}: {', '.join(fails)}")
        sys.exit(1)
    print(f"All {len(pages)} keyword pages clear the content bar "
          f"(>= {MIN_WORDS} words, >= {MIN_EXAMPLES} examples, pitfalls + related).")

if __name__ == "__main__":
    main()
