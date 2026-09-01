/* ============================================================
   Sue Chef — recipe fetch server (FR-1.x)
   The import ladder, server side:
     1. TikTok oEmbed (fast, official, no browser)      — FR-1.2
     2. Headless browser for Instagram / general pages  — FR-1.3
        · waits for late-loading content
        · reads captions + the FIRST comment (IG habit) — spec 5.1
        · extracts the author for credit                — FR-1.4
        · blocks images/media/fonts                     — FR-1.5
     3. Clear, typed errors so the app can offer the
        paste-text fallback                             — NFR-5/6
   Security: CORS allowlist (never wildcard in prod, NFR-3),
   SSRF guard on the ENTRY URL and on EVERY in-page request —
   redirects and subresources are re-checked in the request
   interceptor, so a public page can't bounce us to a private
   or cloud-metadata address. Residual risk: a DNS answer can
   still change between our lookup and Chrome's (classic
   rebinding TOCTOU); the 30s verdict cache + per-request
   re-check narrows the window, and no internal services run
   beside this container on the target free tiers.
   ============================================================ */
"use strict";
const express = require("express");
const dns = require("dns").promises;
const net = require("net");
const fs = require("fs");

const PORT = process.env.PORT || 8787;
const NAV_TIMEOUT_MS = +(process.env.NAV_TIMEOUT_MS || 25000);   // NFR-5 social budget
const OEMBED_TIMEOUT_MS = +(process.env.OEMBED_TIMEOUT_MS || 6000);
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === "1";          // tests only
const ORIGINS = (process.env.ALLOWED_ORIGINS ||
  "https://claude.ai,https://*.claudeusercontent.com,https://*.netlify.app")
  .split(",").map(s => s.trim()).filter(Boolean);

const app = express();
app.set("trust proxy", 1); // Render/Fly sit one proxy in front; req.ip = real client

/* ---------- CORS: explicit allowlist, wildcard subdomain support ---------- */
function originAllowed(origin) {
  if (!origin || origin === "null") return ALLOW_PRIVATE; // file:// during dev only
  return ORIGINS.some(pat => {
    if (pat === origin) return true;
    if (pat.includes("*")) {
      // "*" spans subdomain labels too (a.b.netlify.app) — the literal dot
      // before the base domain keeps evil-netlify.app out.
      const re = new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z0-9.-]+") + "$", "i");
      return re.test(origin);
    }
    return false;
  });
}
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    // echo the origin only — never fall back to "*" (NFR-3)
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

/* ---------- tiny in-memory rate limit: 20 requests/min per IP ---------- */
const hits = new Map();
app.use((req, res, next) => {
  const now = Date.now(), ip = req.ip || "?";
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (arr.length > 20) return fail(res, 429, "rate_limited", "Too many requests — try again in a minute.");
  next();
});
// evict idle IPs so the map can't grow forever
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits)
    if (!arr.length || now - arr[arr.length - 1] > 120000) hits.delete(ip);
}, 300000);
sweep.unref();

function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

