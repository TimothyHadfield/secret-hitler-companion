/* Build-id consistency. Run: node test/build.test.js
 * js/build.js, version.json and every local ?v= in index.html must agree, or
 * phones either never see the new build or reload onto a stale one. Fix a
 * failure with `node test/bump-build.js`. */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log("  FAIL " + label); } }

const buildJs = fs.readFileSync(path.join(ROOT, "js", "build.js"), "utf8");
const m = /window\.SH_BUILD\s*=\s*"([^"]+)"/.exec(buildJs);
ok(!!m, "js/build.js sets window.SH_BUILD");
const BUILD = m ? m[1] : null;
let ver = null;
try { ver = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).build; } catch (e) {}
ok(ver === BUILD, `version.json build (${ver}) === js/build.js (${BUILD})`);

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const refs = [];
html.replace(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"[^>]*>/g, (tag, url) => {
  if (/^(https?:)?\/\//.test(url)) return;                  // external (CDN, preconnect)
  if (/^<link/.test(tag) && !/rel="stylesheet"/.test(tag)) return; // icons etc.
  refs.push(url);
});
ok(refs.length >= 14, `index.html has the stylesheet + all local scripts (${refs.length})`);
refs.forEach((u) => ok(u.endsWith("?v=" + BUILD), `${u} carries ?v=${BUILD}`));
ok(refs.some((u) => u.startsWith("js/build.js")), "index.html loads js/build.js");
const iBuild = html.indexOf("js/build.js"), iApp = html.indexOf("js/app.js");
ok(iBuild >= 0 && iBuild < iApp, "js/build.js loads before js/app.js");

// Home-screen kit: manifest linked, js/pwa.js before app.js (plain script, no defer)
// with data-version = this build, and the service worker at the site root.
const pwaTag = (/<script\b[^>]*src="js\/pwa\.js[^"]*"[^>]*>/.exec(html) || [""])[0];
ok(/<link rel="manifest" href="manifest\.webmanifest">/.test(html), "index.html links manifest.webmanifest");
ok(pwaTag.includes(`data-version="${BUILD}"`), `js/pwa.js carries data-version="${BUILD}"`);
ok(pwaTag && !/\bdefer\b/.test(pwaTag) && html.indexOf("js/pwa.js") < iApp, "js/pwa.js loads (not deferred) before js/app.js");
ok(fs.existsSync(path.join(ROOT, "sw.js")) && fs.existsSync(path.join(ROOT, "manifest.webmanifest")), "sw.js + manifest.webmanifest at the root");

// The modules must not import local files (those would escape the ?v= stamp).
["cloud.js", "online.js"].forEach((f) => {
  const src = fs.readFileSync(path.join(ROOT, "js", f), "utf8");
  const local = (src.match(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']/g) || []);
  ok(local.length === 0, `${f} imports no local files (${local.join(", ")})`);
});

console.log(`build.test.js: ${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
