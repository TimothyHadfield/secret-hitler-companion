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

// --------------------------------------------------------------------------
section("7. Role posterior — invariants and sanity");
{
  // No governments at all: every player is fascist with the base rate f/n, and
  // the marginals sum to exactly the fascist count.
  const g = { playerCount: 7, fascistCount: 2, forcedFascist: [], rounds: [] };
  const a = Honesty.analyzeGame(g);
  const sum = a.pFascist.reduce((x, y) => x + y, 0);
  close("no evidence -> everyone at base rate", a.pFascist[0], 2 / 7, 1e-9);
  close("marginals sum to the fascist count", sum, 2, 1e-9);
}
{
  // A forced fascist (e.g. Hitler was elected Chancellor) is pinned to 1.
  const g = { playerCount: 7, fascistCount: 2, forcedFascist: [3], rounds: [] };
  const a = Honesty.analyzeGame(g);
  close("a revealed fascist reads 1.0", a.pFascist[3], 1, 1e-9);
  close("marginals still sum to the fascist count", a.pFascist.reduce((x, y) => x + y, 0), 2, 1e-9);
  ok("the pinned player pulls the others down", a.pFascist[0] < 2 / 7);
}
{
  // A president who repeatedly enacts FASCIST from hands they CLAIM were
  // liberal-heavy should end up more likely fascist than the base rate; a
  // president who keeps enacting liberal should end up less.
  const rounds = [{
    startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0,
    govs: [
      { presIdx: 0, chanIdx: 1, claim: 2, enacted: "F", vetoed: false, conflict: false },
      { presIdx: 2, chanIdx: 3, claim: 2, enacted: "L", vetoed: false, conflict: false },
    ],
  }];
  const a = Honesty.analyzeGame({ playerCount: 5, fascistCount: 1, forcedFascist: [], rounds });
  ok("the fascist-enacting president is above base rate", a.pFascist[0] > 1 / 5, "p0=" + a.pFascist[0].toFixed(3));
  ok("the liberal-enacting president is below base rate", a.pFascist[2] < 1 / 5, "p2=" + a.pFascist[2].toFixed(3));
  ok("the suspicious president outranks the clean one", a.pFascist[0] > a.pFascist[2]);
}
{
  // A conflict should implicate the pair (president or chancellor), lifting both
  // above the base rate relative to uninvolved players.
  const rounds = [{
    startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0,
    govs: [{ presIdx: 0, chanIdx: 1, claim: 2, enacted: "F", vetoed: false, conflict: true }],
  }];
  const a = Honesty.analyzeGame({ playerCount: 7, fascistCount: 2, forcedFascist: [], rounds });
  ok("conflict lifts the president above base", a.pFascist[0] > 2 / 7, "p0=" + a.pFascist[0].toFixed(3));
  ok("conflict lifts the chancellor above base", a.pFascist[1] > 2 / 7, "p1=" + a.pFascist[1].toFixed(3));
  ok("an uninvolved player stays at/under base", a.pFascist[5] <= 2 / 7 + 1e-9);
}

