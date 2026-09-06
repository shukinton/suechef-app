// Website-paste robustness: recipe cards copied from the browser carry checkbox
// glyphs (▢ ☐ …) on every ingredient line, shop buttons ("Instacart"), section
// headers with no title before them, and trailing Notes/Nutrition blocks.
// Shuki's field bug (Aug 31): a ▢-prefixed paste parsed NO amounts, so the
// Metric/Imperial toggle changed nothing. Run from repo root: node tests/paste.js
const fs = require('fs');
const path = require('path');
const SC = new Function('document','window',
  fs.readFileSync(path.join(__dirname,'../app/src/app.js'),'utf8') + '; return SC;')({addEventListener(){}}, undefined);

let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };
const disp = (ing, sys) => SC.units.displayAmount(ing, 1, sys);

// ---- 1) the exact field paste (WordPress recipe card, copied from "Equipment" down)
const FIELD = [
  'Equipment', '▢', 'air fryer', 'Ingredients',
  '▢10 oz gnocchi or frozen cauliflower gnocchi', '▢12 oz salmon or 2 six oz filets',
  '▢½ teaspoon salt', '▢½ teaspoon pepper', '▢1 tablespoon olive oil', '▢1 tablespoon garlic powder',
  '▢1 tablespoon everything But The Bagel Seasoning', '▢¼ cup chopped parsley', '▢juice of 1 lemon',
  'Instacart', 'Get Recipe Ingredients', 'Instructions', '',
  'Season the salmon with half of the everything bagel seasoning, garlic powder, and salt.',
  'Place the filet into the air fryer and pour in the gnocchi.',
  'Air fry at 400 degrees Fahrenheit for 15 minutes until gnocchi is golden brown.',
  'Serve with chopped parsley.'
].join('\n');
const r = SC.parser.parse(FIELD);
t('field: parses', !!r);
t('field: title is not a header', r.name === 'Untitled recipe', r.name);
t('field: 9 ingredients, no chrome rows', r.ingredients.length === 9, r.ingredients.map(i => i.name));
t('field: no Instacart row', !r.ingredients.some(i => /instacart|get recipe/i.test(i.name)));
t('field: no equipment row', !r.ingredients.some(i => /air fryer/i.test(i.name)));
const gn = r.ingredients[0], pars = r.ingredients[7], lem = r.ingredients[8];
t('field: ▢ stripped from amount', gn.amount === 10 && gn.unit === 'oz', gn);
t('field: oz -> g in metric', disp(gn, 'metric') === '280 g', disp(gn, 'metric'));
t('field: oz stays in imperial', disp(gn, 'imperial') === '10 oz', disp(gn, 'imperial'));
t('field: cup w/o density -> ml', disp(pars, 'metric') === '60 ml', disp(pars, 'metric'));
t('field: cup stays in imperial', disp(pars, 'imperial') === '¼ cup', disp(pars, 'imperial'));
t('field: spoons stay spoons', disp(r.ingredients[2], 'metric') === '½ tsp', disp(r.ingredients[2], 'metric'));
t('field: juice of lemon survives ▢', lem.juiceOf === 'lemon' && lem.amount === 1, lem);
t('field: 4 steps', r.steps.length === 4, r.steps.map(s => s.text));
t('field: timer on air-fry step', r.steps[2].timerMin === 15, r.steps[2]);

// ---- 2) other checkbox glyphs + double markers
for (const g of ['☐', '□', '◻', '☑', '✓', '• ', '- ', '▢ • ']) {
  const ing = SC.parser.parseIngredientLine(g + '2 cups all-purpose flour');
  t('glyph ' + JSON.stringify(g), ing && ing.amount === 2 && ing.unit === 'cup' && ing.name === 'all-purpose flour', ing);
}
t('bare glyph line is nothing', SC.parser.parseIngredientLine('▢') === null);
t('chrome line is nothing', SC.parser.parseIngredientLine('Instacart') === null);
t('header line is nothing', SC.parser.parseIngredientLine('Equipment') === null);
t('"Salt" alone still an ingredient', SC.parser.parseIngredientLine('Salt').name === 'Salt');

