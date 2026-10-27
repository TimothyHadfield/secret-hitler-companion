/* Give this deploy a new build id. Run from the repo root before committing a
 * change that ships:  node test/bump-build.js [id]
 * Default id: today's date plus a counter (2026-10-17.1, .2, ...). Rewrites
 * js/build.js, version.json and every ?v= in index.html together; then
 * `node test/build.test.js` should pass. */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const f = (p) => path.join(ROOT, p);
const old = /window\.SH_BUILD\s*=\s*"([^"]+)"/.exec(fs.readFileSync(f("js/build.js"), "utf8"))[1];
let id = process.argv[2];
if (!id) {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const n = old.startsWith(day + ".") ? +old.slice(day.length + 1) + 1 : 1;
  id = `${day}.${n}`;
}
const js = fs.readFileSync(f("js/build.js"), "utf8").replace(/(window\.SH_BUILD\s*=\s*")[^"]+(")/, `$1${id}$2`);
fs.writeFileSync(f("js/build.js"), js);
fs.writeFileSync(f("version.json"), JSON.stringify({ build: id }) .replace("{", "{ ").replace("}", " }") + "\n");
const html = fs.readFileSync(f("index.html"), "utf8").replace(/\?v=[^"]+"/g, `?v=${id}"`)
  .replace(/data-version="[^"]*"/g, `data-version="${id}"`); // js/pwa.js (home-screen kit) cache name
fs.writeFileSync(f("index.html"), html);
console.log(`build ${old} -> ${id}`);
