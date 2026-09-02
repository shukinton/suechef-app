/* ============================================================
   Sue Chef — application engine
   Modules (kept separable for the future Capacitor build):
     SC.store   — persistence (localStorage w/ memory fallback)
     SC.units   — normalization, countables, naturals, scaling
     SC.parser  — pasted text -> structured recipe JSON
     SC.ui      — router, screens, cooking flow
   ============================================================ */
"use strict";
const SC = {};

/* ---------------- SC.store ---------------- */
SC.store = (() => {
  const mem = {};
  const wrap = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
  return {
    get(key, fallback) {
      const raw = wrap(() => localStorage.getItem("suechef." + key), null);
      if (raw == null) return key in mem ? mem[key] : fallback;
      const parsed = wrap(() => JSON.parse(raw), undefined);
      return parsed === undefined ? fallback : parsed;
    },
    set(key, val) {
      mem[key] = val;
      wrap(() => localStorage.setItem("suechef." + key, JSON.stringify(val)), null);
    }
  };
})();

/* ---------------- SC.units ---------------- */
SC.units = (() => {
  const UNIT_MAP = {
    g:"g", gr:"g", gram:"g", grams:"g", kg:"kg", kilogram:"kg", kilograms:"kg",
    ml:"ml", milliliter:"ml", milliliters:"ml", millilitre:"ml", millilitres:"ml",
    l:"l", liter:"l", liters:"l", litre:"l", litres:"l",
    tsp:"tsp", teaspoon:"tsp", teaspoons:"tsp",
    tbsp:"tbsp", tbs:"tbsp", tablespoon:"tbsp", tablespoons:"tbsp",
    cup:"cup", cups:"cup", c:"cup",
    oz:"oz", ounce:"oz", ounces:"oz",
    "fl oz":"floz", "fl. oz":"floz", "fluid ounce":"floz", "fluid ounces":"floz", floz:"floz",
    lb:"lb", lbs:"lb", pound:"lb", pounds:"lb",
    pinch:"pinch", pinches:"pinch", dash:"dash", dashes:"dash",
    stick:"stick", sticks:"stick", handful:"handful", handfuls:"handful",
    sprig:"sprig", sprigs:"sprig", splash:"splash", knob:"knob",
    can:"can", cans:"can", jar:"jar", jars:"jar", package:"package", packages:"package", pkg:"package",
    slice:"slice", slices:"slice", bunch:"bunch", bunches:"bunch"
  };
  const NATURAL = new Set(["pinch","dash","stick","handful","sprig","splash","knob","bunch"]);
  const COUNTABLE_WORDS = ["egg","eggs","garlic clove","garlic cloves","clove of garlic","cloves of garlic",
    "onion","onions","tomato","tomatoes","lemon","lemons","lime","limes","potato","potatoes",
    "carrot","carrots","apple","apples","banana","bananas","bell pepper","bell peppers",
    "shallot","shallots","scallion","scallions","avocado","avocados","cucumber","cucumbers",
    "zucchini","orange","oranges","chicken breast","chicken breasts","chicken thigh","chicken thighs",
    "tortilla","tortillas","pita","pitas","bay leaf","bay leaves"];
  // Volume units in precise US ml (reconciles the spec's "1 cup sugar = 201 g")
  const TO_METRIC = { cup:{f:236.6,u:"ml"}, tbsp:{f:14.79,u:"ml"}, tsp:{f:4.93,u:"ml"},
    oz:{f:28.35,u:"g"}, lb:{f:453.6,u:"g"}, floz:{f:29.57,u:"ml"} };
  // FR-3.1 density table (g per ml) — appendix values first, ordered most-specific-first
  const DENSITY = [
    [/cream cheese/,0.99],[/sour cream/,0.97],[/powdered sugar|icing sugar/,0.56],
    [/brown sugar/,0.93],[/sugar/,0.85],[/honey/,1.42],[/maple syrup|golden syrup/,1.32],
    [/peanut butter|tahini|nut butter/,1.06],
    [/oil/,0.918],[/butter/,0.955],[/cocoa/,0.52],[/cornstarch|corn flour/,0.53],
    [/flour/,0.53],[/parmesan/,0.42],[/cheddar|mozzarella|shredded cheese|grated cheese/,0.47],
    [/breadcrumbs|panko/,0.45],[/oats|oatmeal/,0.38],[/rice/,0.85],[/salt/,1.22],
    [/baking powder/,0.92],[/baking soda/,0.96],[/yogurt|yoghurt/,1.03],
    [/chocolate chips/,0.71],
    [/almonds|walnuts|pecans|cashews|nuts/,0.5],[/mayonnaise|mayo/,0.91],
    [/ketchup/,1.14],[/soy sauce/,1.15],[/tomato paste/,1.07]
  ];
  function densityOf(name){
    const n = name.toLowerCase();
    for (const [re,d] of DENSITY) if (re.test(n)) return d;
    return null;
  }
  const TO_IMPERIAL = { g:{f:1/28.35,u:"oz"}, kg:{f:2.2046,u:"lb"}, ml:{f:1/29.6,u:"fl oz"}, l:{f:33.8,u:"fl oz"} };
  const FRACTIONS = [[0.125,"⅛"],[0.25,"¼"],[1/3,"⅓"],[0.375,"⅜"],[0.5,"½"],[0.625,"⅝"],[2/3,"⅔"],[0.75,"¾"],[0.875,"⅞"]];

  function normalizeUnit(u) {
    if (!u) return "";
    return UNIT_MAP[u.toLowerCase().replace(/\.$/,"").trim()] || "";
  }
  function isCountable(name) {
    const n = name.toLowerCase();
    return COUNTABLE_WORDS.some(w => n === w || n.startsWith(w + " ") || n.endsWith(" " + w) || n.includes(w));
  }
  function isNatural(unit) { return NATURAL.has(unit); }

  function niceNumber(x, allowFractions) {
    if (allowFractions) {
      const whole = Math.floor(x + 1e-9), rem = x - whole;
      if (rem > 0.05 && rem < 0.95) {
        let best = null, bd = 1;
        for (const [v, ch] of FRACTIONS) { const d = Math.abs(rem - v); if (d < bd) { bd = d; best = ch; } }
        if (bd < 0.06) return (whole ? whole + " " : "") + best;
      }
    }
    if (x >= 100) return String(Math.round(x));
    if (x >= 10) return String(Math.round(x * 2) / 2).replace(/\.0$/,"");
    const r = Math.round(x * 4) / 4;
    return String(r).replace(/\.0+$/,"");
  }

  // Liquids show ml in metric; solids with a known density show grams (FR-3.1);
  // "cream cheese" and friends are never mistaken for liquids (FR-3.4).
  const LIQUID_RE = /\b(milk|buttermilk|water|oil|cream|juice|extract|honey|syrup|vinegar|wine|beer|broth|stock|coffee|espresso|liqueur)\b/i;
  const NOT_LIQUID_RE = /cream cheese|ice cream|sour cream/i;
  function isLiquid(name){ return LIQUID_RE.test(name) && !NOT_LIQUID_RE.test(name); }

  // Behind-the-scenes equivalents for naturals & vague amounts (spec appendix):
  // used for scaling and shopping weights only — never shown on screen.
  const NATURAL_EQUIV_G = { stick:113, pinch:0.36, clove:5, knob:15, handful:30, sprig:2 };
  const NATURAL_EQUIV_ML = { dash:0.62, splash:5 };
  const JUICE_ML = { lemon:38, lime:30, orange:70 };

  function pluralize(u, n) {
    if (!u || n <= 1) return u;
    return u + (/(sh|ch|s|x)$/.test(u) ? "es" : "s");
  }

  // Returns display string for one ingredient at a scale factor & unit system
  function displayAmount(ing, factor, system) {
    if (ing.natural) { // shown naturally, scaled as counts, never converted (FR-3.3)
      if (ing.amount == null) return ing.rawAmount || "";      // "to taste"
      const n = ing.amount * factor;
      // "as written" only while it's really one: a shopping row summed from two
      // recipes has amount 2 — "a pinch" would hide the doubling (rev-6 leftover)
      if (n === 1 && /^an?\b/i.test(ing.rawAmount)) return ing.rawAmount; // "a pinch"
      return niceNumber(n, true) + (ing.unit ? " " + pluralize(ing.unit, n) : "");
    }
    if (ing.countable) { // always a whole count, in both systems (FR-3.7)
      if (!ing.amount) return ing.rawAmount || "";
      return String(Math.max(1, Math.round(ing.amount * factor)));
    }
    if (!ing.amount) return ing.rawAmount || "";
    let amt = ing.amount * factor, unit = ing.unit;
    const volumeUnit = ["cup","tbsp","tsp","floz"].includes(unit);
    if (system === "metric" && TO_METRIC[unit]) {
      if (unit === "tsp" || unit === "tbsp") {
        // spoons stay spoons — natural kitchen amounts (Shuki, 2026-08-22)
      } else if (!volumeUnit || isLiquid(ing.name)) {     // oz/lb -> g, liquids -> ml
        amt *= TO_METRIC[unit].f; unit = TO_METRIC[unit].u;
      } else {
        const d = densityOf(ing.name);                    // solids: volume -> grams via density
        if (d) { amt = amt * TO_METRIC[unit].f * d; unit = "g"; }
        else { amt *= TO_METRIC[unit].f; unit = TO_METRIC[unit].u; } // no density -> ml fallback
      }
    }
    if (system === "imperial" && TO_IMPERIAL[unit]) { amt *= TO_IMPERIAL[unit].f; unit = TO_IMPERIAL[unit].u; }
    if (unit === "floz") unit = "fl oz";
    if (unit === "ml" && amt >= 1000) { amt /= 1000; unit = "l"; }
    if (unit === "g" && amt >= 1000) { amt /= 1000; unit = "kg"; }
    let numStr;
    if (unit === "g" || unit === "ml") {
      // graduated precision: <10 precise, 10–50 to nearest 5, >50 to nearest 10
      if (amt < 10) numStr = String(Math.round(amt * 2) / 2);
      else if (amt <= 50) numStr = String(Math.round(amt / 5) * 5);
      else numStr = String(Math.round(amt / 10) * 10);
    } else {
      const fractionOk = ["cup","tbsp","tsp","oz","lb","fl oz"].includes(unit);
      numStr = niceNumber(amt, fractionOk);
    }
    if (["cup","can","jar","package","slice","bunch"].includes(unit)) unit = pluralize(unit, amt);
    return numStr + (unit ? " " + unit : "");
  }

  /* FR-2.3 — every step speaks amount + unit + name, live-scaled.
     Pass A rewrites explicit amount phrases ("2 eggs" -> "3 eggs" at 6 servings);
     Pass B annotates bare first mentions ("the flour" -> "the flour (250 g)").
     Swapped ingredients surface their replacement name in the text. */
  const STEP_AMT = "(?:\\d+\\s*[½⅓⅔¼¾⅛⅜⅝⅞]|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])";
  const STEP_UNIT = "(?:cups?|tablespoons?|tbsp|teaspoons?|tsp|grams?|g|ml|milliliters?|millilitres?|ounces?|oz|pounds?|lbs?|sticks?|fl\\.?\\s?oz)";
  // filler between unit and name is a safelist of adjectives — never "and"/"with",
  // so an amount can't be bridged onto a different ingredient across a conjunction
  const STEP_FILLER = "(?:(?:melted|softened|chopped|minced|diced|grated|ground|sifted|beaten|whisked|warm|warmed|cold|dry|wet|cooled|unsalted|salted|the)\\s+)";
  const KEY_STOP = new Set(["the","and","for","with","fresh","large","small","medium","extra","light","dark"]);
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Unique key ownership: a fallback key ("butter" from "peanut butter") is dropped
  // when the word belongs to another ingredient's name — no cross-stealing.
  function assignKeys(ingredients) {
    const names = ingredients.map(ing => (ing.originalName || ing.name).toLowerCase());
    return ingredients.map((ing, i) => {
      const src = names[i].replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();
      const words = src.split(" ").filter(Boolean);
      const filtered = words.filter(w => w.length > 2 && !KEY_STOP.has(w));
      const cands = [src];
      if (filtered.length && filtered.join(" ") !== src) cands.push(filtered.join(" "));
      if (filtered.length) {
        cands.push(filtered[filtered.length - 1]);
        if (filtered.length > 1) cands.push(filtered[0]);
      }
      return [...new Set(cands)].filter((k, ki) => {
        if (k.length < 3) return false;
        if (ki === 0) return true; // the full name always belongs to its own ingredient
        const re = new RegExp("(^|[\\s-])" + escRe(k) + "s?($|[\\s-])");
        return !names.some((n, ni) => ni !== i && re.test(n));
      });
    });
  }
  function displayStepText(step, ingredients, factor, system) {
    let txt = step.text;
    const keySets = assignKeys(ingredients);
    // longest names first so "peanut butter" is consumed before bare "butter"
    const order = ingredients.map((ing, i) => i)
      .sort((a, b) => (ingredients[b].originalName || ingredients[b].name).length -
                      (ingredients[a].originalName || ingredients[a].name).length);
    for (const i of order) {
      const ing = ingredients[i];
      if (ing.juiceOf) {
        // replace the whole juice phrase with its scaled form — annotating it
        // ("juice of half a lemon (1)") reads as a contradiction
        txt = txt.replace(/juice of (?:half an?|\d+(?:\/\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])?\s*(lemon|lime|orange)s?/i,
          displayName(ing, factor));
        continue;
      }
      if (ing.removed) { // removed ingredients: strip amounts AND mark bare mentions
        for (const key of keySets[i]) {
          txt = txt.replace(new RegExp(STEP_AMT + "\\s*" + STEP_UNIT + "?\\s+(?:of\\s+(?:the\\s+)?)?(" + STEP_FILLER + "{0,2})(" + escRe(key) + ")s?\\b", "gi"),
            "$2 (omitted)");
          txt = txt.replace(new RegExp("\\b(" + escRe(key) + "s?)\\b(?!\\s*\\(omitted)", "gi"), "$1 (omitted)");
        }
        continue;
      }
      const disp = displayAmount(ing, factor, system);
      if (!disp) continue;
      let done = false;
      for (const key of keySets[i]) {
        const esc = escRe(key);
        // Pass A: amount [unit] [adjective filler] name — ALL occurrences
        const reA = new RegExp(STEP_AMT + "\\s*" + STEP_UNIT + "?\\s+(?:of\\s+(?:the\\s+)?)?(" + STEP_FILLER + "{0,2})(" + esc + ")s?\\b", "gi");
        if (reA.test(txt)) {
          txt = txt.replace(reA, (m, filler, name) =>
            disp + " " + (filler || "") + (ing.swapped ? ing.name : name + (m.endsWith("s") && !name.endsWith("s") ? "s" : "")));
          done = true; break;
        }
        // Pass B: bare mention -> annotate the first occurrence.
        // Guards: never inside a compound noun ("baking sheet", "butter mix" —
        // the next word must be a connector or punctuation), and never when the
        // step already carries the amount in words ("a pinch of chili flakes").
        if (txt.toLowerCase().includes(disp.toLowerCase())) { done = true; break; }
        const CONNECT = "(?:for|and|in|into|with|until|then|to|over|on|at|of|the|a|an|so|by|is|are|before|after|while|when|or|until)";
        const reB = new RegExp("\\b(" + esc + "s?)\\b(?!\\s*\\()(?!\\s+(?!" + CONNECT + "\\b)[a-z])", "i");
        const mB = txt.match(reB);
        if (mB) {
          txt = txt.replace(reB, (ing.swapped ? ing.name : mB[1]) + " (" + disp + ")");
          done = true; break;
        }
      }
      // Pass C: a swapped ingredient renames its remaining bare mentions —
      // unless the new name contains the old word (milk -> oat milk)
      if (done && ing.swapped) {
        for (const key of keySets[i]) {
          if (ing.name.toLowerCase().includes(key)) continue;
          txt = txt.replace(new RegExp("\\b" + escRe(key) + "s?\\b(?![^(]*\\))", "gi"), m =>
            m === m.toUpperCase() ? ing.name.toUpperCase() : ing.name);
        }
      }
    }
    return txt;
  }

  // half-tolerant fruit count: 0.5 -> "half a lemon", 1.5 -> "1 ½ lemons"
  function fruitCount(n, fruit) {
    if (Math.abs(n - 0.5) < 0.13) return "half a " + fruit;
    const r = Math.max(0.5, Math.round(n * 2) / 2);
    return niceNumber(r, true) + " " + pluralize(fruit, r);
  }
  // Scaled display name — handles phrase ingredients like "juice of 1 lemon" (FR-2.8)
  function displayName(ing, factor) {
    if (ing.juiceOf && ing.amount != null)
      return "juice of " + fruitCount(ing.amount * factor, ing.juiceOf);
    return ing.name;
  }

  // Cross-unit shopping merges (FR-6.2 polish): reduce a unit to its metric
  // base (g or ml) so "2 cups flour" and "250 g flour" can share one row.
  // Spoons are deliberately excluded — tsp/tbsp stay as written everywhere
  // (Shuki's spoon rule), and countables/naturals/juice keep their own rows.
  function metricBase(unit, name) {
    if (unit === "g") return { f: 1, u: "g" };
    if (unit === "kg") return { f: 1000, u: "g" };
    if (unit === "oz") return { f: 28.35, u: "g" };
    if (unit === "lb") return { f: 453.6, u: "g" };
    if (unit === "ml") return { f: 1, u: "ml" };
    if (unit === "l") return { f: 1000, u: "ml" };
    if (unit === "floz") return { f: 29.57, u: "ml" };
    if (unit === "cup") {
      if (isLiquid(name)) return { f: 236.6, u: "ml" };
      const d = densityOf(name); if (d) return { f: 236.6 * d, u: "g" };
    }
    return null;
  }
  return { normalizeUnit, isCountable, isNatural, displayAmount, displayName, displayStepText,
    niceNumber, pluralize, metricBase, NATURAL_EQUIV_G, NATURAL_EQUIV_ML, JUICE_ML };
})();