/* ---------- SSRF guard: public http(s) hosts only ---------- */
function isPrivateIp(ip) {
  ip = String(ip || "").replace(/^\[|\]$/g, "").toLowerCase();
  // IPv4-mapped IPv6 — dotted (::ffff:169.254.169.254) or hex (::ffff:a9fe:a9fe)
  if (ip.startsWith("::ffff:")) {
    const rest = ip.slice(7);
    if (net.isIPv4(rest)) return isPrivateIp(rest);
    const hx = rest.split(":");
    if (hx.length === 2 && hx.every(h => /^[0-9a-f]{1,4}$/.test(h))) {
      const n = parseInt(hx[0], 16) * 65536 + parseInt(hx[1], 16);
      return isPrivateIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
    }
    return true; // unparseable mapped form — refuse
  }
  if (net.isIPv6(ip))
    return ip === "::" || ip === "::1" || /^(f[cd]|fe[89ab])/i.test(ip);
  const p = ip.split(".").map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
         (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
         (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) ||
         (p[0] === 100 && p[1] >= 64 && p[1] <= 127); // CGNAT (cloud-internal)
}

/* One verdict per hostname: "public" | "private" | "nx". Used for the entry
   URL AND for every request the page makes (redirect targets included). */
const dnsCache = new Map();
async function hostVerdict(hostname) {
  const bare = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!bare) return "nx";
  if (/^(localhost|.+\.localhost|.+\.local|.+\.internal|metadata\.google\.internal)$/.test(bare)) return "private";
  if (net.isIP(bare)) return isPrivateIp(bare) ? "private" : "public";
  const now = Date.now(), c = dnsCache.get(bare);
  if (c && now - c.ts < 30000) return c.v;
  let v;
  try {
    const addrs = await dns.lookup(bare, { all: true });
    v = addrs.some(a => isPrivateIp(a.address)) ? "private" : "public";
  } catch { v = "nx"; }
  if (dnsCache.size > 512) dnsCache.delete(dnsCache.keys().next().value);
  dnsCache.set(bare, { v, ts: now });
  return v;
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch { throw { code: "badurl", message: "That doesn't look like a valid link." }; }
  if (!/^https?:$/.test(u.protocol)) throw { code: "badurl", message: "Only http and https links are supported." };
  if (ALLOW_PRIVATE) return u;
  const v = await hostVerdict(u.hostname);
  if (v === "nx") throw { code: "notfound", message: "That site can't be found." };
  if (v === "private") throw { code: "badurl", message: "That address isn't reachable from here." };
  return u;
}

/* ---------- rung 1: TikTok oEmbed ---------- */
async function fetchTikTok(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), OEMBED_TIMEOUT_MS);
  try {
    const r = await fetch("https://www.tiktok.com/oembed?url=" + encodeURIComponent(url), { signal: ctrl.signal });
    if (!r.ok) throw { code: "blocked", message: "TikTok wouldn't share this post." };
    const j = await r.json();
    return { kind: "text", source: "tiktok",
      title: (j.title || "").slice(0, 120) || "TikTok recipe",
      author: j.author_name || null,
      text: j.title || "" };
  } catch (e) {
    if (e.code) throw e;
    throw { code: e.name === "AbortError" ? "timeout" : "blocked",
      message: e.name === "AbortError" ? "TikTok took too long to answer." : "TikTok wouldn't share this post." };
  } finally { clearTimeout(to); }
}

