/* Node test for the lie-rate fitter (js/fit.js). Run: node test/fit.test.js
 *
 * The gold-standard check for an inference routine (HONESTY_MODEL §8): generate
 * synthetic games with KNOWN lie rates and confirm the fitter recovers them —
 * validating the code independently of whether the model matches real play.
 *
 * The generator uses single-government rounds with R = 0 (startN = 3, one gov),
 * which pins the true hand exactly (h = startL), so the ONLY latent thing is
 * whether the president misreported it. That isolates the lie-rate estimator: the
 * fitter should recover the empirical misreport rate (shrunk toward the default). */
const Fit = require("../js/fit.js");
const Honesty = require("../js/honesty.js");

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) pass++; else { fail++; console.log("  FAIL " + label + (extra ? "  (" + extra + ")" : "")); }
}
function rng(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// One pinned-hand government: h = startL is forced by R = 0. `lie` decides whether
// the reported claim differs from the true hand.
function makeSample(presIdx, h, lie, rnd) {
  const enacted = h >= 1 ? "L" : "F";
  let claim = h;
  if (lie) { const opts = [0, 1, 2, 3].filter((c) => c !== h); claim = opts[Math.floor(rnd() * opts.length)]; }
  return {
    playerCount: 5, cautiousHitler: false,
    roles: { hitlerIdx: 0, fascistIdxs: [1] }, // seat0 = Hitler (knowing), seat1 = fascist, 2–4 liberal
    rounds: [{ startN: 3, startL: h, chaosLibs: 0, chaosFascs: 0,
      govs: [{ presIdx, chanIdx: (presIdx + 1) % 5, claim, enacted, vetoed: false, conflict: false, facBefore: 0, libBefore: 0 }] }],
  };
}
// Build `count` games with a president in the given seat, lying at `rate`.
function dataset(presIdx, rate, count, seed) {
  const rnd = rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) out.push(makeSample(presIdx, i % 4, rnd() < rate, rnd));
  return out;
}

// ------------------------------------------------- edge: no data -> defaults
(function noData() {
  const r = Fit.fit([]);
  ok(Math.abs(r.params.facLie - Honesty.DEFAULTS.facLie) < 1e-9, "no games: facLie stays at the default");
  ok(Math.abs(r.params.libLie - Honesty.DEFAULTS.libLie) < 1e-9, "no games: libLie stays at the default");
  ok(r.govs === 0 && r.samples === 0, "no games: zero governments counted");
})();

// --------------------------------------------- recovery of known lie rates
(function recovery() {
  const trueFac = 0.40, trueLib = 0.20, N = 900, kappa = 6;
  // fascist-president games (seat 1 = F) recover facLie; liberal-president (seat 2) recover libLie
  const fac = dataset(1, trueFac, N, 12345);
  const lib = dataset(2, trueLib, N, 67890);
  const r = Fit.fit(fac.concat(lib), { kappa });
  ok(Math.abs(r.params.facLie - trueFac) < 0.03, "recovers the fascist lie rate", `got ${r.params.facLie.toFixed(3)} vs ${trueFac}`);
  ok(Math.abs(r.params.libLie - trueLib) < 0.03, "recovers the liberal lie rate", `got ${r.params.libLie.toFixed(3)} vs ${trueLib}`);
  ok(r.byTeam.F.opps === N && r.byTeam.L.opps === N, "each team bucketed the right number of governments");
  ok(r.params.facLie >= 1e-3 && r.params.facLie <= 0.95, "fitted rate stays in range");
  ok(r.converged, "EM converged");
})();

// ------------------------------------------------ a knowing Hitler is a fascist
(function knowingHitlerBucket() {
  // seat 0 is Hitler; at 5 players Hitler knows the team, so its reports feed the
  // FASCIST lie bucket, not the liberal one.
  const r = Fit.fit(dataset(0, 0.5, 300, 999), { kappa: 6 });
  ok(r.byTeam.F.opps === 300 && r.byTeam.L.opps === 0, "a knowing Hitler's reports count as fascist");
})();

// ------------------------------------------------ cautious Hitler is excluded
(function cautiousHitlerExcluded() {
  const games = dataset(0, 0.5, 200, 555).map((s) => Object.assign({}, s, { playerCount: 7, cautiousHitler: true }));
  const r = Fit.fit(games, { kappa: 6 });
  ok(r.byTeam.F.opps === 0 && r.byTeam.L.opps === 0, "a cautious Hitler's reports feed neither fitted rate");
})();

// ----------------------------------------------------------- shrinkage
(function shrinkage() {
  // A handful of games barely moves the estimate off the default; the same rate
  // over many games moves it much further. (Both datasets have the SAME empirical
  // rate; only the sample size differs.)
  const few = Fit.fit(dataset(1, 0.9, 8, 1), { kappa: 24 });
  const many = Fit.fit(dataset(1, 0.9, 800, 1), { kappa: 24 });
  const d0 = Honesty.DEFAULTS.facLie;
  ok(Math.abs(few.params.facLie - d0) < Math.abs(many.params.facLie - d0), "few games shrink harder toward the default");
  ok(many.params.facLie > few.params.facLie, "more evidence pulls further toward the data");
})();

// --------------------------------------------------- responsiveness + determinism
(function responsiveAndDeterministic() {
  const hi = Fit.fit(dataset(1, 0.7, 500, 7), { kappa: 6 }).params.facLie;
  const lo = Fit.fit(dataset(1, 0.1, 500, 7), { kappa: 6 }).params.facLie;
  ok(hi > lo, "a lyier group fits a higher rate than an honest one", `hi=${hi.toFixed(3)} lo=${lo.toFixed(3)}`);
  const a = Fit.fit(dataset(1, 0.5, 200, 3), { kappa: 6 }).params.facLie;
  const b = Fit.fit(dataset(1, 0.5, 200, 3), { kappa: 6 }).params.facLie;
  ok(a === b, "fitting is deterministic on identical input");
})();

// ------------------------------------- multi-gov round (R>0) exercises the DP
(function uncertainHands() {
  // Two governments in a fresh pool: hands are NOT pinned, so the forward-backward
  // marginals (not point masses) drive the E-step and EM iterates. Just assert the
  // machinery is well-behaved: finite, in-range, converges.
  const games = [];
  const rnd = rng(2024);
  for (let i = 0; i < 200; i++) {
    games.push({
      playerCount: 5, cautiousHitler: false, roles: { hitlerIdx: 0, fascistIdxs: [1] },
      rounds: [{ startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0, govs: [
        { presIdx: 1, chanIdx: 2, claim: rnd() < 0.5 ? 1 : 2, enacted: "F", vetoed: false, conflict: false, facBefore: 0, libBefore: 0 },
        { presIdx: 2, chanIdx: 3, claim: 2, enacted: "L", vetoed: false, conflict: false, facBefore: 1, libBefore: 0 },
      ] }],
    });
  }
  const r = Fit.fit(games, { kappa: 12 });
  ok(isFinite(r.params.facLie) && r.params.facLie > 0 && r.params.facLie < 1, "uncertain hands: fitted rate finite and in (0,1)");
  ok(isFinite(r.params.libLie) && r.params.libLie > 0 && r.params.libLie < 1, "uncertain hands: liberal rate finite and in (0,1)");
  ok(r.converged, "uncertain hands: EM converges");
  ok(r.iters >= 1, "uncertain hands: EM ran at least one iteration");
})();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
