/* ============================================================================
 * honesty.js — "how likely is this claim a lie?" engine.
 * See HONESTY_MODEL.md for the full derivation and the design review (§11).
 * Pure functions only; no DOM access here.
 *
 * Two layers, computed on the SAME recursion over the round's conservation law:
 *
 *   hard logic   min-plus semiring  -> fewest claims that MUST be false
 *   posterior    sum-product        -> P(this claim was true)
 *
 * Using one recursion for both is deliberate: it makes it impossible for the
 * "proven" layer and the "probable" layer to disagree about what is feasible.
 *
 * The conservation law for one round (see HONESTY_MODEL.md §1):
 *
 *     sum(h_j) + chaosLibs + r = startL,     r in [0, R]
 *     R = startN - 3*governments - chaosCards
 *
 * `R` is the number of cards in the round pool nobody has seen. It doubles as
 * the evidence-strength measure: R = 0 pins every hand exactly, a large R means
 * the round constrains almost nothing yet (HONESTY_MODEL.md §11 F1).
 * ==========================================================================*/

const Honesty = (() => {
  const P = typeof Prob !== "undefined" ? Prob : require("./probability.js");
  const binom = P.binom;

  /**
   * Default reporting-model parameters. v1 fits NOTHING from data — see
   * HONESTY_MODEL.md §11 F4. These are documented priors, not measurements,
   * and the UI must never present results from them as measurements.
   */
  const DEFAULTS = {
    // P(a president misreports their hand at all), marginalised over their team.
    // Roughly: P(fascist) ~0.45 x lies-when-useful ~0.45, plus a few % of liberals.
    lieRate: 0.22,
    // Liars mostly under-report liberals (that is the point of the lie).
    // Relative weight of an upward lie vs a downward one.
    upBias: 0.15,
    // Each extra card of exaggeration is this much less likely.
    decay: 0.35,
    // Sophistication: how strongly a liar prefers a story that is plausible
    // given the public pool. 0 = says whatever helps, 1 = perfectly mimics the
    // honest claim distribution. Controls the SIGN of the evidence from rarity.
    sophistication: 0.5,
  };

  // ---------------------------------------------------------------- helpers --

  /**
   * Feasible range of true liberals for one government, from public facts only.
   * A vetoed government enacts nothing, so it carries no enacted-card constraint;
   * otherwise the enacted policy must have come out of the hand.
   */
  function handBounds(gov, poolLibs) {
    let lo = 0;
    let hi = 3;
    if (!gov.vetoed) {
      if (gov.enacted === "L") lo = 1; // an enacted liberal was in the hand
      else if (gov.enacted === "F") hi = 2; // as was an enacted fascist
    }
    hi = Math.min(hi, poolLibs);
    return [lo, hi];
  }

  /**
   * A president claiming 1F2L who then blames the chancellor for a fascist
   * policy is describing something that cannot happen: they say they discarded
   * the fascist and passed LL, and no chancellor can enact a card they were
   * never handed. So the hand-claim or the pass-claim is false — but we do NOT
   * know which, so this must not constrain the hand itself.
   * See HONESTY_MODEL.md §11 F3.
   */
  function hasImpossibleStory(gov) {
    return !gov.vetoed && gov.conflict === true && gov.claim === 2;
  }

  // --------------------------------------------------------- the recursion --

  /**
   * Shared skeleton for both semirings.
   *
   * `combine(acc, stepValue)` and `zero`/`empty` differ between:
   *   min-plus  : combine = min,  step = cost (0 or 1)
   *   sum-product: combine = sum, step = weight
   *
   * Returns the forward table: fwd[j][s] over j = 0..G governments and
   * s = 0..T liberals consumed, where T = startL - chaosLibs.
   */
  function forwardTable(govs, T, stepFn, semiring) {
    const G = govs.length;
    const fwd = [];
    let cur = new Array(T + 1).fill(semiring.zero);
    cur[0] = semiring.one;
    fwd.push(cur);
    for (let j = 0; j < G; j++) {
      const next = new Array(T + 1).fill(semiring.zero);
      for (let s = 0; s <= T; s++) {
        if (cur[s] === semiring.zero) continue;
        for (let h = govs[j].lo; h <= govs[j].hi; h++) {
          if (s + h > T) break;
          const step = stepFn(j, h);
          if (step === semiring.zero) continue;
          next[s + h] = semiring.combine(next[s + h], semiring.extend(cur[s], step));
        }
      }
      cur = next;
      fwd.push(cur);
    }
    return fwd;
  }

  /** Backward table, mirrored, including the C(R, r) leftover term at the end. */
  function backwardTable(govs, T, R, stepFn, semiring, leftoverFn) {
    const G = govs.length;
    const bwd = new Array(G + 1);
    let cur = new Array(T + 1).fill(semiring.zero);
    for (let s = 0; s <= T; s++) {
      const r = T - s; // liberals left over among the R unseen cards
      if (r >= 0 && r <= R) cur[s] = leftoverFn(r);
    }
    bwd[G] = cur;
    for (let j = G - 1; j >= 0; j--) {
      const next = new Array(T + 1).fill(semiring.zero);
      for (let s = 0; s <= T; s++) {
        for (let h = govs[j].lo; h <= govs[j].hi; h++) {
          if (s + h > T) break;
          if (cur[s + h] === semiring.zero) continue;
          const step = stepFn(j, h);
          if (step === semiring.zero) continue;
          next[s] = semiring.combine(next[s], semiring.extend(cur[s + h], step));
        }
      }
      cur = next;
      bwd[j] = cur;
    }
    return bwd;
  }

  const MINPLUS = {
    zero: Infinity,
    one: 0,
    combine: Math.min,
    extend: (a, b) => a + b,
  };
  const SUMPROD = {
    zero: 0,
    one: 1,
    combine: (a, b) => a + b,
    extend: (a, b) => a * b,
  };

  // ------------------------------------------------------------- hard logic --

  /**
   * Fewest claims in the round that must be false.
   * `force` optionally pins one government: {idx, equal:true|false} meaning
   * "assume this claim WAS true" / "assume it was NOT true".
   * Returns Infinity when the constraint set is unsatisfiable.
   */
  function minLies(govs, T, R, force) {
    const cost = (j, h) => {
      const truthful = h === govs[j].claim;
      if (force && force.idx === j) {
        if (force.equal && !truthful) return Infinity;
        if (!force.equal && truthful) return Infinity;
      }
      return truthful ? 0 : 1;
    };
    const fwd = forwardTable(govs, T, cost, MINPLUS);
    const last = fwd[govs.length];
    let best = Infinity;
    for (let s = 0; s <= T; s++) {
      const r = T - s;
      if (r >= 0 && r <= R && last[s] < best) best = last[s];
    }
    return best;
  }

  // -------------------------------------------------------- reporting model --

  /**
   * P(claim c is reported | the true hand held h liberals), marginalised over
   * the president's team. See HONESTY_MODEL.md §3b.
   */
  function reportLikelihood(c, h, priorClaim, prm) {
    if (c === h) return 1 - prm.lieRate;
    let total = 0;
    const weights = [];
    for (let k = 0; k <= 3; k++) {
      if (k === h) { weights.push(0); continue; }
      const dir = k < h ? 1 : prm.upBias;
      const mag = Math.pow(prm.decay, Math.abs(k - h) - 1);
      const plaus = Math.pow(Math.max(priorClaim[k], 1e-9), prm.sophistication);
      const w = dir * mag * plaus;
      weights.push(w);
      total += w;
    }
    if (total <= 0) return 0;
    return prm.lieRate * (weights[c] / total);
  }

  // ------------------------------------------------------------------ entry --

  /**
   * Analyse one round.
   *
   * @param {object} round
   *   {number} startN      cards in the round pool at round start
   *   {number} startL      liberals in that pool
   *   {number} chaosLibs   liberal chaos top-decks enacted this round
   *   {number} chaosFascs  fascist chaos top-decks enacted this round
   *   {object[]} govs      [{claim, enacted:'L'|'F'|null, vetoed, conflict}]
   * @param {object} [params] overrides for DEFAULTS
   */
  function analyzeRound(round, params) {
    const prm = Object.assign({}, DEFAULTS, params || {});
    const raw = round.govs || [];
    const G = raw.length;
    const chaosLibs = round.chaosLibs || 0;
    const chaosN = chaosLibs + (round.chaosFascs || 0);
    const R = Math.max(0, round.startN - 3 * G - chaosN);
    const T = round.startL - chaosLibs; // liberals still to be accounted for

    const empty = {
      minLies: 0, feasible: true, leftover: R, target: T,
      evidence: "none", govs: [],
    };
    if (G === 0 || T < 0) return empty;

    const govs = raw.map((g) => {
      const [lo, hi] = handBounds(g, Math.max(0, T));
      return { claim: g.claim, lo, hi, vetoed: !!g.vetoed, conflict: !!g.conflict };
    });

    // ---- layer 1: hard logic
    const base = minLies(govs, T, R);
    const feasible = base !== Infinity;

    // ---- layer 2: posterior over hands, same recursion, sum-product
    const priorClaim = P.drawDistribution(round.startN, round.startL);
    const weight = (j, h) =>
      binom(3, h) * reportLikelihood(govs[j].claim, h, priorClaim, prm);
    const fwd = forwardTable(govs, T, weight, SUMPROD);
    const bwd = backwardTable(govs, T, R, weight, SUMPROD, (r) => binom(R, r));

    const out = govs.map((g, j) => {
      // marginal over this government's true hand
      const post = [0, 0, 0, 0];
      let norm = 0;
      for (let s = 0; s <= T; s++) {
        if (fwd[j][s] === 0) continue;
        for (let h = g.lo; h <= g.hi; h++) {
          if (s + h > T) break;
          const w = fwd[j][s] * weight(j, h) * bwd[j + 1][s + h];
          post[h] += w;
          norm += w;
        }
      }
      if (norm > 0) for (let h = 0; h < 4; h++) post[h] /= norm;

      const honestCost = feasible ? minLies(govs, T, R, { idx: j, equal: true }) : Infinity;
      const liarCost = feasible ? minLies(govs, T, R, { idx: j, equal: false }) : Infinity;

      return {
        claim: g.claim,
        // hard logic — statements about CLAIMS, never about people (§11 F8)
        provenFalse: feasible && honestCost === Infinity,
        provenTrue: feasible && liarCost === Infinity,
        // how many extra false claims elsewhere it costs to believe this one
        costIfHonest: feasible && honestCost !== Infinity ? honestCost - base : null,
        impossibleStory: hasImpossibleStory(raw[j]),
        // probability
        handPosterior: norm > 0 ? post : null,
        pTrue: norm > 0 ? post[g.claim] : null,
      };
    });

    return {
      minLies: feasible ? base : Infinity,
      feasible,
      leftover: R,
      target: T,
      // R is exactly how much slack the round still has: it is the honest
      // measure of how much these numbers are worth (§11 F1).
      evidence: R === 0 ? "exact" : R <= 2 ? "strong" : R <= 5 ? "moderate" : "weak",
      govs: out,
    };
  }

  return {
    DEFAULTS,
    analyzeRound,
    // exported for tests
    _minLies: minLies,
    _reportLikelihood: reportLikelihood,
    _handBounds: handBounds,
    _hasImpossibleStory: hasImpossibleStory,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Honesty;
