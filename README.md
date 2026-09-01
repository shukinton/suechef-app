# Sue Chef 🍳

Voice-guided, hands-free cooking assistant. Paste (or share) a recipe — Sue
plans the prep, reads every step aloud, listens for "next", answers "how much
flour?", runs the timers, and keeps your cookbook and shopping list.

## What's in this repository

| folder | what it is |
|---|---|
| `app/` | The app itself — a single self-contained HTML file, assembled from `app/src/` by `app/build.sh`. `app/suechef.html` is the ready-to-use build (fonts bundled, works offline). |
| `server/` | The recipe-fetch server (Node/Express + headless browser): turns an Instagram / TikTok / website link into recipe text. Deployed on Render's free tier — see `docs/DEPLOY-SERVER.md`. |
| `capacitor/` | iOS wrap groundwork (Capacitor). When a Mac + Apple Developer account are available, `docs/CAPACITOR.md` + `capacitor/README.md` finish the job. |
| `deploy/` | PWA assets (manifest + icons) for the Netlify-hosted install. |
| `docs/` | The deploy guide (Hebrew) and the iOS packaging guide. |
| `tests/` | Playwright + node test batteries (smoke, regression, RC, native-voice seam, server E2E). |

## Quick start

- **Use the app**: open `app/suechef.html` in any browser — or host it
  (Netlify Drop works great) and "Add to Home Screen" on a phone for the
  full-screen, voice-enabled experience.
- **Deploy the server**: follow `docs/DEPLOY-SERVER.md` (Render free tier,
  Root Directory = `server`), then paste the server address into
  Settings → Developer options in the app.
- **Rebuild after editing** `app/src/`: `bash app/build.sh`.

Built nightly by Claude with Shuki, one feedback loop at a time.