// ---- 3) full card with title, trailing Notes + Nutrition, Equipment between sections
const FULL = [
  'Best Banana Bread', 'Prep Time 10 minutes', 'Cook Time 1 hour', 'Servings 8',
  'Ingredients', '▢3 ripe bananas', '▢½ cup butter', '▢1 cup sugar', '▢2 cups flour',
  'Equipment', '▢loaf pan', '▢mixing bowl',
  'Instructions', 'Preheat the oven to 350 degrees.', 'Mash the bananas.', 'Bake for 60 minutes.',
  'Notes', 'Store in the fridge up to 5 days.',
  'Nutrition', 'Calories: 320kcal | Carbohydrates: 50g'
].join('\n');
const f = SC.parser.parse(FULL);
t('full: title', f.name === 'Best Banana Bread', f.name);
t('full: servings + times from header', f.servings === 8 && f.prepMin === 10 && f.cookMin === 60, [f.servings, f.prepMin, f.cookMin]);
t('full: equipment block skipped', f.ingredients.length === 4 && !f.ingredients.some(i => /pan|bowl/i.test(i.name)), f.ingredients.map(i => i.name));
t('full: notes/nutrition not steps', f.steps.length === 3 && !f.steps.some(s => /calories|fridge/i.test(s.text)), f.steps.map(s => s.text));
t('full: "Note:" inside a step is kept', SC.parser.parse('X\nIngredients\n1 egg\nInstructions\nNote: whisk gently.\nBake.').steps.length === 2);

// ---- 4) regressions: the old paths still work
const plain = SC.parser.parse('Pancakes\n\nIngredients\n- 2 cups flour\n• 1 egg\n\nSteps\n1. Mix.\n2. Cook 3 minutes.');
t('plain dashes/dots', plain.ingredients.length === 2 && plain.steps.length === 2 && plain.name === 'Pancakes', plain);
const heur = SC.parser.parse('Toast\n2 slices bread\n1 tbsp butter\nToast the bread, then butter it while hot.');
t('headerless heuristic', heur.ingredients.length === 2 && heur.steps.length === 1, heur);
const sub = SC.parser.parse('Cake\nIngredients\nFor the sauce:\n1 cup cream\nSteps\nWhip.');
t('sub-header still skipped', sub.ingredients.length === 1 && sub.ingredients[0].name === 'cream', sub.ingredients);

// ---- 5) Instagram-caption hygiene (tester, Sep 4): hype lines are not steps
const CAP = [
  'You have got to try this! 🔥', 'Crispy Honey Salmon', 'So easy!!',
  '2 salmon filets', '1 tbsp honey', 'juice of 1 lemon',
  'Season the salmon and air fry at 400 degrees Fahrenheit for 12 minutes. #airfryer #salmon',
  'Drizzle the honey and serve.', 'Follow for more recipes!', 'Save this for later 👇',
  'Tag a friend who needs this', '#easyrecipes #dinner #yum', 'Enjoy!'
].join('\n');
const cap = SC.parser.parse(CAP);
t('cap: title skips hype', cap.name === 'Crispy Honey Salmon', cap.name);
t('cap: 3 ingredients', cap.ingredients.length === 3, cap.ingredients.map(i => i.name));
t('cap: only real steps', cap.steps.length === 2, cap.steps.map(s => s.text));
t('cap: no hype in steps', !cap.steps.some(s => /try this|follow|save this|tag a|enjoy/i.test(s.text)));
t('cap: trailing hashtags stripped', !/#/.test(cap.steps[0].text), cap.steps[0].text);
t('cap: real "try" instruction kept',
  SC.parser.parse('X\nIngredients\n1 egg\nSteps\nTry not to overmix the batter.\nBake.').steps.length === 2);

// ---- 6) temperature follows the unit system (tester, Sep 4)
const T = SC.units.convertTempsInText;
t('temp F->C metric', T('Air fry at 400 degrees Fahrenheit for 15 minutes.', 'metric') ===
  'Air fry at 200°C (400°F) for 15 minutes.', T('Air fry at 400 degrees Fahrenheit for 15 minutes.', 'metric'));
t('temp F imperial keeps F first', T('Bake at 350°F.', 'imperial') === 'Bake at 350°F (175°C)', T('Bake at 350°F.', 'imperial'));
t('temp C->F imperial', T('Preheat the oven to 180 C.', 'imperial') === 'Preheat the oven to 350°F (180°C)',
  T('Preheat the oven to 180 C.', 'imperial'));
t('temp bare high is F', /200°C \(400°F\)/.test(T('Roast at 400 degrees until golden.', 'metric')),
  T('Roast at 400 degrees until golden.', 'metric'));
t('temp bare low is C', /180°C \(350°F\)/.test(T('Bake at 180 degrees.', 'metric')), T('Bake at 180 degrees.', 'metric'));
t('temp bare ambiguous untouched', T('Warm at 250 degrees.', 'metric') === 'Warm at 250 degrees.');
t('temp angle untouched', T('Fold the dough at a 45 degree angle.', 'metric') === 'Fold the dough at a 45 degree angle.');
t('temp rotate untouched', T('Rotate the pan 180 degrees halfway.', 'metric') === 'Rotate the pan 180 degrees halfway.');
t('temp chart pairs', T('at 425°F', 'metric') === 'at 220°C (425°F)' && T('at 220 C', 'imperial') === 'at 425°F (220°C)');

console.log('PASTE: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