/* ---------------- SC.parser ---------------- */
SC.parser = (() => {
  const UF = { "½":0.5,"⅓":1/3,"⅔":2/3,"¼":0.25,"¾":0.75,"⅛":0.125,"⅜":0.375,"⅝":0.625,"⅞":0.875 };
  // list markers recipe sites paste along with each line: dashes/dots plus the
  // checkbox glyphs (▢ ☐ □ ◻ ☑ ✓ …) WordPress recipe cards prepend to ingredients
  const BULLET = "[-•*·◦▪▫■□▢◻◼☐☑✓✔►▸‣⁃–—]";
  const BULLET_RE = new RegExp("^\\s*(?:" + BULLET + "\\s*)+");
  const AMOUNT_RE = new RegExp("^\\s*(?:" + BULLET + "\\s*)*(\\d+\\s*[½⅓⅔¼¾⅛⅜⅝⅞]|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|[½⅓⅔¼¾⅛⅜⅝⅞]|\\d+(?:[.,]\\d+)?)(?:\\s*[-–—]\\s*(\\d+(?:[.,]\\d+)?))?\\s*");
  // site chrome that rides along inside the ingredient list (Instacart buttons, cook mode…)
  const CHROME_RE = /^(instacart|get recipe ingredients|shop (?:the )?ingredients|add (?:all )?to cart|buy ingredients|cook mode|prevent your screen from going dark|print(?: recipe)?|pin(?: recipe)?|save(?: recipe)?|jump to recipe|watch (?:the )?video|scale)\s*:?$/i;
  // section headers a website paste carries — never the title, never an ingredient
  const SECTION_RE = /^(ingredients?|instructions?|directions?|method|steps|preparation|equipment|tools|notes?|recipe notes|nutrition(?:al)?(?: information| facts)?|video)\s*:?$/i;
  const UNIT_RE = /^(fl\.?\s?oz|fluid ounces?|[a-zA-Z]+\.?)\s+/;

  function parseAmountToken(tok) {
    tok = tok.trim();
    const mixed = tok.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixed) return +mixed[1] + (+mixed[2] / +mixed[3]);
    const frac = tok.match(/^(\d+)\/(\d+)$/);
    if (frac) return +frac[1] / +frac[2];
    const uni = tok.match(/^(\d*)\s*([½⅓⅔¼¾⅛⅜⅝⅞])$/);
    if (uni) return (+uni[1] || 0) + UF[uni[2]];
    return parseFloat(tok.replace(",", "."));
  }

  function parseIngredientLine(line) {
    const raw = line.replace(BULLET_RE, "").trim();
    if (!raw || CHROME_RE.test(raw) || SECTION_RE.test(raw)) return null;
    // section sub-headers ("For the sauce:") are labels, not ingredients
    if (/:$/.test(raw) && !AMOUNT_RE.test(raw)) return null;
    // "juice of 1 lemon" — vague measurable (FR-2.8); ml equivalent kept behind the scenes
    const juice = raw.match(/^juice\s+of\s+(\d+(?:\/\d+)?|half)\s+an?\s*(lemon|lime|orange)s?$/i)
               || raw.match(/^juice\s+of\s+(\d+(?:\/\d+)?)\s+(lemon|lime|orange)s?$/i);
    if (juice) {
      const n = /half/i.test(juice[1]) ? 0.5 : parseAmountToken(juice[1]);
      const fruit = juice[2].toLowerCase();
      return { amount: n, rawAmount: raw, unit: "", name: raw, prep: "",
        countable: false, natural: true, juiceOf: fruit };
    }
    let rest = raw, amount = null, rawAmount = "", unit = "";
    // "a pinch of salt" / "a dash of pepper"
    const aNatural = raw.match(/^an?\s+(pinch|dash|handful|splash|knob|squeeze)\s+of\s+(.+)$/i);
    if (aNatural) {
      return { amount: 1, rawAmount: "a " + aNatural[1].toLowerCase(), unit: aNatural[1].toLowerCase(),
        name: aNatural[2].trim(), prep: "", countable: false, natural: true };
    }
    // "Salt to taste", "black pepper, to taste"
    const toTaste = raw.match(/^(.+?),?\s+to\s+taste\.?$/i);
    if (toTaste) {
      return { amount: null, rawAmount: "to taste", unit: "",
        name: toTaste[1].trim(), prep: "", countable: false, natural: true };
    }
    const am = rest.match(AMOUNT_RE);
    if (am && am[1]) {
      amount = parseAmountToken(am[1]);
      if (am[2]) amount = (amount + parseFloat(am[2].replace(",", "."))) / 2; // range -> midpoint
      rawAmount = am[0].trim().replace(BULLET_RE, "");
      rest = rest.slice(am[0].length);
    }
    const um = rest.match(UNIT_RE);
    if (um) {
      const norm = SC.units.normalizeUnit(um[1]);
      if (norm) { unit = norm; rest = rest.slice(um[0].length); }
    }
    rest = rest.replace(/^of\s+/i, "");
    let name = rest.trim(), prep = "";
    const comma = name.indexOf(",");
    if (comma > -1) { prep = name.slice(comma + 1).trim(); name = name.slice(0, comma).trim(); }
    const paren = name.match(/^(.*?)\s*\((.+?)\)\s*$/);
    if (paren) { name = paren[1].trim(); prep = prep ? paren[2] + ", " + prep : paren[2]; }
    if (!name) return null;
    const natural = SC.units.isNatural(unit);
    const countable = !unit && SC.units.isCountable(name);
    return { amount, rawAmount: rawAmount || (amount == null ? "" : String(amount)),
      unit, name, prep, countable, natural };
  }

  const TOOL_WORDS = { oven:"oven", skillet:"skillet", pan:"pan", saucepan:"saucepan", pot:"pot",
    bowl:"mixing bowl", whisk:"whisk", blender:"blender", "baking sheet":"baking sheet",
    "baking dish":"baking dish", grater:"grater", mixer:"mixer", "food processor":"food processor",
    knife:"knife", spatula:"spatula", ladle:"ladle", colander:"colander", griddle:"griddle",
    "cutting board":"cutting board", "measuring cup":"measuring cups", tongs:"tongs", "rolling pin":"rolling pin" };
  const TOOL_RES = Object.keys(TOOL_WORDS).map(k =>
    [new RegExp("\\b" + k.replace(/ /g, "\\s+") + "s?\\b", "i"), TOOL_WORDS[k]]);

  // "1 hour 30 minutes" | "45 minutes" | "1.5 hours" -> minutes
  function durationMin(low) {
    const hm = low.match(/(\d+(?:\.\d+)?)\s*h(?:ou)?rs?\b(?:\s*(?:and\s*)?(\d+)\s*min(?:ute)?s?)?/);
    if (hm) return Math.round(parseFloat(hm[1]) * 60 + (+hm[2] || 0));
    const mm = low.match(/(\d+)(?:\s*(?:to|[-–])\s*(\d+))?\s*(?:more\s+)?min(?:ute)?s?\b/);
    if (mm) return mm[2] ? Math.round((+mm[1] + +mm[2]) / 2) : +mm[1];
    return null;
  }

  function parseStep(text) {
    const t = text.trim();
    const tools = [];
    const low = t.toLowerCase();
    for (const [re, tool] of TOOL_RES) if (re.test(low) && !tools.includes(tool)) tools.push(tool);
    const timerMin = durationMin(low);
    const prepish = /^(preheat|measure|chop|dice|mince|grate|wash|rinse|peel|gather|bring .* to room temperature)/i.test(t);
    return { text: t, phase: prepish ? "prep" : "cook", tools, timerMin };
  }

  function looksLikeIngredient(line) {
    const l = line.trim();
    if (!l || l.length > 90 || l.split(" ").length > 9) return false;
    if (/^\d+[.)]\s/.test(l)) return false;           // numbered step
    if (/^\d[^\n]{0,20}\b(min|minute|hour|second)s?\b/i.test(l)) return false; // "2 minutes per side..."
    if (/to\s+taste\.?$/i.test(l) && l.split(" ").length <= 6) return true;
    if (/^juice\s+of\s+/i.test(l)) return true;
    if (AMOUNT_RE.test(l) || /^an?\s+(pinch|dash|handful|splash)/i.test(l)) return true;
    return BULLET_RE.test(l) && l.split(" ").length <= 8;
  }

  function parse(text) {
    const lines = text.replace(/\r/g, "").split("\n").map(l => l.trim());
    // name: first substantial line BEFORE any section header that isn't a URL or
    // a bare list marker — a paste that starts at "Equipment"/"Ingredients" has
    // no title in it, and a header must never become one
    let name = "Untitled recipe", rawTitleLine = null;
    const firstHeader = lines.findIndex(l => SECTION_RE.test(l));
    for (const l of (firstHeader > -1 ? lines.slice(0, firstHeader) : lines)) {
      if (l && !/^https?:\/\//i.test(l) && !SECTION_RE.test(l) && l.replace(BULLET_RE, "").trim()) {
        rawTitleLine = l;
        name = l.replace(/^recipe:?\s*/i, "").replace(/\s+recipe\s*$/i, "")
          .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B50}\u{2764}]/gu, "") // emoji
          .replace(/\s{2,}/g, " ").trim().slice(0, 80);
        const letters = name.replace(/[^A-Za-z]/g, "");
        if (letters && letters === letters.toUpperCase()) // ALL CAPS -> Title Case
          name = name.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
        break;
      }
    }
    // split into sections FIRST, so meta (servings/times) is read from the header
    // region only — never from inside step text ("cook 2 minutes more").
    const ingIdx = lines.findIndex(l => /^ingredients?\b/i.test(l));
    const stepIdx = lines.findIndex(l => /^(instructions?|directions?|method|steps|preparation)\b/i.test(l));
    const metaEnd = ingIdx > -1 ? ingIdx : (stepIdx > -1 ? stepIdx : Math.min(lines.length, 8));
    const metaText = lines.slice(0, metaEnd).join("\n");
    let servings = null;
    const sm = metaText.match(/(?:serves|servings?:?|yield:?|makes)\s*:?\s*(\d+)/i) || metaText.match(/(\d+)\s+servings/i);
    if (sm) servings = +sm[1];
    let prepMin = null, cookMin = null;
    const pm = metaText.match(/prep(?:\s*time)?\s*:?\s*([^\n·|,]+)/i);
    if (pm) prepMin = durationMin(pm[1].toLowerCase());
    const cm = metaText.match(/cook(?:ing)?(?:\s*time)?\s*:?\s*([^\n·|,]+)/i);
    if (cm) cookMin = durationMin(cm[1].toLowerCase());

    let ingLines = [], stepLines = [];
    if (ingIdx > -1 && stepIdx > -1) {
      ingLines = lines.slice(Math.min(ingIdx, stepIdx) + 1, Math.max(ingIdx, stepIdx)).filter(Boolean);
      stepLines = lines.slice(Math.max(ingIdx, stepIdx) + 1).filter(Boolean);
      if (stepIdx < ingIdx) { const t = ingLines; ingLines = stepLines; stepLines = t; }
      // a website paste keeps going after the steps — Notes / Nutrition / Video
      // are not steps ("Calories: 450" must never be read aloud as one)
      const tail = stepLines.findIndex(l => SECTION_RE.test(l) && !/^(instructions?|directions?|method|steps|preparation)/i.test(l));
      if (tail > -1) stepLines = stepLines.slice(0, tail);
      stepLines = stepLines.filter(l => !CHROME_RE.test(l.replace(BULLET_RE, "")));
      // an Equipment/Tools block inside the ingredient region: skip its items
      // ("air fryer" is not an ingredient) until the list looks like food again
      let inTools = false;
      ingLines = ingLines.filter(l => {
        const bare = l.replace(BULLET_RE, "").trim();
        if (/^(equipment|tools)\s*:?$/i.test(bare)) { inTools = true; return false; }
        if (inTools && (looksLikeIngredient(bare) || SECTION_RE.test(bare))) inTools = false;
        return !inTools;
      });
    } else {
      // heuristic: ingredient-looking lines vs sentences (skip the raw title line)
      for (const l of lines) {
        if (!l || l === rawTitleLine || /^https?:\/\//i.test(l)) continue;
        if (looksLikeIngredient(l)) ingLines.push(l);
        else if (l.split(" ").length > 3 || /[.!?]$/.test(l)) stepLines.push(l);
      }
    }
    const ingredients = ingLines.map(parseIngredientLine).filter(Boolean);
    // steps: merge numbered lines; split long paragraphs into sentences if only one blob
    let stepTexts = stepLines.map(l => l.replace(/^(?:step\s*)?\d+[.):]\s*/i, "").trim()).filter(s => s.length > 3);
    if (stepTexts.length <= 1 && stepTexts[0] && stepTexts[0].length > 160) {
      stepTexts = stepTexts[0].split(/(?<=\.)\s+(?=[A-Z])/).filter(s => s.length > 10);
    }
    const steps = stepTexts.map(parseStep);
    if (!ingredients.length && !steps.length) return null;
    const id = "r-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    return { id, name, servings: servings || 4,
      baseServings: servings || 4, prepMin, cookMin, source: "Pasted text", ingredients, steps, notes: {} };
  }

  return { parse, parseIngredientLine, parseStep };
})();

/* ---------------- SC.swaps ----------------
   Rule-based ingredient swaps (FR-4.1/4.2): every replacement is a specific
   ingredient with a ratio and a cooking explanation — never "a gluten-free
   alternative". Pantry items are preferred when they fit (FR-4.4). */
