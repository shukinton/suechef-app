#!/bin/bash
# Sue Chef build — assembles src/ into three outputs:
#   suechef.html          — standalone document, fonts BUNDLED (offline: file://, PWA, Capacitor)
#   artifact.html         — content-only variant for the Artifact tool (no doctype/html/head/body);
#                           keeps Google Fonts CDN links (allowed by the artifact CSP, smaller page)
#   ../capacitor/www/index.html — copy of the standalone for `cap sync` (created if capacitor/ exists)
set -e
cd "$(dirname "$0")"

{ echo '<!DOCTYPE html>'
  echo '<html lang="en">'
  echo '<head>'
  echo '<meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">'
  grep '<title>' src/meta.html          # title only — no CDN font links offline (DP-5/NFR-2)
  echo '<style>'
  cat src/fonts.css
  cat src/styles.css
  echo '</style>'
  echo '</head>'
  echo '<body>'
  cat src/body.html
  echo '<script>'
  cat src/app.js
  echo '</script>'
  echo '</body>'
  echo '</html>'
} > suechef.html

{ cat src/meta.html
  echo '<style>'
  cat src/styles.css
  echo '</style>'
  cat src/body.html
  echo '<script>'
  cat src/app.js
  echo '</script>'
} > artifact.html

if [ -d ../capacitor ]; then
  mkdir -p ../capacitor/www
  cp suechef.html ../capacitor/www/index.html
  echo "capacitor/www/index.html refreshed"
fi

# PWA deploy page always ships the current build (rev-9: it had gone stale)
if [ -d ../deploy ]; then
  cp suechef.html ../deploy/index.html
  sed -i 's|<title>Sue Chef</title>|<link rel="manifest" href="manifest.json">\n<link rel="apple-touch-icon" href="icon-180.png">\n<meta name="theme-color" content="#B94A24">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="default">\n<meta name="apple-mobile-web-app-title" content="Sue Chef">\n<title>Sue Chef</title>|' ../deploy/index.html
  echo "deploy/index.html refreshed (PWA meta injected)"
fi

echo "built: suechef.html ($(wc -c < suechef.html) bytes), artifact.html ($(wc -c < artifact.html) bytes)"
