/* ============================================================================
 * stats.js — persistence + statistics (localStorage).
 * Stores completed games and derives per-player / cross-game statistics.
 *
 * A stored game record looks like:
 *   { players:[{name}], playerCount, firstPres, events:[…], roundMods,
 *     result:{ winner, hitlerIdx, fascistIdxs }, date }
 * Events are the same model the app plays with:
 *   { type:'gov', presidentIdx, chancellorIdx, claimLibs, conflict, enacted, vetoed, power? }
 *   { type:'fail', presidentIdx }   { type:'chaos', enacted }
 *   { type:'hitler', presidentIdx, chancellorIdx }  // Hitler elected Chancellor: game ends
 * A vetoed government enacts nothing (enacted null), discards all 3 cards and
 * advances the election tracker.
 * where power is one of
 *   {type:'invest',targetIdx,party} {type:'special',chosenIdx}
 *   {type:'peek',order}             {type:'kill',killedIdx,wasHitler}
 * ==========================================================================*/

const Stats = (() => {
  const KEY = "secretHitler.games.v1";
  // Export envelope format. Bump only on a breaking change to the record shape;
  // importers must refuse a schema they don't understand rather than guess.
  const EXPORT_SCHEMA = 1;
  const EXPORT_APP = "secret-hitler-companion";

  // Claimed hands, indexed by the number of liberal policies claimed (0..3).
  const CLAIM_NAMES = ["Coal (3F)", "Golden (2F/1L)", "Silver (1F/2L)", "Bronze (3L)"];

  /** Stable per-game identifier: dedupe key on import, idempotency key on sync. */
  function uuid() {
    try {
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    // Fallback for older/insecure contexts — uniqueness is all that matters here.
    return "g-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Every game on this device, regardless of which group it belongs to.
   * WRITES MUST USE THIS — saving a filtered list would delete other groups'
   * games. Reads meant for display should use loadGames() instead.
   */
  function loadAllGames() {
    let games;
    try {
      games = JSON.parse(localStorage.getItem(KEY)) || [];
    } catch (e) {
      return [];
    }
    if (!Array.isArray(games)) return [];
    // Backfill ids on games saved before they existed. Writes at most once:
    // afterwards every record has an id and this is a no-op.
    let changed = false;
    games.forEach((g) => {
      if (g && !g.id) {
        g.id = uuid();
        changed = true;
      }
    });
    if (changed) saveGames(games);
    return games;
  }

  // Which games the statistics should describe. Set by the app to the active
  // group; null means "everything on this device" (the signed-out view).
  let scope = null;
  function setScope(fn) { scope = typeof fn === "function" ? fn : null; }

  /** The games currently in view — every consumer of statistics uses this. */
  function loadGames() {
    const all = loadAllGames();
    return scope ? all.filter(scope) : all;
  }

  function saveGames(games) {
    localStorage.setItem(KEY, JSON.stringify(games));
  }

  /** Append a completed game record and persist it. */
  function recordGame(game) {
    const games = loadAllGames(); // never a filtered view — writes replace the whole array
    if (!game.id) game.id = uuid();
    games.push(game);
    saveGames(games);
    return games.length;
  }

  /**
   * Everything needed to rebuild this device's archive elsewhere — the backup
   * file, and the payload that seeds an account on first login.
   */
  function exportData() {
    return {
      app: EXPORT_APP,
      schema: EXPORT_SCHEMA,
      exportedAt: new Date().toISOString(),
      games: loadAllGames(), // a backup covers the whole device, not just the active group
    };
  }

  /**
   * Merge an exported archive into this device's games. Additive and
   * idempotent: a game already present (same id) is skipped, so re-importing
   * the same file — or a file that overlaps another device's — is harmless.
   * Throws on a payload that isn't a recognisable export.
   * @returns {{added:number, skipped:number}}
   */
  function importData(payload) {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.games))
      throw new Error("That file isn't a Secret Hitler statistics export.");
    if (payload.app && payload.app !== EXPORT_APP)
      throw new Error("That export came from a different app.");
    if (payload.schema > EXPORT_SCHEMA)
      throw new Error("That export was made by a newer version of the app.");

    const games = loadAllGames(); // merge against everything, then write it all back
    const seen = new Set(games.map((g) => g.id));
    let added = 0,
      skipped = 0;
    payload.games.forEach((g) => {
      // Only complete, recorded games carry statistics worth merging.
      if (!g || !g.result || !Array.isArray(g.events)) return void skipped++;
      if (!g.id) g.id = uuid();
      if (seen.has(g.id)) return void skipped++;
      seen.add(g.id);
      games.push(g);
      added++;
    });
    if (added) saveGames(games);
    return { added, skipped };
  }

  function clearAll() {
    localStorage.removeItem(KEY);
  }

  /**
   * Delete a single recorded game by id. Operates on the FULL array (never a
   * scoped view — removing from a filtered list would drop other groups' games)
   * and writes the rest back. Returns true if a game was removed. The cloud copy
   * (if any) is deleted separately by cloud.js so it can't re-download.
   */
  function deleteGame(id) {
    if (!id) return false;
    const games = loadAllGames();
    const idx = games.findIndex((g) => g && g.id === id);
    if (idx < 0) return false;
    games.splice(idx, 1);
    saveGames(games);
    return true;
  }

  /**
   * Per-game display metadata — a user-set `label` (name) and a `favorite` flag.
   * These are LOCAL, mutable annotations that live on the game record; they are
   * NOT part of the immutable recorded history (which the rules keep append-only),
   * and cloud.js mirrors them per-user via profile gameMeta so they follow you
   * across devices. Both write through loadAllGames()/saveGames() (the full
   * array), exactly like deleteGame, so a scoped view can never drop other games.
   */
  function setLabel(id, label) {
    if (!id) return false;
    const games = loadAllGames();
    const g = games.find((x) => x && x.id === id);
    if (!g) return false;
    const clean = String(label || "").trim().slice(0, 60);
    if (clean) g.label = clean; else delete g.label;
    saveGames(games);
    return true;
  }

  function setFavorite(id, fav) {
    if (!id) return false;
    const games = loadAllGames();
    const g = games.find((x) => x && x.id === id);
    if (!g) return false;
    if (fav) g.favorite = true; else delete g.favorite;
    saveGames(games);
    return true;
  }

  /**
   * Correct the recorded RESULT (roles + winner) of a finished game — e.g. a
   * mis-tapped Hitler. Only the `result` is touched; the event LOG (what actually
   * happened) is never rewritten. Writes through the full array like the others.
   */
  function setResult(id, result) {
    if (!id || !result || typeof result !== "object") return false;
    const games = loadAllGames();
    const g = games.find((x) => x && x.id === id);
    if (!g) return false;
    g.result = {
      winner: result.winner,
      hitlerIdx: result.hitlerIdx,
      fascistIdxs: (result.fascistIdxs || []).slice(),
    };
    saveGames(games);
    return true;
  }

  /**
   * Games in display order: favorites first (keeping their relative order),
   * everything else after. A stable partition, so within each group the caller's
   * existing order is preserved. Operates on whatever list is passed in.
   */
  function orderForDisplay(games) {
    const fav = [], rest = [];
    (games || []).forEach((g) => (g && g.favorite ? fav : rest).push(g));
    return fav.concat(rest);
  }

  const eventsOf = (g) => g.events || g.governments || [];
  const typeOf = (ev) => ev.type || "gov";

  /** Which team a seat was on. Returns 'hitler' | 'fascist' | 'liberal'. */
  function roleOf(result, i) {
    if (i === result.hitlerIdx) return "hitler";
    return (result.fascistIdxs || []).includes(i) ? "fascist" : "liberal";
  }

  /** How a finished game ended, inferred from its events + result. */
  function endingOf(g) {
    let lib = 0,
      fac = 0,
      hitlerShot = false,
      hitlerChancellor = false;
    for (const ev of eventsOf(g)) {
      const t = typeOf(ev);
      if (t === "fail") continue;
      if (t === "hitler") { hitlerChancellor = true; continue; }
      if (ev.vetoed) continue; // a vetoed government enacts nothing
      if (ev.enacted === "L") lib++;
      else if (ev.enacted === "F") fac++;
      if (t === "gov" && ev.power && ev.power.type === "kill" && ev.power.wasHitler) hitlerShot = true;
    }
    if (hitlerChancellor) return "Hitler elected Chancellor";
    if (hitlerShot) return "Hitler executed";
    if (fac >= 6) return "6 Fascist policies";
    if (lib >= 5) return "5 Liberal policies";
    return "Other / ended manually";
  }

  /** Aggregate per-player stats across all stored games (keyed by name). */
  function playerStats() {
    const byName = {};
    const ensure = (name) =>
      (byName[name] = byName[name] || {
        name,
        games: 0,
        wins: 0,
        // roles (mutually exclusive, so they sum to `games`)
        asLiberal: 0,
        asFascist: 0, // fascist but NOT Hitler
        asHitler: 0,
        winsAsLiberal: 0,
        winsAsFascist: 0, // includes games played as Hitler
        // seats held
        presidencies: 0,
        chancellorships: 0,
        failedElections: 0, // failed elections while they were the candidate
        // claimed hands as President, indexed by claimLibs 0..3
        claims: [0, 0, 0, 0],
        // conflicts
        conflictsAsChancellor: 0,
        conflictsAsPresident: 0,
        // vetoed governments (unlocked after 5 fascist policies)
        vetoesAsPresident: 0,
        vetoesAsChancellor: 0,
        // powers wielded as President
        investigations: 0,
        peeks: 0,
        kills: 0,
        specialElections: 0,
        // things done to them
        timesKilled: 0,
        timesInvestigated: 0,
        timesSpecialElected: 0,
        // policies they personally enacted as Chancellor
        libEnactedAsChancellor: 0,
        facEnactedAsChancellor: 0,
      });

    for (const g of loadGames()) {
      if (!g.result) continue;
      const players = g.players || [];
      const nameAt = (i) => (players[i] ? players[i].name : null);

      players.forEach((p, i) => {
        const s = ensure(p.name);
        s.games++;
        const role = roleOf(g.result, i);
        const onFascistTeam = role !== "liberal";
        if (role === "hitler") s.asHitler++;
        else if (role === "fascist") s.asFascist++;
        else s.asLiberal++;
        const won =
          (g.result.winner === "Fascist" && onFascistTeam) ||
          (g.result.winner === "Liberal" && !onFascistTeam);
        if (won) {
          s.wins++;
          if (onFascistTeam) s.winsAsFascist++;
          else s.winsAsLiberal++;
        }
      });

      for (const ev of eventsOf(g)) {
        const t = typeOf(ev);
        if (t === "chaos" || t === "hitler") continue;
        if (t === "fail") {
          const n = nameAt(ev.presidentIdx);
          if (n) ensure(n).failedElections++;
          continue;
        }
        const pres = nameAt(ev.presidentIdx);
        if (pres) {
          const s = ensure(pres);
          s.presidencies++;
          if (ev.claimLibs >= 0 && ev.claimLibs <= 3) s.claims[ev.claimLibs]++;
          if (ev.conflict) s.conflictsAsPresident++;
          if (ev.vetoed) s.vetoesAsPresident++;
          const pw = ev.power;
          if (pw) {
            if (pw.type === "invest") s.investigations++;
            else if (pw.type === "peek") s.peeks++;
            else if (pw.type === "kill") s.kills++;
            else if (pw.type === "special") s.specialElections++;
          }
        }
        const chan = nameAt(ev.chancellorIdx);
        if (chan) {
          const s = ensure(chan);
          s.chancellorships++;
          if (ev.conflict) s.conflictsAsChancellor++;
          if (ev.vetoed) s.vetoesAsChancellor++;
          else if (ev.enacted === "L") s.libEnactedAsChancellor++;
          else if (ev.enacted === "F") s.facEnactedAsChancellor++;
        }
        // things done TO other players by this presidency's power
        const pw = ev.power;
        if (pw) {
          if (pw.type === "kill" && pw.killedIdx != null) {
            const n = nameAt(pw.killedIdx);
            if (n) ensure(n).timesKilled++;
          } else if (pw.type === "invest" && pw.targetIdx != null) {
            const n = nameAt(pw.targetIdx);
            if (n) ensure(n).timesInvestigated++;
          } else if (pw.type === "special" && pw.chosenIdx != null) {
            const n = nameAt(pw.chosenIdx);
            if (n) ensure(n).timesSpecialElected++;
          }
        }
      }
    }

    return Object.values(byName)
      .map((s) => ({
        ...s,
        winRate: s.games ? s.wins / s.games : 0,
        libWinRate: s.asLiberal ? s.winsAsLiberal / s.asLiberal : 0,
        facWinRate: s.asFascist + s.asHitler ? s.winsAsFascist / (s.asFascist + s.asHitler) : 0,
        conflicts: s.conflictsAsChancellor + s.conflictsAsPresident,
      }))
      .sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.name.localeCompare(b.name));
  }

  /** Cross-game summary + totals across every recorded game. */
  function summary() {
    const finished = loadGames().filter((g) => g.result);
    const s = {
      totalGames: finished.length,
      fascistWins: 0,
      liberalWins: 0,
      fascistWinRate: 0,
      governments: 0,
      failedElections: 0,
      avgGovernments: 0,
      avgFailedElections: 0,
      avgPlayers: 0,
      policiesLib: 0,
      policiesFac: 0,
      claims: [0, 0, 0, 0],
      conflicts: 0,
      vetoes: 0,
      chaosPolicies: 0,
      investigations: 0,
      peeks: 0,
      kills: 0,
      specialElections: 0,
      hitlerExecuted: 0,
      endings: {},
      totalPlayersSeen: 0,
    };

    let playerSum = 0;
    for (const g of finished) {
      if (g.result.winner === "Fascist") s.fascistWins++;
      else s.liberalWins++;
      playerSum += g.playerCount || (g.players || []).length;

      for (const ev of eventsOf(g)) {
        const t = typeOf(ev);
        if (t === "hitler") continue; // terminal marker: no cards, no government
        if (t === "fail") {
          s.failedElections++;
          continue;
        }
        if (!ev.vetoed) {
          if (ev.enacted === "L") s.policiesLib++;
          else if (ev.enacted === "F") s.policiesFac++;
        }
        if (t === "chaos") {
          s.chaosPolicies++;
          continue;
        }
        s.governments++;
        if (ev.vetoed) s.vetoes++;
        if (ev.claimLibs >= 0 && ev.claimLibs <= 3) s.claims[ev.claimLibs]++;
        if (ev.conflict) s.conflicts++;
        const pw = ev.power;
        if (pw) {
          if (pw.type === "invest") s.investigations++;
          else if (pw.type === "peek") s.peeks++;
          else if (pw.type === "kill") {
            s.kills++;
            if (pw.wasHitler) s.hitlerExecuted++;
          } else if (pw.type === "special") s.specialElections++;
        }
      }
      const end = endingOf(g);
      s.endings[end] = (s.endings[end] || 0) + 1;
    }

    const n = finished.length;
    s.fascistWinRate = n ? s.fascistWins / n : 0;
    s.avgGovernments = n ? s.governments / n : 0;
    s.avgFailedElections = n ? s.failedElections / n : 0;
    s.avgPlayers = n ? playerSum / n : 0;
    return s;
  }

  return {
    loadGames,
    loadAllGames,
    setScope,
    recordGame,
    deleteGame,
    setLabel,
    setFavorite,
    setResult,
    orderForDisplay,
    clearAll,
    exportData,
    importData,
    playerStats,
    summary,
    endingOf,
    uuid,
    CLAIM_NAMES,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Stats;
