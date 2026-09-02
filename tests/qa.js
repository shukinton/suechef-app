// Q&A consistency battery (tester, Sep 1: "sometimes she answers, sometimes
// she's not sure"). Drives transcripts through the REAL pipeline — native
// SpeechRecognition mock -> restart loop -> echo guard -> handleVoiceCommand —
// and asserts on what Sue actually SPEAKS (mock TTS capture).
// Run from repo root: node tests/qa.js
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
    window.__mock = { spoken: [], recQueue: [], silentMs: 60 };
    window.Capacitor = { Plugins: {
      TextToSpeech: {
        speak(o) { window.__mock.spoken.push(o.text); return new Promise(r => setTimeout(r, 15)); },
        stop() { return Promise.resolve(); }
      },
      SpeechRecognition: {
        _pending: null,
        requestPermissions() { return Promise.resolve({ speechRecognition: 'granted' }); },
        start() {
          if (this._pending) return Promise.reject(new Error('Ongoing speech recognition'));
          return new Promise((resolve, reject) => {
            this._pending = { resolve, reject };
            const done = fn => { if (this._pending) { const p = this._pending; this._pending = null; fn(p); } };
            const next = window.__mock.recQueue.shift();
            if (next != null) setTimeout(() => done(p => p.resolve({ matches: [next] })), 25);
            else setTimeout(() => done(p => p.reject(new Error('No speech detected'))), window.__mock.silentMs);
          });
        },
        stop() {
          if (this._pending) { const p = this._pending; this._pending = null; p.reject(new Error('Speech recognition canceled')); }
          return Promise.resolve();
        }
      },
      App: { addListener() { return { remove() {} }; } }
    } };
  });
  await page.goto('file://' + path.resolve(__dirname, '../app/suechef.html'));

  // Cook the pancakes fixture (flour/sugar/leaveners/pinch salt/eggs/buttermilk/butter/vanilla)
  await page.evaluate(() => {
    document.getElementById('paste-input').value = SC.SAMPLE_TEXT;
    document.getElementById('btn-cook').click();
  });
  await page.waitForSelector('#screen-review.active', { timeout: 15000 });
  await page.evaluate(() => document.getElementById('rv-start').click());
  await page.waitForSelector('#screen-cooking.active', { timeout: 5000 });
  await page.waitForTimeout(1200); // greeting
  await page.evaluate(() => document.getElementById('ck-ready').click());
  await page.waitForTimeout(1200); // step 1 speech

  // ask(): inject one transcript, wait for Sue's spoken reply (or silence)
  const ask = async phrase => {
    await page.evaluate(() => { window.__mock.spoken = []; });
    await page.waitForTimeout(500); // clear the echo tail (layer 2 = 400ms)
    await page.evaluate(p => window.__mock.recQueue.push(p), phrase);
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(150);
      const s = await page.evaluate(() => window.__mock.spoken.join(' '));
      if (s) { await page.waitForTimeout(250); return page.evaluate(() => window.__mock.spoken.join(' ')); }
    }
    return '';
  };

  const CASES = [
    // [question, expected regex on Sue's reply]
    ['how much flour', /250 g of all-purpose flour/],
    ['how much flour do we need', /250 g of all-purpose flour/],
    ['how much flour do I need for this recipe', /250 g of all-purpose flour/],
    ['can you tell me how much sugar', /2 tbsp of sugar/],
    ['how many eggs', /^2 eggs/],
    ['how many eggs do we need', /^2 eggs/],
    ['how much salt', /a pinch of salt/],
    ['how much butter', /4 tbsp of butter.*melted/],
    ['how much vanilla extract do I put in', /1 tsp of vanilla extract/],
    ['how much buttermilk', /410 ml of buttermilk/],
    ['how many grams of flour', /250 g of all-purpose flour/],
    ['how much of the flour', /250 g of all-purpose flour/],
    ['how much flower', /250 g of all-purpose flour/],            // recognition mishears
    ['repeat how much salt we need', /a pinch of salt/],
    ['how much sugar do we need in that step', /2 tbsp of sugar/],
    ["what's the amount of sugar", /2 tbsp of sugar/],
    ['how much time is left', /No timer is running/],             // no timer -> honest, not "not in ingredients"
    ['substitute butter', /Instead of butter, use/],
    ["I don't have buttermilk", /milk plus a tablespoon of lemon juice/],
    ['how much baking powder', /1 tsp of baking powder/],
    ['how much baking soda', /(½|half a) tsp of baking soda/],
  ];
  for (const [q, re] of CASES) t('Q: ' + q, re.test(await ask(q)), 'got: ' + JSON.stringify(await page.evaluate(() => window.__mock.spoken.join(' '))));

  // consistency: the SAME question answered identically 3 times in a row
  const a1 = await ask('how much flour'), a2 = await ask('how much flour'), a3 = await ask('how much flour');
  t('same answer x3', a1 === a2 && a2 === a3 && /250 g/.test(a1), JSON.stringify([a1, a2, a3]));

  // the walk is steps-only now: no mise item is ever spoken
  const stepLabel = await page.evaluate(() => document.getElementById('ck-progress').textContent);
  t('walk shows recipe steps', /^Step \d+ of \d+$/.test(stepLabel), stepLabel);

  t('no js errors', errors.length === 0, errors.join('\n'));
  console.log(`QA: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
