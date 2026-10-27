/* The build id of this deploy. Bump it on every change that ships (see
 * CLAUDE.md "Deploy"): run `node test/bump-build.js`, which rewrites this
 * file, version.json and every ?v= in index.html together. app.js compares it
 * with version.json (fetched no-store) to move an old open page to a new build. */
window.SH_BUILD = "2026-10-27.3";
