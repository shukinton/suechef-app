# Sue Chef — iOS Packaging Guide (Capacitor)

> Written night 6 (Aug 27). This is the complete, honest map of what turning the
> web app into an App Store app involves: what I (Claude) prepare, what runs on a
> Mac, and what only Shuki can provide. Nothing here is exotic — it is the standard
> Capacitor path — but a few steps are unavoidable native work in Xcode.

## What Shuki must provide
1. **Apple Developer account** — $99/year, developer.apple.com. Needed for TestFlight
   and the App Store. Nothing else needs it, so it can wait until we're ready to install.
2. **A Mac with Xcode** (free from the App Store), **or** a cloud build service
   (Codemagic / Ionic Appflow have free tiers) if no Mac is available.
3. The **recipe server URL** (nights 7-8) and an **Anthropic API key** for the AI
   features — both go into the app's config, server-side per NFR-4 when we get there.

## What I prepare (in this repo, before the Mac step)
- `app/suechef.html` — already built standalone; becomes `www/index.html`.
- `deploy/manifest.json`, `icon-180.png`, `icon-512.png` — app icons seed.
- A voice adapter in `SC.voice` that switches Web Speech → native plugins when
  running under Capacitor (planned; the module boundary already exists for this).
- Fonts: bundle Playfair Display / DM Sans / DM Mono as local woff2 files with
  @font-face so the app works fully offline (DP-5/NFR-2) — replaces the Google
  Fonts link in the native build.

## The packaging steps (on the Mac / cloud builder)
```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init "Sue Chef" com.shuki.suechef --web-dir=www
mkdir www && cp app/suechef.html www/index.html   # + fonts/, icons
npm install @capacitor-community/speech-recognition @capacitor-community/text-to-speech
npx cap add ios
npx cap sync
npx cap open ios          # opens Xcode
```

### In Xcode (one-time, ~30 minutes)
1. **Signing** — select the Apple Developer team.
2. **Permissions** in `Info.plist`:
   - `NSMicrophoneUsageDescription` — "Sue listens for voice commands while you cook."
   - `NSSpeechRecognitionUsageDescription` — "Sue understands next / repeat / questions."
3. **Icons & splash** — drag the icon set (I generate all sizes when we reach this).
4. Build to a real iPhone with a free provisioning profile to test immediately;
   TestFlight upload needs the paid account.

## Share Extension (Instagram Share → Sue Chef)
The tester's goal: tap Share in Instagram and see Sue Chef as a target. Honest
status: **native-only**, and Capacitor has no one-line plugin for iOS share
extensions — it requires adding a Share Extension target in Xcode:
1. File → New → Target → *Share Extension* (name: "Send to Sue").
2. The extension receives the shared URL and hands it to the main app via an App
   Group + custom URL scheme (`suechef://import?url=...`).
3. The webview reads the URL on launch and feeds it to the import flow
   (which calls the recipe server).
I will write the small Swift files (~40 lines) and the JS handoff when we reach
this step — budget one extra Xcode session for it. Community reference:
`capacitor-share-extension` (iOS) shows the exact pattern.

## Voice on native — why it gets better
- `@capacitor-community/speech-recognition` uses iOS's on-device engine: reliable,
  no iframe restrictions, and the phone's echo cancellation means **voice barge-in
  becomes possible** (interrupting Sue mid-sentence) — the thing the web version
  structurally cannot do.
- `@capacitor-community/text-to-speech` uses AVSpeechSynthesizer with any premium
  voice installed on the phone.

## Order of operations (recommended)
1. Nights 7-8: recipe server (needed by the share flow anyway).
2. Wire the app's import ladder to the server; field-test on the Netlify version.
3. Then one packaging session: Capacitor + Xcode + TestFlight on Shuki's phone.
4. Share Extension in the following session.
5. App Store review submission (screenshots, privacy labels — I prepare all copy).
