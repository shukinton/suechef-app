// Recipe-server test harness: unit tests on the security guards (in-process,
// so run WITHOUT ALLOW_PRIVATE in the parent env) + fixture pages over local
// HTTP with real browser extraction (the spawned server gets ALLOW_PRIVATE=1).
// Run from server/: CHROME_PATH=/opt/pw-browsers/chromium node test/run.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");

const FIXTURE_PORT = 8899, SERVER_PORT = 8787;

// 1) fixture host
http.createServer((req, res) => {
  const f = path.join(__dirname, "../fixtures", path.basename(req.url.split("?")[0]));
  if (fs.existsSync(f)) { res.setHeader("content-type", "text/html"); res.end(fs.readFileSync(f)); }
  else { res.statusCode = 404; res.end("nope"); }
}).listen(FIXTURE_PORT);

// 2) the server under test
const srv = spawn(process.execPath, [path.join(__dirname, "../index.js")], {
  env: { ...process.env, PORT: SERVER_PORT, ALLOW_PRIVATE: "1",
    CHROME_PATH: process.env.CHROME_PATH || "/opt/pw-browsers/chromium",
    ALLOWED_ORIGINS: "http://test.local" },
  stdio: ["ignore", "pipe", "pipe"]
});
srv.stderr.on("data", d => process.stderr.write("[srv] " + d));

const get = (p) => fetch(`http://127.0.0.1:${SERVER_PORT}${p}`).then(async r => ({ status: r.status, body: await r.json() }));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let pass = 0, fail = 0;
  const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log("FAIL:", name, extra || ""); } };

  /* ---- unit tests: SSRF + CORS guards (require the module, no listen) ---- */
  const guard = require("../index.js");
  t("priv 10.x", guard.isPrivateIp("10.0.0.1") === true);
  t("priv 0.0.0.0", guard.isPrivateIp("0.0.0.0") === true);
  t("priv linklocal", guard.isPrivateIp("169.254.169.254") === true);
  t("priv cgnat", guard.isPrivateIp("100.64.0.1") === true);
  t("pub 8.8.8.8", guard.isPrivateIp("8.8.8.8") === false);
  t("priv mapped dotted", guard.isPrivateIp("::ffff:169.254.169.254") === true);
  t("priv mapped hex", guard.isPrivateIp("::ffff:a9fe:a9fe") === true);
  t("pub mapped", guard.isPrivateIp("::ffff:8.8.8.8") === false);
  t("priv ::1", guard.isPrivateIp("::1") === true);
  t("priv fe80", guard.isPrivateIp("fe80::1") === true);
  t("priv fd00", guard.isPrivateIp("fd00::1") === true);
  t("pub v6", guard.isPrivateIp("2606:4700::1111") === false);
  t("cors exact", guard.originAllowed("https://claude.ai") === true);
  t("cors wildcard", guard.originAllowed("https://myapp.netlify.app") === true);
  t("cors deep subdomain", guard.originAllowed("https://a.b.netlify.app") === true);
  t("cors suffix trick", guard.originAllowed("https://evil-netlify.app") === false);
  t("cors stranger", guard.originAllowed("https://evil.com") === false);
  t("cors no origin", guard.originAllowed(undefined) === false, "parent env must not set ALLOW_PRIVATE");
  t("verdict localhost", (await guard.hostVerdict("localhost")) === "private");
  t("verdict metadata", (await guard.hostVerdict("metadata.google.internal")) === "private");
  t("verdict ip", (await guard.hostVerdict("169.254.169.254")) === "private");
  t("verdict bracketed", (await guard.hostVerdict("[::ffff:169.254.169.254]")) === "private");
  const err = p => p.then(() => null, e => e && e.code);
  t("assert junk", (await err(guard.assertPublicUrl("not-a-url"))) === "badurl");
  t("assert ftp", (await err(guard.assertPublicUrl("ftp://example.com/x"))) === "badurl");
  t("assert localhost", (await err(guard.assertPublicUrl("http://localhost:1/"))) === "badurl");
  t("assert v6 loopback", (await err(guard.assertPublicUrl("http://[::1]/"))) === "badurl");
  t("assert metadata ip", (await err(guard.assertPublicUrl("http://169.254.169.254/latest"))) === "badurl");
  const sr = guard.sanitizeResult({ kind: "text", text: "x".repeat(99999), title: 42, author: { a: 1 } });
  t("clamp text", sr.text.length === 16000);
  t("coerce title", sr.title === "42");
  t("drop object author", sr.author === null);
  const sr2 = guard.sanitizeResult({ kind: "structured", recipe: { name: 7, ingredients: ["a", 5, null], steps: [{}, "Mix"] } });
  t("coerce structured", sr2.recipe.name === "7" && sr2.recipe.ingredients.join(",") === "a,5" &&
    sr2.recipe.steps.length === 1 && sr2.recipe.steps[0] === "Mix");
  t("structured sans recipe", guard.sanitizeResult({ kind: "structured" }).kind === null);

  /* ---- route tests against the spawned server + fixture host ---- */
  for (let i = 0; i < 40; i++) { try { await get("/health"); break; } catch { await sleep(250); } }

  // JSON-LD structured extraction
  let r = await get("/recipe?url=" + encodeURIComponent(`http://127.0.0.1:${FIXTURE_PORT}/jsonld-recipe.html`));
  t("jsonld ok", r.body.ok === true && r.body.kind === "structured");
  t("jsonld name", r.body.recipe && r.body.recipe.name === "Best Banana Bread");
  t("jsonld author", r.body.recipe && r.body.recipe.author === "Nana Levi", JSON.stringify(r.body.recipe && r.body.recipe.author));
  t("jsonld servings", r.body.recipe && r.body.recipe.servings === 8);
  t("jsonld ingredients", r.body.recipe && r.body.recipe.ingredients.length === 8);
  t("jsonld steps", r.body.recipe && r.body.recipe.steps.length === 6 && /Preheat/.test(r.body.recipe.steps[0]));

  // og-only page -> text for the client parser
  r = await get("/recipe?url=" + encodeURIComponent(`http://127.0.0.1:${FIXTURE_PORT}/og-only.html`));
  t("og ok", r.body.ok === true && r.body.kind === "text");
  t("og title", r.body.title === "Weeknight Lemon Chicken");
  t("og author", r.body.author === "Tal Cohen", r.body.author);
  t("og text has ingredients", /chicken thighs/.test(r.body.text) && /juice of 1 lemon/.test(r.body.text));

  // instagram-style caption page (content-signature detection)
  r = await get("/recipe?url=" + encodeURIComponent(`http://127.0.0.1:${FIXTURE_PORT}/instagram-like.html`));
  t("ig ok", r.body.ok === true && r.body.kind === "text");
  t("ig author", r.body.author === "chef.dani", r.body.author);
  t("ig caption cleaned", /CRISPY GNOCCHI/.test(r.body.text) && !/likes,/.test(r.body.text), (r.body.text || "").slice(0, 60));
  t("ig has ingredients", /500 g potato gnocchi/.test(r.body.text));

  // error taxonomy
  r = await get("/recipe?url=not-a-url");
  t("badurl", r.status === 400 && r.body.code === "badurl");
  r = await get("/recipe?url=" + encodeURIComponent(`http://127.0.0.1:${FIXTURE_PORT}/missing.html`));
  t("empty/notfound", r.body.ok === false, JSON.stringify(r.body));

  console.log(`SERVER TESTS: ${pass} passed, ${fail} failed`);
  srv.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