// --------------------------------------------------------------------------
section("8. Role posterior vs. a fully independent brute-force");
// Enumerate every (fascist-set, Hitler) assignment by hand, and for each
// enumerate every feasible hand vector explicitly (no DP), applying EVERY factor
// the engine uses — hands, nominations, investigations, kills, specials, peeks.
// This mirrors analyzeGame from first principles, so a mistake in the recursion,
// the role behaviour, or any factor cannot hide.
function bruteRole(game, prm) {
  const p = Object.assign({}, Honesty.DEFAULTS, prm || {});
  const n = game.playerCount, f = game.fascistCount;
  const cautious = game.cautiousHitler != null ? game.cautiousHitler : n >= 7;
  const rounds = game.rounds.map((r) => {
    const T = r.startL - (r.chaosLibs || 0);
    const chaosN = (r.chaosLibs || 0) + (r.chaosFascs || 0);
    const R = Math.max(0, r.startN - 3 * r.govs.length - chaosN);
    const govs = r.govs.map((g) => {
      const [lo, hi] = Honesty._handBounds(g, Math.max(0, T));
      return Object.assign({}, g, { lo, hi });
    });
    return { govs, T, R, prior: Prob.drawDistribution(r.startN, r.startL) };
  });
  const As = Honesty._assignments(n, f, game.forcedFascist, game.forcedHitler, game.notHitler);
  const roleOf = (A, i) => (i === A.H ? "H" : A.S.has(i) ? "F" : "L");
  const knows = (role) => role === "F" || (role === "H" && !cautious);
  const bhv = (A, i, g) => Honesty._roleBehaviour(roleOf(A, i), { fac: g.facBefore || 0, lib: g.libBefore || 0 }, p, cautious);
  const roundMassBrute = (r, A) => {
    let mass = 0;
    const walk = (j, used, w) => {
      if (j === r.govs.length) {
        const leftover = r.T - used;
        if (leftover < 0 || leftover > r.R) return;
        mass += w * Prob.binom(r.R, leftover);
        return;
      }
      const g = r.govs[j];
      const rel = {
        chanKnowsPresAlly: knows(roleOf(A, g.chanIdx)) && A.S.has(g.presIdx),
        presKnowsChanAlly: knows(roleOf(A, g.presIdx)) && A.S.has(g.chanIdx),
      };
      for (let h = g.lo; h <= g.hi; h++) {
        if (used + h > r.T) break;
        let step = Prob.binom(3, h) * Honesty._govLikelihoodTeam(g, h, bhv(A, g.presIdx, g), bhv(A, g.chanIdx, g), r.prior, p, rel);
        if (g.peek) step *= Honesty._teamReport(g.peek.peekLibs, h, bhv(A, g.peek.peekerIdx, g), r.prior, p);
        if (step === 0) continue;
        walk(j + 1, used + h, w * step);
      }
    };
    walk(0, 0, 1);
    return mass;
  };
  const scoreOf = (A) => {
    let s = 1;
    for (const r of rounds) {
      if (r.govs.length) s *= roundMassBrute(r, A);
      for (const g of r.govs) { // nominations
        const rP = roleOf(A, g.presIdx);
        if (knows(rP) && A.S.has(g.chanIdx)) s *= p.nomAffinity;
      }
    }
    for (const iv of game.investigations || []) {
      const tru = A.S.has(iv.targetIdx) ? "F" : "L";
      const role = roleOf(A, iv.investIdx);
      const truthful = iv.party === tru;
      s *= role === "L" ? (truthful ? 1 - p.mu : p.mu) : (truthful ? 1 - p.investLie : p.investLie);
    }
    for (const k of game.kills || []) if (knows(roleOf(A, k.killerIdx)) && A.S.has(k.victimIdx)) s *= p.killAllyPenalty;
    for (const sp of game.specials || []) if (knows(roleOf(A, sp.chooserIdx)) && A.S.has(sp.chosenIdx)) s *= p.specialAffinity;
    return s;
  };
  const scores = As.map(scoreOf);
  const Z = scores.reduce((a, b) => a + b, 0);
  const pF = new Array(n).fill(0), pH = new Array(n).fill(0);
  if (Z > 0) As.forEach((A, i) => { for (const idx of A.S) pF[idx] += scores[i] / Z; pH[A.H] += scores[i] / Z; });
  return { pFascist: pF, pHitler: pH };
}
[
  { playerCount: 5, fascistCount: 1, forcedFascist: [], rounds: [{
      startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0,
      govs: [
        { presIdx: 0, chanIdx: 1, claim: 2, enacted: "F", vetoed: false, conflict: false, facBefore: 0, libBefore: 0 },
        { presIdx: 2, chanIdx: 3, claim: 1, enacted: "L", vetoed: false, conflict: false, facBefore: 1, libBefore: 0 },
        { presIdx: 4, chanIdx: 0, claim: 0, enacted: "F", vetoed: false, conflict: false, facBefore: 1, libBefore: 1 },
      ] }] },
  { playerCount: 7, fascistCount: 2, forcedFascist: [], rounds: [
      { startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0, govs: [
        { presIdx: 1, chanIdx: 2, claim: 2, enacted: "F", vetoed: false, conflict: true, facBefore: 0, libBefore: 0 } ] },
      { startN: 11, startL: 4, chaosLibs: 1, chaosFascs: 0, govs: [
        { presIdx: 3, chanIdx: 4, claim: 1, enacted: "L", vetoed: false, conflict: false, facBefore: 2, libBefore: 1 },
        { presIdx: 0, chanIdx: 1, claim: 3, enacted: "F", vetoed: false, conflict: false, facBefore: 2, libBefore: 2,
          peek: { peekerIdx: 3, peekLibs: 1 } } ] } ],
    investigations: [{ investIdx: 1, targetIdx: 3, party: "F" }],
    kills: [{ killerIdx: 0, victimIdx: 5 }],
    specials: [{ chooserIdx: 2, chosenIdx: 1 }],
    forcedHitler: null, notHitler: [6] },
].forEach((game, i) => {
  const mine = Honesty.analyzeGame(game);
  const brute = bruteRole(game);
  let worstF = 0, worstH = 0;
  for (let k = 0; k < game.playerCount; k++) {
    worstF = Math.max(worstF, Math.abs(mine.pFascist[k] - brute.pFascist[k]));
    worstH = Math.max(worstH, Math.abs(mine.pHitler[k] - brute.pHitler[k]));
  }
  ok(`game ${i + 1}: fascist marginals match brute force`, worstF < 1e-9, "max diff " + worstF);
  ok(`game ${i + 1}: Hitler marginals match brute force`, worstH < 1e-9, "max diff " + worstH);
});