SC.swaps = (() => {
  const LIB = [
    { re:/\bbuttermilk\b/i, alts:["oat milk + 1 tsp lemon juice","soy milk + 1 tsp vinegar"], diets:["vegan","dairyfree"], ratio:1, note:"stir and rest 5 minutes so it curdles like buttermilk" },
    { re:/\bpeanut butter\b/i, alts:["sunflower seed butter"], diets:["nutfree"], ratio:1, note:"same texture; roast-y rather than nutty" },
    { re:/\bheavy cream\b|\bwhipping cream\b/i, alts:["coconut cream"], diets:["vegan","dairyfree"], ratio:1, note:"chill the can and use the thick part for whipping" },
    { re:/\bsoy sauce\b/i, alts:["tamari"], diets:["glutenfree"], ratio:1, note:"tamari is naturally gluten-free with the same saltiness" },
    { re:/\bbutter\b/i, alts:["coconut oil","olive oil","vegan margarine"], diets:["vegan","dairyfree"], ratio:1, note:"works 1:1 when melted" },
    { re:/\beggs?\b/i, alts:[
        { to:"flax eggs", note:"per egg: 1 tbsp ground flax + 3 tbsp water, rest 5 minutes — neutral taste" },
        { to:"unsweetened applesauce", note:"¼ cup per egg — adds moisture, best in sweet baking" },
        { to:"mashed banana", note:"half a banana per egg — adds banana flavor, great in desserts" },
        { to:"aquafaba", note:"3 tbsp per egg — whips like egg whites" }
      ], diets:["vegan","eggfree"], ratio:1 },
    { re:/\bmilk\b/i, alts:["oat milk","almond milk","soy milk"], diets:["vegan","dairyfree"], ratio:1, note:"any unsweetened plant milk works 1:1" },
    { re:/\bparmesan\b/i, alts:["nutritional yeast"], diets:["vegan","dairyfree"], ratio:0.5, note:"use half the amount — strong salty umami" },
    { re:/\bcheese\b/i, alts:["dairy-free cheese shreds"], diets:["vegan","dairyfree"], ratio:1, note:"melts best mixed with a little plant milk" },
    { re:/\byogh?urt\b/i, alts:["coconut yogurt"], diets:["vegan","dairyfree"], ratio:1, note:"same tang and thickness" },
    { re:/\bhoney\b/i, alts:["maple syrup"], diets:["vegan"], ratio:1, note:"slightly thinner — reduce other liquids a touch" },
    { re:/\bcream\b/i, alts:["coconut cream"], diets:["vegan","dairyfree"], ratio:1, note:"rich and neutral in cooked dishes" },
    { re:/\b(all-purpose|plain)\s+flour\b|\bflour\b/i, alts:["gluten-free flour blend","rice flour"], diets:["glutenfree"], ratio:1, note:"a 1:1 GF blend behaves closest to wheat flour" },
    { re:/\bspaghetti\b|\bpasta\b|\bnoodles\b/i, alts:["gluten-free pasta"], diets:["glutenfree"], ratio:1, note:"cook 1–2 minutes less than the package says" },
    { re:/\bbreadcrumbs\b|\bpanko\b/i, alts:["gluten-free breadcrumbs","crushed rice crackers"], diets:["glutenfree"], ratio:1, note:"toast lightly for extra crunch" },
    { re:/\b(chicken|beef)\s+(broth|stock)\b/i, alts:["vegetable broth"], diets:["vegan","vegetarian"], ratio:1, note:"same amount; a splash of soy sauce deepens it" },
    { re:/\bpeanuts?\b/i, alts:["roasted sunflower seeds"], diets:["nutfree"], ratio:1, note:"same crunch, nut-free" },
    { re:/\b(almonds?|walnuts?|pecans?|cashews?|hazelnuts?|pistachios?)\b/i, alts:["pumpkin seeds","sunflower seeds"], diets:["nutfree"], ratio:1, note:"toast them for the same crunch" },
    // keto / low-carb
    { re:/\b(all-purpose|plain)\s+flour\b|\bflour\b/i, alts:["almond flour"], diets:["keto","lowcarb","paleo"], ratio:1, note:"denser — an extra egg helps the rise" },
    { re:/\bsugar\b/i, alts:["erythritol"], diets:["keto","lowcarb","sugarfree"], ratio:1, note:"measures like sugar, zero carbs" },
    { re:/\bsugar\b/i, alts:["coconut sugar"], diets:["paleo"], ratio:1, note:"slightly caramel flavor" },
    { re:/\bspaghetti\b|\bpasta\b|\bnoodles\b/i, alts:["zucchini noodles"], diets:["keto","lowcarb","paleo"], ratio:1, note:"sauté 2–3 minutes only — they release water" },
    { re:/\brice\b(?!\s*(vinegar|flour|paper|wine|noodle))/i, alts:["cauliflower rice"], diets:["keto","lowcarb","paleo"], ratio:1, note:"cooks in 5 minutes, don't overdo it" },
    { re:/\bpotato(es)?\b/i, alts:["cauliflower florets"], diets:["keto","lowcarb"], ratio:1, note:"roasts and mashes the same way" },
    { re:/\bbread\s?crumbs\b|\bbreadcrumbs\b/i, alts:["crushed pork rinds","almond flour"], diets:["keto","lowcarb"], ratio:1, note:"same crisp coating" },
    { re:/\bhoney\b|\bmaple syrup\b/i, alts:["sugar-free maple syrup"], diets:["keto","lowcarb","sugarfree"], ratio:1, note:"same pour, no sugar" },
    { re:/\bmilk\b/i, alts:["unsweetened almond milk"], diets:["keto","lowcarb"], ratio:1, note:"only ~1g carbs per cup" },
    { re:/\bchocolate chips\b/i, alts:["sugar-free chocolate chips"], diets:["keto","sugarfree"], ratio:1, note:"melts the same" },
    // paleo extras
    { re:/\bbutter\b/i, alts:["ghee"], diets:["paleo"], ratio:1, note:"clarified butter — paleo-friendly" },
    { re:/\bsoy sauce\b/i, alts:["coconut aminos"], diets:["paleo"], ratio:1, note:"slightly sweeter — add a pinch of salt" },
    { re:/\bpeanut butter\b/i, alts:["almond butter"], diets:["paleo"], ratio:1, note:"same texture" },
    // low sodium
    { re:/\bsoy sauce\b/i, alts:["low-sodium soy sauce"], diets:["lowsodium"], ratio:1, note:"same flavor, ~40% less salt" },
    { re:/\b(chicken|beef|vegetable)\s+(broth|stock)\b/i, alts:["low-sodium broth"], diets:["lowsodium"], ratio:1, note:"season at the end, to taste" },
    // vegetarian
    { re:/\bchicken\b(?!\s*(broth|stock|bouillon))/i, alts:["extra-firm tofu"], diets:["vegetarian","vegan"], ratio:1, note:"press it dry, then pan-sear for texture" },
    { re:/\bbeef\b(?!\s*(broth|stock|bouillon))/i, alts:["brown lentils","chopped mushrooms"], diets:["vegetarian","vegan"], ratio:1, note:"mushrooms bring the umami, lentils the bite" },
    { re:/\bbacon\b/i, alts:["smoked paprika + sautéed mushrooms"], diets:["vegetarian","vegan"], ratio:1, note:"the smoke is what you're really after" }
  ];
  const DIETS = [
    { key:"vegan", label:"Vegan" },
    { key:"glutenfree", label:"Gluten-free" },
    { key:"dairyfree", label:"Dairy-free" },
    { key:"nutfree", label:"Nut-free" }
  ];
  // Ingredients already compliant with a diet are never proposed for swapping
  const SAFE = {
    vegan: /\b(oat|almond|soy|coconut|rice|cashew)\s+(milk|cream|yog?hurt)|flax egg|nutritional yeast|vegan|plant-based|dairy-free|maple syrup|(peanut|sunflower|seed|nut)\s+butter|vegetable (broth|stock)|tamari|tofu|lentils\b/i,
    dairyfree: /\b(oat|almond|soy|coconut|rice|cashew)\s+(milk|cream|yog?hurt)|dairy-free|vegan|coconut (cream|yogurt)|(peanut|sunflower|seed|nut)\s+butter|margarine\b/i,
    glutenfree: /\bgluten-free|rice flour|almond flour|corn(meal| tortilla)|tamari|buckwheat|quinoa\b/i,
    nutfree: /\b(pumpkin|sunflower)\s+seed|seed butter|nut-free\b/i,
    keto: /\balmond flour|erythritol|cauliflower|zucchini noodles|sugar-free|pork rinds\b/i,
    lowcarb: /\balmond flour|erythritol|cauliflower|zucchini noodles|sugar-free|pork rinds\b/i,
    paleo: /\balmond (flour|butter)|coconut (sugar|aminos|milk)|ghee|cauliflower|zucchini noodles\b/i,
    sugarfree: /\berythritol|sugar-free|stevia\b/i,
    lowsodium: /\blow-sodium\b/i,
    vegetarian: /\btofu|lentils|mushrooms|paneer|tempeh\b/i
  };
  // Category allergies ("dairy", "gluten", "nuts") expand to the ingredients they cover
  const ALLERGY_GROUPS = {
    dairy: ["milk","butter","buttermilk","cheese","cream","yogurt","yoghurt","parmesan","mozzarella","cheddar","whey","ghee"],
    lactose: ["milk","buttermilk","cheese","cream","yogurt","yoghurt","whey"],
    gluten: ["flour","wheat","pasta","spaghetti","noodles","breadcrumbs","panko","bread","barley","rye","couscous","soy sauce","semolina"],
    wheat: ["flour","wheat","pasta","spaghetti","noodles","breadcrumbs","panko","bread","couscous","semolina"],
    nut: ["almond","walnut","pecan","cashew","hazelnut","pistachio","macadamia","nut"],
    nuts: ["almond","walnut","pecan","cashew","hazelnut","pistachio","macadamia","nut"],
    "tree nut": ["almond","walnut","pecan","cashew","hazelnut","pistachio","macadamia"],
    egg: ["egg"], eggs: ["egg"],
    soy: ["soy","tofu","edamame"],
    shellfish: ["shrimp","prawn","crab","lobster","clam","mussel","oyster","scallop"],
    sesame: ["sesame","tahini"],
    peanut: ["peanut"], peanuts: ["peanut"], fish: ["salmon","tuna","cod","anchovy","anchovies","sardine"]
  };
  function allergyTerms(allergy) {
    return ALLERGY_GROUPS[allergy.toLowerCase().trim()] || [allergy.toLowerCase().trim()];
  }
  // word-boundary match so "nut" never flags "coconut"; singular/plural tolerant both ways
  function allergyHit(name, allergy) {
    const n = name.toLowerCase();
    return allergyTerms(allergy).some(t => {
      const base = t.replace(/es$/, "").replace(/s$/, "");
      return new RegExp("(^|[\\s-])" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:e?s)?($|[\\s-])").test(n);
    });
  }
  const MAINSTREAM = ["vegan", "dairyfree", "glutenfree", "nutfree"];
  function ruleFor(name, diet) {
    if (diet && SAFE[diet] && SAFE[diet].test(name)) return null;
    if (diet) {
      for (const r of LIB) if (r.re.test(name) && r.diets.includes(diet)) return r;
      return null;
    }
    // no diet context (per-row swap, allergies): prefer like-for-like mainstream
    // swaps; diet-specific rules (keto/paleo/…) only as a last resort
    // diet-flavored rules (keto sweeteners, vegetarian proteins…) are never
    // volunteered without the user asking for that diet
    for (const r of LIB) if (r.re.test(name) && r.diets.some(d => MAINSTREAM.includes(d)) && !r.diets.includes("vegetarian")) return r;
    return null;
  }
  // alternatives normalize to {to, note} — strings inherit the rule's note
  function altList(rule) {
    return rule.alts.map(a => typeof a === "string"
      ? { to: a, note: rule.note || "" } : { to: a.to, note: a.note || rule.note || "" });
  }
  function pickAlt(rule, pantry) {
    const list = altList(rule);
    const hit = list.find(a => (pantry || []).some(p =>
      a.to.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(a.to.toLowerCase())));
    return hit || list[0];
  }
  function proposalsForDiet(ingredients, diet, pantry) {
    const out = [];
    ingredients.forEach((ing, idx) => {
      if (ing.swapped || ing.removed) return;
      const r = ruleFor(ing.name, diet);
      if (r) {
        const alt = pickAlt(r, pantry);
        if (alt.to.toLowerCase() !== ing.name.toLowerCase())
          out.push({ idx, from: ing.name, to: alt.to, note: alt.note, ratio: r.ratio, alts: altList(r) });
      }
    });
    return out;
  }
  function proposalForAllergy(ing, idx, allergy, pantry) {
    if (!allergyHit(ing.name, allergy)) return null;
    // allergies search ALL rules — a chicken allergy deserves the tofu swap
    // even though per-row swaps don't volunteer it
    const r = ruleFor(ing.name, null) || LIB.find(x => x.re.test(ing.name)) || null;
    if (r) {
      const alt = pickAlt(r, pantry);
      // never "swap" an allergen for itself; library alts are curated allergen-free
      // ("flax eggs" only borrows the word — it contains no egg)
      if (alt.to.toLowerCase() !== ing.name.toLowerCase())
        return { idx, from: ing.name, to: alt.to, ratio: r.ratio, note: alt.note, allergy, alts: altList(r) };
    }
    return { idx, from: ing.name, to: null, ratio: 1, note: "no safe swap found — consider omitting", allergy };
  }
  // One-ingredient swap for the per-row button (Shuki request, Aug 23)
  function proposalForIngredient(ing, idx, pantry) {
    if (ing.swapped || ing.removed) return null;
    const r = ruleFor(ing.name, null);
    if (!r) return null;
    const alt = pickAlt(r, pantry);
    if (alt.to.toLowerCase() === ing.name.toLowerCase()) return null;
    return { idx, from: ing.name, to: alt.to, ratio: r.ratio, note: alt.note, alts: altList(r) };
  }

  /* Free-text change requests (Shuki request, Aug 23):
     "make it gluten free", "keto diet", "no onions", "less sugar".
     Rule-based keyword mapping — an unknown diet gets an honest "not yet". */
  const REQUEST_DIETS = [
    [/gluten[\s-]?free|no gluten|celiac/i, "glutenfree", "Gluten-free"],
    [/vegan/i, "vegan", "Vegan"],
    [/dairy[\s-]?free|no dairy|lactose/i, "dairyfree", "Dairy-free"],
    [/nut[\s-]?free|no nuts/i, "nutfree", "Nut-free"],
    [/keto(genic)?/i, "keto", "Keto"],
    [/low[\s-]?carb/i, "lowcarb", "Low-carb"],
    [/paleo/i, "paleo", "Paleo"],
    [/low[\s-]?sodium|less salt|low[\s-]?salt/i, "lowsodium", "Low-sodium"],
    [/sugar[\s-]?free|no sugar/i, "sugarfree", "Sugar-free"],
    [/vegetarian/i, "vegetarian", "Vegetarian"]
  ];
  function parseRequest(text) {
    const t = " " + text.toLowerCase().trim() + " ";
    const out = { diets: [], removes: [], halves: [], unknown: false };
    for (const [re, key, label] of REQUEST_DIETS)
      if (re.test(t) && !out.diets.some(d => d.key === key)) out.diets.push({ key, label });
    // "no onions" / "without garlic" / "remove the cilantro" — but not "no sugar" (a diet)
    let m;
    const removeRe = /(?:\bno\b|\bwithout\b|\bremove\b|\bskip\b)\s+(?:the\s+)?([a-z][a-z\s-]{1,30}?)(?=[,.!]|\s+and\b|\s*$)/g;
    while ((m = removeRe.exec(t)) !== null) {
      const what = m[1].replace(/\b(please|thanks|thank you)\b/g, "").trim();
      if (!what) continue;
      // "without sugar" / "remove dairy" are really diet requests — route them there
      const dietHit = REQUEST_DIETS.find(([re2]) => re2.test("no " + what) || re2.test(what + " free"));
      if (dietHit) {
        if (!out.diets.some(d => d.key === dietHit[1])) out.diets.push({ key: dietHit[1], label: dietHit[2] });
      } else if (what !== "gluten" && what !== "dairy") out.removes.push(what);
    }
    const lessRe = /\bless\s+(?:of\s+)?(?:the\s+)?([a-z][a-z\s-]{1,30}?)(?=[,.!]|\s+and\b|\s*$)/g;
    while ((m = lessRe.exec(t)) !== null) {
      const what = m[1].replace(/\b(please|thanks|thank you)\b/g, "").trim();
      if (what && what !== "salt") out.halves.push(what); // "less salt" maps to low-sodium (which halves salt)
    }
    out.unknown = !out.diets.length && !out.removes.length && !out.halves.length;
    return out;
  }

  // Static improvised-alternative hints — informational only, no ownership tracking
  const ALT_TOOLS = { griddle:"a skillet", blender:"a food processor", mixer:"a whisk and elbow grease",
    "food processor":"a blender", whisk:"a fork", "rolling pin":"a clean bottle" };
  function toolAlternative(tool) { return ALT_TOOLS[tool] || null; }
  function toolHintFor(phrase) { // "I don't have a mixer" — the app knows this one
    const pl = phrase.toLowerCase();
    for (const k in ALT_TOOLS) if (pl.includes(k)) return { tool: k, alt: ALT_TOOLS[k] };
    return null;
  }
  return { DIETS, proposalsForDiet, proposalForAllergy, proposalForIngredient,
    parseRequest, toolAlternative, toolHintFor, allergyHit };
})();

/* ---------------- SC.planner ----------------
   Mise-en-place planning (FR-2.9): a prep phase before step 1, passive
   long-running tasks started as early as possible, everything else in the
   recipe's own order — never reordered when order matters. */
SC.planner = (() => {
  const VERB = { minced:"Mince", chopped:"Chop", diced:"Dice", grated:"Grate", melted:"Melt",
    sifted:"Sift", beaten:"Beat", softened:"Soften", peeled:"Peel", sliced:"Slice",
    crushed:"Crush", zested:"Zest", juiced:"Juice", halved:"Halve", cubed:"Cube",
    shredded:"Shred", toasted:"Toast", "room temperature":"Bring to room temperature" };
  function prepVerb(prep) {
    const p = prep.toLowerCase();
    for (const k in VERB) if (p.includes(k)) {
      const extra = p.replace(k, "").replace(/,.*$/, "").trim(); // "finely chopped" -> "finely"
      return (extra && /ly$/.test(extra) ? extra[0].toUpperCase() + extra.slice(1) + " " + VERB[k].toLowerCase()
                                         : VERB[k]);
    }
    return null;
  }
  const PASSIVE_RE = /^(preheat|bring .*to a (simmer|boil)|boil (a|the|some)? ?(pot|water|kettle))/i;
  function buildPlan(recipe, factor, system) {
    const items = [];
    // 1) passive long-running steps FIRST — the oven takes longer than the
    //    measuring does, so it goes on before mise en place (Amit, Aug 25)
    const promoted = new Set();
    recipe.steps.forEach((s, i) => {
      const independent = !/\b(mixture|batter|dough|sauce|filling|marinade|bowl|it\b)/i.test(s.text);
      if (/^preheat/i.test(s.text) && independent) promoted.add(i);
      else if (i === 0 && PASSIVE_RE.test(s.text) && independent) promoted.add(i);
    });
    [...promoted].forEach(i => items.push({ kind: "step", phase: "cook", passive: true,
      step: recipe.steps[i], stepIndex: i }));
    // 2) mise-en-place: measure / prep every ingredient that's still in the recipe
    recipe.ingredients.forEach(ing => {
      if (ing.removed) return;
      const disp = SC.units.displayAmount(ing, factor, system);
      const name = SC.units.displayName(ing, factor);
      let text = null;
      const verb = ing.prep ? prepVerb(ing.prep) : null;
      if (ing.juiceOf && ing.amount != null) {
        // "juice of half a lemon" -> "Juice half a lemon"
        text = "Juice " + SC.units.displayName(ing, factor).replace(/^juice of /, "");
      }
      else if (verb === "Bring to room temperature")
        text = "Bring " + (disp ? disp + " " : "") + name + " to room temperature";
      else if (verb) text = verb + " " + (disp ? disp + " " : "") + name;
      else if (ing.countable && ing.amount != null) text = "Set out " + disp + " " + name;
      else if (disp && !ing.natural) text = "Measure " + disp + " " + name;
      else if (ing.natural && ing.amount != null && disp !== name) text = "Have " + name + " ready (" + disp + ")";
      if (text) items.push({ kind: "mise", phase: "prep", text, timerMin: null, tools: [] });
    });
    // 3) everything else, untouched order
    recipe.steps.forEach((s, i) => {
      if (!promoted.has(i)) items.push({ kind: "step", phase: s.phase, step: s, stepIndex: i });
    });
    return items;
  }
  return { buildPlan };
})();

