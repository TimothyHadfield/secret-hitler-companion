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
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

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

    // ---- team behaviour, used only by the ROLE posterior (analyzeGame). These
    // are the least-identifiable parameters in the whole model (HONESTY_MODEL.md
    // §11 F4/F6): documented priors, NOT measurements. The role posterior is
    // therefore a soft read, and must be presented as one.
    libLie: 0.05,   // a liberal misreporting their own hand (protecting a partner, a misplay)
    facLie: 0.50,   // a fascist misreporting their hand
    beta: 0.70,     // fascist PRESIDENT discards a liberal to push a fascist policy (base rate)
    gamma: 0.85,    // fascist CHANCELLOR enacts fascist from a mixed (1L1F) pass (base rate)
    mu: 0.03,       // honest-mistake floor, so nothing is ever exactly impossible on behaviour
    falseAccuseFasc: 0.30, // fascist president raising a bogus conflict (framing the chancellor)
    falseAccuseLib: 0.02,  // a liberal doing the same — essentially never

    // ---- state-dependence of the push rates (§12.5). Fascists blend early and
    // push hard once fascist policies pile up or liberals near a win. These
    // shift beta/gamma by the board state; kept gentle and clamped.
    pushPerFasc: 0.06,   // each fascist policy already down raises the push rate
    pushLibThreat: 0.05, // each liberal policy past the 2nd raises it (desperation)
    pushMin: 0.05, pushMax: 0.96,

    // ---- Hitler plays cautiously in 7+ games (§12.6): doesn't know the other
    // fascists, avoids execution, so behaves close to a liberal on the cards
    // while still holding a Fascist party card. In 5-6p Hitler knows the fascist
    // and plays normally (handled by cautiousHitler=false there).
    hitlerLie: 0.10,    // a cautious Hitler misreporting
    hitlerBeta: 0.15,   // a cautious Hitler burying a liberal (rarely — stays hidden)
    hitlerGamma: 0.25,  // a cautious Hitler enacting fascist from a mixed pass

    // ---- extra signals already in the log (§12.1-12.4) ----
    nomAffinity: 2.2,     // a fascist who KNOWS allies nominates one: relative weight vs a non-ally
    specialAffinity: 2.5, // ditto for a Special-Election pick
    killAllyPenalty: 0.2, // a fascist executing a fellow fascist: relative weight vs a non-ally
    investLie: 0.45,      // a fascist investigator misreporting the party they saw
    // (a Policy Peek is modelled as the peeker REPORTING the next government's true
    //  hand — same report model as a normal claim, using the peeker's lie rate.)
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

  // ======================================================================== //
  //  ROLE POSTERIOR  —  P(each player is fascist), from the same generative   //
  //  model read the other way. See HONESTY_MODEL.md §4.                        //
  //                                                                            //
  //  Instead of marginalising over teams to price a claim, we ENUMERATE every  //
  //  assignment of `f` fascists to `n` players (<=120 for a 10-player game),   //
  //  score each by how well it explains the whole game, and sum the posterior  //
  //  weight of the assignments that contain each player.                       //
  // ======================================================================== //

  // Total sum-product mass of a round under a per-(gov,hand) weight function:
  //   Σ over feasible hand vectors of  ∏_j weight(j, h_j) · C(R, leftover)
  // This is the round's data-likelihood (up to the assignment-independent
  // C(N,L) normaliser, which cancels in the posterior over assignments).
  function roundMass(govs, T, R, weightFn) {
    if (T < 0) return 0;
    if (!govs.length) return 1; // no governments constrain nothing
    const fwd = forwardTable(govs, T, weightFn, SUMPROD);
    const last = fwd[govs.length];
    let mass = 0;
    for (let s = 0; s <= T; s++) {
      const r = T - s;
      if (r >= 0 && r <= R) mass += last[s] * binom(R, r);
    }
    return mass;
  }

  // Behaviour of a seat depends on its ROLE (Liberal / Fascist / Hitler) and, for
  // fascists, on the board STATE (§12.5-12.6). This resolves a role+state to the
  // four numbers the card model needs. `cautiousHitler` is true in 7+ games, where
  // Hitler is blind to the fascists and plays hidden; in 5-6p Hitler knows the
  // fascist and plays like one.
  function roleBehaviour(role, state, prm, cautiousHitler) {
    // beta = P(bury a liberal to push fascist); gamma = P(enact fascist from a
    // mixed pass). A liberal does neither, bar a rare slip (mu).
    if (role === "L") return { lie: prm.libLie, beta: prm.mu, gamma: prm.mu, falseAccuse: prm.falseAccuseLib };
    if (role === "H" && cautiousHitler)
      return { lie: prm.hitlerLie, beta: prm.hitlerBeta, gamma: prm.hitlerGamma, falseAccuse: prm.falseAccuseLib };
    // an ordinary fascist (or a knowing Hitler in 5-6p): push rate rises with the
    // board state — blend early, push hard as fascist policies pile up / liberals near a win.
    const fac = (state && state.fac) || 0;
    const lib = (state && state.lib) || 0;
    const bump = prm.pushPerFasc * fac + prm.pushLibThreat * Math.max(0, lib - 2);
    const beta = clamp(prm.beta + bump, prm.pushMin, prm.pushMax);
    const gamma = clamp(prm.gamma + bump, prm.pushMin, prm.pushMax);
    return { lie: prm.facLie, beta, gamma, falseAccuse: prm.falseAccuseFasc };
  }

  // The president holds `h` liberals in 3 cards, discards 1, passes 2. The pass
  // holds `p` liberals: either `h` (discarded a fascist) or `h-1` (discarded a
  // liberal), clamped to what the hand actually allows.
  function passOptions(h) {
    if (h === 0) return [0];      // FFF: can only pass FF
    if (h === 3) return [2];      // LLL: can only pass LL
    return [h, h - 1];            // keep-liberals (p=h) or bury-one (p=h-1)
  }
  function passProb(p, h, bhv, prm) {
    if (h === 0 || h === 3) return 1;       // forced, no choice
    const buried = p === h - 1;             // discarded a liberal
    return buried ? bhv.beta : 1 - bhv.beta;
  }
  // Chancellor holds `p` liberals + (2-p) fascists; enacts one, observed as `e`.
  function enactProb(e, p, bhv) {
    if (p === 2) return e === "L" ? 1 : 0;  // LL: must enact L
    if (p === 0) return e === "F" ? 1 : 0;  // FF: must enact F
    return e === "F" ? bhv.gamma : 1 - bhv.gamma; // p===1: a real choice
  }
  // A conflict is the president publicly asserting they passed >=1 liberal while
  // a fascist policy was enacted. Truthful when p>=1; a fabricated frame when p=0.
  function conflictFactor(p, bhv) {
    return p >= 1 ? 1 : bhv.falseAccuse;
  }
  // Role-specific report model: P(claim | true hand h). Mirrors the marginal
  // reportLikelihood but with a role/state-specific base lie rate.
  function teamReport(c, h, bhv, priorClaim, prm) {
    const lie = bhv.lie;
    if (c === h) return 1 - lie;
    let total = 0;
    const w = [];
    for (let k = 0; k <= 3; k++) {
      if (k === h) { w.push(0); continue; }
      const dir = k < h ? 1 : prm.upBias;
      const mag = Math.pow(prm.decay, Math.abs(k - h) - 1);
      const plaus = Math.pow(Math.max(priorClaim[k], 1e-9), prm.sophistication);
      const ww = dir * mag * plaus;
      w.push(ww);
      total += ww;
    }
    if (total <= 0) return 0;
    return lie * (w[c] / total);
  }
  // Likelihood of ONE government's card facts given the true hand and the two
  // seats' behaviours: the president's report, and (unless vetoed) the pass→enact
  // chain that produced the observed policy, plus any conflict.
  function govLikelihoodTeam(g, h, bhvP, bhvC, priorClaim, prm) {
    const report = teamReport(g.claim, h, bhvP, priorClaim, prm);
    if (g.vetoed || g.enacted == null) return report; // no pass/enact observed
    let acc = 0;
    for (const p of passOptions(h)) {
      const pp = passProb(p, h, bhvP, prm);
      if (pp <= 0) continue;
      const ep = enactProb(g.enacted, p, bhvC);
      if (ep <= 0) continue;
      const cf = g.conflict ? conflictFactor(p, bhvP) : 1;
      acc += pp * ep * cf;
    }
    return report * acc;
  }

  // ---- extra-signal factors (all >0; unnormalised relative likelihoods) -------
  // A fascist who KNOWS their allies picks one preferentially. `knows` is false
  // for a liberal (no info) and for a cautious/blind Hitler → factor 1, no signal.
  function affinityFactor(knows, targetIsAlly, weight) {
    if (!knows) return 1;
    return targetIsAlly ? weight : 1;
  }
  // An investigation: the investigator privately sees the target's party and
  // reports one. A liberal reports truth (μ slip); a fascist may misreport.
  function investigationFactor(role, reported, trueParty, prm) {
    const truthful = reported === trueParty;
    if (role === "L") return truthful ? 1 - prm.mu : prm.mu;
    return truthful ? 1 - prm.investLie : prm.investLie; // fascist/Hitler
  }
  // All size-k subsets of {0..n-1}, each as a Set. n<=10, k<=3 → <=120.
  function combinations(n, k) {
    const res = [];
    const idx = [];
    (function rec(start, need) {
      if (need === 0) { res.push(new Set(idx)); return; }
      for (let i = start; i <= n - need; i++) { idx.push(i); rec(i + 1, need - 1); idx.pop(); }
    })(0, k);
    return res;
  }
  // Every assignment: a fascist-set S plus which member is Hitler.
  function assignments(n, f, forcedFascist, forcedHitler, notHitler) {
    const forced = new Set(forcedFascist || []);
    const noH = new Set(notHitler || []);
    const out = [];
    for (const S of combinations(n, f)) {
      let ok = true;
      for (const x of forced) if (!S.has(x)) { ok = false; break; }
      if (!ok) continue;
      for (const H of S) {
        if (forcedHitler != null && H !== forcedHitler) continue;
        if (noH.has(H)) continue;
        out.push({ S, H });
      }
    }
    return out;
  }

  /**
   * P(each player is fascist) and P(each player is Hitler) for a whole game.
   *
   * @param {object} game
   *   {number}   playerCount
   *   {number}   fascistCount    fascists incl. Hitler = ceil(n/2) - 1
   *   {number[]} forcedFascist   players certainly on the fascist team
   *   {number}   forcedHitler    the seat certainly Hitler, or null/undefined
   *   {number[]} notHitler       seats certainly NOT Hitler (D8/D9)
   *   {boolean}  cautiousHitler  true in 7+ games (Hitler is blind & plays hidden)
   *   {object[]} rounds  each {startN, startL, chaosLibs, chaosFascs, govs:[…]}
   *     gov = {presIdx, chanIdx, claim, enacted:'L'|'F'|null, vetoed, conflict,
   *            facBefore, libBefore,
   *            peek?: {peekerIdx, peekLibs}}  // a peek of THIS gov's cards by a
   *                                           // prior president, treated as their
   *                                           // report of this hand
   *   {object[]} investigations  [{investIdx, targetIdx, party:'L'|'F'}]
   *   {object[]} kills           [{killerIdx, victimIdx}]  (non-Hitler executions)
   *   {object[]} specials        [{chooserIdx, chosenIdx}]
   * @returns {{pFascist:number[], pHitler:number[], assignments:number}}
   */
  function analyzeGame(game, params) {
    const prm = Object.assign({}, DEFAULTS, params || {});
    const n = game.playerCount;
    const f = game.fascistCount;
    const nullOut = { pFascist: new Array(n).fill(null), pHitler: new Array(n).fill(null), assignments: 0 };
    if (!n || f == null || f < 0 || f > n) return nullOut;
    const cautious = game.cautiousHitler != null ? game.cautiousHitler : n >= 7;

    // Pre-enrich rounds once (bounds + prior claim distribution are role-independent).
    const rounds = (game.rounds || []).map((r) => {
      const T = r.startL - (r.chaosLibs || 0);
      const chaosN = (r.chaosLibs || 0) + (r.chaosFascs || 0);
      const R = Math.max(0, r.startN - 3 * r.govs.length - chaosN);
      const govs = r.govs.map((g) => {
        const [lo, hi] = handBounds(g, Math.max(0, T));
        return Object.assign({}, g, { lo, hi });
      });
      return { govs, T, R, priorClaim: P.drawDistribution(r.startN, r.startL) };
    });

    const As = assignments(n, f, game.forcedFascist, game.forcedHitler, game.notHitler);
    if (!As.length) return { pFascist: new Array(n).fill(f / n), pHitler: new Array(n).fill(1 / n), assignments: 0 };

    // role of seat i, and whether a fascist president KNOWS their allies
    const roleOf = (A, i) => (i === A.H ? "H" : A.S.has(i) ? "F" : "L");
    // a fascist knows the team; a cautious Hitler does not; in 5-6p Hitler knows
    const knowsAllies = (role) => role === "F" || (role === "H" && !cautious);

    const logScores = As.map((A) => {
      let logL = 0;
      // rounds — the hand/claim/enact/conflict signal
      for (const r of rounds) {
        if (!r.govs.length) continue;
        const bhvCache = {};
        const bhv = (i, g) => {
          const key = i + ":" + (g.facBefore || 0) + ":" + (g.libBefore || 0);
          if (!bhvCache[key])
            bhvCache[key] = roleBehaviour(roleOf(A, i), { fac: g.facBefore || 0, lib: g.libBefore || 0 }, prm, cautious);
          return bhvCache[key];
        };
        const weightFn = (j, h) => {
          const g = r.govs[j];
          let w = binom(3, h) * govLikelihoodTeam(g, h, bhv(g.presIdx, g), bhv(g.chanIdx, g), r.priorClaim, prm);
          // a Policy Peek of these exact cards is the peeker reporting this hand —
          // scored with the peeker's own lie model, tying their honesty to the cards
          if (g.peek) w *= teamReport(g.peek.peekLibs, h, bhv(g.peek.peekerIdx, g), r.priorClaim, prm);
          return w;
        };
        const mass = roundMass(r.govs, r.T, r.R, weightFn);
        if (mass <= 0) { logL = -Infinity; break; }
        logL += Math.log(mass);
        // nominations (§12.1): a fascist who knows allies picks one preferentially
        for (const g of r.govs) {
          const rP = roleOf(A, g.presIdx);
          logL += Math.log(affinityFactor(knowsAllies(rP), A.S.has(g.chanIdx), prm.nomAffinity));
        }
      }
      if (!isFinite(logL)) return -Infinity;
      // investigations (§12.2)
      for (const iv of game.investigations || []) {
        const trueParty = A.S.has(iv.targetIdx) ? "F" : "L"; // Hitler's party card is Fascist
        logL += Math.log(investigationFactor(roleOf(A, iv.investIdx), iv.party, trueParty, prm));
      }
      // executions (§12.4): a fascist avoids killing an ally
      for (const k of game.kills || []) {
        const rK = roleOf(A, k.killerIdx);
        if (knowsAllies(rK)) logL += Math.log(A.S.has(k.victimIdx) ? prm.killAllyPenalty : 1);
      }
      // special elections (§12.4): a fascist elevates an ally
      for (const sp of game.specials || []) {
        const rS = roleOf(A, sp.chooserIdx);
        logL += Math.log(affinityFactor(knowsAllies(rS), A.S.has(sp.chosenIdx), prm.specialAffinity));
      }
      // (Policy Peek is applied inside the round DP above, as the peeker's report
      //  of the next government's hand — see weightFn.)
      return logL;
    });

    const maxLog = Math.max(...logScores);
    if (!isFinite(maxLog))
      return { pFascist: new Array(n).fill(f / n), pHitler: new Array(n).fill(1 / n), assignments: As.length };
    let Z = 0;
    const wts = logScores.map((l) => { const w = Math.exp(l - maxLog); Z += w; return w; });

    const pF = new Array(n).fill(0);
    const pH = new Array(n).fill(0);
    As.forEach((A, i) => {
      const p = wts[i] / Z;
      for (const idx of A.S) pF[idx] += p;
      pH[A.H] += p;
    });
    return { pFascist: pF, pHitler: pH, assignments: As.length };
  }

  return {
    DEFAULTS,
    analyzeRound,
    analyzeGame,
    // exported for tests
    _minLies: minLies,
    _reportLikelihood: reportLikelihood,
    _handBounds: handBounds,
    _hasImpossibleStory: hasImpossibleStory,
    _govLikelihoodTeam: govLikelihoodTeam,
    _teamReport: teamReport,
    _roleBehaviour: roleBehaviour,
    _roundMass: roundMass,
    _combinations: combinations,
    _assignments: assignments,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Honesty;
