/* Node test for js/stats.js storage writes. Run: node test/stats.test.js
 * Focus: a full localStorage quota must not throw out of Stats (2026-10-17
 * sweep bug: saveGames had no try/catch, so recording a game on a full phone
 * threw and nothing told the user). */
let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log("  FAIL " + label); } }

// Minimal localStorage with a switch that makes every write fail like Safari's
// QuotaExceededError.
const store = new Map();
let full = false;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (full) { const e = new Error("The quota has been exceeded."); e.name = "QuotaExceededError"; throw e; }
    store.set(k, String(v));
  },
  removeItem: (k) => store.delete(k),
};
const Stats = require("../js/stats.js");
const KEY = "secretHitler.games.v1";

const game = (id) => ({
  id, players: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }], playerCount: 5, firstPres: 0,
  events: [{ type: "gov", presidentIdx: 0, chancellorIdx: 1, claimLibs: 1, conflict: false, enacted: "L" }],
  roundMods: {}, result: { winner: "Liberal", hitlerIdx: 2, fascistIdxs: [3] }, date: "2026-10-17T00:00:00.000Z",
});

// Normal path still works.
ok(!!Stats.recordGame(game("g1")), "recordGame returns truthy when the write succeeds");
ok(JSON.parse(store.get(KEY)).length === 1, "game persisted");

let errors = 0;
if (typeof Stats.setSaveErrorHandler === "function") Stats.setSaveErrorHandler(() => errors++);
ok(typeof Stats.setSaveErrorHandler === "function", "Stats exposes setSaveErrorHandler");

full = true;
let threw = false, res;
try { res = Stats.recordGame(game("g2")); } catch (e) { threw = true; }
ok(!threw, "recordGame does not throw when storage is full");
ok(res === false, "recordGame returns false when the write fails");
ok(errors === 1, "save-error handler called once (got " + errors + ")");
ok(JSON.parse(store.get(KEY)).length === 1 && JSON.parse(store.get(KEY))[0].id === "g1", "stored games untouched by the failed write");

const quiet = (fn) => { try { return fn(); } catch (e) { return "threw"; } };
ok(quiet(() => Stats.setLabel("g1", "x")) === false, "setLabel returns false on a full quota");
ok(quiet(() => Stats.setFavorite("g1", true)) === false, "setFavorite returns false on a full quota");
ok(quiet(() => Stats.setResult("g1", { winner: "Fascist", hitlerIdx: 2, fascistIdxs: [3] })) === false, "setResult returns false on a full quota");
ok(quiet(() => Stats.deleteGame("g1")) === false, "deleteGame returns false on a full quota");
const imp = quiet(() => Stats.importData({ app: "secret-hitler-companion", schema: 1, games: [game("g3")] }));
ok(imp !== "threw" && imp.saveFailed === true && imp.added === 0, "importData reports saveFailed instead of throwing");
ok(errors === 6, "handler called for every failed write (got " + errors + ")");

full = false;
ok(Stats.setLabel("g1", "Friday") === true, "setLabel returns true once storage has room");
ok(Stats.loadAllGames()[0].label === "Friday", "label written");

console.log(`stats.test.js: ${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
