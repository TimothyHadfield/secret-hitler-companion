/* Node tests for js/honesty.js and the chaos-aware fix in js/probability.js.
 * No dependencies — run with:  node test/honesty.test.js
 *
 * The important test here is #3: the dynamic program is cross-checked against a
 * brute-force enumeration written independently, so a mistake in the
 * forward/backward recursion cannot hide behind a plausible-looking number.
 */
const Prob = require("../js/probability.js");
const Honesty = require("../js/honesty.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  " + extra : ""}`); }
}
function close(name, a, b, eps = 1e-9) {
  ok(name, Math.abs(a - b) < eps, `got ${a}, want ${b}`);
}
function section(t) { console.log(`\n${t}`); }

// --------------------------------------------------------------------------
section("1. Hard logic — the HONESTY_MODEL.md §2b worked example");
// Pool of 8 with 2 liberals, two governments, both enacted LIBERAL.
// Both enacted L => each hand held >=1 liberal => h1+h2 >= 2, and conservation
// says h1+h2+r = 2, so r=0 and h1=h2=1 exactly. Claim of 2L is therefore false
// and the claim of 1L is therefore true — with no priors involved at all.
{
  const round = {
    startN: 8, startL: 2, chaosLibs: 0, chaosFascs: 0,
    govs: [
      { claim: 2, enacted: "L", vetoed: false, conflict: false },
      { claim: 1, enacted: "L", vetoed: false, conflict: false },
    ],
  };
  const a = Honesty.analyzeRound(round);
  ok("exactly one claim must be false", a.minLies === 1, `got ${a.minLies}`);
  ok("the 2L claim is proven false", a.govs[0].provenFalse === true);
  ok("the 1L claim is proven true", a.govs[1].provenTrue === true);
  ok("the 2L claim is not proven true", a.govs[0].provenTrue === false);
  close("posterior agrees the hand was 1L", a.govs[1].handPosterior[1], 1);
  close("posterior rules the 2L claim out", a.govs[0].pTrue, 0);
}

// --------------------------------------------------------------------------
section("2. Hard logic — feasibility, veto bounds, and the impossible story");
{
  // Three governments claiming 2L each out of a pool holding only 3 liberals,
  // with no unseen slack (R = 9 - 9 = 0). Every hand enacted a liberal so every
  // hand held >= 1, and they must sum to exactly 3 — so every hand was exactly
  // 1L and all three claims of 2L are false.
  const round = {
    startN: 9, startL: 3, chaosLibs: 0, chaosFascs: 0,
    govs: [
      { claim: 2, enacted: "L", vetoed: false, conflict: false },
      { claim: 2, enacted: "L", vetoed: false, conflict: false },
      { claim: 2, enacted: "L", vetoed: false, conflict: false },
    ],
  };
  const a = Honesty.analyzeRound(round);
  ok("R collapses to zero", a.leftover === 0);
  ok("evidence is exact when nothing is unseen", a.evidence === "exact");
  ok("all three claims must be false", a.minLies === 3, `got ${a.minLies}`);
  ok("every claim is proven false here", a.govs.every((g) => g.provenFalse));
}
{
  // A vetoed government enacts nothing, so it carries no enacted-card bound.
  const [lo, hi] = Honesty._handBounds({ vetoed: true, enacted: null }, 6);
  ok("veto leaves the hand unconstrained", lo === 0 && hi === 3);
  const [lo2, hi2] = Honesty._handBounds({ vetoed: false, enacted: "L" }, 6);
  ok("an enacted liberal forces h >= 1", lo2 === 1 && hi2 === 3);
  const [lo3, hi3] = Honesty._handBounds({ vetoed: false, enacted: "F" }, 6);
  ok("an enacted fascist forces h <= 2", lo3 === 0 && hi3 === 2);
}
{
  // Claiming 1F2L means claiming you passed LL — from which no chancellor can
  // produce a fascist policy. Claiming 2F1L with a conflict is fine (pass = LF).
  ok("1F2L + conflict is an impossible story",
    Honesty._hasImpossibleStory({ claim: 2, conflict: true, vetoed: false }) === true);
  ok("2F1L + conflict is a perfectly possible story",
    Honesty._hasImpossibleStory({ claim: 1, conflict: true, vetoed: false }) === false);
  ok("a veto cannot produce the contradiction",
    Honesty._hasImpossibleStory({ claim: 2, conflict: true, vetoed: true }) === false);
}

// --------------------------------------------------------------------------
section("3. The DP posterior vs. an independent brute-force enumeration");
// Enumerate every feasible hand vector explicitly and compare marginals. This
// is what proves the forward/backward recursion is actually computing the
// distribution it claims to compute.
function bruteForce(round, prm) {
  const p = Object.assign({}, Honesty.DEFAULTS, prm || {});
  const G = round.govs.length;
  const chaosN = (round.chaosLibs || 0) + (round.chaosFascs || 0);
  const R = Math.max(0, round.startN - 3 * G - chaosN);
  const T = round.startL - (round.chaosLibs || 0);
  const priorClaim = Prob.drawDistribution(round.startN, round.startL);
  const bounds = round.govs.map((g) => Honesty._handBounds(g, Math.max(0, T)));
  const acc = round.govs.map(() => [0, 0, 0, 0]);
  let norm = 0;
  const walk = (j, used, w) => {
    if (j === G) {
      const r = T - used;
      if (r < 0 || r > R) return;
      const tot = w * Prob.binom(R, r);
      if (tot === 0) return;
      norm += tot;
      hand.forEach((h, k) => (acc[k][h] += tot));
      return;
    }
    for (let h = bounds[j][0]; h <= bounds[j][1]; h++) {
      if (used + h > T) break;
      const step = Prob.binom(3, h) *
        Honesty._reportLikelihood(round.govs[j].claim, h, priorClaim, p);
      if (step === 0) continue;
      hand[j] = h;
      walk(j + 1, used + h, w * step);
    }
  };
  const hand = new Array(G).fill(0);
  walk(0, 0, 1);
  if (norm > 0) acc.forEach((a) => { for (let h = 0; h < 4; h++) a[h] /= norm; });
  return norm > 0 ? acc : null;
}

const CASES = [
  { startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0,
    govs: [{ claim: 0, enacted: "F" }, { claim: 1, enacted: "L" }] },
  { startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0,
    govs: [{ claim: 0, enacted: "F" }, { claim: 0, enacted: "F" },
           { claim: 1, enacted: "L" }, { claim: 2, enacted: "L" }] },
  { startN: 11, startL: 4, chaosLibs: 1, chaosFascs: 0,
    govs: [{ claim: 1, enacted: "L" }, { claim: 0, enacted: "F" }] },
  { startN: 14, startL: 5, chaosLibs: 0, chaosFascs: 1,
    govs: [{ claim: 2, enacted: "L" }, { claim: 0, enacted: "F" },
           { claim: 1, enacted: "F", conflict: true }] },
  { startN: 12, startL: 3, chaosLibs: 0, chaosFascs: 0,
    govs: [{ claim: 0, enacted: "F" }, { claim: 3, enacted: "L" },
           { claim: 1, vetoed: true, enacted: null }] },
];
CASES.forEach((c, i) => {
  const mine = Honesty.analyzeRound(c);
  const brute = bruteForce(c);
  let worst = 0;
  mine.govs.forEach((g, j) => {
    for (let h = 0; h < 4; h++) {
      worst = Math.max(worst, Math.abs(g.handPosterior[h] - brute[j][h]));
    }
  });
  ok(`case ${i + 1}: DP marginals match brute force`, worst < 1e-9, `max diff ${worst}`);
});
// Same check with the parameters pushed to their extremes, since that is where
// a normalisation mistake would show up.
[{ lieRate: 0.01 }, { lieRate: 0.6 }, { sophistication: 0 }, { sophistication: 1 },
 { upBias: 0.9 }, { decay: 0.05 }].forEach((prm, i) => {
  const c = CASES[1];
  const mine = Honesty.analyzeRound(c, prm);
  const brute = bruteForce(c, prm);
  let worst = 0;
  mine.govs.forEach((g, j) => {
    for (let h = 0; h < 4; h++) worst = Math.max(worst, Math.abs(g.handPosterior[h] - brute[j][h]));
  });
  ok(`param set ${i + 1} (${JSON.stringify(prm)}) matches`, worst < 1e-9, `max diff ${worst}`);
});

// --------------------------------------------------------------------------
section("4. The reporting model behaves as designed");
{
  const prior = Prob.drawDistribution(17, 6);
  const p = Honesty.DEFAULTS;
  let sum = 0;
  for (let c = 0; c <= 3; c++) sum += Honesty._reportLikelihood(c, 1, prior, p);
  close("report distribution sums to 1 over all claims", sum, 1, 1e-12);
  ok("truth is the single most likely report",
    Honesty._reportLikelihood(1, 1, prior, p) > 0.5);
  ok("under-reporting beats over-reporting",
    Honesty._reportLikelihood(0, 1, prior, p) > Honesty._reportLikelihood(2, 1, prior, p));
  ok("a bigger lie is less likely than a small one",
    Honesty._reportLikelihood(0, 2, prior, p) < Honesty._reportLikelihood(1, 2, prior, p));
  ok("lieRate 0 makes an honest report certain",
    Honesty._reportLikelihood(1, 1, prior, { ...p, lieRate: 0 }) === 1 &&
    Honesty._reportLikelihood(0, 1, prior, { ...p, lieRate: 0 }) === 0);
}

// --------------------------------------------------------------------------
section("5. probability.js — chaos top-decks are accounted for");
{
  // Round pool of 11 with 4 liberals; two governments and one LIBERAL chaos
  // top-deck. The chaos card is public, so it must shrink the unseen leftovers
  // AND be counted among the round's liberals.
  const N = 11, L = 4, claims = [1, 0];
  const withChaos = Prob.retrospectiveProb(N, L, claims, 0, 1, 1);
  const ignoring = Prob.retrospectiveProb(N, L, claims, 0);
  ok("accounting for chaos changes the answer", Math.abs(withChaos - ignoring) > 1e-6);

  // Verify against the definition directly: R = 11 - 6 - 1 = 4 unseen cards,
  // S = 4 - 0 (other gov) - 1 (chaos liberal) = 3 liberals split between this
  // hand and those 4 leftovers.
  const R = 4, S = 3, k = 1;
  let den = 0;
  for (let m = 0; m <= 3; m++) den += Prob.binom(3, m) * Prob.binom(R, S - m);
  close("matches the closed form", withChaos, (Prob.binom(3, k) * Prob.binom(R, S - k)) / den);

  // With no chaos the new signature must reproduce the old behaviour exactly.
  close("no-chaos call is unchanged",
    Prob.retrospectiveProb(17, 6, [0, 1], 0, 0, 0), Prob.retrospectiveProb(17, 6, [0, 1], 0));
}
{
  // The PROBABILITY_MODEL.md §4 worked check must still hold: pool of 6 with 3
  // liberals, two governments, no leftovers. Seeing 3L from the other government
  // forces this one to have been 3F.
  close("5% -> 100% worked check still holds",
    Prob.retrospectiveProb(6, 3, [0, 3], 0), 1);
}

// --------------------------------------------------------------------------
section("6. Evidence strength tracks the unseen remainder");
{
  const mk = (n, g) => ({
    startN: n, startL: 6, chaosLibs: 0, chaosFascs: 0,
    govs: Array.from({ length: g }, () => ({ claim: 1, enacted: "L" })),
  });
  ok("a fresh round is weak evidence", Honesty.analyzeRound(mk(17, 1)).evidence === "weak");
  ok("a nearly drained round is strong", Honesty.analyzeRound(mk(17, 5)).evidence === "strong");
  ok("no unseen cards is exact", Honesty.analyzeRound(mk(15, 5)).evidence === "exact");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
