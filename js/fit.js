/* ============================================================================
 * fit.js — fit the model's report LIE RATES from your own recorded games.
 * See HONESTY_MODEL.md §7 (EM with closed-form M-steps) and §7b (shrinkage).
 *
 * What this DOES fit: the per-team report lie rates — P(a fascist / a liberal
 * misreports their own hand). With the recorded roles as labels these are the
 * "lie tendency" statistic on the wishlist, and they are IDENTIFIABLE from the
 * presidential claims the app already stores.
 *
 * What this deliberately does NOT fit: the behavioural push rates β (bury) and γ
 * (enact-fascist). HONESTY_MODEL §7c is explicit that β and λ are CONFOUNDED
 * without chancellor-claims or votes — data this app deliberately does not
 * capture — so fitting them from presidential claims alone is exactly the
 * "confident nonsense" the design review (§11 F4) warns against. They stay at the
 * documented defaults.
 *
 * Method: EM with the roles KNOWN (no assignment sum — only the hands are latent).
 *   E-step  run the §4b forward–backward DP with the true roles fixed → posterior
 *           P(hand = v) for every government. It reuses the EXACT Honesty kernels,
 *           so the fitter can never drift from the model it feeds.
 *   M-step  each lie rate is a Bernoulli rate → a Beta-posterior mean, i.e. a
 *           shrunk count ratio:  λ̂_t = (κ·default_t + Σ E[misreport]) / (κ + Σ 1).
 *           κ pseudo-observations of the DEFAULT keep a small archive near the
 *           documented prior; the rate only moves toward the data as games pile up.
 * ==========================================================================*/

