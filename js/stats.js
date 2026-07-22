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
        failedElections: 0,
        conflicts: 0, // times blamed as Chancellor in a conflict
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
      // support both the current event model and the legacy `governments` array
      const events = g.events || g.governments || [];
      for (const ev of events) {
        const type = ev.type || "gov";
        if (type === "fail") {
          const pres = g.players[ev.presidentIdx];
          if (pres) ensure(pres.name).failedElections++;
          continue;
        }
        if (type === "chaos") continue;
        const pres = g.players[ev.presidentIdx];
        if (pres) ensure(pres.name).presidencies++;
        const chan = g.players[ev.chancellorIdx];
        if (chan) {
          const s = ensure(chan.name);
          s.chancellorships++;
          if (ev.conflict) s.conflicts++;
          if (ev.enacted === "L") s.libEnactedAsChancellor++;
          if (ev.enacted === "F") s.facEnactedAsChancellor++;
        }
      }
    }

    return Object.values(byName)
      .map((s) => ({ ...s, winRate: s.games ? s.wins / s.games : 0 }))
      .sort((a, b) => b.games - a.games || b.winRate - a.winRate);
  }

  /** Cross-game summary. */
  function summary() {
    const games = loadGames();
    const finished = games.filter((g) => g.result);
    const fascistWins = finished.filter((g) => g.result.winner === "Fascist").length;
    const liberalWins = finished.filter((g) => g.result.winner === "Liberal").length;
    const govCount = (g) =>
      (g.events || g.governments || []).filter((e) => (e.type || "gov") === "gov").length;
    const avgGovs = finished.length
      ? finished.reduce((a, g) => a + govCount(g), 0) / finished.length
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
