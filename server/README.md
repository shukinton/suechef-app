# Sue Chef — Recipe Server

Turns a link (TikTok / Instagram / any recipe site) into recipe text or structured
data for the Sue Chef app. Implements the spec's import ladder (FR-1.x):
TikTok oEmbed → headless browser (late content, caption + first comment, author
credit, heavy assets blocked) → typed errors so the app can offer paste-text.

## API
- `GET /health` → `{ok:true}` — also used by the app to wake a napping free-tier server.
- `GET /recipe?url=<link>` →
  - `{ok:true, kind:"structured", recipe:{name,author,servings,prepTime,cookTime,ingredients[],steps[]}}` (JSON-LD sites)
  - `{ok:true, kind:"text", title, author, text}` (Instagram/TikTok/plain pages)
  - `{ok:false, code:"badurl|timeout|blocked|empty|notfound|rate_limited", message}`

## Environment
| var | default | meaning |
|---|---|---|
| `PORT` | 8787 | listen port |
| `ALLOWED_ORIGINS` | `https://claude.ai,https://*.claudeusercontent.com,https://*.netlify.app` | CORS allowlist, comma-separated, `*` = subdomain wildcard, spans labels (never a bare `*` — NFR-3) |
| `CHROME_PATH` | (unset) | path to a chromium binary; unset = use @sparticuz/chromium (serverless) |
| `NAV_TIMEOUT_MS` | 25000 | page-load budget (NFR-5) |
| `ALLOW_PRIVATE` | off | **tests only** — allows localhost targets and null origins |

## Run locally
```bash
npm install
CHROME_PATH=/path/to/chromium node index.js
npm test   # unit tests on the security guards + fixture pages; no live social calls.
           # Don't set ALLOW_PRIVATE when running tests — the harness sets it
           # only for the spawned server; the unit tests need the guards ON.
```

## Deploy (free tier — exact clicks in docs/DEPLOY-SERVER.md, written night 8)
The Dockerfile is ready for Render / Fly / Railway. Free tiers nap after idle —
the app shows "Waking the kitchen up…" and waits, per the plan.
