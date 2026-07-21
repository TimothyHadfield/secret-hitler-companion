/* ============================================================================
 * stats.js — persistence + statistics (localStorage).
 * Stores completed games and derives per-player / cross-game statistics.
 * ==========================================================================*/

const Stats = (() => {
  const KEY = "secretHitler.games.v1";

  function loadGames() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveGames(games) {
    localStorage.setItem(KEY, JSON.stringify(games));
  }

  /** Append a completed game record and persist it. */
  function recordGame(game) {
    const games = loadGames();
    games.push(game);
    saveGames(games);
    return games.length;
  }

  function clearAll() {
    localStorage.removeItem(KEY);
  }

  /**
   * Aggregate per-player stats across all stored games.
   * A stored game is expected to have: players[], governments[], result{winner,hitlerIdx,fascistIdxs}.
   */
  function playerStats() {
    const games = loadGames();
    const byName = {};

    const ensure = (name) =>
      (byName[name] = byName[name] || {
        name,
        games: 0,
        wins: 0,
        asLiberal: 0,
        asFascist: 0,
        asHitler: 0,
        presidencies: 0,
        chancellorships: 0,
        modifierSum: 0, // sum of liberal modifiers while President (lie tendency)
        modifierCount: 0,
        libEnactedAsChancellor: 0,
        facEnactedAsChancellor: 0,
      });

    for (const g of games) {
      if (!g.result) continue;
      const fascistSet = new Set(g.result.fascistIdxs || []);
      const hitlerIdx = g.result.hitlerIdx;
      g.players.forEach((p, i) => {
        const s = ensure(p.name);
        s.games++;
        const isFascist = fascistSet.has(i) || i === hitlerIdx;
        if (i === hitlerIdx) s.asHitler++;
        if (isFascist) s.asFascist++;
        else s.asLiberal++;
        const won =
          (g.result.winner === "Fascist" && isFascist) ||
          (g.result.winner === "Liberal" && !isFascist);
        if (won) s.wins++;
      });
      for (const gov of g.governments || []) {
        const pres = g.players[gov.presidentIdx];
        if (pres) {
          const s = ensure(pres.name);
          s.presidencies++;
          if (typeof gov.modifier === "number") {
            s.modifierSum += gov.modifier;
            s.modifierCount++;
          }
        }
        const chan = g.players[gov.chancellorIdx];
        if (chan) {
          const s = ensure(chan.name);
          s.chancellorships++;
          if (gov.enacted === "L") s.libEnactedAsChancellor++;
          if (gov.enacted === "F") s.facEnactedAsChancellor++;
        }
      }
    }

    return Object.values(byName)
      .map((s) => ({
        ...s,
        winRate: s.games ? s.wins / s.games : 0,
        avgModifier: s.modifierCount ? s.modifierSum / s.modifierCount : 0,
      }))
      .sort((a, b) => b.games - a.games || b.winRate - a.winRate);
  }

  /** Cross-game summary. */
  function summary() {
    const games = loadGames();
    const finished = games.filter((g) => g.result);
    const fascistWins = finished.filter((g) => g.result.winner === "Fascist").length;
    const liberalWins = finished.filter((g) => g.result.winner === "Liberal").length;
    const avgGovs = finished.length
      ? finished.reduce((a, g) => a + (g.governments ? g.governments.length : 0), 0) /
        finished.length
      : 0;
    return {
      totalGames: finished.length,
      fascistWins,
      liberalWins,
      fascistWinRate: finished.length ? fascistWins / finished.length : 0,
      avgGovernments: avgGovs,
    };
  }

  return { loadGames, recordGame, clearAll, playerStats, summary };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Stats;
