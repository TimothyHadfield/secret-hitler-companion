/* ============================================================================
 * probability.js — the probability engine for the Secret Hitler companion.
 * See PROBABILITY_MODEL.md for the full derivation.
 * Pure functions only; no DOM access here.
 * ==========================================================================*/

const Prob = (() => {
  // Binomial coefficient C(n, k) with memoization. Returns 0 for invalid args.
  const _binom = new Map();
  function binom(n, k) {
    if (k < 0 || n < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    const key = n * 1000 + k;
    if (_binom.has(key)) return _binom.get(key);
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    r = Math.round(r);
    _binom.set(key, r);
    return r;
  }

  /**
   * Hypergeometric: probability of drawing exactly `k` liberals when drawing
   * `draw` cards from a pile of `n` cards containing `l` liberals.
   */
  function hypergeometric(n, l, draw, k) {
    const d = binom(n, draw);
    if (d === 0) return NaN;
    return (binom(l, k) * binom(n - l, draw - k)) / d;
  }

  /**
   * Full distribution over liberal-count of a 3-card draw from a known pile.
   * Returns [P(0 lib), P(1), P(2), P(3)] i.e. [3F, 2F1L, 1F2L, 3L].
   */
  function drawDistribution(n, l) {
    return [0, 1, 2, 3].map((k) => hypergeometric(n, l, 3, k));
  }

  /**
   * Retrospective probability that the government at `idx` drew `govLiberals[idx]`
   * liberals, conditioned on every OTHER observed government in the same round.
   *
   * @param {number} N           round pool size (cards in the draw pile at round start)
   * @param {number} L           liberals in the round pool at round start
   * @param {number[]} govLiberals  true liberals drawn by each observed government in the round
   * @param {number} idx         which government to evaluate
   * @returns {number} probability in [0,1], or NaN if the configuration is impossible
   */
  function retrospectiveProb(N, L, govLiberals, idx) {
    const G = govLiberals.length;
    const R = N - 3 * G; // unseen leftover cards in the round pool
    if (R < 0) return NaN; // more governments than the pool can supply
    const kLib = govLiberals[idx];
    let otherLib = 0;
    for (let j = 0; j < G; j++) if (j !== idx) otherLib += govLiberals[j];
    const S = L - otherLib; // liberals shared between this hand and the R leftovers
    const num = binom(3, kLib) * binom(R, S - kLib);
    let den = 0;
    for (let m = 0; m <= 3; m++) den += binom(3, m) * binom(R, S - m);
    if (den === 0) return NaN;
    return num / den;
  }

  /**
   * Convenience label for a hand given its liberal count (0..3).
   */
  function handLabel(libs) {
    return `${3 - libs}F / ${libs}L`;
  }

  function fmtPct(p) {
    if (p === null || p === undefined || Number.isNaN(p)) return "—";
    return (p * 100).toFixed(1) + "%";
  }

  return {
    binom,
    hypergeometric,
    drawDistribution,
    retrospectiveProb,
    handLabel,
    fmtPct,
  };
})();

// Support both browser (global) and any future module usage.
if (typeof module !== "undefined" && module.exports) module.exports = Prob;