const Fit = (() => {
  const H = typeof Honesty !== "undefined" ? Honesty : require("./honesty.js");
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  const RATE_LO = 1e-3, RATE_HI = 0.95;

  // Which fitted rate governs a president's report, by role. A knowing Hitler
  // (5–6p) reports like a fascist; a cautious/blind Hitler (7+) uses its own
  // (unfitted) rate, so its governments are excluded from both buckets.
  function presBucket(role, cautious) {
    if (role === "L") return "L";
    if (role === "F") return "F";
    if (role === "H") return cautious ? null : "F";
    return null;
  }

  // Per-government posterior over the true hand, roles fixed. Mirrors the round
  // mass in analyzeGame but keeps the marginals (fwd · weight · bwd).
  function govMarginals(round, prm, roleOf, isFasc, knows, cautious) {
    const T = round.startL - (round.chaosLibs || 0);
    if (T < 0) return null;
    const chaosN = (round.chaosLibs || 0) + (round.chaosFascs || 0);
    const R = Math.max(0, round.startN - 3 * round.govs.length - chaosN);
    const prior = H._drawDistribution(round.startN, round.startL);
    const govs = round.govs.map((g) => {
      const [lo, hi] = H._handBounds(g, Math.max(0, T));
      return Object.assign({}, g, { lo, hi });
    });
    const cache = {};
    const bhv = (i, g) => {
      const key = i + ":" + (g.facBefore || 0) + ":" + (g.libBefore || 0);
      if (!cache[key]) cache[key] = H._roleBehaviour(roleOf(i), { fac: g.facBefore || 0, lib: g.libBefore || 0 }, prm, cautious);
      return cache[key];
    };
    const weight = (j, h) => {
      const g = govs[j];
      const rel = {
        chanKnowsPresAlly: knows(roleOf(g.chanIdx)) && isFasc(g.presIdx),
        presKnowsChanAlly: knows(roleOf(g.presIdx)) && isFasc(g.chanIdx),
      };
      let w = H._binom(3, h) * H._govLikelihoodTeam(g, h, bhv(g.presIdx, g), bhv(g.chanIdx, g), prior, prm, rel);
      if (g.peek) w *= H._teamReport(g.peek.peekLibs, h, bhv(g.peek.peekerIdx, g), prior, prm);
      return w;
    };
    const fwd = H._forwardTable(govs, T, weight, H._SUMPROD);
    const bwd = H._backwardTable(govs, T, R, weight, H._SUMPROD, (r) => H._binom(R, r));
    return govs.map((g, j) => {
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
      return { post: norm > 0 ? post : null, claim: g.claim, presIdx: g.presIdx };
    });
  }

  /**
   * Fit the report lie rates from labelled games.
   *
   * @param {object[]} samples each {playerCount, cautiousHitler?, roles:{hitlerIdx,
   *   fascistIdxs:number[]}, rounds:[{startN,startL,chaosLibs,chaosFascs,govs:[…]}]}
   *   — the same round/gov shape analyzeGame consumes, but with the TRUE roles.
   * @param {object} [opts] {params:base overrides, kappa:shrinkage strength (default
   *   24 pseudo-obs of the default), iters, tol}
   * @returns {{params:{facLie,libLie}, base:{facLie,libLie}, byTeam, govs, iters,
   *   converged, samples}}
   */
  function fit(samples, opts) {
    opts = opts || {};
    const base = Object.assign({}, H.DEFAULTS, opts.params || {});
    const kappa = opts.kappa != null ? opts.kappa : 24;
    const maxIters = opts.iters != null ? opts.iters : 40;
    const tol = opts.tol != null ? opts.tol : 1e-6;

    let facLie = base.facLie, libLie = base.libLie;
    const usable = (samples || []).filter((s) => s && s.rounds && s.roles);

    let byTeam = { F: { lies: 0, opps: 0 }, L: { lies: 0, opps: 0 } };
    let iters = 0, converged = false;

    for (; iters < maxIters; iters++) {
      const prm = Object.assign({}, base, { facLie, libLie });
      const acc = { F: { lies: 0, opps: 0 }, L: { lies: 0, opps: 0 } };

      for (const s of usable) {
        const n = s.playerCount;
        const cautious = s.cautiousHitler != null ? s.cautiousHitler : n >= 7;
        const hitler = s.roles.hitlerIdx;
        const facSet = new Set(s.roles.fascistIdxs || []);
        const roleOf = (i) => (i === hitler ? "H" : facSet.has(i) ? "F" : "L");
        const isFasc = (i) => i === hitler || facSet.has(i);
        const knows = (role) => role === "F" || (role === "H" && !cautious);

        for (const round of s.rounds || []) {
          if (!round.govs || !round.govs.length) continue;
          const marg = govMarginals(round, prm, roleOf, isFasc, knows, cautious);
          if (!marg) continue;
          for (const m of marg) {
            if (!m.post) continue; // an infeasible round contributes no evidence
            const bucket = presBucket(roleOf(m.presIdx), cautious);
            if (!bucket) continue;
            // E[misreport] = 1 − P(true hand == the claimed value). A claim outside
            // the feasible hand range has P == 0 → counted as a certain misreport.
            acc[bucket].lies += 1 - (m.post[m.claim] || 0);
            acc[bucket].opps += 1;
          }
        }
      }

      // M-step: Beta-posterior mean (shrink to the documented default).
      const nf = clamp((kappa * base.facLie + acc.F.lies) / (kappa + acc.F.opps), RATE_LO, RATE_HI);
      const nl = clamp((kappa * base.libLie + acc.L.lies) / (kappa + acc.L.opps), RATE_LO, RATE_HI);
      byTeam = acc;
      const moved = Math.abs(nf - facLie) + Math.abs(nl - libLie);
      facLie = nf; libLie = nl;
      if (moved < tol) { converged = true; iters++; break; }
    }

    return {
      params: { facLie, libLie },
      base: { facLie: base.facLie, libLie: base.libLie },
      byTeam,
      govs: byTeam.F.opps + byTeam.L.opps,
      iters, converged,
      samples: usable.length,
    };
  }

  return { fit, _govMarginals: govMarginals, _presBucket: presBucket };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Fit;
