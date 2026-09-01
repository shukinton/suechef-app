// E2E: app + recipe server, URL import ladder (structured, IG-text, failure toast).
// Spawns the server (ALLOW_PRIVATE=1) + fixture host, drives the app over file://.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

const FIXTURE_PORT = 8899, SERVER_PORT = 8787;

http.createServer((req, res) => {
  const f = path.join(__dirname, '../server/fixtures', path.basename(req.url.split('?')[0]));
  if (fs.existsSync(f)) { res.setHeader('content-type', 'text/html'); res.end(fs.readFileSync(f)); }
  else { res.statusCode = 404; res.end('nope'); }
}).listen(FIXTURE_PORT);

const srv = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], {
  env: { ...process.env, PORT: SERVER_PORT, ALLOW_PRIVATE: '1',
    CHROME_PATH: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' },
  stdio: ['ignore', 'pipe', 'pipe']
});
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));

(async () => {
  let pass = 0, fail = 0;
  const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra || ''); } };
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${SERVER_PORT}/health`); break; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '../app/suechef.html'));
  // set the server address through the real Settings UI
  await page.click('#nav button[data-nav="settings"]');
  await page.click('#st-dev-toggle'); // server address lives under Developer options
  await page.fill('#st-server', `http://127.0.0.1:${SERVER_PORT}`);
  await page.dispatchEvent('#st-server', 'change');
  await page.click('#nav button[data-nav="home"]');

  const importUrl = async u => {
    await page.fill('#paste-input', u);
    await page.click('#btn-cook');
  };

  // 1) structured JSON-LD -> review screen with parsed amounts + author credit
  await importUrl(`http://127.0.0.1:${FIXTURE_PORT}/jsonld-recipe.html`);
  await page.waitForSelector('#screen-review.active', { timeout: 30000 });
  t('structured name', (await page.textContent('#rv-name')).includes('Best Banana Bread'));
  t('structured author', (await page.textContent('#rv-source')).includes('by Nana Levi'));
  const ings = await page.$$eval('#rv-ings li', els => els.map(li => li.textContent.replace(/\s+/g, ' ').trim()));
  t('structured amounts', ings.some(i => /250 g.*flour/.test(i)), ings.join(' | '));
  const times = await page.textContent('#rv-times');
  t('structured times', /Prep 15 min/.test(times) && /Cook 55 min/.test(times), times);

  // 2) instagram-style caption -> text parse, author credit
  await page.click('#nav button[data-nav="home"]');
  await importUrl(`http://127.0.0.1:${FIXTURE_PORT}/instagram-like.html`);
  await page.waitForSelector('#screen-review.active', { timeout: 30000 });
  t('ig title', /GNOCCHI/i.test(await page.textContent('#rv-name')));
  t('ig author', (await page.textContent('#rv-source')).includes('chef.dani'));

  // 3) failure -> toast, stays recoverable (paste path open)
  await page.click('#nav button[data-nav="home"]');
  await importUrl(`http://127.0.0.1:${FIXTURE_PORT}/missing.html`);
  await page.waitForSelector('#toast.show', { timeout: 30000 });
  t('failure toast', /paste|couldn/i.test(await page.textContent('#toast')));

  t('no js errors', errors.length === 0, errors.join('\n'));
  console.log(`E2E IMPORT: ${pass} passed, ${fail} failed`);
  await browser.close(); srv.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