/* ---------- rung 2: headless browser ---------- */
function resolveChrome() {
  // CHROME_PATH wins when it exists; otherwise probe the usual homes
  // (the puppeteer docker image, plain debian/alpine installs).
  const cands = [process.env.CHROME_PATH, "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch {} }
  return null;
}
let browserPromise = null;
async function getBrowser() {
  if (browserPromise) return browserPromise;
  const p = (async () => {
    const puppeteer = require("puppeteer-core");
    const execPath = resolveChrome();
    let b;
    if (execPath) {
      b = await puppeteer.launch({ executablePath: execPath, headless: "new",
        args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    } else {
      // serverless fallback — an optional dep, absent from the Docker image
      let chromium;
      try { chromium = require("@sparticuz/chromium"); }
      catch { throw { code: "error", message: "No browser is installed on this server — set CHROME_PATH." }; }
      b = await puppeteer.launch({ executablePath: await chromium.executablePath(),
        args: chromium.args, headless: chromium.headless });
    }
    // if chrome dies later, forget it so the next request relaunches
    b.on("disconnected", () => { if (browserPromise === p) browserPromise = null; });
    return b;
  })();
  browserPromise = p;
  p.catch(() => { if (browserPromise === p) browserPromise = null; });
  return p;
}

async function fetchWithBrowser(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
    await page.setRequestInterception(true);
    page.on("request", async r => {
      try {
        if (["image", "media", "font", "stylesheet"].includes(r.resourceType()))
          return await r.abort();                      // FR-1.5: no heavy files
        const ru = new URL(r.url());
        if (/^(about|data|blob):$/.test(ru.protocol)) return await r.continue();
        if (!/^https?:$/.test(ru.protocol)) return await r.abort();
        // SSRF: every request — the redirect chain included — must stay public
        if (!ALLOW_PRIVATE && (await hostVerdict(ru.hostname)) !== "public")
          return await r.abort();
        return await r.continue();
      } catch { try { await r.abort(); } catch {} }
    });
    await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    // give late scripts a moment (Instagram renders captions after load)
    await new Promise(r => setTimeout(r, 1200));
    return await page.evaluate(extractInPage);
  } catch (e) {
    if (/timeout/i.test(e.message || "")) throw { code: "timeout", message: "The page took too long to load." };
    throw { code: "notfound", message: "That page couldn't be loaded." };
  } finally {
    await page.close().catch(() => {});
  }
}

/* runs INSIDE the page — keep self-contained */
function extractInPage() {
  const out = { kind: null, title: null, author: null, text: null, recipe: null, source: location.hostname };
  const meta = n => (document.querySelector(`meta[property="${n}"],meta[name="${n}"]`) || {}).content || null;

  // A. JSON-LD Recipe (most recipe websites) -> structured gold
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      let data = JSON.parse(s.textContent);
      const list = Array.isArray(data) ? data : (data["@graph"] || [data]);
      for (const node of list) {
        const types = [].concat(node["@type"] || []);
        if (types.includes("Recipe")) {
          const insts = [].concat(node.recipeInstructions || []).map(i =>
            typeof i === "string" ? i : (i.text || (i.itemListElement || []).map(x => x.text || "").join(" "))).filter(Boolean);
          // author can be "Nana", {name:"Nana"}, or an array of either
          const ra = node.author;
          let author = null;
          if (typeof ra === "string") author = ra;
          else if (ra) { const f = [].concat(ra)[0]; author = typeof f === "string" ? f : (f && f.name) || null; }
          out.kind = "structured";
          out.recipe = {
            name: node.name != null ? String(node.name) : null,
            author: author != null ? String(author) : null,
            servings: parseInt([].concat(node.recipeYield || [])[0]) || null,
            prepTime: node.prepTime || null,
            cookTime: node.cookTime || null,
            ingredients: [].concat(node.recipeIngredient || node.ingredients || []).map(x => typeof x === "string" ? x : (x && x.name) || "").filter(Boolean),
            steps: insts.map(String)
          };
          out.title = out.recipe.name;
          out.author = out.recipe.author;
          return out;
        }
      }
    } catch (e) { /* bad JSON-LD — keep looking */ }
  }

  // B. Instagram-style: og:description carries the caption; author from og:title / URL.
  // Detected by hostname OR by the caption's "N likes, N comments -" signature,
  // so mirrors and embeds work too.
  const host = location.hostname;
  const descProbe = meta("og:description") || "";
  const igLike = /[\d,.KM]+ likes?, [\d,.KM]+ comments? - /i.test(descProbe);
  if (/instagram\.com$/.test(host) || /instagram/.test(host) || igLike) {
    const wall = document.querySelector('input[name="username"], form[id*="login"]');
    const desc = meta("og:description");
    if (!desc && wall) { out.kind = "blocked"; return out; }
    let caption = desc || "";
    caption = caption.replace(/^[\d,.KM]+ likes?, [\d,.KM]+ comments? - /i, "");
    const m = caption.match(/^([\w.]+) on .*?: ["“]([\s\S]*)["”]?$/) || caption.match(/^([\w.]+): ([\s\S]*)$/);
    if (m) { out.author = m[1]; caption = m[2]; }
    // the recipe often hides in the FIRST comment (spec 5.1 #3)
    const firstComment = document.querySelector('ul li[role="menuitem"] span, article ul > div li span');
    if (firstComment && firstComment.textContent.length > caption.length)
      caption += "\n" + firstComment.textContent;
    out.kind = "text"; out.text = caption;
    out.title = (caption.split("\n")[0] || "Instagram recipe").slice(0, 80);
    out.author = out.author || (meta("og:title") || "").split(/[|•(]/)[0].trim() || null;
    return out;
  }

  // C. General page: og meta + best-effort article text
  out.kind = "text";
  out.title = meta("og:title") || document.title || null;
  out.author = meta("author") || meta("article:author") || null;
  const article = document.querySelector("article") || document.querySelector("main") || document.body;
  out.text = (out.title ? out.title + "\n\n" : "") +
    (article ? article.innerText.slice(0, 12000) : "");
  return out;
}

/* ---------- response hygiene: one clamp for every branch ----------
   The page (and TikTok's oEmbed) is untrusted input — coerce every field
   to a bounded string so no branch can return megabytes or crash the app. */
function clampStr(v, n) {
  if (v == null) return null;
  const s = typeof v === "string" ? v
    : (typeof v === "number" || typeof v === "boolean") ? String(v)
    : null; // objects/arrays would stringify to noise — drop them
  return s ? s.slice(0, n) : null;
}
function sanitizeResult(r) {
  if (!r || typeof r !== "object") return { kind: null };
  const out = { kind: typeof r.kind === "string" ? r.kind : null,
    source: clampStr(r.source, 200), title: clampStr(r.title, 200), author: clampStr(r.author, 120) };
  if (out.kind === "structured" && r.recipe && typeof r.recipe === "object") {
    const rec = r.recipe;
    out.recipe = {
      name: clampStr(rec.name, 200),
      author: clampStr(rec.author, 120),
      servings: Number.isFinite(+rec.servings) && +rec.servings > 0 ? Math.min(+rec.servings, 200) : null,
      prepTime: clampStr(rec.prepTime, 40),
      cookTime: clampStr(rec.cookTime, 40),
      ingredients: [].concat(rec.ingredients || []).slice(0, 80).map(i => clampStr(i, 300)).filter(Boolean),
      steps: [].concat(rec.steps || []).slice(0, 100).map(s => clampStr(s, 2000)).filter(Boolean)
    };
    out.title = out.title || out.recipe.name;
    out.author = out.author || out.recipe.author;
  } else if (out.kind === "structured") {
    out.kind = null; // "structured" without a recipe object is nonsense
  } else {
    out.text = clampStr(r.text, 16000);
  }
  return out;
}

/* ---------- routes ---------- */
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get("/recipe", async (req, res) => {
  const url = req.query.url;
  try {
    const u = await assertPublicUrl(url);
    const raw = /(^|\.)tiktok\.com$/i.test(u.hostname)
      ? await fetchTikTok(u.href)
      : await fetchWithBrowser(u.href);
    const r = sanitizeResult(raw);
    if (r.kind === "blocked")
      return fail(res, 422, "blocked", "This post is private or behind a login — paste the recipe text instead.");
    if (r.kind === "structured" && !r.recipe.ingredients.length && !r.recipe.steps.length)
      return fail(res, 422, "empty", "Couldn't find recipe details on that page — paste them instead.");
    // the <40-char guard applies to EVERY text source, TikTok included
    if (!r.kind || (r.kind === "text" && (!r.text || r.text.trim().length < 40)))
      return fail(res, 422, "empty", "Couldn't find recipe text on that page — paste it instead.");
    return res.json({ ok: true, ...r });
  } catch (e) {
    const KNOWN = ["badurl", "timeout", "blocked", "empty", "notfound", "rate_limited"];
    const code = KNOWN.includes(e && e.code) ? e.code : "error";
    const status = code === "badurl" ? 400 : code === "timeout" ? 504 : 502;
    const message = code === "error" ? "Something went wrong reading that link." : e.message;
    return fail(res, status, code, message);
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log("Sue Chef recipe server on :" + PORT));
}
module.exports = { app, isPrivateIp, originAllowed, hostVerdict, assertPublicUrl, sanitizeResult, resolveChrome };
