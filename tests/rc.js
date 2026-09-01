// Release-candidate pass: both samples cooked end-to-end, timer confirm-replace,
// cross-unit shopping merge, diet-chip pressed state, light+dark screenshots.
// Run from repo root: node tests/rc.js
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');

(async () => {
  let pass = 0, fail = 0;
  const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x || ''); } };
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const shot = n => page.screenshot({ path: path.join(__dirname, 'shots', n + '.png') });
  await page.goto('file://' + path.resolve(__dirname, '../app/suechef.html'));

  const cookTo = async (sampleBtn) => {
    await page.click('#nav button[data-nav="home"]');
    await page.click('#' + sampleBtn);
    await page.click('#btn-cook');
    await page.waitForSelector('#screen-review.active', { timeout: 20000 });
  };
  const walkToDone = async (max) => {
    await page.evaluate(() => document.getElementById('rv-start').click());
    await page.waitForSelector('#screen-cooking.active');
    await page.click('#ck-ready');
    await page.waitForSelector('#ck-body:not([hidden])');
    for (let i = 0; i < max; i++) {
      const done = await page.$eval('#ck-done', el => !el.hidden).catch(() => false);
      if (done) return true;
      await page.click('#ck-next'); await page.waitForTimeout(60);
    }
    return await page.$eval('#ck-done', el => !el.hidden).catch(() => false);
  };

  // ---- 1) BAKING sample end-to-end, with timer confirm-replace on the way ----
  await cookTo('btn-sample-baking');
  await shot('rc-review-light');
  await page.evaluate(() => document.getElementById('rv-start').click());
  await page.waitForSelector('#screen-cooking.active');
  await page.click('#ck-ready');
  await page.waitForSelector('#ck-body:not([hidden])');
  // find the first timer step, start it
  let timerSteps = 0, firstDeadline = null;
  for (let i = 0; i < 40; i++) {
    const hasTimer = await page.$eval('#ck-timer', el => !el.hidden).catch(() => false);
    if (hasTimer) {
      timerSteps++;
      if (timerSteps === 1) {
        await page.click('#ck-timer-start');
        firstDeadline = await page.evaluate(() => SC.__cookDeadline === undefined ? null : SC.__cookDeadline);
      } else if (timerSteps === 2) {
        // second timer step: first tap must ASK (old timer keeps running in the
        // pill, this step's start button stays offered); the second tap within
        // 8s replaces — the timer moves HERE, so the pill hides and this step's
        // card shows the fresh countdown.
        const state = () => page.evaluate(() => ({
          pillShown: !document.getElementById('ck-pill').hidden,
          startShown: !document.getElementById('ck-timer-start').hidden,
          time: document.getElementById('ck-timer-time').textContent
        }));
        const s0 = await state();
        await page.click('#ck-timer-start');
        await page.waitForTimeout(250);
        const s1 = await state();
        t('timer replace asks first', s0.pillShown && s1.pillShown && s1.startShown, JSON.stringify({ s0, s1 }));
        await page.click('#ck-timer-start'); // confirm within 8s
        await page.waitForTimeout(900);
        const s2 = await state();
        t('timer replace confirms', !s2.pillShown && !s2.startShown && /^1[01]:/.test(s2.time), JSON.stringify(s2));
        break;
      }
    }
    await page.click('#ck-next'); await page.waitForTimeout(60);
  }
  t('baking has 2+ timer steps', timerSteps >= 2, 'saw ' + timerSteps);
  // finish the walk
  t('baking cooks to done', await walkToDoneTail());
  async function walkToDoneTail() {
    for (let i = 0; i < 40; i++) {
      const done = await page.$eval('#ck-done', el => !el.hidden).catch(() => false);
      if (done) return true;
      await page.click('#ck-next'); await page.waitForTimeout(60);
    }
    return false;
  }
  await shot('rc-done-light');
  await page.click('#ck-done-save');
  t('done-save works', /In your cookbook/.test(await page.textContent('#ck-done-save')));
  await page.click('#ck-done-home');

  // ---- 2) COOKING sample end-to-end ----
  await cookTo('btn-sample-cooking');
  t('shakshuka cooks to done', await walkToDone(40));
  await page.click('#ck-done-home');

  // ---- 3) cross-unit shopping merge: 2 cups flour + 250 g flour -> one row in grams ----
  await page.evaluate(() => { SC.store.set('shopping', []); });
  await page.evaluate(() => {
    document.getElementById('paste-input').value =
      'Cup Cake\n\nIngredients\n2 cups all-purpose flour\n\nSteps\nMix the flour.';
    document.getElementById('btn-cook').click();
  });
  await page.waitForSelector('#screen-review.active', { timeout: 20000 });
  await page.click('#rv-shop');
  await page.evaluate(() => {
    document.getElementById('paste-input').value =
      'Gram Bread\n\nIngredients\n250 g all-purpose flour\n\nSteps\nKnead the flour.';
    document.getElementById('btn-cook').click();
  });
  // navigating home first: paste flow starts from home
  await page.waitForSelector('#screen-review.active', { timeout: 20000 });
  await page.click('#rv-shop');
  const shop = await page.evaluate(() =>
    SC.store.get('shopping', []).map(i => ({ name: i.name, unit: i.unit, amount: Math.round(i.amount) })));
  t('cross-unit single row', shop.filter(i => /flour/.test(i.name)).length === 1, JSON.stringify(shop));
  const flourRow = shop.find(i => /flour/.test(i.name));
  t('cross-unit sums in grams', flourRow && flourRow.unit === 'g' && flourRow.amount > 480 && flourRow.amount < 520,
    JSON.stringify(flourRow));
  await page.click('#nav button[data-nav="shopping"]');
  const shopText = await page.textContent('#sh-list');
  t('cross-unit display', /flour/.test(shopText) && /50\d\s*g|500\s*g/.test(shopText.replace(/\s+/g, ' ')), shopText.replace(/\s+/g, ' ').slice(0, 80));

  // rev-10 regression: TWO same-name ingredients in ONE recipe must both survive
  // the cross-unit merge (sources keyed per ingredient, not per recipe)
  await page.evaluate(() => { SC.store.set('shopping', []); });
  await page.evaluate(() => {
    document.getElementById('paste-input').value =
      'Milk Twice\n\nIngredients\n1 cup milk\n100 ml milk\n\nSteps\nWarm the milk.';
    document.getElementById('btn-cook').click();
  });
  await page.waitForSelector('#screen-review.active', { timeout: 20000 });
  await page.click('#rv-shop');
  let milk = await page.evaluate(() => SC.store.get('shopping', []).filter(i => /milk/.test(i.name)));
  t('same-recipe merge keeps both', milk.length === 1 && Math.round(milk[0].amount) === 337,
    JSON.stringify(milk.map(m => ({ u: m.unit, a: m.amount, s: m.sources }))));
  await page.click('#rv-shop'); // re-add: nothing changed
  t('re-add is stable', /Already on your list/.test(await page.textContent('#toast')),
    await page.textContent('#toast'));

  // ---- 4) diet chips pressed state + suppressed wording ----
  await cookTo('btn-sample-baking');
  await page.click('#rv-diet-chips button:has-text("Vegan")');
  await page.waitForTimeout(150);
  t('diet chip pressed', await page.$eval('#rv-diet-chips button[aria-pressed="true"]', el => /Vegan/.test(el.textContent)).catch(() => false));
  await page.click('#rv-diet-chips button:has-text("Vegan")');
  await page.waitForTimeout(150);
  t('suppressed toast honest', /already have swaps|nothing to swap/i.test(await page.textContent('#toast')),
    await page.textContent('#toast'));

  // ---- 5) dark-mode screenshots ----
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.click('#nav button[data-nav="home"]');
  await shot('rc-home-dark');
  await cookTo('btn-sample-baking');
  await shot('rc-review-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.click('#nav button[data-nav="home"]');
  await shot('rc-home-light');

  t('no js errors', errors.length === 0, errors.join('\n'));
  console.log(`RC PASS: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
