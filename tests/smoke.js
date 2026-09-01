// Sue Chef smoke test — walks the core flow, screenshots every screen.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const shot = (n) => page.screenshot({ path: path.join(__dirname, 'shots', n + '.png') });
  await page.goto('file://' + path.resolve(__dirname, '../app/suechef.html'));
  await page.waitForTimeout(1200);
  await shot('01-home');

  // sample -> cook -> loading -> review
  await page.evaluate(() => { document.querySelector('#paste-input').value = SC.SAMPLE_TEXT; });
  await page.click('#btn-cook');
  await page.waitForTimeout(900);
  await shot('02-loading');
  await page.waitForSelector('#screen-review.active', { timeout: 6000 });
  await page.waitForTimeout(300);
  await shot('03-review');

  const name = await page.textContent('#rv-name');
  const ings = await page.$$eval('#rv-ings li', els => els.map(li => li.textContent.trim()));
  console.log('RECIPE:', name);
  console.log('INGREDIENTS(' + ings.length + '):'); ings.forEach(i => console.log('  -', i));

  // servings scaling 4 -> 6
  await page.click('#rv-serv-plus'); await page.click('#rv-serv-plus');
  await page.waitForTimeout(200);
  const scaled = await page.$$eval('#rv-ings li .ing-amt', els => els.map(e => e.textContent.trim()));
  console.log('SCALED x1.5:', scaled.join(' | '));
  await shot('04-review-scaled');

  // imperial toggle
  await page.click('#screen-review [data-units-toggle] button[data-units="imperial"]');
  await page.waitForTimeout(200);
  const imp = await page.$$eval('#rv-ings li .ing-amt', els => els.map(e => e.textContent.trim()));
  console.log('IMPERIAL:', imp.join(' | '));
  await page.click('#screen-review [data-units-toggle] button[data-units="metric"]');
  await page.click('#rv-serv-minus'); await page.click('#rv-serv-minus');

  // shopping + cookbook
  await page.click('#rv-shop'); await page.waitForTimeout(300);
  await page.click('#rv-save'); await page.waitForTimeout(300);

  // cooking flow (starts at the plan overview since night 3)
  await page.click('#rv-start');
  await page.waitForSelector('#screen-cooking.active');
  const navHidden = await page.$eval('#nav', n => getComputedStyle(n).display === 'none');
  console.log('NAV HIDDEN WHILE COOKING:', navHidden);
  await page.click('#ck-ready');
  await page.waitForTimeout(200);
  // skip the mise items to reach the recipe steps
  while (!(await page.textContent('#ck-progress')).startsWith('Step')) {
    await page.click('#ck-next'); await page.waitForTimeout(60);
  }
  await shot('05-cooking-step1');
  const steps = [];
  for (let i = 0; i < 25; i++) {
    const t = await page.textContent('#ck-text').catch(() => '');
    const p = await page.textContent('#ck-progress').catch(() => '');
    const timerVisible = await page.$eval('#ck-timer', el => !el.hidden).catch(() => false);
    steps.push(p + ' [' + (timerVisible ? 'TIMER' : 'no timer') + '] ' + t.slice(0, 60));
    const done = await page.$eval('#ck-done', el => !el.hidden).catch(() => false);
    if (done) break;
    await page.click('#ck-next');
    await page.waitForTimeout(120);
  }
  steps.forEach(s => console.log('STEP:', s));
  await shot('06-cooking-done');
  await page.click('#ck-done-home');

  // cookbook
  await page.click('#nav button[data-nav="cookbook"]');
  await page.waitForTimeout(200);
  await shot('07-cookbook');
  // shopping
  await page.click('#nav button[data-nav="shopping"]');
  await page.waitForTimeout(200);
  const badge = await page.textContent('#nav-shop-badge');
  console.log('SHOP BADGE:', badge);
  await shot('08-shopping');
  // settings
  await page.click('#nav button[data-nav="settings"]');
  await page.waitForTimeout(200);
  await page.fill('#st-allergy-input', 'peanuts');
  await page.click('#st-allergy-add');
  await shot('09-settings');

  // persistence: reload, cookbook should survive
  await page.reload(); await page.waitForTimeout(800);
  await page.click('#nav button[data-nav="cookbook"]');
  const saved = await page.$$eval('.recipe-card h3', els => els.map(e => e.textContent));
  console.log('PERSISTED RECIPES:', saved.join(', ') || 'NONE');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  await browser.close();
})();