/* ---------------- SC.voice ----------------
   TTS + speech recognition wrapper (FR-5.1/5.2/5.6). Degrades honestly:
   TTS works nearly everywhere; recognition needs mic permission and may be
   unavailable inside embedded pages — touch stays a full backup (DP-2). */
SC.voice = (() => {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  /* ---- native bridge (FR-5.7) ----------------------------------------
     Detected at runtime so this SAME file runs in the browser and inside
     the Capacitor iOS wrap. When the community plugins are present they
     take over; the web paths below stay the browser implementation.
     Field-testing of the native paths happens in the native phase — the
     echo-guard bookkeeping (speakId/speakingNow/lastSpokenText) is shared
     by both paths on purpose: iOS taught us to filter at the result level. */
  const capPlugins = (typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins) || null;
  const natTTS = (capPlugins && capPlugins.TextToSpeech) || null;
  const natSR = (capPlugins && capPlugins.SpeechRecognition) || null;
  let rec = null, wantListen = false, muted = false, onCommand = null, onState = null;
  let state = "off"; // off | listening | muted | denied | unsupported
  let speakId = 0, speakingNow = 0; // echo guard: recognition stays down while ANY utterance lives
  // Field-proven extra armor (Shuki's iPhone, Aug 25): iOS Safari sometimes keeps
  // recognizing through rec.stop(), so Sue heard her own "say next when ready"
  // and advanced herself. Three layers:
  //   1. anything recognized WHILE she speaks is her — drop it
  //   2. a short grace window after she finishes swallows the audio tail
  //   3. a multi-word transcript that is a fragment of her last sentence is an
  //      echo no matter when it arrives (single words like "next" stay valid —
  //      that's the user)
  let lastSpokenText = "", lastSpeechEnd = 0;
  const normTxt = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  function isSelfEcho(transcript) {
    if (speakingNow > 0) return true;                              // layer 1
    const since = Date.now() - lastSpeechEnd;
    if (since < 400) return true;                                  // layer 2
    const t = normTxt(transcript);
    // Exact short timer commands are exempt from layer 3 (rev-10): Sue's own
    // ask sentence contains "start timer again", so a user obeying her would
    // otherwise be swallowed for 5s. Layers 1-2 still protect during and just
    // after speech; a lone echo tail this exact is unlikely — field-verify on
    // the phone (see PROJECT_STATE review queue).
    if (/^(start|stop) (the )?timer( again)?$/.test(t)) return false;
    if (t.split(" ").length >= 3 && lastSpokenText.includes(t) && since < 5000) return true; // layer 3
    return false;
  }
  function setState(s) { state = s; onState && onState(s); }
  function supported() { return !!natSR || !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  function ttsAvailable() { return !!natTTS || !!synth; }

  /* voice quality: prefer the best local voice, let the user override */
  let voices = [], preferredName = null;
  function refreshVoices() { try { voices = synth ? synth.getVoices() : []; } catch (e) { voices = []; } }
  if (synth) { refreshVoices(); try { synth.onvoiceschanged = refreshVoices; } catch (e) {} }
  function listVoices() {
    if (natTTS) return []; // native uses the system voice; per-voice pick arrives with the native phase
    refreshVoices(); return voices.filter(v => /^en/i.test(v.lang));
  }
  function scoreVoice(v) {
    let s = 0; const n = v.name.toLowerCase();
    if (/premium/.test(n)) s += 6;
    if (/enhanced/.test(n)) s += 5;
    if (/natural|neural/.test(n)) s += 5;
    if (/\b(ava|samantha|allison|susan|zoe|karen|moira|serena|nicky|joelle)\b/.test(n)) s += 3;
    if (/google (us|uk) english/.test(n)) s += 3;
    if (v.lang === "en-US") s += 2; else if (/^en/i.test(v.lang)) s += 1;
    if (v.localService) s += 1;
    if (/compact|espeak|robot|whisper|bells|zarvox|trinoids/.test(n)) s -= 6;
    return s;
  }
  function pickVoice() {
    const list = listVoices();
    if (!list.length) return null;
    if (preferredName) { const m = list.find(v => v.name === preferredName); if (m) return m; }
    return [...list].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
  }
  function setPreferredVoice(name) { preferredName = name || null; }

  // Sentence-chunked speech with breathing room between sentences — less robotic,
  // and the whole job holds the echo guard so the mic never hears Sue.
  function speak(text, rate, onDone) {
    if (natTTS) return speakNative(text, rate, onDone);
    if (!synth) { onDone && onDone(); return; }
    try {
      synth.cancel();                     // stale utterances resolve via their own settle below
      const id = ++speakId;
      speakingNow++;
      pauseRec();                          // down BEFORE audio starts — don't listen to ourselves
      lastSpokenText = normTxt(text);
      let settled = false;
      const settle = () => {
        if (settled) return; settled = true;
        speakingNow = Math.max(0, speakingNow - 1);
        // count 0 means NOTHING is speaking — safe to resume no matter whose settle this is
        if (speakingNow === 0) { lastSpeechEnd = Date.now(); resumeRec(); }
        onDone && onDone();
      };
      const chunks = text.split(/(?<=[.?!])\s+/).filter(Boolean);
      // safety budget scaled by rate + inter-chunk gaps; if it ever fires early,
      // cancel the synth too — never leave audio playing into a live mic
      const budget = Math.min(90000, (3500 + text.length * 100) / (rate || 1) + chunks.length * 300);
      setTimeout(() => { if (!settled) { try { synth.cancel(); } catch (e) {} settle(); } }, budget);
      const voice = pickVoice();
      const next = (k) => {
        if (settled) return;
        if (k >= chunks.length || id !== speakId) { settle(); return; }
        const u = new SpeechSynthesisUtterance(chunks[k]);
        u.rate = rate || 1; u.lang = "en-US";
        if (voice) u.voice = voice;
        u.onend = () => setTimeout(() => next(k + 1), k < chunks.length - 1 ? 220 : 0);
        u.onerror = () => setTimeout(() => next(k + 1), 100); // skip a bad chunk, keep the readout
        synth.speak(u);
      };
      next(0);
    } catch (e) { speakingNow = Math.max(0, speakingNow - 1); onDone && onDone(); }
  }
  // Native TTS: same sentence-chunking + 220ms breathing room + echo-guard
  // bookkeeping as the web path; plugin speak() resolves when audio ends.
  async function speakNative(text, rate, onDone) {
    const id = ++speakId;
    speakingNow++;
    pauseRec();
    lastSpokenText = normTxt(text);
    let settled = false;
    const settle = () => {
      if (settled) return; settled = true;
      speakingNow = Math.max(0, speakingNow - 1);
      if (speakingNow === 0) { lastSpeechEnd = Date.now(); resumeRec(); }
      onDone && onDone();
    };
    const chunks = text.split(/(?<=[.?!])\s+/).filter(Boolean);
    const budget = Math.min(90000, (3500 + text.length * 100) / (rate || 1) + chunks.length * 300);
    const guard = setTimeout(() => {
      if (!settled) { try { natTTS.stop().catch(() => {}); } catch (e) {} settle(); }
    }, budget);
    try {
      for (const c of chunks) {
        if (id !== speakId || settled) break;
        await natTTS.speak({ text: c, lang: "en-US", rate: rate || 1, category: "playback" });
        if (id !== speakId || settled) break;
        await new Promise(r => setTimeout(r, 220));
      }
    } catch (e) { /* a failed chunk ends the readout quietly */ }
    clearTimeout(guard); settle();
  }
  function stopSpeak() {
    speakId++;                       // invalidates pending sentence chains (the 220ms gaps)
    if (natTTS) { try { natTTS.stop().catch(() => {}); } catch (e) {} }
    try { synth && synth.cancel(); } catch (e) {}
  }
  function pauseRec() { try { rec && rec.stop(); } catch (e) {} }
  function resumeRec() { if (wantListen && !muted && speakingNow === 0) { try { rec && rec.start(); } catch (e) {} } }
  // Native recognition: iOS sessions end on their own (one utterance / ~1 min
  // cap), so web `continuous` is mirrored by re-starting while wantListen holds.
  // A consecutive-failure counter keeps a broken plugin from hot-looping.
  let natFails = 0;
  async function startNativeRec() {
    // Entry + post-await guards (rev-9 CRITICAL): this runs from queued 150ms
    // timers and from before/after awaits — the world may have moved (Sue
    // started speaking, user muted or exited). Opening a session in any of
    // those states is how the Aug-25 echo bug would come back.
    if (!wantListen || muted || speakingNow > 0) return;
    let opened = 0;
    try {
      const perm = await natSR.requestPermissions();
      if (perm && perm.speechRecognition && /denied/i.test(perm.speechRecognition)) {
        wantListen = false; setState("denied"); return;
      }
      if (!wantListen || muted || speakingNow > 0) return; // state moved during the await
      setState("listening");
      opened = Date.now();
      const res = await natSR.start({ language: "en-US", maxResults: 1, partialResults: false, popup: false });
      natFails = 0;
      const t = ((res && res.matches && res.matches[0]) || "").trim();
      if (t && !isSelfEcho(t) && wantListen && !muted) onCommand && onCommand(t);
    } catch (e) {
      // Benign session ends must NOT count toward giving up (rev-9): iOS
      // rejects on silence ("No speech detected"), on the ~1-min session cap,
      // on our own stop() ("canceled"), and on an already-open session
      // ("Ongoing"). A session that lived a while was working, whatever the
      // final error says. A quiet kitchen is normal — only fast, repeated,
      // unexplained failures mean the plugin is truly broken.
      const msg = String((e && e.message) || e || "");
      const benign = /no speech|not detected|ongoing|cancel|1110/i.test(msg) ||
                     (opened && Date.now() - opened > 2000);
      if (benign) natFails = 0;
      else if (++natFails > 5) { wantListen = false; setState("unsupported"); return; }
    }
    if (wantListen && !muted && speakingNow === 0) setTimeout(startNativeRec, 150);
  }
  function initNativeRec() {
    rec = { // same start/stop surface pauseRec/resumeRec already use
      start() { natFails = 0; startNativeRec(); },
      stop() { try { natSR.stop().catch(() => {}); } catch (e) {} }
    };
    return true;
  }
  function init(cmdCb, stateCb) {
    onCommand = cmdCb; onState = stateCb;
    if (natSR) return initNativeRec();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setState("unsupported"); return false; }
    rec = new SR();
    rec.continuous = true; rec.interimResults = false; rec.lang = "en-US";
    rec.onresult = e => {
      const t = e.results[e.results.length - 1][0].transcript.trim();
      if (t && !isSelfEcho(t)) onCommand && onCommand(t);
    };
    rec.onerror = e => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantListen = false; setState("denied");
      }
    };
    // never auto-restart while Sue is speaking — that's how she'd hear herself
    rec.onend = () => { if (wantListen && !muted && speakingNow === 0) { try { rec.start(); } catch (e) {} } };
    return true;
  }
  function start() {
    if (!rec) return false;
    wantListen = true; muted = false;
    try { rec.start(); setState("listening"); return true; }
    catch (e) { return state === "listening"; }
  }
  function mute() { muted = true; pauseRec(); setState("muted"); }
  function unmute() { muted = false; if (wantListen) { resumeRec(); setState("listening"); } else start(); }
  function stopAll() { wantListen = false; muted = false; pauseRec(); stopSpeak(); setState("off"); }
  return { init, start, mute, unmute, stopAll, speak, stopSpeak, supported, ttsAvailable,
    listVoices, pickVoice, setPreferredVoice, isNativeTTS: () => !!natTTS,
    isMuted: () => muted, getState: () => state };
})();

/* ---------------- sample recipe ---------------- */
SC.SAMPLE_TEXT = `Fluffy Buttermilk Pancakes
Serves 4 · Prep time: 10 min · Cook time: 15 min

Ingredients
2 cups all-purpose flour
2 tbsp sugar
1 tsp baking powder
1/2 tsp baking soda
a pinch of salt
2 eggs
1 3/4 cups buttermilk
4 tbsp butter, melted
1 tsp vanilla extract

Instructions
1. Preheat a griddle or large skillet over medium heat.
2. Whisk the flour, sugar, baking powder, baking soda and salt in a large mixing bowl.
3. In a second bowl, whisk 2 eggs with 1 3/4 cups buttermilk and 1 tsp vanilla extract.
4. Pour the wet mix into the dry mix, add 4 tbsp melted butter, and stir until just combined.
5. Grease the skillet lightly and pour about 1/4 cup batter per pancake.
6. Cook for 3 minutes until bubbles form on top, then flip and cook 2 minutes more.
7. Rest the pancakes for 2 minutes and serve warm.`;

/* Two comprehensive sample recipes (Shuki+Amit, Aug 25) — each deliberately
   exercises every app capability, and both double as regression fixtures. */
SC.SAMPLES = [
  { key: "baking", label: "Baking · Chocolate Chip Cookies", text: `Chocolate Chip Cookies
Serves 24 · Prep time: 20 min · Cook time: 12 min

Ingredients
2 1/4 cups all-purpose flour
1 tsp baking soda
a pinch of salt
1 cup butter, at room temperature
3/4 cup brown sugar
1/2 cup sugar
2 eggs
2 tsp vanilla extract
2 cups chocolate chips

Instructions
1. Preheat the oven to 190 degrees.
2. Whisk the flour, baking soda and salt in a mixing bowl.
3. Beat 1 cup butter with 3/4 cup brown sugar and 1/2 cup sugar in a mixer until fluffy.
4. Beat in 2 eggs and 2 tsp vanilla extract.
5. Stir the dry mix into the butter mix, then fold in 2 cups chocolate chips.
6. Chill the dough for 30 minutes.
7. Scoop the dough onto a baking sheet, spacing well.
8. Bake for 10 to 12 minutes until golden at the edges.
9. Cool on the baking sheet for 5 minutes and serve.` },
  { key: "cooking", label: "Cooking · Shakshuka", text: `Shakshuka
Serves 4 · Prep time: 10 min · Cook time: 25 min

Ingredients
2 tbsp olive oil
1 onion, diced
3 garlic cloves, minced
1 red bell pepper, chopped
800 g canned tomatoes
2 tsp paprika
1 tsp cumin
a pinch of chili flakes
Salt to taste
6 eggs
100 g feta cheese, crumbled
juice of half a lemon
fresh parsley, chopped

Instructions
1. Heat 2 tbsp olive oil in a large skillet over medium heat.
2. Sauté the onion for 5 minutes until soft, then add the garlic and bell pepper and cook 3 minutes more.
3. Pour in 800 g canned tomatoes, add 2 tsp paprika, 1 tsp cumin and a pinch of chili flakes, and simmer for 10 minutes.
4. While the sauce simmers, crumble 100 g feta cheese.
5. Make six wells in the sauce and crack 6 eggs into them.
6. Cover and cook for 6 to 8 minutes until the egg whites are set.
7. Finish with the feta, juice of half a lemon and fresh parsley, and season with salt to taste.` }
];

