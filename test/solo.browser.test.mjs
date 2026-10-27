/* Play vs computers, end to end in Safari's engine (Playwright WebKit).
 * Run: node test/solo.browser.test.mjs   (Playwright from ~/.claude/tools or PLAYWRIGHT_DIR)
 *
 * A person plays full games against the computers by tapping the real buttons
 * (always the first offered choice), at 5 and 10 players, on an iPhone-sized
 * screen. Checks: the game reaches a winner, no page errors, the live table
 * fits the screen with no page scrolling, a reload resumes the game, Back asks
 * before quitting, and computer games never enter the recorded-games history.
 * Network: everything except localhost is blocked (Firebase never loads).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pw;
for (const dir of [process.env.PLAYWRIGHT_DIR, path.join(os.homedir(), ".claude", "tools", "node_modules"), path.join(ROOT, "test", "node_modules")]) {
  if (!dir) continue;
  try { pw = createRequire(path.join(dir, "x.js"))("playwright"); break; } catch (e) {}
}
if (!pw) { console.log("solo.browser.test.mjs: SKIPPED (Playwright not found; set PLAYWRIGHT_DIR)"); process.exit(0); }

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log("  FAIL " + label); } }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname === "/" ? "/index.html" : u.pathname;
  const f = path.join(ROOT, decodeURIComponent(p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await pw.webkit.launch({ headless: true });

async function open(ls) {
  const ctx = await browser.newContext({ ...pw.devices["iPhone 15"], viewport: { width: 393, height: 659 } });
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  await ctx.addInitScript((pairs) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    for (const [k, v] of pairs) localStorage.setItem(k, v);
  }, Object.entries(ls || {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

// Tap whatever the game is asking this person for (first choice), if anything.
async function humanStep(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector("#olAction " + s);
    const b = q(".ol-choice:not([disabled])") || q(".ol-pcard:not([disabled])") || q("#olJa") || q("#olPk") || q("#olVy");
    if (b) { b.click(); return b.id || b.className; }
    return null;
  });
}

async function fits(page) {
  return page.evaluate(() => {
    const s = document.getElementById("onlineScreen");
    return { sh: s.scrollHeight, ch: s.clientHeight, doc: document.scrollingElement.scrollHeight, vh: innerHeight, w: document.scrollingElement.scrollWidth };
  });
}

// Optional screenshots (SHOTS=<dir>): one per kind of step the person is asked.
const shotSteps = {};
function worstKey(prompt) { return prompt ? "-" + prompt.replace(/[^A-Za-z]+/g, "").slice(0, 18) : ""; }

async function playOne(n, level) {
  const { ctx, page, errors } = await open({ "secretHitler.soloPick.v1": JSON.stringify({ n, level }) });
  await page.click("#btnMenuSolo");
  await page.waitForSelector("#soloGo");
  ok(await page.isVisible("#soloGo"), `${n}p: setup shows Deal roles`);
  await page.waitForTimeout(300);
  ok(await page.isVisible(".coach-offer"), `${n}p: first visit offers the guided game`);
  await page.click(".coach-offer [data-o=no]");
  await page.click("#soloGo");
  await page.waitForSelector("#olBegin");
  const role = await page.textContent(".ol-role");
  ok(/You are/.test(role), `${n}p: night shows your secret role`);
  await page.evaluate(() => { window.Solo.delay = 0; });
  await page.click("#olBegin");
  await page.waitForSelector(".ol-felt");
  let maxOver = 0, steps = 0, worst = "";
  for (let i = 0; i < 2500; i++) {
    const over = await page.evaluate(() => !window.Solo.table || window.Solo.table.phase === "gameover");
    if (over) break;
    const f = await fits(page);
    const o = Math.max(f.sh - f.ch, f.doc - f.vh);
    if (o > maxOver) {
      maxOver = o; worst = await page.evaluate(() => (document.querySelector("#olAction") || {}).textContent || "");
      if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `overflow-${n}.png`) });
    }
    if (process.env.SHOTS && !shotSteps[n + worstKey(await page.evaluate(() => (document.querySelector("#olAction .ol-prompt") || {}).textContent || ""))]) {
      const k = n + worstKey(await page.evaluate(() => (document.querySelector("#olAction .ol-prompt") || {}).textContent || ""));
      shotSteps[k] = 1;
      await page.screenshot({ path: path.join(process.env.SHOTS, `step-${k}.png`) });
    }
    const did = await humanStep(page);
    if (did) steps++;
    await page.waitForTimeout(did ? 30 : 15);
  }
  const t = await page.evaluate(() => window.Solo.table && { phase: window.Solo.table.phase, winner: window.Solo.table.winner, ev: window.Solo.table.events.length });
  ok(t && t.phase === "gameover" && /Liberal|Fascist/.test(t.winner), `${n}p ${level}: game reaches a winner (${JSON.stringify(t)}, ${steps} taps)`);
  ok(maxOver <= 1, `${n}p: live table never scrolls the page on a 393×659 phone (worst overflow ${maxOver}px at "${worst.slice(0, 80)}")`);
  await page.waitForSelector("#soloAgain");
  ok(/You (win|lose)/.test(await page.textContent("#olAction")), `${n}p: game over says whether you won`);
  const st = await page.evaluate(() => window.Profile ? Profile.stats() : null);
  ok(st && st.games === 1 && st.byLevel && st.byLevel[level], `${n}p: My stats counted the game once, under ${level} (${st && JSON.stringify({ g: st.games, w: st.wins, lv: Object.keys(st.byLevel || {}) })})`);
  await page.click("#soloStats2");
  await page.waitForTimeout(1200);
  const pf = await page.evaluate(() => { const p = document.querySelector(".pf-panel"); const r = p && p.getBoundingClientRect(); return p && { vis: r.height > 0, top: r.top, bottom: r.bottom, vh: innerHeight, w: document.scrollingElement.scrollWidth, vw: innerWidth }; });
  ok(pf && pf.vis && pf.top >= 0 && pf.bottom <= pf.vh + 1 && pf.w <= pf.vw, `${n}p: My stats opens on screen (${JSON.stringify(pf)})`);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `mystats-${n}.png`) });
  await page.keyboard.press("Escape");
  const games = await page.evaluate(() => localStorage.getItem("secretHitler.games.v1"));
  ok(!games || JSON.parse(games).length === 0, `${n}p: a computer game is not added to the recorded games`);
  ok(errors.length === 0, `${n}p: no page errors (${errors.join(" | ")})`);
  await ctx.close();
}

await playOne(5, "normal");
await playOne(10, "hard");

// Guided first game (game-coach): offered once, walks the table, survives a reload;
// "?" opens the short rules on top of the game.
{
  const { ctx, page, errors } = await open({ "secretHitler.soloPick.v1": JSON.stringify({ n: 7, level: "normal" }) });
  const bubble = () => page.evaluate(() => {
    const b = document.querySelector(".coach-bubble"); if (!b) return null;
    const r = b.getBoundingClientRect(), t = b.querySelector(".coach-title");
    return { title: t ? t.textContent : "", on: r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 && getComputedStyle(b).visibility !== "hidden" && getComputedStyle(b).display !== "none" };
  });
  await page.click("#btnMenuSolo");
  await page.waitForTimeout(300);
  await page.click(".coach-offer [data-o=yes]");
  await page.waitForTimeout(700);
  let b = await bubble();
  ok(b && b.on && /role/i.test(b.title), `tour: starts on your role card, fully on screen (${JSON.stringify(b)})`);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "tour-1.png") });
  await page.click(".coach-bubble [data-coach=next]");
  await page.click("#olBegin");
  await page.waitForTimeout(900);
  b = await bubble();
  ok(b && b.on && /table/i.test(b.title), `tour: moves to the table once the game begins (${JSON.stringify(b)})`);
  const ev0 = await page.evaluate(() => JSON.stringify([Solo.table.phase, Solo.table.votedUids, Solo.table.nomineeUid]));
  await page.waitForTimeout(2500);
  const ev1 = await page.evaluate(() => JSON.stringify([Solo.table.phase, Solo.table.votedUids, Solo.table.nomineeUid]));
  ok(ev0 === ev1, `tour: the computers wait while a note is being read (${ev0} → ${ev1})`);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "tour-3.png") });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  b = await bubble();
  ok(b && b.on && /table/i.test(b.title), `tour: a reload carries on at the same step (${JSON.stringify(b)})`);
  await page.click("#olRulesBtn");
  await page.waitForTimeout(1200);
  const rules = await page.evaluate(() => { const r = document.querySelector(".coach-rules"); const x = r && r.getBoundingClientRect(); return r && { top: x.top, bottom: x.bottom, vh: innerHeight, txt: r.textContent.slice(0, 40) }; });
  ok(rules && rules.top >= 0 && rules.bottom <= rules.vh + 1 && /How to play/.test(rules.txt), `"?" opens the short rules on screen (${JSON.stringify(rules)})`);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "rules.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok(!(await page.evaluate(() => window.COACH.rulesOpen())), "Esc closes the rules");
  ok(errors.length === 0, "tour: no page errors (" + errors.join(" | ") + ")");
  await ctx.close();
}

// Reload mid-game resumes it; Back asks before quitting.
{
  const { ctx, page, errors } = await open({ "secretHitler.soloPick.v1": JSON.stringify({ n: 7, level: "easy"}), "coach-offer:sh-solo-first": "1" });
  await page.click("#btnMenuSolo");
  await page.click("#soloGo");
  await page.click("#olBegin");
  await page.waitForSelector(".ol-felt");
  await page.waitForTimeout(2500);
  const before = await page.evaluate(() => JSON.stringify(window.Solo.state.seatOrder) + window.Solo.state.events.length);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(400);
  ok(await page.isVisible("#onlineScreen .ol-felt"), "reload: lands straight back in the computer game (no menu tap)");
  await page.waitForSelector(".ol-felt");
  const after = await page.evaluate(() => JSON.stringify(window.Solo.state.seatOrder) + window.Solo.state.events.length);
  ok(before.split("]")[0] === after.split("]")[0], "reload: the same game resumes (same seats)");
  await page.click("#btnBackFromOnline");
  ok(await page.isVisible("#confirmModal"), "Back during a game asks before leaving");
  await page.click("#cfYes");
  await page.waitForTimeout(300);
  ok(await page.isVisible("#menuScreen"), "leaving returns to the menu");
  ok(await page.evaluate(() => !localStorage.getItem("secretHitler.solo.v1")), "leaving drops the saved game");
  ok(errors.length === 0, "resume/leave: no page errors (" + errors.join(" | ") + ")");
  await ctx.close();
}

// Player-review fixes: the guided-game offer goes away once you deal; the Veto label
// never sits on an enacted card; Execute needs a second tap; the history names who
// a power hit.
{
  const { ctx, page, errors } = await open({ "secretHitler.soloPick.v1": JSON.stringify({ n: 7, level: "normal" }) });
  await page.click("#btnMenuSolo");
  await page.waitForTimeout(300);
  ok(await page.isVisible(".coach-offer"), "review: the offer shows on the setup screen");
  await page.click("#soloGo");
  await page.waitForTimeout(400);
  ok(!(await page.isVisible(".coach-offer")), "review: dealing roles closes the guided-game offer");
  await page.evaluate(() => { window.Solo.delay = 1e7; }); // freeze the computers
  await page.evaluate(() => document.getElementById("olBegin").click());
  await page.waitForSelector(".ol-felt");
  // Put five Fascist laws down and hand YOU the Execute power.
  await page.evaluate(() => {
    const S = window.Solo.state;
    S.facEnacted = 5;
    S.presIdx = S.seatOrder.indexOf("you");
    const other = S.seatOrder.find((u) => u !== "you");
    S.events.push({ type: "gov", presidentIdx: S.presIdx, chancellorIdx: S.seatOrder.indexOf(other), claimLibs: 0, conflict: false, enacted: "F" });
    S._powerEventIdx = S.events.length - 1;
    S.phase = "power_execute";
    window.Solo.refresh();
  });
  await page.waitForTimeout(200);
  const both = await page.evaluate(() => [...document.querySelectorAll(".sh-slot")].filter((s) => s.querySelector(".policy-card") && s.querySelector(".veto-sign")).length);
  ok(both === 0, `review: the Veto label is hidden under an enacted card (${both} slots show both)`);
  const target = await page.evaluate(() => { const b = [...document.querySelectorAll("#olAction .ol-choice")].find((x) => x.dataset.u !== window.Solo.state.hitlerUid); return { uid: b.dataset.u, name: window.Solo.state.names[b.dataset.u] }; });
  await page.evaluate((u) => document.querySelector("#olAction .ol-choice[data-u='" + u + "']").click(), target.uid);
  await page.waitForTimeout(200);
  const mid = await page.evaluate(() => ({ phase: window.Solo.state.phase, dead: window.Solo.state.deadUids.slice(), txt: document.querySelector("#olAction").textContent }));
  ok(mid.phase === "power_execute" && mid.dead.length === 0, `review: one tap on Execute doesn't kill yet (${JSON.stringify(mid)})`);
  await page.evaluate((u) => { const b = document.querySelector("#olAction .ol-choice[data-u='" + u + "']"); if (b) b.click(); }, target.uid);
  await page.waitForTimeout(300);
  const done = await page.evaluate(() => ({ dead: window.Solo.state.deadUids.slice(), hist: (document.querySelector(".ol-history") || {}).textContent || "" }));
  ok(done.dead.indexOf(target.uid) >= 0, `review: the second tap executes (${JSON.stringify(done.dead)})`);
  ok(new RegExp("execution[^A-Za-z]*" + target.name).test(done.hist),`review: the history names who was executed (${done.hist.slice(0, 120)})`);
  ok(errors.length === 0, "review: no page errors (" + errors.join(" | ") + ")");
  await ctx.close();
}

await browser.close();
server.close();
console.log(`solo.browser: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
