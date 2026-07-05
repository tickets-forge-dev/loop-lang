#!/usr/bin/env bash
# Notify IndexNow (Bing / ChatGPT-search, Yandex) of all loopflow.live URLs.
# Run AFTER deploying, and again whenever pages change. Reads docs/sitemap.xml.
set -euo pipefail
KEY="fcd38f2db8c9466c9f122de285feaaa7"
HOST="loopflow.live"
DOCS="$(cd "$(dirname "$0")/.." && pwd)"
URLS=$(grep -oE '<loc>[^<]+' "$DOCS/sitemap.xml" | sed 's/<loc>//')
JSON=$(printf '%s\n' "$URLS" | python3 -c '
import sys,json
urls=[l.strip() for l in sys.stdin if l.strip()]
print(json.dumps({"host":"loopflow.live","key":"'"$KEY"'","keyLocation":"https://loopflow.live/'"$KEY"'.txt","urlList":urls}))')
echo "Submitting $(printf '%s\n' "$URLS" | wc -l | tr -d ' ') URLs to IndexNow..."
curl -sS -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "$JSON" -w "\nHTTP %{http_code}\n"