/* ---------------- SC.ui ---------------- */
SC.ui = (() => {
  const $ = id => document.getElementById(id);

  const DEFAULT_SERVER = "https://suechef-app.onrender.com"; // Shuki's Render deploy, Sep 2
  let settings = SC.store.get("settings", {
    units: "metric", allergies: [], pantry: [],
    ttsRate: 1, aiKey: "", server: DEFAULT_SERVER
  });
  const hadStaleTools = "tools" in settings;
  delete settings.tools; // ownership tracking removed (owner decision, Aug 26)
  // one-time: pre-fill the kitchen server for installs from before the deploy —
  // only when the field is empty; a value the user typed (or cleared later) wins
  const needServerDefault = !settings.serverDefaulted && !settings.server;
  if (needServerDefault) settings.server = DEFAULT_SERVER;
  settings.serverDefaulted = true;
  let shopping = SC.store.get("shopping", []);
  // migrate pre-provenance items: amounts now tracked per source recipe
  shopping.forEach(it => { if (!it.sources) it.sources = { legacy: it.amount == null ? null : it.amount }; });
  function sumSources(it) {
    const vals = Object.values(it.sources).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  let cookbook = SC.store.get("cookbook", []);
  let current = null;      // recipe being reviewed / cooked
  let servings = 4;
  // Single active timer, wall-clock based (survives screen lock / tab throttle),
  // keeps running across step navigation — only Exit or Stop-alarm ends it.
  let cook = { i: 0, deadline: null, timerStep: null, timerTotal: 0, iv: null, ringing: false, audio: null };

  const saveSettings = () => SC.store.set("settings", settings);
  const saveShopping = () => { SC.store.set("shopping", shopping); renderShopBadge(); };
  const saveCookbook = () => SC.store.set("cookbook", cookbook);
  if (hadStaleTools || needServerDefault) saveSettings(); // persist migrations once

  /* ---- toast ---- */
  let toastT = null;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---- router ---- */
  function show(screen) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $("screen-" + screen).classList.add("active");
    document.querySelectorAll("#nav button").forEach(b =>
      b.setAttribute("aria-current", b.dataset.nav === screen ? "page" : "false"));
    $("nav").classList.toggle("hidden", screen === "cooking");
    window.scrollTo(0, 0);
    if (screen === "cookbook") renderCookbook();
    if (screen === "shopping") renderShopping();
  }

  /* ---- units toggles (all instances stay in sync) ---- */
  function renderUnits() {
    document.querySelectorAll("[data-units-toggle] button").forEach(b =>
      b.setAttribute("aria-pressed", b.dataset.units === settings.units ? "true" : "false"));
    if (current) renderIngredients();
  }

  /* ---- loading sequence ---- */
  const LOADING_MSGS = ["Reading your recipe…", "Extracting ingredients…", "Building your steps…"];
  let loadingBusy = false;
  function runLoading(done) {
    if (loadingBusy) return;
    loadingBusy = true;
    const origDone = done; done = () => { loadingBusy = false; origDone(); };
    const box = $("loading"); box.classList.add("active");
    let i = 0; $("loading-msg").textContent = LOADING_MSGS[0];
    const iv = setInterval(() => {
      i++;
      if (i < LOADING_MSGS.length) $("loading-msg").textContent = LOADING_MSGS[i];
      else { clearInterval(iv); box.classList.remove("active"); done(); }
    }, 750);
  }

  /* ---- Home ---- */
  function onCook() {
    const text = $("paste-input").value.trim();
    if (!text) { toast("Paste a recipe first — or try the sample."); return; }
    if (/^https?:\/\/\S+$/i.test(text)) {
      if (settings.server && settings.server.trim()) importFromUrl(text);
      else toast("Link import needs the recipe server (set its address under Settings → Developer options) — or paste the recipe text.");
      return;
    }
    runLoading(() => {
      const r = SC.parser.parse(text);
      if (!r) { toast("Sue couldn't read that — try pasting the full recipe text."); return; }
      openReview(r);
    });
  }

  /* ---- URL import through the recipe server (FR-1.x, ladder per NFR-5/6) ---- */
  function isoMin(iso) { // "PT1H20M" -> 80, "P1DT2H" -> 1560, "PT1.5H" -> 90
    const m = /^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?)?$/.exec(iso || "");
    if (!m || !(m[1] || m[2] || m[3] || m[4])) return null;
    const min = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + (+m[4] || 0) / 60;
    return min > 0 ? Math.round(min) : null;
  }
  function recipeFromStructured(j) {
    const r = j.recipe || {};
    const name = String(r.name || j.title || "Recipe");
    const ingredients = (r.ingredients || []).map(x => SC.parser.parseIngredientLine(String(x || ""))).filter(Boolean);
    const steps = (r.steps || []).map(s => SC.parser.parseStep(String(s || ""))).filter(s => s.text);
    if (!ingredients.length && !steps.length) return null;
    return {
      id: "r-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40),
      name, author: r.author || j.author || null,
      servings: r.servings || 4, baseServings: r.servings || 4,
      prepMin: isoMin(r.prepTime), cookMin: isoMin(r.cookTime),
      source: j.source || "Link", ingredients, steps, notes: {}
    };
  }
  function serverBase() {
    let b = (settings.server || "").trim().replace(/\/+$/, "");
    if (!b) return null;
    if (!/^https?:\/\//i.test(b)) b = "https://" + b; // typed without a scheme
    return b;
  }
  // mixed content: an https page can't call an http server (browser blocks it silently)
  function serverSchemeProblem(base) {
    return location.protocol === "https:" && /^http:/i.test(base) &&
      !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(base);
  }
  // the claude.ai preview page runs under a CSP that blocks calls to outside
  // servers — link import only works from the installed (Netlify) / standalone app
  function isPreviewPage() { return /claudeusercontent\.com$/i.test(location.hostname); }
  const PREVIEW_MSG = "This preview page can't call outside servers — use the installed app (the Netlify link) for link import.";
  let importBusy = false; // one import at a time — double-taps must not race
  async function importFromUrl(url) {
    if (importBusy) return;
    const base = serverBase();
    if (!base) { toast("Set the recipe-server address first (Settings → Developer options)."); return; }
    if (isPreviewPage()) { toast(PREVIEW_MSG); return; }
    if (serverSchemeProblem(base)) {
      toast("The server address must start with https:// when the app runs over https.");
      return;
    }
    importBusy = true;
    const box = $("loading"); box.classList.add("active");
    const setMsg = (m, sub) => { $("loading-msg").textContent = m; $("loading-sub").textContent = sub || ""; };
    setMsg("Reading the post…", "Sue is fetching your recipe");
    // free-tier servers nap: after a few seconds of silence, say so honestly
    const wakeTimer = setTimeout(() =>
      setMsg("Waking the kitchen up…", "Free server — the first request after a break can take up to a minute"), 4000);
    const midTimer = setTimeout(() => setMsg("Still reading…", "Social pages load slowly — hang on"), 25000);
    const ctrl = new AbortController();
    const hardTimeout = setTimeout(() => ctrl.abort(), 90000);
    try {
      const resp = await fetch(base + "/recipe?url=" + encodeURIComponent(url), { signal: ctrl.signal });
      clearTimeout(wakeTimer); clearTimeout(midTimer);
      const j = await resp.json().catch(() => ({ ok: false, message: "The server answered strangely." }));
      if (!j.ok) throw j;
      setMsg("Extracting ingredients…", "");
      const recipe = j.kind === "structured"
        ? recipeFromStructured(j)
        : SC.parser.parse((j.title && !(j.text || "").startsWith(j.title) ? j.title + "\n\n" : "") + (j.text || ""));
      if (!recipe) throw { message: "Couldn't read a recipe from that page — paste the text instead." };
      if (j.author && !recipe.author) recipe.author = j.author;
      if (!recipe.source || recipe.source === "Pasted text") recipe.source = j.source || "Link";
      setMsg("Building your steps…", "");
      setTimeout(() => { box.classList.remove("active"); openReview(recipe); }, 350);
    } catch (e) {
      clearTimeout(wakeTimer); clearTimeout(midTimer);
      box.classList.remove("active");
      const msg = e && e.name === "AbortError"
        ? "That took too long — the paste-text route always works."
        : (e && e.message) || "Couldn't read that link — paste the recipe text instead.";
      toast(msg); // ladder bottom rung (NFR-6): the pasted-text path is always open
    } finally { clearTimeout(hardTimeout); importBusy = false; }
  }
  /* Settings → Developer options → Test connection: /health with honest wake states */
  async function testServerConnection() {
    // pick up whatever is in the field right now, saved or not
    settings.server = $("st-server").value; saveSettings();
    const st = $("st-server-status"), btn = $("st-server-test");
    const base = serverBase();
    st.className = "server-test-status";
    if (!base) { st.textContent = "Enter an address first."; return; }
    if (isPreviewPage()) { st.className = "server-test-status err"; st.textContent = PREVIEW_MSG; return; }
    if (serverSchemeProblem(base)) {
      st.className = "server-test-status err";
      st.textContent = "Address must start with https:// here."; return;
    }
    btn.disabled = true; st.textContent = "Checking…";
    const wake = setTimeout(() => {
      st.textContent = "Waking it up… free server — give it up to a minute";
    }, 4000);
    const ctrl = new AbortController();
    const hard = setTimeout(() => ctrl.abort(), 75000);
    try {
      const r = await fetch(base + "/health", { signal: ctrl.signal });
      const j = await r.json().catch(() => null);
      if (j && j.ok) { st.className = "server-test-status ok"; st.textContent = "✓ Kitchen is awake"; }
      else { st.className = "server-test-status err"; st.textContent = "Reached it, but it doesn't answer like the recipe server."; }
    } catch (e) {
      st.className = "server-test-status err";
      st.textContent = e.name === "AbortError"
        ? "No answer after a minute — check the address."
        : "Can't reach it — check the address (https:// included).";
    } finally { clearTimeout(wake); clearTimeout(hard); btn.disabled = false; }
  }

  /* ---- Review ---- */
  function openReview(recipe) {
    current = recipe;
    current.swaps = current.swaps || [];
    servings = recipe.servings || 4;
    // FR-4.3: allergies auto-replace while reading, transparently and undoable.
    // Tracked per-allergy so allergies added later re-check saved recipes.
    current.allergyCheckedFor = current.allergyCheckedFor || [];
    settings.allergies.forEach(al => {
      if (current.allergyCheckedFor.includes(al.toLowerCase())) return;
      current.allergyCheckedFor.push(al.toLowerCase());
      current.ingredients.forEach((ing, idx) => {
        if (ing.swapped || current.swaps.some(s => s.idx === idx)) return;
        const p = SC.swaps.proposalForAllergy(ing, idx, al, settings.pantry);
        if (p) {
          const row = { ...p, status: p.to ? "accepted" : "blocked", auto: true };
          current.swaps.push(row);
          if (p.to) applySwap(row, false);
        }
      });
    });
    $("rv-name").textContent = recipe.name;
    const bits = [];
    if (recipe.prepMin) bits.push("Prep " + recipe.prepMin + " min");
    if (recipe.cookMin) bits.push("Cook " + recipe.cookMin + " min");
    $("rv-times").innerHTML = bits.length ? bits.map(b => "<b>" + b + "</b>").join(" · ") : "";
    $("rv-source").textContent = (recipe.source || "") +
      (recipe.author ? " · by " + recipe.author : ""); // credit the creator (FR-1.4)
    $("rv-serv-count").textContent = servings;
    renderIngredients();
    renderSwaps();
    renderEquipment();
    show("review");
  }

  /* ---- swaps (FR-4.x) ---- */
  function applySwap(row, rerender = true) {
    const ing = current.ingredients[row.idx];
    if (!ing) return;
    if (row.type === "remove") {
      ing.removed = true;
    } else if (row.type === "halve") {
      if (ing.amount != null) {
        ing.origAmount = ing.origAmount == null ? ing.amount : ing.origAmount;
        ing.amount = ing.origAmount * 0.5;
      }
      ing.halved = true;
    } else {
      if (ing.swapped) return;
      ing.originalName = ing.originalName || ing.name;
      ing.name = row.to;
      ing.swapped = true;
      if (row.ratio !== 1 && ing.amount != null) {
        ing.origAmount = ing.origAmount == null ? ing.amount : ing.origAmount;
        ing.amount = ing.origAmount * row.ratio;
      }
    }
    row.status = "accepted";
    if (rerender) { renderIngredients(); renderSwaps(); }
  }
  function undoSwap(row) {
    const ing = current.ingredients[row.idx];
    if (ing) {
      if (row.type === "remove") ing.removed = false;
      else if (row.type === "halve") {
        if (ing.origAmount != null) { ing.amount = ing.origAmount; delete ing.origAmount; }
        ing.halved = false;
      } else if (ing.swapped) {
        ing.name = ing.originalName;
        if (ing.origAmount != null) { ing.amount = ing.origAmount; delete ing.origAmount; }
        delete ing.originalName; ing.swapped = false;
      }
    }
    if (row.type) current.swaps.splice(current.swaps.indexOf(row), 1);
    else row.status = "proposed"; // auto (allergy) rows revert too — a protection
                                  // swap must never be one accidental tap from gone
    renderIngredients(); renderSwaps();
  }
  // Free-text change requests (Shuki, Aug 23)
  function handleFreeRequest() {
    const inp = $("rv-request-input");
    const text = inp.value.trim();
    if (!text) return;
    const req = SC.swaps.parseRequest(text);
    if (req.unknown) {
      toast("Sue doesn't know \"" + text + "\" yet — that arrives with the AI engine. Try: keto, paleo, gluten free, no onions, less sugar…");
      return;
    }
    let added = 0;
    // blocked rows must never block the follow-up they themselves suggest
    const rowBlocks = (idx, type) => current.swaps.some(s => s.idx === idx &&
      s.status !== "dismissed" && s.status !== "blocked" && (s.status === "proposed" || s.type === type));
    const clearBlocked = idx => {
      const b = current.swaps.find(s => s.idx === idx && s.status === "blocked");
      if (b) current.swaps.splice(current.swaps.indexOf(b), 1);
    };
    req.diets.forEach(d => {
      const before = added;
      SC.swaps.proposalsForDiet(current.ingredients, d.key, settings.pantry).forEach(p => {
        if (rowBlocks(p.idx)) return;
        current.swaps.push({ ...p, status: "proposed", auto: false, tag: d.label });
        added++;
      });
      // free-text diet requests light the matching chip too (rev-10)
      if (added > before) {
        current.dietsRequested = current.dietsRequested || [];
        if (!current.dietsRequested.includes(d.key)) current.dietsRequested.push(d.key);
      }
      // low-sodium also halves plain salt (the rule library only covers salty products)
      if (d.key === "lowsodium") current.ingredients.forEach((ing, idx) => {
        if (ing.removed || ing.halved || !/\bsalt\b/i.test(ing.name) || rowBlocks(idx, "halve")) return;
        current.swaps.push({ idx, from: ing.name, to: "half the amount", type: "halve",
          ratio: 0.5, note: "season at the end, to taste", status: "proposed", auto: false, tag: d.label });
        added++;
      });
    });
    req.removes.forEach(what => {
      current.ingredients.forEach((ing, idx) => {
        if (ing.removed || !SC.swaps.allergyHit(ing.name, what)) return;
        if (rowBlocks(idx, "remove")) return;
        clearBlocked(idx);
        current.swaps.push({ idx, from: ing.name, to: "remove from recipe", type: "remove",
          ratio: 1, note: "taken out of the ingredient list and the steps", status: "proposed", auto: false });
        added++;
      });
    });
    req.halves.forEach(what => {
      current.ingredients.forEach((ing, idx) => {
        const matches = SC.swaps.allergyHit(ing.name, what) ||
                        (ing.originalName && SC.swaps.allergyHit(ing.originalName, what));
        if (ing.removed || ing.halved || !matches) return;
        if (rowBlocks(idx, "halve")) return;
        current.swaps.push({ idx, from: ing.name, to: "half the amount", type: "halve",
          ratio: 0.5, note: "everywhere — list, steps and shopping", status: "proposed", auto: false });
        added++;
      });
    });
    renderSwaps();
    inp.value = "";
    toast(added ? added + " change" + (added > 1 ? "s" : "") + " proposed — approve below"
                : "Nothing in this recipe matches that request");
  }
  function proposeDiet(dietKey) {
    const props = SC.swaps.proposalsForDiet(current.ingredients, dietKey, settings.pantry);
    let added = 0, suppressed = 0;
    props.forEach(p => {
      if (current.swaps.some(s => s.idx === p.idx && s.status !== "dismissed")) { suppressed++; return; }
      current.swaps.push({ ...p, status: "proposed", auto: false });
      added++;
    });
    // remember the request so the chip shows a pressed state (rev-5 polish) —
    // but only when the diet actually touched something: a press that found
    // nothing must not assert itself forever (rev-10)
    if (added + suppressed > 0) {
      current.dietsRequested = current.dietsRequested || [];
      if (!current.dietsRequested.includes(dietKey)) current.dietsRequested.push(dietKey);
    }
    renderSwaps();
    toast(added ? added + " swap" + (added > 1 ? "s" : "") + " proposed — approve each one below"
        : suppressed ? "Those ingredients already have swaps below — nothing new to add"
        : "Sue found nothing to swap for that diet in this recipe");
  }
  function renderSwaps() {
    const chips = $("rv-diet-chips"); chips.innerHTML = "";
    SC.swaps.DIETS.forEach(d => {
      const c = document.createElement("button");
      c.type = "button"; c.className = "chip"; c.textContent = d.label;
      const on = !!(current.dietsRequested && current.dietsRequested.includes(d.key));
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
      c.addEventListener("click", () => proposeDiet(d.key));
      chips.appendChild(c);
    });
    const ul = $("rv-swaps"); ul.innerHTML = "";
    current.swaps.filter(s => s.status !== "dismissed").forEach(row => {
      const li = document.createElement("li");
      li.className = "swap-row" + (row.status === "accepted" ? " accepted" : "") +
                     (row.status === "blocked" ? " blocked" : "");
      const line = document.createElement("div"); line.className = "swap-line";
      const from = document.createElement("span");
      // strike the old name only when it was actually replaced
      from.className = row.status === "accepted" ? "swap-from" : "swap-keep";
      from.textContent = (row.status === "blocked" ? "⚠ " : "") + row.from;
      line.appendChild(from);
      if (row.to) {
        const ar = document.createElement("span"); ar.className = "swap-arrow"; ar.textContent = "→";
        const to = document.createElement("span"); to.className = "swap-to"; to.textContent = row.to;
        line.append(ar, to);
      }
      if (row.allergy) {
        const tag = document.createElement("span"); tag.className = "swap-tag";
        tag.textContent = "allergy: " + row.allergy;
        line.appendChild(tag);
      } else if (row.tag) {
        const tag = document.createElement("span"); tag.className = "swap-tag diet";
        tag.textContent = row.tag;
        line.appendChild(tag);
      }
      li.appendChild(line);
      // multiple alternatives: pick before you accept (Amit, Aug 25)
      if (row.status === "proposed" && row.alts && row.alts.length > 1) {
        const altRow = document.createElement("div"); altRow.className = "chip-row alt-row";
        row.alts.forEach(a => {
          const c = document.createElement("button");
          c.type = "button";
          c.className = "chip" + (a.to === row.to ? " on" : "");
          c.textContent = a.to;
          c.setAttribute("aria-pressed", a.to === row.to ? "true" : "false");
          c.addEventListener("click", () => { row.to = a.to; row.note = a.note; renderSwaps(); renderIngredients(); });
          altRow.appendChild(c);
        });
        li.appendChild(altRow);
      }
      if (row.note) {
        const note = document.createElement("div"); note.className = "swap-note"; note.textContent = row.note;
        li.appendChild(note);
      }
      const acts = document.createElement("div"); acts.className = "swap-actions";
      const dismiss = () => { // fully remove — dead rows shouldn't pile up in the cookbook
        current.swaps.splice(current.swaps.indexOf(row), 1); renderSwaps();
      };
      if (row.status === "proposed") {
        const ok = document.createElement("button");
        ok.type = "button"; ok.className = "btn btn-secondary"; ok.textContent = "Accept";
        ok.addEventListener("click", () => applySwap(row));
        const no = document.createElement("button");
        no.type = "button"; no.className = "btn btn-ghost"; no.textContent = "Dismiss";
        no.addEventListener("click", dismiss);
        acts.append(ok, no);
      } else if (row.status === "blocked") {
        const no = document.createElement("button");
        no.type = "button"; no.className = "btn btn-ghost"; no.textContent = "Dismiss";
        no.addEventListener("click", dismiss);
        acts.appendChild(no);
      } else if (row.status === "accepted") {
        const un = document.createElement("button");
        un.type = "button"; un.className = "btn btn-ghost"; un.textContent = "Undo";
        un.addEventListener("click", () => undoSwap(row));
        acts.appendChild(un);
      }
      if (acts.children.length) li.appendChild(acts);
      ul.appendChild(li);
    });
  }

  function factor() { return servings / (current.baseServings || servings || 1); }

  function findShopTwin(ing) {
    // match on the STABLE identity (pre-swap name) so accepting a swap after
    // adding to the list never orphans or double-counts the row
    const base = (ing.originalName || ing.name).toLowerCase();
    const same = it =>
      (it.baseName || it.name).toLowerCase() === base || it.name.toLowerCase() === ing.name.toLowerCase();
    // exact-unit twin first (also the only merge for countables/naturals/spoons)
    const exact = shopping.find(it => same(it) && it.unit === ing.unit);
    if (exact) return exact;
    // cross-unit twin: both sides must reduce to the SAME metric base (g or ml)
    if (ing.amount == null || ing.countable || ing.natural || ing.juiceOf) return null;
    const mine = SC.units.metricBase(ing.unit, ing.name);
    if (!mine) return null;
    return shopping.find(it => {
      if (!same(it) || it.countable || it.natural || it.juiceOf || it.amount == null) return false;
      const theirs = SC.units.metricBase(it.unit, it.name);
      return !!theirs && theirs.u === mine.u;
    }) || null;
  }
  // When a cross-unit merge happens, canonicalize the row to its metric base
  // (g/ml) — every stored per-recipe amount is rescaled — and return a
  // converter for the incoming contribution. Same-unit merges pass through.
  function harmonizeShopUnits(twin, ing) {
    if (twin.unit === ing.unit) return a => a;
    const mine = SC.units.metricBase(ing.unit, ing.name);
    const theirs = SC.units.metricBase(twin.unit, twin.name);
    if (twin.unit !== theirs.u) {
      for (const k in twin.sources) if (twin.sources[k] != null) twin.sources[k] *= theirs.f;
      twin.unit = theirs.u; twin.rawAmount = null;
    }
    return a => a == null ? null : a * mine.f;
  }
  function claimLegacy(twin) { // first recipe to touch a pre-migration row absorbs its amount
    if (twin && "legacy" in twin.sources) delete twin.sources.legacy;
  }
  // Sources are keyed per recipe AND ingredient ("rid:idx") — rev-10: with
  // cross-unit merging, two same-name ingredients of ONE recipe (1 cup milk +
  // 100 ml milk) can share a row; a plain recipe-id key made them overwrite
  // each other. Plain-id keys from older rows are migrated on next touch.
  function recipeHasSource(twin) {
    const rid = current.id;
    return Object.keys(twin.sources).some(k => k === rid || k.indexOf(rid + ":") === 0);
  }
  function inShopping(ing, idx) { // "in the cart" = THIS recipe contributed it
    const twin = findShopTwin(ing);
    if (!twin || !current) return false;
    return (current.id + ":" + idx) in twin.sources || current.id in twin.sources;
  }
  function toggleShoppingItem(ing, idx) {
    const skey = current.id + ":" + idx;
    const twin = findShopTwin(ing);
    const legacy = twin && (current.id in twin.sources);
    if (twin && (skey in twin.sources || legacy)) {
      // remove only this contribution — other recipes' amounts survive
      delete twin.sources[skey];
      if (legacy) delete twin.sources[current.id]; // pre-composite lump goes with it
      if (!Object.keys(twin.sources).length) shopping.splice(shopping.indexOf(twin), 1);
      else twin.amount = sumSources(twin);
      toast(ing.name + " removed from shopping");
    } else {
      const amt = ing.amount == null ? null : ing.amount * factor();
      if (twin) {
        claimLegacy(twin);
        const conv = harmonizeShopUnits(twin, ing);
        twin.sources[skey] = conv(amt); twin.amount = sumSources(twin); twin.checked = false;
        twin.name = ing.name; twin.baseName = ing.originalName || ing.name; // follow swaps
      }
      else shopping.push({ name: ing.name, baseName: ing.originalName || ing.name, unit: ing.unit,
        amount: amt, sources: { [skey]: amt },
        rawAmount: ing.rawAmount, countable: ing.countable, natural: ing.natural,
        juiceOf: ing.juiceOf || null, checked: false });
      toast(ing.name + " added to shopping");
    }
    saveShopping(); renderIngredients();
  }
  function proposeSingleSwap(ing, idx) {
    if (current.swaps.some(s => s.idx === idx && s.status !== "dismissed" && s.status !== "blocked")) {
      toast("There's already a swap for " + ing.name + " below"); return;
    }
    const p = SC.swaps.proposalForIngredient(ing, idx, settings.pantry);
    if (!p) { toast("Sue doesn't know a swap for " + ing.name + " yet"); return; }
    current.swaps.push({ ...p, status: "proposed", auto: false });
    renderSwaps();
    toast("Swap proposed below — approve it there");
  }
  function renderIngredients() {
    const ul = $("rv-ings"); ul.innerHTML = "";
    const f = factor();
    current.ingredients.forEach((ing, idx) => {
      const li = document.createElement("li");
      const main = document.createElement("div"); main.className = "ing-main";
      if (ing.removed) li.classList.add("removed");
      const amt = document.createElement("span");
      amt.className = "ing-amt";
      amt.textContent = ing.removed ? "—" : SC.units.displayAmount(ing, f, settings.units);
      const body = document.createElement("span");
      const nm = document.createElement("span");
      nm.className = "ing-name"; nm.textContent = SC.units.displayName(ing, f);
      body.appendChild(nm);
      if (ing.prep) {
        const pr = document.createElement("span");
        pr.className = "ing-prep"; pr.textContent = " · " + ing.prep;
        body.appendChild(pr);
      }
      if (ing.swapped) {
        const bd = document.createElement("span");
        bd.className = "badge badge-swap";
        bd.textContent = "was " + (ing.originalName || "?"); // visible on touch (DP-4)
        body.appendChild(document.createTextNode(" ")); body.appendChild(bd);
      } else {
        const hit = settings.allergies.find(a => SC.swaps.allergyHit(ing.name, a));
        if (hit) {
          const bd = document.createElement("span");
          bd.className = "badge badge-allergy"; bd.textContent = "allergy";
          body.appendChild(document.createTextNode(" ")); body.appendChild(bd);
        }
      }
      // per-row actions: swap + cart (Shuki, Aug 23)
      const acts = document.createElement("span");
      acts.className = "ing-actions";
      if (!ing.removed) {
        const sw = document.createElement("button");
        sw.type = "button"; sw.className = "ing-act";
        sw.setAttribute("aria-label", "Suggest a swap for " + ing.name);
        sw.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h13m0 0-3.5-3.5M17 7l-3.5 3.5M20 17H7m0 0 3.5-3.5M7 17l3.5 3.5"/></svg>';
        sw.addEventListener("click", () => proposeSingleSwap(ing, idx));
        const inCart = inShopping(ing, idx);
        const ct = document.createElement("button");
        ct.type = "button"; ct.className = "ing-act" + (inCart ? " on" : "");
        ct.setAttribute("aria-label", (inCart ? "Remove " : "Add ") + ing.name + (inCart ? " from" : " to") + " the shopping list");
        ct.setAttribute("aria-pressed", inCart ? "true" : "false");
        ct.innerHTML = inCart
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.8h-9A2 2 0 0 1 5.5 18zM8 7a4 4 0 0 1 8 0M9 13l2 2 4-4"/></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.8h-9A2 2 0 0 1 5.5 18zM8 7a4 4 0 0 1 8 0M12 11v5m-2.5-2.5h5"/></svg>';
        ct.addEventListener("click", () => toggleShoppingItem(ing, idx));
        acts.append(sw, ct);
      }
      main.appendChild(amt); main.appendChild(body); main.appendChild(acts);
      li.appendChild(main);
      // Amit's inline swap toggle: the row itself flips between original and
      // replacement once a (non-remove/halve) swap exists for this ingredient
      const swapRow = current.swaps.find(s => s.idx === idx && !s.type &&
        s.status !== "dismissed" && s.status !== "blocked");
      if (swapRow && !ing.removed) {
        const tog = document.createElement("div"); tog.className = "ing-toggle";
        const mk = (label, active, onTap) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "ing-pill" + (active ? " on" : "");
          b.textContent = label;
          b.setAttribute("aria-pressed", active ? "true" : "false");
          if (!active) b.addEventListener("click", onTap);
          return b;
        };
        const accepted = swapRow.status === "accepted";
        tog.appendChild(mk(swapRow.from, !accepted, () => undoSwap(swapRow)));
        tog.appendChild(mk(swapRow.to, accepted, () => applySwap(swapRow)));
        li.appendChild(tog);
      }
      ul.appendChild(li);
    });
  }

  function recipeTools() {
    const set = new Set();
    (current ? current.steps : []).forEach(s => s.tools.forEach(t => set.add(t)));
    return [...set];
  }
  function renderEquipment() {
    // Plain informational list — the app never guesses what the user owns
    // (owner decision, Aug 26; replaces the FR-4.6 ownership checklist)
    const ul = $("rv-equip"); ul.innerHTML = "";
    const tools = recipeTools();
    $("rv-equip-card").style.display = tools.length ? "" : "none";
    tools.forEach(t => {
      const li = document.createElement("li");
      const mark = document.createElement("span");
      mark.className = "equip-ok"; mark.textContent = "•";
      const label = document.createElement("span");
      label.textContent = t;
      li.append(mark, label);
      const alt = SC.swaps.toolAlternative(t);
      if (alt) {
        const hint = document.createElement("span");
        hint.className = "equip-hint"; hint.textContent = "— or " + alt;
        li.appendChild(hint);
      }
      ul.appendChild(li);
    });
  }

  function addToShopping() {
    const f = factor(), key = current.id;
    let touched = 0;
    current.ingredients.forEach((ing, idx) => {
      if (ing.removed) return;
      // per-source amounts (FR-6.2): re-adding the SAME recipe updates its
      // contribution instead of double-counting; other recipes aggregate on top
      const skey = key + ":" + idx;
      const amt = ing.amount == null ? null : ing.amount * f;
      const twin = findShopTwin(ing);
      if (twin) {
        claimLegacy(twin);
        if (key in twin.sources) { delete twin.sources[key]; touched++; } // migrate pre-composite lump
        const conv = harmonizeShopUnits(twin, ing), cAmt = conv(amt);
        if (twin.sources[skey] !== cAmt || twin.name !== ing.name) {
          twin.sources[skey] = cAmt; twin.amount = sumSources(twin); twin.checked = false;
          twin.name = ing.name; twin.baseName = ing.originalName || ing.name;
          touched++;
        }
      } else {
        shopping.push({ name: ing.name, baseName: ing.originalName || ing.name, unit: ing.unit,
          amount: amt, sources: { [skey]: amt },
          rawAmount: ing.rawAmount, countable: ing.countable, natural: ing.natural,
          juiceOf: ing.juiceOf || null, checked: false });
        touched++;
      }
    });
    saveShopping(); renderIngredients();
    toast(touched ? touched + " ingredients on your shopping list" : "Already on your list");
  }

  function saveToCookbook() {
    const copy = JSON.parse(JSON.stringify(current));
    copy.servings = servings;
    const at = cookbook.findIndex(r => r.id === copy.id);
    if (at > -1) cookbook[at] = copy; else cookbook.unshift(copy);
    saveCookbook();
    toast("Saved to your cookbook");
  }

  /* ---- Cooking: mise-en-place plan + voice + conversational pacing (Sprint 4) ---- */
  function currentItem() { return cook.items ? cook.items[cook.i] : null; }
  function itemText(it) {
    if (!it) return "";
    return it.kind === "mise" ? it.text
         : SC.units.displayStepText(it.step, current.ingredients, factor(), settings.units);
  }
  function startCooking() {
    if (!current || !current.steps.length) { toast("No steps found in this recipe."); return; }
    killTimer();
    // the full plan feeds the overview + the on-demand prep sheet; the WALK is
    // recipe steps only — mise is optional viewing, never read aloud (tester, Sep 1)
    cook.plan = SC.planner.buildPlan(current, factor(), settings.units);
    cook.items = cook.plan.filter(it => it.kind !== "mise");
    cook.i = 0; cook.mode = "overview"; cook.checkins = 0; cook.lastActivity = Date.now();
    $("ck-done").hidden = true;
    show("cooking");
    renderOverview();
    initVoiceOnce();
    if (!cook.pacing) cook.pacing = setInterval(paceTick, 5000);
    voiceSay("Here's the plan. Say ready, or tap the button, and we'll start cooking.");
  }
  function renderOverview() {
    cook.mode = "overview";
    $("ck-body").hidden = true; $("ck-nav").hidden = true; $("ck-overview").hidden = false;
    // one-time voice-quality tip (tester, Sep 1: "the voice is very robotic") —
    // the picker has existed since night 4; people just never found it
    $("ck-voice-tip").hidden = !!settings.voiceTipSeen || SC.voice.isNativeTTS() || !SC.voice.ttsAvailable();
    $("ck-progress").textContent = current.name;
    const box = $("ck-plan-list"); box.innerHTML = "";
    let lastGroup = null;
    cook.plan.forEach(it => {
      const group = it.passive ? "Start now — it takes the longest"
                  : it.kind === "mise" ? "Mise en place" : "Cooking";
      if (group !== lastGroup) {
        const h = document.createElement("div"); h.className = "eyebrow plan-head";
        h.textContent = group;
        box.appendChild(h); lastGroup = group;
      }
      const row = document.createElement("div"); row.className = "plan-row";
      row.textContent = itemText(it);
      box.appendChild(row);
    });
  }
  function beginWalk() {
    cook.mode = "walk"; cook.i = 0;
    cook.lastActivity = Date.now(); cook.checkins = 0;
    $("ck-overview").hidden = true; $("ck-body").hidden = false; $("ck-nav").hidden = false;
    const mise = cook.plan.filter(x => x.kind === "mise");
    $("ck-prep-btn").hidden = !mise.length;
    renderStep(); speakCurrent();
  }
  // On-demand prep sheet — the mise list, for eyes only (never read aloud)
  function togglePrepSheet(open) {
    const sheet = $("ck-prep");
    if (open) {
      const box = $("ck-prep-items"); box.innerHTML = "";
      cook.plan.filter(x => x.kind === "mise").forEach(it => {
        const row = document.createElement("div"); row.className = "plan-row";
        row.textContent = it.text;
        box.appendChild(row);
      });
      sheet.hidden = false; $("ck-body").hidden = true; $("ck-nav").hidden = true;
    } else {
      sheet.hidden = true;
      if (cook.mode === "walk") { $("ck-body").hidden = false; $("ck-nav").hidden = false; }
    }
  }
  function fmt(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }
  function timeLeft() {
    return cook.deadline == null ? 0 : Math.max(0, Math.ceil((cook.deadline - Date.now()) / 1000));
  }
  function renderStep() {
    const it = currentItem();
    if (!it) return;
    // position within kind — plan order is now: passive-first steps, mise, steps
    const miseTotal = cook.items.filter(x => x.kind === "mise").length;
    const before = cook.items.slice(0, cook.i + 1).filter(x => x.kind === it.kind).length;
    $("ck-progress").textContent = it.kind === "mise"
      ? "Prep " + before + " of " + miseTotal
      : "Step " + before + " of " + (cook.items.length - miseTotal);
    const ph = $("ck-phase");
    ph.textContent = it.kind === "mise" ? "Mise en place" : (it.phase === "prep" ? "Get ready" : "Cook");
    ph.className = "eyebrow " + (it.kind === "mise" || it.phase === "prep" ? "prep" : "cook");
    $("ck-text").textContent = itemText(it);
    const tc = $("ck-timer");
    const tm = it.step ? it.step.timerMin : null;
    const runningHere = cook.timerStep === cook.i && cook.deadline != null;
    if (tm || runningHere) {
      tc.hidden = false;
      $("ck-timer-label").textContent = (tm || Math.round(cook.timerTotal / 60)) + " minute timer";
      $("ck-timer-time").textContent = runningHere ? fmt(timeLeft()) : fmt((tm || 0) * 60);
      $("ck-timer-start").hidden = runningHere;
      $("ck-timer-stop").hidden = !(runningHere && cook.ringing);
      tc.classList.toggle("ringing", runningHere && cook.ringing);
    } else tc.hidden = true;
    drawPill();
    // per-step personal notes (FR-5.5) — on real steps only, keyed to the original step
    const isStep = it.kind === "step";
    const note = isStep ? (current.notes || {})[it.stepIndex] : null;
    $("ck-note-box").hidden = !note;
    if (note) $("ck-note-text").textContent = note;
    $("ck-note-btn").parentElement.hidden = !isStep;
    $("ck-note-btn").textContent = note ? "✎ Edit note" : "✎ Note";
    $("ck-note-edit").hidden = true;
    $("ck-back").disabled = cook.i === 0;
    $("ck-next").textContent = cook.i === cook.items.length - 1 ? "Finish" : "Next";
  }
  function saveNoteText(text) { // shared by the ✎ editor and the voice "add a note" flow
    const it = currentItem();
    if (!it || it.kind !== "step") return false;
    current.notes = current.notes || {};
    if (text) current.notes[it.stepIndex] = text; else delete current.notes[it.stepIndex];
    // keep the cookbook copy in sync so the note is there next time (FR-5.5)
    const saved = cookbook.find(r => r.id === current.id);
    if (saved) { saved.notes = { ...current.notes }; saveCookbook(); }
    renderStep();
    toast(text ? (saved ? "Note saved — it'll be here next time" : "Note saved — save the recipe to keep it for next time")
               : "Note removed");
    return true;
  }
  function saveStepNote() { saveNoteText($("ck-note-input").value.trim()); }
  /* ---- voice layer ---- */
  function showBubble(who, text) {
    $("ck-bubble").hidden = false;
    const w = $("ck-bubble").querySelector(".who");
    w.textContent = who;
    $("ck-bubble-text").textContent = text;
  }
  function voiceSay(text, onDone) {
    if (!SC.voice.ttsAvailable()) { onDone && onDone(); return; }
    showBubble("Sue", text);
    SC.voice.speak(text, settings.ttsRate || 1, onDone);
  }
  function speakCurrent() {
    const it = currentItem();
    if (!it) return;
    voiceSay(itemText(it));
  }
  function initVoiceOnce() {
    if (cook.voiceInit) { if (SC.voice.getState() !== "denied") SC.voice.start(); return; }
    cook.voiceInit = true;
    const ok = SC.voice.init(handleVoiceCommand, renderMicState);
    if (ok) SC.voice.start(); else renderMicState("unsupported");
  }
  function renderMicState(state) {
    const btn = $("ck-mic");
    const labels = {
      listening: ["●", "Listening — tap to mute", false],
      muted: ["○", "Muted — tap to listen", false],
      denied: ["✕", "Mic blocked here — buttons work", true],
      unsupported: ["✕", "Voice input not supported here — buttons work", true],
      off: ["○", "Tap to listen", false]
    };
    const [glyph, label, disabled] = labels[state] || labels.off;
    btn.textContent = glyph + " mic";
    btn.setAttribute("aria-label", label);
    btn.classList.toggle("live", state === "listening");
    btn.classList.toggle("dead", disabled);
    // sticky note — a bubble message would be overwritten by the next step readout
    $("ck-mic-note").hidden = !(state === "denied" || state === "unsupported");
  }
  function handleVoiceCommand(raw) {
    if (cook.mode === "off" || cook.mode === "done") return; // cooking is over — stay silent
    const t = raw.toLowerCase();
    showBubble("You", raw);
    cook.lastActivity = Date.now(); cook.checkins = 0;
    if (cook.mode === "overview") {
      if (/\b(ready|start|yes|let's go|begin)\b/.test(t)) beginWalk();
      return;
    }
    // voice-note capture mode: the next thing said IS the note (tester, Aug 26)
    if (cook.noteCapture) {
      cook.noteCapture = false;
      clearTimeout(cook.noteTimer);
      if (/^(cancel|never mind|nevermind|forget it)\.?$/.test(t)) voiceSay("Cancelled.");
      else if (saveNoteText(raw)) voiceSay("Saved: " + raw);
      else voiceSay("We're not on a cooking step right now — the note wasn't saved.");
      return;
    }
    if (/\b(add|take|make) a note\b|\bnote to self\b/.test(t)) {
      const it = currentItem();
      if (cook.mode !== "walk" || !it || it.kind !== "step") {
        voiceSay("Notes attach to cooking steps — try again during a step."); return;
      }
      cook.noteCapture = true;
      clearTimeout(cook.noteTimer);
      cook.noteTimer = setTimeout(() => {
        if (cook.noteCapture) { cook.noteCapture = false; voiceSay("I didn't catch a note — say add a note to try again."); }
      }, 30000);
      voiceSay("Go ahead — I'm listening.");
      return;
    }
    if (/\bread my note\b|\bwhat'?s my note\b/.test(t)) {
      const it = currentItem();
      const note = it && it.kind === "step" ? (current.notes || {})[it.stepIndex] : null;
      voiceSay(note ? "Your note: " + note : "No note on this step yet.");
      return;
    }
    // questions and specific commands FIRST — "yes but how much flour" must answer, not advance
    // timer questions win whenever a timer exists, even without the word "timer"
    // ("how much is left", "how much longer", "are we out of time")
    const timerish = /timer/.test(t) || (cook.deadline != null && /\b(time|left|longer)\b/.test(t));
    if (timerish && /\b(done|left|status|long|longer|much|time|finished|over)\b/.test(t)) { answerTimerStatus(); return; }
    // "how much X" / "what's the amount of X" — and "how much time" when no
    // ingredient matches must answer about the TIMER, never "I don't see that
    // in the ingredients" (tester, Sep 1: answers felt inconsistent)
    const hm = t.match(/how (?:much|many)\s+(.+?)(?:\?|$)/)
            || t.match(/(?:amount|quantity) of\s+(.+?)(?:\?|$)/);
    if (hm) {
      if (findIngredientInPhrase(hm[1]) < 0 && /\b(time|minutes?|longer|left)\b/.test(hm[1])) answerTimerStatus();
      else answerHowMuch(hm[1]);
      return;
    }
    const dh = t.match(/(?:don'?t have|do not have|out of|ran out of)\s+(?:any\s+)?(.+?)(?:\s+left)?(?:\?|$)/);
    if (dh) {
      // a precise staple pattern ("baking powder") beats fuzzy recipe matching —
      // otherwise it cross-matches the recipe's baking SODA
      if (STAPLE_SUBS.some(([re]) => re.test(dh[1]))) answerDontHave(dh[1]);
      else if (findIngredientInPhrase(dh[1]) >= 0) answerSubstitute(dh[1]);
      else answerDontHave(dh[1]);
      return;
    }
    const sb = t.match(/\b(?:substitute|swap|replace)\s+(?:the\s+)?(.+?)(?:\?|$)/);
    if (sb) { answerSubstitute(sb[1]); return; }
    if (/\b(repeat|again|what was that)\b/.test(t)) { speakCurrent(); return; }
    if (/\b(back|previous)\b/.test(t)) { prevStep(); return; }
    if (/\b(stop|quiet|silence|okay|ok)\b/.test(t) && cook.ringing) { dismissAlarm(); return; }
    if (/\bstart (?:the )?timer\b/.test(t)) { startTimer(); return; }
    // comprehension questions ("room temperature or cold eggs?") before any advance word
    if (/^(what|when|why|does|do|should|can|is|are|which|how)\b/.test(t) ||
        (/\bor\b/.test(t) && t.split(" ").length >= 3)) { answerRecipeQuestion(t); return; }
    if (/\b(next|done|ready|continue|go on|finished|yes|yeah|yep)\b/.test(t)) { advance(); return; }
    // anything else: stay quiet — patient waiting is the default (4.5.1)
  }
  // Natural phrasing survives: "…how much salt we need in that step" must find "salt".
  // Scan the phrase word-by-word against ingredient names, best match wins.
  // Recognition mishears: common kitchen homophones mapped back before matching
  const HOMOPHONE = { flower: "flour", flowers: "flour", cellery: "celery",
    stake: "steak", carats: "carrots", currents: "currants", bazil: "basil" };
  function findIngredientInPhrase(phrase) {
    const words = phrase.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)
      .map(w => HOMOPHONE[w] || w)
      .filter(w => w.length > 2 && !QSTOP.has(w) && !["for","the","that","step","need","some"].includes(w));
    let best = -1, bestScore = 0;
    current.ingredients.forEach((x, i) => {
      if (x.removed) return;
      const names = [x.name, x.originalName].filter(Boolean);
      const score = words.filter(w => names.some(n => SC.swaps.allergyHit(n, w))).length;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best >= 0 ? best : -1;
  }
  function answerHowMuch(what) {
    const f = factor();
    const idx = findIngredientInPhrase(what);
    if (idx >= 0) {
      const ing = current.ingredients[idx];
      const disp = SC.units.displayAmount(ing, f, settings.units);
      const name = SC.units.displayName(ing, f);
      const amount = ing.countable ? disp + " " + name          // "2 eggs", never "2 of eggs"
                   : ing.juiceOf ? name                          // "juice of half a lemon"
                   : disp === "to taste" ? name + ", to taste"   // never "to taste of Salt"
                   : ing.natural ? disp + " of " + name          // "a pinch of salt"
                   : (disp ? disp + " of " : "") + name;
      voiceSay(amount + (ing.prep ? ", " + ing.prep : "") + ".");
    } else voiceSay("I don't see that in this recipe's ingredients.");
  }
  function answerSubstitute(what) {
    const cleaned = what.replace(/^for\s+/, "").trim();
    const idx = findIngredientInPhrase(cleaned);
    if (idx < 0) { answerDontHave(cleaned); return; } // maybe a staple not in the recipe
    const p = SC.swaps.proposalForIngredient(current.ingredients[idx], idx, settings.pantry);
    if (p) voiceSay("Instead of " + p.from + ", use " + p.to + ". " + (p.note || ""));
    else answerDontHave(current.ingredients[idx].name);
  }
  // "I don't have X" — pantry-staple fixes for things with no swap rule (Shuki, Aug 26)
  const STAPLE_SUBS = [
    [/baking powder/, "Per teaspoon of baking powder: a quarter teaspoon of baking soda plus half a teaspoon of lemon juice or cream of tartar."],
    [/baking soda/, "Use three times the amount of baking powder and cut back a little on salt."],
    [/buttermilk/, "Per cup: regular milk plus a tablespoon of lemon juice or vinegar — stir and rest five minutes."],
    [/brown sugar/, "Per cup: white sugar plus a tablespoon of molasses, or just white sugar in a pinch."],
    [/sour cream/, "Plain yogurt, one to one."],
    [/tomato paste/, "Reduce tomato sauce by simmering — three tablespoons of sauce make one of paste."],
    [/cake flour/, "Per cup: all-purpose flour minus two tablespoons, plus two tablespoons of cornstarch."],
    [/cream of tartar/, "Per half teaspoon: a teaspoon of lemon juice or white vinegar."],
    [/vanilla/, "Maple syrup one-to-one, or just skip it — the recipe will survive."],
    [/powdered sugar|icing sugar/, "Blend white sugar until fine — one cup makes about one cup."],
    [/cornstarch/, "Twice the amount of all-purpose flour, mixed into cold liquid first."],
    [/fresh (basil|parsley|oregano|thyme|herbs)/, "Dried herbs work — use a third of the amount."],
    [/breadcrumbs|panko/, "Crushed crackers, cornflakes, or toasted blended bread."],
    [/honey/, "Maple syrup or sugar syrup, one to one."]
  ];
  function answerDontHave(what) {
    const w = what.toLowerCase();
    for (const [re, fix] of STAPLE_SUBS) if (re.test(w)) { voiceSay(fix); return; }
    const th = SC.swaps.toolHintFor(w); // "I don't have a mixer" — tools count too
    if (th) { voiceSay("No " + th.tool + "? " + th.alt + " will do."); return; }
    voiceSay("I don't have a good substitute for " + what + " in my book yet — the installed app will know.");
  }
  function answerTimerStatus() {
    if (cook.ringing) { voiceSay("The timer is done — say okay to silence it."); return; }
    if (cook.deadline != null) {
      const left = timeLeft(), m = Math.floor(left / 60), s = left % 60;
      voiceSay((m ? m + " minute" + (m > 1 ? "s" : "") + (s ? " and " : "") : "") +
               (s || !m ? s + " seconds" : "") + " left on the timer.");
      return;
    }
    voiceSay("No timer is running right now.");
  }
  /* ---- recipe-comprehension Q&A v1 (Amit, Aug 25) — rule-based interim.
     Order of honesty: quote the recipe itself → small curated kitchen knowledge
     → admit we don't know. The full free-form brain is the AI-engine phase. ---- */
  const QSTOP = new Set(["the","and","for","with","this","that","what","when","why","does",
    "should","can","are","you","use","need","recipe","say","says","tell","about","how","much",
    "many","which","them","have","has","from","into","will","want"]);
  const KB = [
    { re:/egg.*(room temperature|cold)|(room temperature|cold).*egg/, a:"The recipe doesn't specify. For baking, room-temperature eggs blend more evenly and whip fuller. Straight from the fridge is fine for frying or boiling." },
    { re:/butter.*(soften|soft|melt|room temperature)|(soften|melt).*butter/, a:"Softened butter creams with sugar and traps air for lift. Melted butter makes things denser and chewier. Use whichever the recipe calls for." },
    { re:/(chill|rest).*(dough|batter)|why.*(chill|rest)/, a:"Chilling or resting lets the flour hydrate and the fat firm up — the result spreads less and tastes deeper." },
    { re:/preheat|oven.*(ready|hot)/, a:"Start the oven first — it usually needs 10 to 15 minutes to reach temperature." },
    { re:/simmer.*boil|boil.*simmer/, a:"A simmer is small gentle bubbles. A boil is big rolling bubbles. Most sauces want a simmer." }
  ];
  function answerRecipeQuestion(q) {
    const words = q.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)
      .filter(w => w.length > 2 && !QSTOP.has(w));
    // words in the question that name an actual ingredient — a quoted answer
    // must mention them, or "cold eggs?" gets answered with butter facts
    const ingWords = words.filter(w =>
      current.ingredients.some(x => !x.removed && SC.swaps.allergyHit(x.name, w)));
    const sentences = [];
    current.steps.forEach(s => s.text.split(/(?<=\.)\s+/).forEach(x => { if (x.trim()) sentences.push(x.trim()); }));
    current.ingredients.forEach(i => {
      if (i.prep && !i.removed) sentences.push(SC.units.displayName(i, factor()) + " — " + i.prep);
    });
    let best = null, bestN = 0;
    for (const s of sentences) {
      const sl = s.toLowerCase();
      if (ingWords.length && !ingWords.some(w => sl.includes(w))) continue;
      const n = words.filter(w => sl.includes(w)).length;
      if (n > bestN) { bestN = n; best = s; }
    }
    if (best && bestN >= 2) { voiceSay("The recipe says: " + best); return; }
    for (const k of KB) if (k.re.test(q.toLowerCase())) { voiceSay(k.a); return; }
    if (best && bestN >= 1) { voiceSay("The recipe says: " + best); return; }
    voiceSay("The recipe doesn't say, and I'd rather not guess. Questions like that get much smarter in the installed app.");
  }

  /* ---- conversational pacing (4.5.1): never advance alone, gentle check-ins ---- */
  function paceTick() {
    if (cook.mode !== "walk") return;
    if (cook.deadline != null) return;                    // running OR ringing timer: wait quietly
    if (SC.voice.getState() !== "listening") return;      // check-ins only make sense with voice
    const silent = (Date.now() - cook.lastActivity) / 1000;
    if (silent >= 240 && cook.checkins === 1) {
      cook.checkins = 2; voiceSay("Take your time — say next when you're ready.");
    } else if (silent >= 120 && cook.checkins === 0) {
      cook.checkins = 1; voiceSay("Are you still there?");
    }
  }
  function drawPill() {
    const pill = $("ck-pill");
    const runningElsewhere = cook.deadline != null && cook.timerStep !== cook.i && !$("ck-body").hidden;
    pill.hidden = !runningElsewhere;
    if (runningElsewhere) {
      // label with position-within-steps, matching the progress header
      const n = cook.items.slice(0, cook.timerStep + 1).filter(x => x.kind === "step").length;
      pill.textContent = "⏱ " + fmt(timeLeft()) + " · step " + n;
      pill.classList.toggle("ringing", cook.ringing);
    }
  }
  function startTimer() {
    const it = currentItem();
    const tm = it && it.step ? it.step.timerMin : null;
    if (!tm) return;
    // Only ONE timer runs at a time (design decision, spec 4.4) — but replacing
    // a live one silently loses it. Arm-confirm: first ask, second within 8s
    // replaces (rev-5 polish; true multi-timer is a native-phase idea).
    if (cook.deadline != null && !cook.ringing && cook.timerStep !== cook.i) {
      // Confirm must belong to THIS step, and the 8s window restarts when Sue
      // FINISHES asking — her ask sentence takes ~8s itself, so a voice-only
      // user's confirm always lands after it (rev-10).
      const armed = cook.timerReplaceArm && cook.timerReplaceArmStep === cook.i &&
                    Date.now() - cook.timerReplaceArm < 8000;
      if (!armed) {
        const st = cook.i;
        cook.timerReplaceArmStep = st;
        cook.timerReplaceArm = Date.now();
        const n = cook.items.slice(0, cook.timerStep + 1).filter(x => x.kind === "step").length;
        const left = Math.max(1, Math.ceil(timeLeft() / 60));
        voiceSay("A timer is already running for step " + n + " with about " + left +
          (left > 1 ? " minutes" : " minute") + " left. Say start timer again, or tap it again, to replace it.",
          () => { if (cook.timerReplaceArm && cook.timerReplaceArmStep === st) cook.timerReplaceArm = Date.now(); });
        return;
      }
      cook.timerReplaceArm = 0; cook.timerReplaceArmStep = null; // confirmed — fall through and replace
    }
    cook.deadline = Date.now() + tm * 60000;
    cook.timerTotal = tm * 60;
    cook.timerStep = cook.i;
    cook.ringing = false;
    cook.lastActivity = Date.now(); cook.checkins = 0;
    if (!cook.iv) cook.iv = setInterval(tick, 500);
    renderStep();
    voiceSay(tm + " minute timer started. We can keep going in the meantime — say next, or ask me anything.");
  }
  function tick() {
    if (cook.deadline == null) return;
    const left = timeLeft();
    if (cook.timerStep === cook.i) $("ck-timer-time").textContent = fmt(left);
    drawPill();
    if (left <= 0 && !cook.ringing) {
      cook.ringing = true;
      beepLoop();
      if (cook.timerStep === cook.i) renderStep(); else drawPill();
    }
  }
  function beepLoop() {
    if (!cook.ringing) return;
    try {
      if (!cook.audio) cook.audio = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = cook.audio, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.55);
    } catch (e) { /* audio unavailable */ }
    setTimeout(beepLoop, 1400); // keeps ringing until the user responds (FR-5.4)
  }
  function killTimer() { // full reset — Exit / new recipe / alarm dismissed
    cook.deadline = null; cook.timerStep = null; cook.ringing = false;
    cook.timerReplaceArm = 0; cook.timerReplaceArmStep = null; // a stale arm must never authorize a later replace
    if (cook.iv) { clearInterval(cook.iv); cook.iv = null; }
    const tc = $("ck-timer"); if (tc) tc.classList.remove("ringing");
    const pill = $("ck-pill"); if (pill) pill.hidden = true;
  }
  function dismissAlarm() {
    const mins = Math.round(cook.timerTotal / 60);
    killTimer(); renderStep();
    cook.lastActivity = Date.now(); cook.checkins = 0;
    voiceSay("The " + mins + " minutes are up — ready to continue?");
    toast("Alarm off");
  }
  function advance() {
    cook.lastActivity = Date.now(); cook.checkins = 0;
    if (cook.mode === "done") return;                    // finished — nothing to advance
    if (cook.ringing) killTimer();                       // an explicit command answers the alarm
    if (cook.mode === "overview") { beginWalk(); return; }
    if (cook.i >= cook.items.length - 1) {
      killTimer();
      cook.mode = "done";
      togglePrepSheet(false); $("ck-prep-btn").hidden = true;
      $("ck-body").hidden = true; $("ck-nav").hidden = true; $("ck-done").hidden = false;
      renderDoneSave(); // Shuki (Aug 30): save straight from the finish screen
      voiceSay("Beautifully done. Enjoy it.");
      return;
    }
    cook.i++; renderStep(); speakCurrent();
  }
  function renderDoneSave() {
    // saved already (incl. cooked FROM the cookbook, where notes sync live) →
    // quiet confirmation; otherwise an active save that captures tonight's
    // notes and servings via the same upsert the Review button uses
    const b = $("ck-done-save");
    const saved = current && cookbook.some(r => r.id === current.id);
    b.disabled = saved;
    b.textContent = saved ? "✓ In your cookbook" : "Save to cookbook";
  }
  function prevStep() {
    cook.lastActivity = Date.now(); cook.checkins = 0;
    if (cook.ringing) killTimer();
    if (cook.mode !== "walk") return;
    if (cook.i > 0) { cook.i--; renderStep(); speakCurrent(); }
  }
  function stopCookingSession() { // shared teardown — voice must never leak past cooking
    killTimer();
    cook.mode = "off";
    $("ck-prep").hidden = true; $("ck-prep-btn").hidden = true;
    if (cook.pacing) { clearInterval(cook.pacing); cook.pacing = null; }
    SC.voice.stopAll(); renderMicState("off");
  }
  function exitCooking() {
    stopCookingSession();
    show(current && cookbook.some(r => r.id === current.id) ? "cookbook" : "home");
  }

  /* ---- Cookbook ---- */
  function renderCookbook() {
    const box = $("cb-list"); box.innerHTML = "";
    if (!cookbook.length) {
      box.innerHTML = '<div class="empty-state"><span class="glyph">Sue</span>No saved recipes yet. Bring one in from the Cook tab and tap “Save to cookbook”.</div>';
      return;
    }
    cookbook.forEach((r, idx) => {
      const row = document.createElement("div"); row.className = "cb-card-row";
      const b = document.createElement("button");
      b.type = "button"; b.className = "recipe-card";
      const h = document.createElement("h3"); h.textContent = r.name;
      const sub = document.createElement("span"); sub.className = "sub";
      const meta = [];
      if (r.author) meta.push("by " + r.author); // creator credit follows the recipe (FR-1.4)
      meta.push(r.servings + " servings");
      if (r.prepMin || r.cookMin) meta.push(((r.prepMin || 0) + (r.cookMin || 0)) + " min");
      const noteCount = Object.keys(r.notes || {}).length;
      if (noteCount) meta.push(noteCount + " note" + (noteCount > 1 ? "s" : ""));
      sub.textContent = meta.join(" · ");
      b.append(h, sub);
      b.addEventListener("click", () => openReview(JSON.parse(JSON.stringify(r))));
      // two-tap delete: first tap arms, second within 3s deletes
      const del = document.createElement("button");
      del.type = "button"; del.className = "cb-del"; del.textContent = "×";
      del.setAttribute("aria-label", "Delete " + r.name);
      del.addEventListener("click", () => {
        if (del.classList.contains("arm")) { cookbook.splice(idx, 1); saveCookbook(); renderCookbook(); toast("Recipe deleted"); }
        else {
          del.classList.add("arm"); del.textContent = "Sure?";
          setTimeout(() => { del.classList.remove("arm"); del.textContent = "×"; }, 3000);
        }
      });
      row.append(b, del); box.appendChild(row);
    });
  }

  /* ---- Shopping ---- */
  function renderShopBadge() {
    const n = shopping.filter(i => !i.checked).length;
    const badge = $("nav-shop-badge");
    badge.textContent = n; badge.classList.toggle("show", n > 0);
    const navBtn = document.querySelector('#nav button[data-nav="shopping"]');
    if (navBtn) navBtn.setAttribute("aria-label", n ? "Shopping list, " + n + " items to buy" : "Shopping list");
  }
  function renderShopping() {
    const ul = $("sh-list"); ul.innerHTML = "";
    $("sh-empty").hidden = shopping.length > 0;
    const ordered = [...shopping].sort((a, b) => (a.checked ? 1 : 0) - (b.checked ? 1 : 0));
    ordered.forEach(it => {
      const idx = shopping.indexOf(it);
      const li = document.createElement("li");
      if (it.checked) li.classList.add("done");
      const chk = document.createElement("button");
      chk.type = "button"; chk.className = "shop-check"; chk.textContent = "✓";
      chk.setAttribute("aria-label", (it.checked ? "Uncheck " : "Check ") + it.name);
      chk.addEventListener("click", () => { it.checked = !it.checked; saveShopping(); renderShopping(); });
      const nm = document.createElement("span"); nm.className = "shop-name";
      nm.textContent = SC.units.displayName(it, 1);
      const am = document.createElement("span"); am.className = "shop-amt";
      am.textContent = it.juiceOf ? "" : SC.units.displayAmount(it, 1, settings.units);
      const del = document.createElement("button");
      del.type = "button"; del.className = "shop-del"; del.textContent = "×";
      del.setAttribute("aria-label", "Remove " + it.name);
      del.addEventListener("click", () => { shopping.splice(idx, 1); saveShopping(); renderShopping(); });
      li.append(chk, nm, am, del); ul.appendChild(li);
    });
    renderShopBadge();
  }
  function shareShopping() {
    if (!shopping.length) { toast("Your list is empty."); return; }
    const text = "Shopping list — Sue Chef\n" + shopping.map(i => {
      const amt = i.juiceOf ? "" : SC.units.displayAmount(i, 1, settings.units);
      return (i.checked ? "✓ " : "• ") + SC.units.displayName(i, 1) + (amt ? " — " + amt : "");
    }).join("\n");
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("List copied to clipboard")).catch(() => toast("Couldn't copy the list"));
    else toast("Sharing isn't available in this browser");
  }

  /* ---- Settings ---- */
  function chipList(boxId, arr, onRemove) {
    const box = $(boxId); box.innerHTML = "";
    if (!arr.length) {
      const s = document.createElement("span");
      s.style.cssText = "color:var(--ink-faint);font-size:13px"; s.textContent = "None yet";
      box.appendChild(s); return;
    }
    arr.forEach((v, i) => {
      const c = document.createElement("button");
      c.type = "button"; c.className = "chip on";
      c.append(document.createTextNode(v + " "));
      const x = document.createElement("span");
      x.className = "x"; x.setAttribute("aria-hidden", "true"); x.textContent = "×";
      c.appendChild(x);
      c.setAttribute("aria-label", "Remove " + v);
      c.addEventListener("click", () => onRemove(i));
      box.appendChild(c);
    });
  }
  function renderSettings() {
    chipList("st-allergies", settings.allergies, i => { settings.allergies.splice(i, 1); saveSettings(); renderSettings(); });
    chipList("st-pantry", settings.pantry, i => { settings.pantry.splice(i, 1); saveSettings(); renderSettings(); });
    $("st-ai-key").value = settings.aiKey || "";
    $("st-server").value = settings.server || "";
    $("st-tts-rate").value = settings.ttsRate || 1;
    $("st-tts-rate-val").textContent = (settings.ttsRate || 1).toFixed(1) + "×";
    renderVoiceList();
  }
  function renderVoiceList() {
    const sel = $("st-voice");
    const keep = settings.voiceName || "";
    sel.innerHTML = '<option value="">Best available (automatic)</option>';
    SC.voice.listVoices().forEach(v => {
      const o = document.createElement("option");
      o.value = v.name;
      o.textContent = v.name + (v.localService ? "" : " (online)");
      sel.appendChild(o);
    });
    sel.value = [...sel.options].some(o => o.value === keep) ? keep : "";
    // never downgrade a saved choice just because voices are still loading —
    // voiceschanged re-renders and the saved name comes back (rev-6 leftover)
    SC.voice.setPreferredVoice(keep);
  }
  function addFrom(inputId, arr) {
    const inp = $(inputId), v = inp.value.trim();
    if (!v) return;
    if (!arr.some(x => x.toLowerCase() === v.toLowerCase())) arr.push(v);
    inp.value = ""; saveSettings(); renderSettings();
  }

  /* ---- wire up ---- */
  function init() {
    document.querySelectorAll("#nav button").forEach(b =>
      b.addEventListener("click", () => show(b.dataset.nav)));
    document.querySelectorAll("[data-units-toggle] button").forEach(b =>
      b.addEventListener("click", () => { settings.units = b.dataset.units; saveSettings(); renderUnits(); }));
    $("btn-sample-baking").addEventListener("click", () => {
      $("paste-input").value = SC.SAMPLES[0].text; toast("Cookie sample loaded — hit Let's Cook");
    });
    $("btn-sample-cooking").addEventListener("click", () => {
      $("paste-input").value = SC.SAMPLES[1].text; toast("Shakshuka sample loaded — hit Let's Cook");
    });
    $("btn-cook").addEventListener("click", onCook);
    $("rv-serv-minus").addEventListener("click", () => { if (servings > 1) { servings--; $("rv-serv-count").textContent = servings; renderIngredients(); } });
    $("rv-serv-plus").addEventListener("click", () => { if (servings < 24) { servings++; $("rv-serv-count").textContent = servings; renderIngredients(); } });
    $("rv-start").addEventListener("click", startCooking);
    $("rv-shop").addEventListener("click", addToShopping);
    $("rv-save").addEventListener("click", saveToCookbook);
    $("rv-request-go").addEventListener("click", handleFreeRequest);
    $("rv-request-input").addEventListener("keydown", e => { if (e.key === "Enter") handleFreeRequest(); });
    $("ck-exit").addEventListener("click", exitCooking);
    $("ck-next").addEventListener("click", advance);    // timer keeps running across steps
    $("ck-back").addEventListener("click", prevStep);
    $("ck-timer-start").addEventListener("click", startTimer);
    $("ck-timer-stop").addEventListener("click", dismissAlarm);
    $("ck-pill").addEventListener("click", () => { if (cook.timerStep != null) { cook.i = cook.timerStep; renderStep(); } });
    $("ck-ready").addEventListener("click", beginWalk);
    $("ck-prep-btn").addEventListener("click", () => togglePrepSheet(true));
    $("ck-prep-close").addEventListener("click", () => togglePrepSheet(false));
    $("ck-voice-tip-x").addEventListener("click", () => {
      settings.voiceTipSeen = true; saveSettings(); $("ck-voice-tip").hidden = true;
    });
    $("ck-note-btn").addEventListener("click", () => {
      const it = currentItem();
      $("ck-note-input").value = (it && current.notes && current.notes[it.stepIndex]) || "";
      $("ck-note-edit").hidden = false;
      $("ck-note-input").focus();
    });
    $("ck-note-save").addEventListener("click", saveStepNote);
    $("ck-note-cancel").addEventListener("click", () => { $("ck-note-edit").hidden = true; });
    $("ck-mic").addEventListener("click", () => {
      const st = SC.voice.getState();
      if (st === "denied" || st === "unsupported") return;
      if (st === "listening") SC.voice.mute(); else SC.voice.unmute();
    });
    $("st-tts-rate").addEventListener("input", e => {
      settings.ttsRate = parseFloat(e.target.value); saveSettings();
      $("st-tts-rate-val").textContent = settings.ttsRate.toFixed(1) + "×";
    });
    $("st-voice").addEventListener("change", e => {
      settings.voiceName = e.target.value; saveSettings();
      SC.voice.setPreferredVoice(settings.voiceName);
    });
    $("st-voice-preview").addEventListener("click", () =>
      SC.voice.speak("Hi, I'm Sue. Let's make something delicious.", settings.ttsRate || 1));
    if (window.speechSynthesis) // voices load async on some browsers — refresh the picker
      try { window.speechSynthesis.addEventListener("voiceschanged", renderVoiceList); } catch (e) {}
    $("ck-bubble").addEventListener("click", () => SC.voice.stopSpeak()); // tap Sue to hush her
    $("ck-done-home").addEventListener("click", () => { stopCookingSession(); show("home"); });
    $("ck-done-save").addEventListener("click", () => { saveToCookbook(); renderDoneSave(); });
    $("sh-share").addEventListener("click", shareShopping);
    $("sh-clear-done").addEventListener("click", () => { shopping = shopping.filter(i => !i.checked); saveShopping(); renderShopping(); });
    $("sh-clear-all").addEventListener("click", () => { shopping = []; saveShopping(); renderShopping(); });
    $("st-allergy-add").addEventListener("click", () => addFrom("st-allergy-input", settings.allergies));
    $("st-allergy-input").addEventListener("keydown", e => { if (e.key === "Enter") addFrom("st-allergy-input", settings.allergies); });
    $("st-pantry-add").addEventListener("click", () => addFrom("st-pantry-input", settings.pantry));
    $("st-pantry-input").addEventListener("keydown", e => { if (e.key === "Enter") addFrom("st-pantry-input", settings.pantry); });
    $("st-dev-toggle").addEventListener("click", () => {
      const open = $("st-dev").classList.toggle("open");
      $("st-dev-toggle").setAttribute("aria-expanded", open ? "true" : "false");
    });
    $("st-ai-key").addEventListener("change", e => { settings.aiKey = e.target.value; saveSettings(); });
    $("st-server").addEventListener("change", e => { settings.server = e.target.value; saveSettings(); });
    $("st-server-test").addEventListener("click", testServerConnection);
    // pre-warm a napping free-tier server the moment the app opens (fire and forget)
    const pre = serverBase();
    if (pre && !serverSchemeProblem(pre) && !isPreviewPage()) fetch(pre + "/health").catch(() => {});
    // suechef://import?url=… — the future Share Extension hands links in here
    // (FR-1.1, docs/CAPACITOR.md). No-op in the browser; wired when the
    // Capacitor App plugin is present.
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener("appUrlOpen", d => {
        try {
          const raw = String((d && d.url) || "");
          if (!/^suechef:\/\/import/i.test(raw)) return;
          const target = new URL(raw.replace(/^suechef:\/\/import/i, "https://import.local")).searchParams.get("url");
          if (!target || !/^https?:\/\//i.test(target)) return;
          // a share can arrive mid-cook — tear the live session down first so
          // voice/pacing/timers never keep running behind the Home screen (rev-9)
          if ($("screen-cooking").classList.contains("active")) stopCookingSession();
          show("home"); $("paste-input").value = target; onCook();
        } catch (e) { /* malformed handoff — ignore */ }
      });
    }
    // NFR-8: user data works offline; only AI/import actions need internet
    window.addEventListener("offline", () =>
      toast("You're offline — your recipes, cooking and lists all still work."));
    window.addEventListener("online", () => toast("Back online."));
    renderUnits(); renderSettings(); renderShopBadge();
  }
  return { init };
})();

document.addEventListener("DOMContentLoaded", SC.ui.init);
