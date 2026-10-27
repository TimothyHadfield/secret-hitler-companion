/* Runs the home-screen kit's own check (tools/pwa-check.mjs, kept unchanged) with
 * every request that would leave localhost aborted. This app loads Firebase from
 * gstatic at start-up (accounts, sync, online play); the kit's check would let that
 * reach the real internet and the live Firebase project, which tests must never do.
 *   node test/pwa.check.mjs --engine chromium   (iPhone 393x659; about 70 s)
 * WebKit (the default) passes every step up to the weak-signal one, then its next
 * page load never fires "load" in headless WebKit (2026-10-27, not seen in Chromium).
 * The kit's "nothing left localhost" line lists those blocked Firebase requests;
 * that line is expected to say FAIL for this app and is reported separately below. */
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(path.join(os.homedir(), ".claude", "tools", "node_modules", "x.js"));
let pw;
try { pw = req("playwright"); } catch (e) { console.log("pwa.check.mjs: SKIPPED (Playwright not found)"); process.exit(0); }

for (const name of ["webkit", "chromium"]) {
  const launch = pw[name].launchPersistentContext.bind(pw[name]);
  pw[name].launchPersistentContext = async (...args) => {
    const ctx = await launch(...args);
    await ctx.route((u) => !/^http:\/\/localhost:\d+\//.test(u.href), (r) => r.abort());
    if (process.env.PWA_DEBUG) {
      const pending = new Map();
      const track = (p) => {
        p.on("request", (r) => pending.set(r, Date.now()));
        p.on("requestfinished", (r) => pending.delete(r));
        p.on("requestfailed", (r) => pending.delete(r));
      };
      ctx.pages().forEach(track); ctx.on("page", track);
      setInterval(() => { const old = [...pending].filter(([, t]) => Date.now() - t > 8000).map(([r]) => r.url()); if (old.length) log("PENDING " + old.join(" ")); }, 5000).unref();
    }
    return ctx;
  };
}

// The kit check prints PASS/FAIL lines and exits; keep its output, judge it here.
const lines = [];
const log = console.log.bind(console);
console.log = (...a) => { const s = a.join(" "); lines.push(s); log(s); };
const exit = process.exit.bind(process);
let summarized = false;
process.on("exit", (code) => { if (!summarized) log("pwa.check: crashed before finishing (exit " + code + ")"); });
process.on("unhandledRejection", (e) => { log("pwa.check: crashed: " + (e && e.message)); summarized = true; exit(1); });
process.exit = (code) => {
  summarized = true;
  const fails = lines.filter((l) => /^FAIL/.test(l));
  const onlyFirebase = (l) => /nothing left localhost/.test(l) &&
    !/[^|\s]/.test((l.split("localhost  (")[1] || "x").replace(/\)$/, "").replace(/left localhost: https:\/\/www\.gstatic\.com\/firebasejs\/\S+/g, "").replace(/\|/g, ""));
  const real = fails.filter((l) => !onlyFirebase(l));
  const crashed = code && !fails.length;
  log(crashed ? `pwa.check: crashed after ${lines.filter((l) => /^PASS/.test(l)).length} passes`
    : `pwa.check: ${lines.filter((l) => /^PASS/.test(l)).length} passed, ${real.length} failed` + (fails.length > real.length ? " (plus the blocked Firebase CDN requests, as intended)" : ""));
  exit(real.length || crashed ? 1 : 0);
};
process.argv.push("--config", path.join(ROOT, "test", "pwa-check.json"), "--dir", ROOT);
await import(pathToFileURL(path.join(ROOT, "tools", "pwa-check.mjs")).href);