// --------------------------------------------------------------------------
section("9. The new signals each move the odds the right way");
// Isolate each factor with an otherwise-empty game (no governments), so the test
// measures that one signal and not its interaction with the nomination signal.
const base7 = () => ({ playerCount: 7, fascistCount: 2, rounds: [] });
{
  // A liberal investigator reporting "fascist" on a target makes that target
  // much more likely fascist than an uninvolved seat.
  const g = base7();
  g.investigations = [{ investIdx: 0, targetIdx: 3, party: "F" }];
  const a = Honesty.analyzeGame(g);
  ok("an accused target rises above base", a.pFascist[3] > 2 / 7, "p3=" + a.pFascist[3].toFixed(3));
}
{
  // A special-election pick lifts BOTH the chooser and the chosen (either could
  // be the fascist elevating an ally).
  const g = base7();
  g.specials = [{ chooserIdx: 0, chosenIdx: 3 }];
  const a = Honesty.analyzeGame(g);
  ok("special-election chooser rises", a.pFascist[0] > 2 / 7, "p0=" + a.pFascist[0].toFixed(3));
  ok("special-election pick rises", a.pFascist[3] > 2 / 7, "p3=" + a.pFascist[3].toFixed(3));
}
{
  // A peek by seat 0 that wildly over-claims liberals (says 3L) on cards that a
  // clean follow-up government reveals to be fascist-heavy makes the PEEKER look
  // like a liar → more likely fascist than a bystander.
  const g = { playerCount: 7, fascistCount: 2, rounds: [{ startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0, govs: [
    { presIdx: 4, chanIdx: 5, claim: 1, enacted: "L", vetoed: false, conflict: false, facBefore: 0, libBefore: 0 },
    { presIdx: 3, chanIdx: 6, claim: 0, enacted: "F", vetoed: false, conflict: false, facBefore: 1, libBefore: 1,
      peek: { peekerIdx: 0, peekLibs: 3 } } ] }] };
  const a = Honesty.analyzeGame(g);
  ok("a peeker whose peek is contradicted looks fascist", a.pFascist[0] > a.pFascist[2],
     "p0=" + a.pFascist[0].toFixed(3) + " p2(bystander)=" + a.pFascist[2].toFixed(3));
}
{
  // A "phantom" peek — the peeker reports a 3-card sample (a vetoed pseudo-gov)
  // BEFORE any government draws those cards. Claiming 3 liberals from a round pool
  // that holds only 2 is a provable lie, so the peeker (seat 0) must jump above
  // base immediately — no next government required.
  const pool2 = { playerCount: 5, fascistCount: 2, rounds: [{ startN: 8, startL: 2, chaosLibs: 0, chaosFascs: 0, govs: [
    { presIdx: 1, chanIdx: 2, claim: 0, enacted: "F", vetoed: false, conflict: false, facBefore: 0, libBefore: 0 },
    { presIdx: 0, chanIdx: 0, claim: 3, enacted: null, vetoed: true, conflict: false, facBefore: 1, libBefore: 0, phantom: true },
  ] }] };
  const a = Honesty.analyzeGame(pool2);
  ok("an impossible phantom peek outs the peeker", a.pFascist[0] > 0.6, "p0=" + a.pFascist[0].toFixed(3));
  const plaus = JSON.parse(JSON.stringify(pool2)); plaus.rounds[0].govs[1].claim = 1;
  ok("a plausible phantom peek moves the peeker far less",
     Honesty.analyzeGame(plaus).pFascist[0] < a.pFascist[0], "p0=" + Honesty.analyzeGame(plaus).pFascist[0].toFixed(3));
}
{
  // A fascist executing a fellow fascist is unlikely, so an execution makes the
  // victim LESS likely to be fascist than base.
  const g = base7();
  g.kills = [{ killerIdx: 0, victimIdx: 3 }];
  const a = Honesty.analyzeGame(g);
  ok("an execution victim drops below base", a.pFascist[3] < 2 / 7, "p3=" + a.pFascist[3].toFixed(3));
}
{
  // pHitler sums to 1, and a seat proven not-Hitler (D8/D9) reads 0.
  const g = base7();
  g.notHitler = [0, 1, 2];
  const a = Honesty.analyzeGame(g);
  close("pHitler sums to 1", a.pHitler.reduce((x, y) => x + y, 0), 1, 1e-9);
  close("a not-Hitler seat reads 0", a.pHitler[0], 0, 1e-12);
}
{
  // The nomination signal, isolated with a vetoed government (which enacts
  // nothing, so it carries no policy signal to compete). The nominator and
  // nominee should each be more suspect than an uninvolved bystander (seat 5).
  const g = { playerCount: 7, fascistCount: 2, rounds: [{ startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0,
    govs: [{ presIdx: 0, chanIdx: 3, claim: 1, enacted: null, vetoed: true, conflict: false, facBefore: 0, libBefore: 0 }] }] };
  const a = Honesty.analyzeGame(g);
  ok("nominee more suspect than a bystander", a.pFascist[3] > a.pFascist[5],
     "p3=" + a.pFascist[3].toFixed(3) + " p5=" + a.pFascist[5].toFixed(3));
  ok("nominator more suspect than a bystander", a.pFascist[0] > a.pFascist[5],
     "p0=" + a.pFascist[0].toFixed(3) + " p5=" + a.pFascist[5].toFixed(3));
}
{
  // A cautious Hitler (7+) that keeps enacting liberal is under-suspected on the
  // fascist read relative to a pushy fascist doing the same visible actions —
  // i.e. modelling Hitler distinctly changes the answer.
  const push = { playerCount: 7, fascistCount: 2, cautiousHitler: true, rounds: [{ startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0,
    govs: [{ presIdx: 0, chanIdx: 1, claim: 2, enacted: "F", vetoed: false, conflict: false, facBefore: 3, libBefore: 0 }] }] };
  const a = Honesty.analyzeGame(push);
  ok("a late fascist policy still implicates its president", a.pFascist[0] > 2 / 7, "p0=" + a.pFascist[0].toFixed(3));
}

