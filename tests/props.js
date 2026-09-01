// Property test: metric and imperial displays must describe the SAME quantity
// (within kitchen-rounding tolerance) at every servings factor. (Amit, Aug 25)
const fs = require('fs');
const path = require('path');
const SC = new Function('document','window',
  fs.readFileSync(path.join(__dirname,'../app/src/app.js'),'utf8') + '; return SC;')({addEventListener(){}}, undefined);

const VOL_ML = { cup: 236.6, cups: 236.6, tbsp: 14.79, tsp: 4.93, 'fl oz': 29.57 };
const MASS_G = { g: 1, kg: 1000, oz: 28.35, lb: 453.6 };
const DENS = { flour: 0.53, sugar: 0.85, 'brown sugar': 0.93, butter: 0.955, buttermilk: 1.03,
  milk: 1.03, 'olive oil': 0.918, 'chocolate chips': 0.71, honey: 1.42, cream: 1.0 };

function densityFor(name) {
  const n = name.toLowerCase();
  for (const k of Object.keys(DENS).sort((a,b)=>b.length-a.length)) if (n.includes(k)) return DENS[k];
  return null;
}
const FRAC = { '½':.5,'⅓':1/3,'⅔':2/3,'¼':.25,'¾':.75,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875 };
function parseDisp(s) { // "2 ⅔ cups" -> {num, unit}
  const m = s.match(/^([\d.]+)?\s*([½⅓⅔¼¾⅛⅜⅝⅞])?\s*([a-z ]+)?$/i);
  if (!m) return null;
  let num = (m[1] ? parseFloat(m[1]) : 0) + (m[2] ? FRAC[m[2]] : 0);
  return { num, unit: (m[3] || '').trim().replace(/s$/, '') };
}
function toGrams(num, unit, name) {
  if (MASS_G[unit] != null) return num * MASS_G[unit];
  const ml = unit === 'ml' ? num : unit === 'l' ? num*1000 : VOL_ML[unit] != null ? num * VOL_ML[unit] : null;
  if (ml == null) return null;
  const d = densityFor(name);
  return d ? ml * d : ml; // liquids ~1-ish handled by density map
}

const CORPUS = [
  '2 cups all-purpose flour','1 cup sugar','3/4 cup brown sugar','1 cup butter',
  '1 3/4 cups buttermilk','2 tbsp olive oil','2 cups chocolate chips','800 g canned tomatoes',
  '8 oz cream cheese','1 lb potatoes','250 ml milk'
];
let pass = 0, fail = 0;
for (const line of CORPUS) {
  const ing = SC.parser.parseIngredientLine(line);
  for (const f of [1, 1.5, 2, 3]) {
    const m = parseDisp(SC.units.displayAmount(ing, f, 'metric'));
    const im = parseDisp(SC.units.displayAmount(ing, f, 'imperial'));
    if (!m || !im) { fail++; console.log('UNPARSEABLE', line, f); continue; }
    const gm = toGrams(m.num, m.unit, ing.name), gi = toGrams(im.num, im.unit, ing.name);
    if (gm == null || gi == null) { fail++; console.log('NO-CONVERT', line, f, m, im); continue; }
    const dev = Math.abs(gm - gi) / Math.max(gm, gi);
    if (dev <= 0.09) pass++; // tens-rounding + fraction-rounding tolerance
    else { fail++; console.log('MISMATCH', line, 'x'+f, ':', gm.toFixed(0)+'g vs', gi.toFixed(0)+'g ('+(dev*100).toFixed(1)+'%)'); }
  }
}
console.log('EQUIVALENCE: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
