// Native voice seam (FR-5.7): mock window.Capacitor BEFORE the app loads and
// verify SC.voice routes through the plugins — chunked TTS with completion,
// stopSpeak interruption, recognition restart loop, echo filter intact,
// and the suechef://import deep-link handoff.
// Run from repo root: node tests/native-voice.js
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');

(async () => {
  let pass = 0, fail = 0;
  const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x || ''); } };
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.addInitScript(() => {
    // Mock faithful to the real plugins (rev-9): ONE session at a time — a
    // concurrent start rejects "Ongoing"; stop() settles the pending session
    // ("canceled"); a session with nothing queued rejects "No speech detected"
    // after silentMs (iOS never resolves empty) or stays open when silentMs=0.
    window.__mock = { spoken: [], stops: 0, recStarts: 0, recQueue: [], urlOpenCb: null, silentMs: 0 };
    window.Capacitor = { Plugins: {
      TextToSpeech: {
        speak(o) { window.__mock.spoken.push(o); return new Promise(r => setTimeout(r, 30)); },
        stop() { window.__mock.stops++; return Promise.resolve(); }
      },
      SpeechRecognition: {
        _pending: null,
        requestPermissions() { return Promise.resolve({ speechRecognition: 'granted' }); },
        start() {
          window.__mock.recStarts++;
          if (this._pending) return Promise.reject(new Error('Ongoing speech recognition'));
          return new Promise((resolve, reject) => {
            this._pending = { resolve, reject };
            const done = fn => { if (this._pending) { const p = this._pending; this._pending = null; fn(p); } };
            const next = window.__mock.recQueue.shift();
            if (next != null) setTimeout(() => done(p => p.resolve({ matches: [next] })), 30);
            else if (window.__mock.silentMs) setTimeout(() => done(p => p.reject(new Error('No speech detected'))), window.__mock.silentMs);
          });
        },
        stop() { // real plugin: stopping rejects the in-flight start
          if (this._pending) { const p = this._pending; this._pending = null; p.reject(new Error('Speech recognition canceled')); }
          return Promise.resolve();
        }
      },
      App: {
        addListener(ev, cb) { if (ev === 'appUrlOpen') window.__mock.urlOpenCb = cb; return { remove() {} }; }
      }
    } };
  });
  await page.goto('file://' + path.resolve(__dirname, '../app/suechef.html'));

  // TTS routes through the plugin, sentence-chunked, onDone fires
  let r = await page.evaluate(() => new Promise(res => {
    SC.voice.speak('First sentence. Second one!', 1, () =>
      res({ chunks: window.__mock.spoken.map(s => s.text), n: window.__mock.spoken.length }));
  }));
  t('native tts chunks', r.n === 2 && /^First sentence\.$/.test(r.chunks[0]), JSON.stringify(r));
  t('native tts payload', await page.evaluate(() =>
    window.__mock.spoken.every(s => s.lang === 'en-US' && s.rate === 1)));

  // stopSpeak stops the plugin and abandons the chain
  r = await page.evaluate(() => new Promise(res => {
    window.__mock.spoken = [];
    let done = false;
    SC.voice.speak('One. Two. Three. Four. Five.', 1, () => { done = true; });
    setTimeout(() => SC.voice.stopSpeak(), 40);          // mid-chain
    setTimeout(() => res({ done, n: window.__mock.spoken.length, stops: window.__mock.stops }), 700);
  }));
  t('stopSpeak interrupts', r.n < 5 && r.stops >= 1, JSON.stringify(r));

  // recognition: adapter selected, restart loop, command surfaces, echo dropped
  r = await page.evaluate(() => new Promise(res => {
    const heard = [];
    window.__mock.recQueue = ['next please'];
    SC.voice.init(txt => heard.push(txt), () => {});
    SC.voice.start();
    setTimeout(() => res({ heard, starts: window.__mock.recStarts, state: SC.voice.getState() }), 900);
  }));
  t('native rec hears user', r.heard.length === 1 && r.heard[0] === 'next please', JSON.stringify(r));
  t('native rec keeps listening', r.starts >= 2, 'starts=' + r.starts);
  t('native rec state', r.state === 'listening', r.state);

  r = await page.evaluate(() => new Promise(res => {
    const heard = [];
    SC.voice.init(txt => heard.push(txt), () => {});
    // simulate Sue mid-sentence: anything recognized now is her own voice
    SC.voice.speak('Preheat the oven to 200 degrees. Say next when ready.', 1, () => {});
    window.__mock.recQueue = ['say next when ready'];
    SC.voice.start();
    setTimeout(() => { SC.voice.stopAll(); res({ heard }); }, 500);
  }));
  t('native echo dropped', r.heard.length === 0, JSON.stringify(r.heard));

  // deep link: suechef://import?url=… lands in the paste box and starts import
  r = await page.evaluate(() => {
    window.__mock.urlOpenCb({ url: 'suechef://import?url=' + encodeURIComponent('https://example.com/recipe') });
    return { pasted: document.getElementById('paste-input').value,
      toast: document.getElementById('toast').textContent };
  });
  t('deeplink pastes url', r.pasted === 'https://example.com/recipe', JSON.stringify(r));
  t('deeplink flows to onCook', /server/i.test(r.toast), r.toast); // no server configured -> honest toast
  t('deeplink rejects junk', await page.evaluate(() => {
    document.getElementById('paste-input').value = '';
    window.__mock.urlOpenCb({ url: 'suechef://import?url=javascript:alert(1)' });
    window.__mock.urlOpenCb({ url: 'https://evil.example/import?url=https://x.com' });
    return document.getElementById('paste-input').value === '';
  }));

  // rev-9 regressions — the three loop killers, driven through the REAL cook
  // flow with proper waits (fixed delays race the ~3s loading overlay):
  await page.evaluate(() => {
    window.__mock.recStarts = 0; window.__mock.recQueue = []; window.__mock.silentMs = 0;
    SC.voice.stopAll();
    document.getElementById('paste-input').value = SC.SAMPLE_TEXT;
    document.getElementById('btn-cook').click();
  });
  await page.waitForSelector('#screen-review.active', { timeout: 15000 });
  await page.evaluate(() => document.getElementById('rv-start').click());
  await page.waitForSelector('#screen-cooking.active', { timeout: 5000 });
  await page.waitForTimeout(2000); // greeting speech + session churn happens here

  // (a) greeting speech + open sessions must not avalanche to "unsupported"
  r = await page.evaluate(() => ({ state: SC.voice.getState() }));
  t('cook flow survives', r.state === 'listening', JSON.stringify(r));

  // (b) a quiet kitchen: repeated silent sessions never kill the mic.
  // (A short speak recycles the currently-open session so the new silentMs
  // takes effect — the standing session predates it.)
  r = await page.evaluate(() => new Promise(res => {
    window.__mock.silentMs = 40; window.__mock.recQueue = [];
    SC.voice.speak('Check.', 1, () => {
      const before = window.__mock.recStarts;
      setTimeout(() => res({ state: SC.voice.getState(), churned: window.__mock.recStarts - before }), 1600);
    });
  }));
  t('silence is benign', r.state === 'listening' && r.churned > 3, JSON.stringify(r));

  // (c) stopAll during the retry window: no session reopens afterwards
  r = await page.evaluate(() => new Promise(res => {
    SC.voice.stopAll();
    const after = window.__mock.recStarts;
    setTimeout(() => res({ state: SC.voice.getState(), reopened: window.__mock.recStarts - after }), 600);
  }));
  t('stopAll sticks', r.state === 'off' && r.reopened === 0, JSON.stringify(r));

  // (d) deep link mid-cook tears the session down before importing
  await page.evaluate(() => {
    window.__mock.silentMs = 0;
    document.getElementById('paste-input').value = SC.SAMPLE_TEXT;
    document.getElementById('btn-cook').click();
  });
  await page.waitForSelector('#screen-review.active', { timeout: 15000 });
  await page.evaluate(() => document.getElementById('rv-start').click());
  await page.waitForSelector('#screen-cooking.active', { timeout: 5000 });
  await page.waitForTimeout(1500);
  t('cooking again pre-deeplink', await page.evaluate(() => SC.voice.getState()) === 'listening');
  r = await page.evaluate(() => new Promise(res => {
    window.__mock.urlOpenCb({ url: 'suechef://import?url=' + encodeURIComponent('https://example.com/r') });
    setTimeout(() => res({
      state: SC.voice.getState(),
      home: !!document.querySelector('#screen-home.active'),
      cookGone: !document.querySelector('#screen-cooking.active')
    }), 500);
  }));
  t('deeplink mid-cook teardown', r.state === 'off' && r.home && r.cookGone, JSON.stringify(r));

  t('no js errors', errors.length === 0, errors.join('\n'));
  console.log(`NATIVE VOICE: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