// --------------------------------------------------------------------------
section("9. Correlated fascist behaviour (§12.7)");
{
  const D = Honesty.DEFAULTS;
  const facBhv = Honesty._roleBehaviour("F", { fac: 0, lib: 0 }, D, false);
  // Coordination raises a fascist chancellor's enact-fascist rate from a mixed
  // pass when the president is a known ally — and never lowers it (verified end to
  // end via analyzeGame below; here just the rate arithmetic the model applies).
  ok("coordinated enact-F rate > independent enact-F rate",
     Math.min(D.pushMax, facBhv.gamma + D.coordBump) > facBhv.gamma);
  // Framing an ally is much rarer than framing a non-ally; a truthful conflict is unaffected.
  ok("falseAccuseAlly < falseAccuseFasc (framing a teammate is rare)", D.falseAccuseAlly < D.falseAccuseFasc);

  // Integration — isolate coordination (coordBump only). A pair that repeatedly
  // co-governs and enacts fascist from mixed-pass-capable hands reads as MORE
  // fascist together with coordination on than with it off. 5p ⇒ Hitler knows the
  // fascist, so both seats coordinate.
  const g = { playerCount: 5, fascistCount: 2, forcedFascist: [], rounds: [{
    startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0,
    govs: [
      { presIdx: 0, chanIdx: 1, claim: 1, enacted: "F", vetoed: false, conflict: false, facBefore: 0, libBefore: 0 },
      { presIdx: 0, chanIdx: 1, claim: 1, enacted: "F", vetoed: false, conflict: false, facBefore: 1, libBefore: 0 },
    ] }] };
  const on = Honesty.analyzeGame(g);
  const off = Honesty.analyzeGame(g, { coordBump: 0 });
  ok("coordination raises the co-governing pair's fascist odds (pres)",
     on.pFascist[0] > off.pFascist[0] + 1e-9, `on=${on.pFascist[0].toFixed(4)} off=${off.pFascist[0].toFixed(4)}`);
  ok("coordination raises the co-governing pair's fascist odds (chan)",
     on.pFascist[1] > off.pFascist[1] + 1e-9, `on=${on.pFascist[1].toFixed(4)} off=${off.pFascist[1].toFixed(4)}`);
  // Turning both correlated terms off leaves marginals still summing to the fascist count.
  close("correlated model still conserves the fascist count", on.pFascist.reduce((x, y) => x + y, 0), 2, 1e-9);
}
{
  // The ally-reduction makes a conflict weaker evidence that the pair are BOTH
  // fascist: with it on, the model shifts mass toward "exactly one of the pair is
  // fascist", so the expected # fascists among the pair (p0+p1) is no larger than
  // with the reduction disabled (falseAccuseAlly = falseAccuseFasc).
  const g = { playerCount: 7, fascistCount: 2, forcedFascist: [], rounds: [{
    startN: 17, startL: 6, chaosLibs: 0, chaosFascs: 0,
    govs: [{ presIdx: 0, chanIdx: 1, claim: 1, enacted: "F", vetoed: false, conflict: true, facBefore: 0, libBefore: 0 }] }] };
  const on = Honesty.analyzeGame(g);
  const off = Honesty.analyzeGame(g, { falseAccuseAlly: Honesty.DEFAULTS.falseAccuseFasc });
  ok("a conflict is gentler evidence the pair are BOTH fascist",
     (on.pFascist[0] + on.pFascist[1]) <= (off.pFascist[0] + off.pFascist[1]) + 1e-9,
     `on=${(on.pFascist[0] + on.pFascist[1]).toFixed(4)} off=${(off.pFascist[0] + off.pFascist[1]).toFixed(4)}`);
  // …but the conflict still implicates the pair over a bystander.
  ok("conflict still lifts the pair over a bystander", on.pFascist[0] > on.pFascist[5] && on.pFascist[1] > on.pFascist[5]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
