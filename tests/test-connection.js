// Test-connection button battery: empty field, live server, unreachable, persistence.
// Run from repo root: node tests/test-connection.js
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const { spawn } = require('child_process');
const SERVER_PORT = 8787;
const srv = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], {
  env: { ...process.env, PORT: SERVER_PORT, ALLOW_PRIVATE: '1', CHROME_PATH: '/opt/pw-browsers/chromium' },
  stdio: ['ignore', 'pipe', 'pipe']
});
(async () => {
  let pass = 0, fail = 0;
  const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x || ''); } };
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${SERVER_PORT}/health`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '../app/suechef.html'));
  await page.click('#nav button[data-nav="settings"]');
  await page.click('#st-dev-toggle');
  // 1) empty field
  await page.click('#st-server-test');
  t('empty msg', /enter an address/i.test(await page.textContent('#st-server-status')));
  // 2) good server
  await page.fill('#st-server', `http://127.0.0.1:${SERVER_PORT}`);
  await page.click('#st-server-test');
  await page.waitForFunction(() => /awake|reach|answer/i.test(document.getElementById('st-server-status').textContent), null, { timeout: 15000 });
  t('awake', /Kitchen is awake/.test(await page.textContent('#st-server-status')), await page.textContent('#st-server-status'));
  // 3) unreachable
  await page.fill('#st-server', 'http://127.0.0.1:59999');
  await page.click('#st-server-test');
  await page.waitForFunction(() => /reach/i.test(document.getElementById('st-server-status').textContent), null, { timeout: 15000 });
  t('unreachable', /Can't reach/.test(await page.textContent('#st-server-status')));
  // 4) address persisted via the button (saves current field value)
  const saved = await page.evaluate(() => SC.store.get('settings', {}).server);
  t('saved', saved === 'http://127.0.0.1:59999', saved);
  t('no js errors', errors.length === 0, errors.join('\n'));
  console.log(`TEST-CONNECTION: ${pass} passed, ${fail} failed`);
  await browser.close(); srv.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
