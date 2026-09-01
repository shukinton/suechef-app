// Night 2 regression: swaps UI, allergy auto-replace, live step amounts.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const shot = n => page.screenshot({ path: path.join(__dirname, 'shots', n + '.png') });
  await page.goto('file://' + path.resolve(__dirname, '../app/suechef.html'));

  // --- allergy auto-swap: set an egg allergy first ---
  await page.click('#nav button[data-nav="settings"]');
  await page.fill('#st-allergy-input', 'egg');
  await page.click('#st-allergy-add');
  await page.click('#nav button[data-nav="home"]');
  await page.evaluate(() => { document.querySelector('#paste-input').value = SC.SAMPLE_TEXT; }); await page.click('#btn-cook');
  await page.waitForSelector('#screen-review.active', { timeout: 6000 });
  const autoRows = await page.$$eval('.swap-row.accepted', els => els.map(e => e.textContent.replace(/\s+/g,' ').trim()));
  console.log('AUTO ALLERGY SWAP:', autoRows.join(' || ') || 'NONE');
  const ings1 = await page.$$eval('#rv-ings li', els => els.map(li => li.textContent.replace(/\s+/g,' ').trim()));
  console.log('EGGS ROW NOW:', ings1.find(i => /flax/.test(i)) || 'not swapped!');

  // --- vegan chip -> proposals -> accept butter swap ---
  await page.click('#rv-diet-chips button:has-text("Vegan")');
  await page.waitForTimeout(200);
  await shot('n2-swaps-proposed');
  const proposed = await page.$$eval('.swap-row:not(.accepted)', els => els.map(e => e.textContent.replace(/\s+/g,' ').trim()));
  console.log('PROPOSED(' + proposed.length + '):'); proposed.forEach(p => console.log('  *', p.slice(0, 90)));
  // accept all proposed
  let btn;
  while ((btn = await page.$('.swap-row .btn.btn-secondary'))) { await btn.click(); await page.waitForTimeout(120); }
  const ings2 = await page.$$eval('#rv-ings li', els => els.map(li => li.textContent.replace(/\s+/g,' ').trim()));
  console.log('INGREDIENTS AFTER SWAPS:'); ings2.forEach(i => console.log('  -', i));
  await shot('n2-swaps-accepted');

  // --- servings 4 -> 6, check live step text with swapped names ---
  await page.click('#rv-serv-plus'); await page.click('#rv-serv-plus');
  await page.click('#rv-start');
  await page.waitForSelector('#screen-cooking.active');
  // night 6+: cooking opens on the plan overview — pass through it
  await page.click('#ck-ready');
  await page.waitForSelector('#ck-body:not([hidden])');
  const steps = [];
  for (let i = 0; i < 8; i++) {
    steps.push(await page.textContent('#ck-text'));
    const done = await page.$eval('#ck-done', el => !el.hidden).catch(() => false);
    if (done) break;
    await page.click('#ck-next'); await page.waitForTimeout(100);
  }
  console.log('STEPS AT 6 SERVINGS + SWAPS:');
  steps.slice(0, 4).forEach(s => console.log('  •', s));
  await shot('n2-cooking-swapped');

  // --- undo swap survives back to review ---
  await page.click('#ck-exit');
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  await browser.close();
})();
