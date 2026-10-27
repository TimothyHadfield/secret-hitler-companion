/* Online play end to end: two people on two iPhone-sized WebKit pages + computers
 * in the empty seats, against the LOCAL Firebase emulators (demo project, never
 * the live one).
 *
 * Run from the project root:
 *   firebase emulators:exec --only firestore,auth --project demo-shtest "node test/online.e2e.mjs"
 *
 * Both people sign up, share a group, one hosts, the other joins, the host adds 5
 * computers (7 players), and both tap the real buttons (first offered choice)
 * until the game ends. Checks: the game reaches a winner on both screens, no page
 * or console errors, the public table never carries secrets, a player cannot
 * read another player's private doc or the host's full state (real rules), and
 * the finished game is recorded with the computers marked.
 * Network: the page gets the emulator config (demo project) from the test server,
 * so it can only reach localhost, the emulators and the SDK files on gstatic.
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
if (!pw) { console.log("online.e2e: SKIPPED (Playwright not found)"); process.exit(0); }
const FS = process.env.FIRESTORE_EMULATOR_HOST, AU = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!FS || !AU) { console.log("online.e2e: run it under `firebase emulators:exec --only firestore,auth` (no emulator found)"); process.exit(1); }
const [fsHost, fsPort] = FS.split(":");

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log("  FAIL " + label); } }

const EMU_CONFIG = `window.FIREBASE_CONFIG = { apiKey: "demo-key", authDomain: "demo-shtest.firebaseapp.com", projectId: "demo-shtest", appId: "demo-app" };
window.__SH_EMU = { auth: "http://${AU}", host: "${fsHost}", port: ${+fsPort} };`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname === "/" ? "/index.html" : u.pathname;
  if (p === "/js/firebase-config.js") { res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }); return res.end(EMU_CONFIG); }
  const f = path.join(ROOT, decodeURIComponent(p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
// apis.google.com: the auth SDK's static helper script; cleardot.gif: Firestore's probe (no project data).
const allowed = (u) => u.startsWith(BASE) || u.startsWith("https://www.gstatic.com/firebasejs/") || u.startsWith("https://apis.google.com/") ||
  u.startsWith("https://demo-shtest.firebaseapp.com/") || u.startsWith("https://www.google.com/images/cleardot.gif") || // the SDK's connectivity probe
  u.startsWith("http://" + FS) || u.startsWith("http://" + AU) ||
  u.startsWith("http://localhost:" + fsPort) || u.startsWith("http://localhost:" + AU.split(":")[1]);

const outside = [];
const browser = await pw.webkit.launch({ headless: true });
async function open(tag) {
  const ctx = await browser.newContext({ ...pw.devices["iPhone 15"], viewport: { width: 393, height: 659 }, serviceWorkers: "block" });
  // No request routing: any route makes WebKit intercept the emulator's streaming
  // requests, which breaks them ("rewinding of the data stream failed"). The test
  // server hands out the emulator config instead, so nothing can reach a live project.
  const page = await ctx.newPage();
  const errors = [];
  page.on("request", (r) => { if (!allowed(r.url())) outside.push(tag + " " + r.url().slice(0, 100)); });
  page.on("pageerror", (e) => errors.push(tag + " pageerror: " + String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(tag + " console: " + m.text().slice(0, 200)); });
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.Cloud && !!window.Online, null, { timeout: 30000 });
  return { ctx, page, errors };
}
const until = async (page, fn, arg, ms = 30000) => page.waitForFunction(fn, arg, { timeout: ms });

async function humanStep(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector("#olAction " + s);
    const b = q(".ol-choice:not([disabled])") || q(".ol-pcard:not([disabled])") || q("#olJa") || q("#olPk") || q("#olVy");
    if (b) { b.click(); return b.id || b.className; }
    return null;
  });
}

const A = await open("host"), Bp = await open("guest");
const stamp = Date.now().toString(36);
const sA = await A.page.evaluate((e) => Cloud.signUpEmail(e, "pw-123456", "Hostie"), `host-${stamp}@example.com`);
const sB = await Bp.page.evaluate((e) => Cloud.signUpEmail(e, "pw-123456", "Guesty"), `guest-${stamp}@example.com`);
ok(sA.ok && sB.ok, `both sign up on the auth emulator (${JSON.stringify([sA, sB])})`);
for (const P of [A, Bp]) {
  await until(P.page, () => Cloud.user && Cloud.user.uid).catch(async (e) => {
    console.log("  signed-in state:", await P.page.evaluate(() => JSON.stringify({ user: Cloud.user, status: Cloud.status, error: Cloud.error && String(Cloud.error) })), P.errors);
    throw e;
  });
}
const g = await A.page.evaluate(() => Cloud.createGroup("E2E table"));
ok(g.ok && g.id, `host creates a group (${JSON.stringify(g)})`);
const j = await Bp.page.evaluate(async (gid) => { const r = await Cloud.joinGroup(gid); if (Cloud.groupId !== gid) await Cloud.setActiveGroup(gid); return r; }, g.id);
ok(j && j.ok !== false, `guest joins the group (${JSON.stringify(j)})`);
await until(A.page, (gid) => Online.groupId === gid, g.id);
await until(Bp.page, (gid) => Online.groupId === gid, g.id);

for (const P of [A, Bp]) { await P.page.click("#btnMenuOnline"); }
await A.page.click("#olHost");
await until(A.page, () => !!Online.tableId);
await Bp.page.waitForTimeout(800);
await Bp.page.click("#olRefresh");
await Bp.page.waitForSelector(".ol-join", { timeout: 20000 });
await Bp.page.click(".ol-join");
await until(A.page, () => Online.players.length === 2);
ok(await A.page.isVisible("[data-cpu='5']"), "host sees the computers picker in the lobby");
await A.page.click("[data-cpu='5']");
if (process.env.SHOTS) await A.page.screenshot({ path: path.join(process.env.SHOTS, "online-lobby.png") });
await A.page.evaluate(() => { if (window.Solo) Solo.delay = 120; }); // quicker computers for the test
await A.page.click("#olStart");
await until(A.page, () => Online.table && Online.table.status === "night" && Online.myPrivate && Online.myPrivate.role);
await until(Bp.page, () => Online.table && Online.table.status === "night" && Online.myPrivate && Online.myPrivate.role);
const ids = { A: await A.page.evaluate(() => Online.me.uid), B: await Bp.page.evaluate(() => Online.me.uid), tid: await A.page.evaluate(() => Online.tableId) };
const n = await Bp.page.evaluate(() => Online.table.seatOrder.length);
ok(n === 7, `the table seats 2 people + 5 computers (${n})`);
const pvB = await Bp.page.evaluate(() => Online.myPrivate);
ok(pvB && pvB.role && (pvB.role !== "liberal" || !(pvB.knownFascists || []).length) && !("roleOf" in pvB),
  `the guest's private doc holds only what the guest may know (${JSON.stringify(pvB)})`);
await A.page.click("#olBegin");
await until(Bp.page, () => Online.table.status === "playing");

// Secrets stay secret: the guest can't read the host's private doc or the full state.
const leak = await Bp.page.evaluate(async ({ gid, tid, hostUid }) => {
  const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");
  const { getApp } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js");
  const db = getFirestore(getApp());
  const tryRead = async (...p) => { try { await getDoc(doc(db, ...p)); return "READ"; } catch (e) { return e.code || String(e); } };
  return {
    hostPrivate: await tryRead("groups", gid, "tables", tid, "private", hostUid),
    cpuPrivate: await tryRead("groups", gid, "tables", tid, "private", "cpu-1"),
    hostState: await tryRead("groups", gid, "tables", tid, "host", "state"),
  };
}, { gid: g.id, tid: ids.tid, hostUid: ids.A });
ok(/permission/.test(leak.hostPrivate) && /permission/.test(leak.cpuPrivate) && /permission/.test(leak.hostState), `guest is refused the host's secrets (${JSON.stringify(leak)})`);

// Card lists and roles; (lastElection.passed is a public true/false, not cards.)
const SECRET = /roleOf|hitlerUid|fascistUids|"deck":|"drawn":|"passed":\[|"learned":/;
let leaks = 0, stepsA = 0, stepsB = 0, rounds = 0, shot = false;
const t0 = Date.now();
while (Date.now() - t0 < 6 * 60 * 1000) {
  const st = await Bp.page.evaluate(() => ({ phase: Online.table && Online.table.phase, status: Online.table && Online.table.status, pub: JSON.stringify(Online.table), priv: JSON.stringify(Online.myPrivate || {}), ev: (Online.table && Online.table.events || []).length }));
  if (st.phase !== "gameover" && SECRET.test(st.pub)) leaks++; // roles are revealed at game over by design
  rounds = st.ev;
  if (st.phase === "gameover") break;
  if (!shot && st.ev >= 3 && process.env.SHOTS) { shot = true; await Bp.page.screenshot({ path: path.join(process.env.SHOTS, "online-guest-mid.png") }); }
  if (await humanStep(A.page)) stepsA++;
  if (await humanStep(Bp.page)) stepsB++;
  await A.page.waitForTimeout(120);
}
const endA = await A.page.evaluate(() => Online.table && { phase: Online.table.phase, winner: Online.table.winner });
await until(Bp.page, () => Online.table && Online.table.phase === "gameover", null, 20000).catch(() => {});
const endB = await Bp.page.evaluate(() => Online.table && { phase: Online.table.phase, winner: Online.table.winner });
ok(endA && endA.phase === "gameover" && endB && endB.phase === "gameover" && endA.winner === endB.winner, `the game ends with the same winner on both phones (${JSON.stringify([endA, endB])}, ${rounds} log entries, taps host ${stepsA} guest ${stepsB})`);
ok(leaks === 0, `the public table never carried a secret (${leaks} snapshots did)`);
ok(stepsA > 0 && stepsB > 0, "both people actually played");
await Bp.page.waitForTimeout(800);
ok(/win/.test(await Bp.page.textContent("#olAction")), "the guest's screen says who won");
if (process.env.SHOTS) { await A.page.screenshot({ path: path.join(process.env.SHOTS, "online-host-over.png") }); await Bp.page.screenshot({ path: path.join(process.env.SHOTS, "online-guest-over.png") }); }
const rec = await A.page.evaluate(() => { const gs = JSON.parse(localStorage.getItem("secretHitler.games.v1") || "[]"); return gs.length ? gs[gs.length - 1].players.map((p) => p.name) : null; });
ok(rec && rec.length === 7 && rec.filter((x) => /\(computer\)$/.test(x)).length === 5, `the host records the game with the 5 computers marked (${JSON.stringify(rec)})`);
for (const P of [A, Bp]) {
  const f = await P.page.evaluate(() => ({ w: document.scrollingElement.scrollWidth, vw: innerWidth }));
  ok(f.w <= f.vw, `no sideways scroll (${JSON.stringify(f)})`);
}
ok(outside.length === 0, "no request went anywhere but localhost, the emulators and gstatic (" + outside.slice(0, 5).join(" | ") + ")");
// Windows WebKit's network stack sometimes can't re-send a POST to the emulator
// ("rewinding of the data stream failed"); the SDK retries and the game goes on.
// Counted and reported, not failed: it is the test machine, not the app.
const isTransport = (e) => /rewinding of the data stream failed/.test(e);
const transport = A.errors.concat(Bp.errors).filter(isTransport).length;
if (transport) console.log(`  note: ${transport} WebKit/emulator transport retries (not app errors)`);
const errs = A.errors.concat(Bp.errors).filter((e) => !isTransport(e));
ok(errs.length === 0, "no page or console errors (" + errs.join(" | ") + ")");

await A.ctx.close(); await Bp.ctx.close();
await browser.close();
server.close();
console.log(`online.e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
