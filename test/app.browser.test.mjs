/* Browser regression tests for app.js (Safari's engine via Playwright).
 * Run: node test/app.browser.test.mjs   (needs Playwright; on Tim's laptop it
 * lives in ~/.claude/tools/node_modules, or set PLAYWRIGHT_DIR).
 *
 * Serves the repo on a local port, blocks every network request that isn't
 * localhost (so Firebase never loads and nothing touches the live project),
 * seeds localStorage, and drives the real page. Covers the 2026-10-17 fixes:
 *   A. "Use these rates" on the in-game Stats tab refreshes that tab
 *   B. a malformed claimLibs value doesn't crash review/history
 *   C. a full storage quota while saving a game keeps the game and says so
 *   D. night recorder: double tap / leaving while the mic prompt is open
 *      never leaves the microphone on
 *   E. update check: an old page moves to the new build once, never loops,
 *      and never reloads mid-game or with a dialog open
 *   F. the home menu fits one screen at 393x659, 320x568, 1280x720, 1440x900
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let pw;
for (const dir of [process.env.PLAYWRIGHT_DIR, path.join(os.homedir(), ".claude", "tools", "node_modules"), path.join(ROOT, "test", "node_modules")]) {
  if (!dir) continue;
  try { pw = createRequire(path.join(dir, "x.js"))("playwright"); break; } catch (e) {}
}
if (!pw) { console.log("app.browser.test.mjs: SKIPPED (Playwright not found; set PLAYWRIGHT_DIR)"); process.exit(0); }

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log("  FAIL " + label); } }

// ---------------------------------------------------------------- fixtures
// Real recorded-game shapes, produced by the real producer (engine.toRecordedGame).
const E = require(path.join(ROOT, "js", "engine.js"));
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function botAction(S) {
  const pres = E.presUid(S), alive = E.aliveUids(S);
  switch (S.phase) {
    case "nominate": { const tl = E.termLimited(S); return { type: "nominate", by: pres, target: alive.find((u) => u !== pres && !tl[u]) }; }
    case "vote": return { type: "vote", by: alive.find((x) => !(x in S.votes)), vote: "ja" };
    case "president_play": return { type: "president_play", by: pres, discard: 0, claim: S.drawn.filter((c) => c === "L").length };
    case "chancellor_play": return { type: "chancellor_play", by: S.chancellorUid, enact: 0 };
    case "veto": return { type: "veto", by: pres, agree: true };
    case "power_investigate": return { type: "power", by: pres, target: alive.find((u) => u !== pres && S.investigatedUids.indexOf(u) < 0) || alive.find((u) => u !== pres) };
    case "power_special": case "power_execute": return { type: "power", by: pres, target: alive.find((u) => u !== pres) };
    case "power_peek": return { type: "power", by: pres };
  }
  return null;
}
function recordedGame(seed, n) {
  const uids = Array.from({ length: n }, (_, i) => "p" + i);
  let S = E.initGame(uids.map((u) => ({ uid: u, name: "Player " + u.slice(1) })), rng(seed));
  const r = rng(seed * 7 + 1);
  for (let i = 0; i < 3000 && S.phase !== "gameover"; i++) { const res = E.applyAction(S, botAction(S), r); if (!res.ok) break; S = res.state; }
  const rec = E.toRecordedGame(S);
  rec.id = "fixture-" + seed;
  rec.date = new Date(Date.UTC(2026, 9, 1 + seed)).toISOString();
  rec.groupId = null;
  return rec;
}
const GAMES = [1, 2, 3, 4].map((s) => recordedGame(s, 5 + (s % 3)));
const BAD = JSON.parse(JSON.stringify(GAMES[0]));
BAD.id = "bad-claims";
const weird = [null, "abc", 7, -1, 1.5, undefined];
let w = 0;
BAD.events.forEach((ev) => { if ((ev.type || "gov") === "gov") ev.claimLibs = weird[w++ % weird.length]; });

const NAMES = ["Ann", "Ben", "Cal", "Dee", "Eve"];
function activeGame(extra) {
  return Object.assign({
    date: null, players: NAMES.map((n) => ({ name: n, dead: false })), firstPres: 0, events: [], roundMods: {},
    form: { chanIdxOverride: null, conflictArmed: false, vetoArmed: false }, pendingChaos: false, pendingPower: null,
    gameOver: null, recordingRoles: false, roleDraft: { hitlerIdx: null, fascistIdxs: [] }, winnerDraft: null,
    review: false, autoResult: null, result: null,
  }, extra || {});
}
const K = { games: "secretHitler.games.v1", active: "secretHitler.activeGame.v1" };

// ------------------------------------------------------------------ server
// `routes` overrides a path's body (string or function(req) → string).
let routes = {};
let pageLoads = 0;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let p = u.pathname === "/" ? "/index.html" : u.pathname;
  if (p === "/index.html") pageLoads++;
  const type = TYPES[path.extname(p)] || "application/octet-stream";
  if (routes[p] != null) {
    const body = typeof routes[p] === "function" ? routes[p](u) : routes[p];
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    return res.end(body);
  }
  const f = path.join(ROOT, decodeURIComponent(p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await pw.webkit.launch({ headless: true });

// A fresh page with localStorage seeded before any script runs.
async function open(ls, opts = {}) {
  const ctx = await browser.newContext({ ...pw.devices["iPhone 15"] });
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  await ctx.addInitScript((pairs) => {
    if (sessionStorage.getItem("__seeded")) return; // seed once; reloads keep what the app wrote
    sessionStorage.setItem("__seeded", "1");
    for (const [k, v] of pairs) localStorage.setItem(k, v);
  }, Object.entries(ls || {}));
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  // Real page loads = main-frame navigation requests (a history.replaceState isn't
  // one; the service worker's and js/pwa.js's own fetches of the HTML aren't either).
  let loads = 0;
  page.on("request", (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) loads++; });
  const navs = { get length() { return loads; } };
  await page.goto(BASE + (opts.path || "/"), { waitUntil: "load" });
  await page.waitForTimeout(opts.settle == null ? 600 : opts.settle);
  return { ctx, page, errors, navs };
}
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && !el.classList.contains("hidden"); }, sel);

// ===================================================================== A
{
  const { ctx, page, errors } = await open({ [K.games]: JSON.stringify(GAMES), [K.active]: JSON.stringify(activeGame()) });
  await page.click('.tab[data-tab="stats"]');
  await page.click("#statsBodyInline .fit-run");
  await page.waitForSelector("#statsBodyInline .fit-apply", { timeout: 30000 });
  await page.click("#statsBodyInline .fit-apply");
  await page.waitForTimeout(300);
  const txt = await page.textContent("#statsBodyInline");
  ok(/Now using/.test(txt), "A: in-game Stats tab shows the fitted rates right after 'Use these rates'");
  const reset = await page.$("#statsBodyInline .fit-reset");
  if (reset) { await reset.click(); await page.waitForTimeout(300); }
  ok(reset && !/Now using/.test(await page.textContent("#statsBodyInline")), "A: 'Use defaults' refreshes the in-game Stats tab too");
  ok(errors.length === 0, "A: no page errors (" + errors.join(" | ") + ")");
  await ctx.close();
}

// ===================================================================== B
{
  const { ctx, page, errors } = await open({ [K.games]: JSON.stringify(GAMES.concat([BAD])) });
  await page.click("#btnMenuStats");
  await page.click('.game-box[data-id="bad-claims"]');
  await page.waitForTimeout(300);
  await page.click('.tab[data-tab="history"]');
  const rows = await page.$$eval("#histTable tbody tr", (r) => r.length);
  ok(rows === BAD.events.length, `B: history lists every event of a game with malformed claims (${rows}/${BAD.events.length})`);
  await page.click('.tab[data-tab="play"]');
  await page.click("#pbFirst").catch(() => {});
  for (let i = 0; i < 4; i++) await page.click("#pbNext").catch(() => {});
  const cap = await page.$(".pb-caption");
  ok(!!cap, "B: review stepper caption renders on a malformed claim");
  ok(errors.length === 0, "B: no page errors (" + errors.join(" | ") + ")");
  await ctx.close();
}

// ===================================================================== C
{
  const st = activeGame({ recordingRoles: true, winnerDraft: "Liberal", roleDraft: { hitlerIdx: 0, fascistIdxs: [1] } });
  const { ctx, page, errors } = await open({ [K.active]: JSON.stringify(st) }, {
    init: () => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "secretHitler.games.v1" && window.__full) { const e = new Error("The quota has been exceeded."); e.name = "QuotaExceededError"; throw e; }
        return orig.call(this, k, v);
      };
    },
  });
  await page.evaluate(() => { window.__full = true; });
  await page.click("#btnSaveRoles");
  await page.waitForTimeout(200);
  const toast = await page.textContent("#toast");
  ok(/Storage is full/.test(toast || ""), "C: a full quota is surfaced to the user (toast: " + JSON.stringify(toast) + ")");
  ok(await visible(page, "#gameScreen"), "C: still on the game (in-memory game kept)");
  ok(await page.evaluate(() => !!localStorage.getItem("secretHitler.activeGame.v1")), "C: in-progress game still saved");
  ok(errors.length === 0, "C: no page errors (" + errors.join(" | ") + ")");
  // room again → saving now works
  await page.evaluate(() => { window.__full = false; });
  await page.click("#btnSaveRoles").catch(() => {});
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => (JSON.parse(localStorage.getItem("secretHitler.games.v1")) || []).length === 1), "C: retry saves the game once storage has room");
  await ctx.close();
}

// ===================================================================== D
const MIC = () => {
  window.__mic = { calls: 0, live: 0, pending: [] };
  const md = {
    getUserMedia: () => new Promise((res) => {
      window.__mic.calls++;
      window.__mic.pending.push(() => {
        const t = { stopped: false, stop() { if (!this.stopped) { this.stopped = true; window.__mic.live--; } } };
        window.__mic.live++;
        res({ getTracks: () => [t] });
      });
    }),
  };
  try { Object.defineProperty(navigator, "mediaDevices", { value: md, configurable: true }); } catch (e) {}
  window.MediaRecorder = class { constructor(s) { this.stream = s; this.mimeType = "audio/webm"; } start() {} stop() { if (this.onstop) this.onstop(); } };
  window.__grant = () => window.__mic.pending.splice(0).forEach((f) => f());
};
async function nightRecordView() {
  const o = await open({ [K.active]: JSON.stringify(activeGame()) }, { init: MIC });
  await o.page.click("#btnNight");
  await o.page.click("#nightNew");
  await o.page.waitForSelector('[data-rec="small"]');
  return o;
}
const mic = (page) => page.evaluate(() => ({ calls: window.__mic.calls, live: window.__mic.live }));
{ // D1: double tap on Record
  const { ctx, page, errors } = await nightRecordView();
  await page.evaluate(() => { const b = document.querySelector('[data-rec="small"]'); b.click(); b.click(); });
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__grant());
  await page.waitForTimeout(200);
  let m = await mic(page);
  ok(m.live === 1, `D1: double tap leaves exactly one live mic track (live ${m.live}, requests ${m.calls})`);
  await page.click('[data-stoprec="small"]').catch(() => {});
  await page.waitForTimeout(200);
  m = await mic(page);
  ok(m.live === 0, `D1: Stop turns the mic off (live ${m.live})`);
  ok(errors.length === 0, "D1: no page errors (" + errors.join(" | ") + ")");
  await ctx.close();
}
{ // D2: Back while the permission prompt is open
  const { ctx, page, errors } = await nightRecordView();
  await page.click('[data-rec="small"]');
  await page.click("#nightRecBack");
  await page.evaluate(() => window.__grant());
  await page.waitForTimeout(200);
  const m = await mic(page);
  ok(m.live === 0, `D2: Back during the mic prompt leaves the mic off (live ${m.live})`);
  ok(errors.length === 0, "D2: no page errors (" + errors.join(" | ") + ")");
  await ctx.close();
}
{ // D3: Cancel while the permission prompt is open
  const { ctx, page, errors } = await nightRecordView();
  await page.click('[data-rec="small"]');
  await page.click("#nightCancel");
  await page.evaluate(() => window.__grant());
  await page.waitForTimeout(200);
  const m = await mic(page);
  ok(m.live === 0, `D3: Cancel during the mic prompt leaves the mic off (live ${m.live})`);
  ok(errors.length === 0, "D3: no page errors (" + errors.join(" | ") + ")");
  await ctx.close();
}
{ // D4: Close the whole night panel while the prompt is open
  const { ctx, page, errors } = await nightRecordView();
  await page.click('[data-rec="small"]');
  await page.evaluate(() => document.querySelector("#nightRecBack").click());
  await page.click("#nightBack");
  await page.evaluate(() => window.__grant());
  await page.waitForTimeout(200);
  const m = await mic(page);
  ok(m.live === 0, `D4: closing Night during the mic prompt leaves the mic off (live ${m.live})`);
  ok(errors.length === 0, "D4: no page errors (" + errors.join(" | ") + ")");
  await ctx.close();
}

// ===================================================================== E
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const cur = (JSON.parse(fs.existsSync(path.join(ROOT, "version.json")) ? fs.readFileSync(path.join(ROOT, "version.json"), "utf8") : "{}").build) || "none";
const NEW = "test-new-build";
const newHtml = html.split("?v=" + cur).join("?v=" + NEW);
const newBuildJs = () => fs.readFileSync(path.join(ROOT, "js", "build.js"), "utf8").split(cur).join(NEW);
{ // E1: a deploy lands while the phone holds the old page → one move, lands on the new build
  let deployed = false;
  routes = {
    "/version.json": () => JSON.stringify({ build: NEW }),
    "/index.html": () => { const body = deployed ? newHtml : html; deployed = true; return body; },
    "/js/build.js": (u) => (u.searchParams.get("v") === NEW ? newBuildJs() : fs.readFileSync(path.join(ROOT, "js", "build.js"), "utf8")),
  };
  const { ctx, page, errors, navs } = await open({}, { path: "/?foo=1#frag", settle: 2500 });
  const b = await page.evaluate(() => window.SH_BUILD);
  ok(b === NEW, `E1: old page moved to the new build (now ${b})`);
  ok(navs.length === 2, `E1: exactly one automatic reload (${navs.length - 1})`);
  const url = page.url();
  ok(/foo=1/.test(url) && /#frag$/.test(url), "E1: existing query + hash kept (" + url + ")");
  ok(errors.length === 0, "E1: no page errors (" + errors.join(" | ") + ")");
  await ctx.close();
}
{ // E2: the host still serves stale files after the reload → must not loop
  routes = { "/version.json": () => JSON.stringify({ build: NEW }) };
  const { ctx, page, navs } = await open({}, { settle: 3000 });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1500);
  ok(navs.length === 2, `E2: stale files → one try, then no loop (${navs.length - 1} reloads)`);
  await ctx.close();
}
{ // E3: versions match → nothing happens
  routes = {};
  const { ctx, page, navs } = await open({}, { settle: 1500 });
  ok(navs.length === 1, `E3: same build → no reload (${navs.length - 1})`);
  ok(cur !== "none" && (await page.evaluate(() => window.SH_BUILD)) === cur, "E3: page BUILD matches version.json");
  await ctx.close();
}
{ // E4: mid-game, after the user has tapped → never reloads on return
  routes = {};
  const { ctx, page, navs } = await open({ [K.active]: JSON.stringify(activeGame()) }, { settle: 1200 });
  await page.click('.tab[data-tab="history"]');
  routes = { "/version.json": () => JSON.stringify({ build: NEW }) };
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1500);
  ok(navs.length === 1, `E4: no reload during a game (${navs.length - 1})`);
  await ctx.close();
}
{ // E5: on the menu with a dialog open → no reload; dialog closed → reload on return
  routes = {};
  const { ctx, page, navs } = await open({}, { settle: 1200 });
  await page.click("#btnSettings");
  routes = { "/version.json": () => JSON.stringify({ build: NEW }) };
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1500);
  ok(navs.length === 1, `E5: no reload while Settings is open (${navs.length - 1})`);
  await page.click("#setBack");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(2000);
  ok(navs.length === 2, `E5: reload on return once on the plain menu (${navs.length - 1})`);
  await ctx.close();
}

// ===================================================================== F
// The home menu fits one screen (no scrolling inside it) on phones and laptops.
routes = {};
for (const [w, h, mobile] of [[393, 659, true], [320, 568, true], [1280, 720, false], [1440, 900, false]]) {
  const ctx = await browser.newContext(mobile ? { ...pw.devices["iPhone 15"], viewport: { width: w, height: h } } : { viewport: { width: w, height: h } });
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const s = document.getElementById("menuScreen");
    const btns = [...s.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
    return { scroll: s.scrollHeight, client: s.clientHeight, bottom: Math.max(...btns.map((r) => r.bottom)), right: Math.max(...btns.map((r) => r.right)), sw: document.documentElement.scrollWidth };
  });
  ok(m.scroll <= m.client + 1 && m.bottom <= h, `F: menu fits ${w}x${h} without scrolling (content ${m.scroll}/${m.client}, last button bottom ${Math.round(m.bottom)})`);
  ok(m.right <= w && m.sw <= w, `F: menu has no sideways overflow at ${w}x${h}`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`app.browser.test.mjs: ${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
