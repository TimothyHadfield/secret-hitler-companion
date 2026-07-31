/* ============================================================================
 * engine.js — the PURE authoritative game logic for online play.
 *
 * The "referee": given a game's state it decides roles, the deck, legal moves,
 * and outcomes — with NO network, DOM, or randomness of its own (callers pass an
 * rng, so it's deterministic and replayable). js/online.js wraps this with
 * Firestore sync; keeping the rules here means they're unit-testable in Node.
 *
 * Model: the host holds the full SECRET state (roles, deck order, hands). From
 * it we derive a PUBLIC view (the table doc every member reads) and a PER-PLAYER
 * private view (only that player reads). The public event log uses the SAME shape
 * as the analyzer (js/app.js `derive`, js/stats.js), so a finished online game
 * records to the group as an ordinary reviewable game.
 *
 * Classic script exposing `window.Engine`; also `module.exports` for Node tests.
 * ==========================================================================*/
(function () {
  // Fascists INCLUDING Hitler, by player count (5–10). = ceil(n/2) − 1.
  function fascistTotal(n) { return Math.ceil(n / 2) - 1; }
  // In 5–6 player games Hitler knows the other fascist(s); in 7+ Hitler is blind.
  function hitlerKnowsFascists(n) { return n <= 6; }

  // Presidential power granted by the Nth Fascist policy (1-based), by count.
  // 5–6: peek@3, exec@4,5. 7–8: investigate@2, special@3, exec@4,5.
  // 9–10: investigate@1,2, special@3, exec@4,5. (Slot 6 = Fascist win, no power.)
  const POWERS = {
    5: [null, null, "peek", "execute", "execute"],
    6: [null, null, "peek", "execute", "execute"],
    7: [null, "investigate", "special", "execute", "execute"],
    8: [null, "investigate", "special", "execute", "execute"],
    9: ["investigate", "investigate", "special", "execute", "execute"],
    10: ["investigate", "investigate", "special", "execute", "execute"],
  };

  // Fisher–Yates using a supplied rng (() => [0,1)). Mutates + returns arr.
  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function makeDeck() {
    const d = [];
    for (let i = 0; i < 11; i++) d.push("F");
    for (let i = 0; i < 6; i++) d.push("L");
    return d;
  }

  /**
   * Deal a game's opening (roles + each player's night knowledge). Kept separate
   * so Phase-1 role reveal + tests can use it directly. See initGame for the full
   * live-game state.
   */
  function setupGame(uids, rng) {
    rng = rng || Math.random;
    const seatOrder = shuffleInPlace(uids.slice(), rng);
    const n = seatOrder.length;
    const firstPres = Math.floor(rng() * n);

    const seats = shuffleInPlace(seatOrder.map((_, i) => i), rng);
    const fascistSeats = seats.slice(0, fascistTotal(n));
    const hitlerSeat = fascistSeats[0];
    const regularFascistSeats = fascistSeats.slice(1);

    const roleOf = {};
    seatOrder.forEach((uid, i) => {
      roleOf[uid] = i === hitlerSeat ? "hitler"
        : fascistSeats.indexOf(i) >= 0 ? "fascist" : "liberal";
    });
    const hitlerUid = seatOrder[hitlerSeat];
    const fascistUids = regularFascistSeats.map((i) => seatOrder[i]);

    const reveals = {};
    seatOrder.forEach((uid, i) => {
      const role = roleOf[uid];
      let knownFascists = [], knownHitler = null;
      if (role === "fascist") {
        knownFascists = fascistUids.filter((u) => u !== uid);
        knownHitler = hitlerUid;
      } else if (role === "hitler" && hitlerKnowsFascists(n)) {
        knownFascists = fascistUids.slice();
      }
      reveals[uid] = { role, seat: i, knownFascists, knownHitler };
    });

    return { seatOrder, firstPres, playerCount: n, roleOf, hitlerUid, fascistUids, reveals };
  }

  // -------------------------------------------------------- full live state
  /** Build the complete authoritative state for a live game. */
  function initGame(playersOrUids, rng) {
    rng = rng || Math.random;
    const players = playersOrUids.map((p) => (typeof p === "string" ? { uid: p, name: p } : p));
    const uids = players.map((p) => p.uid);
    const s = setupGame(uids, rng);
    const names = {};
    players.forEach((p) => { names[p.uid] = p.name || "Player"; });
    return {
      seatOrder: s.seatOrder, names, n: s.playerCount,
      roleOf: s.roleOf, hitlerUid: s.hitlerUid, fascistUids: s.fascistUids, reveals: s.reveals,
      deck: shuffleInPlace(makeDeck(), rng), discard: [],
      libEnacted: 0, facEnacted: 0, tracker: 0,
      presIdx: s.firstPres,
      nomineeUid: null, chancellorUid: null,
      lastPresUid: null, lastChanUid: null,
      deadUids: [], investigatedUids: [],
      phase: "nominate",
      votes: {}, lastElection: null,
      drawn: null, presClaim: null, passed: null,
      learned: {},                 // uid -> [{type:'investigate',target,party} | {type:'peek',cards}]
      specialTarget: null, specialReturnIdx: null,
      events: [], winner: null, winReason: null,
    };
  }

  // helpers ------------------------------------------------------------------
  const seatIndex = (S, uid) => S.seatOrder.indexOf(uid);
  const isAlive = (S, uid) => S.deadUids.indexOf(uid) < 0;
  const aliveUids = (S) => S.seatOrder.filter((u) => isAlive(S, u));
  const presUid = (S) => S.seatOrder[S.presIdx];

  function nextPresIdx(S, from) {
    let i = from;
    for (let k = 0; k < S.n; k++) { i = (i + 1) % S.n; if (isAlive(S, S.seatOrder[i])) return i; }
    return from;
  }

  // Chancellor term limits: the last ELECTED chancellor always; the last elected
  // president too, UNLESS only ≤5 players are alive.
  function termLimited(S) {
    const set = {};
    const alive = aliveUids(S).length;
    if (S.lastChanUid) set[S.lastChanUid] = true;
    if (alive > 5 && S.lastPresUid) set[S.lastPresUid] = true;
    return set;
  }

  function ensureDeck(S, rng) {
    if (S.deck.length < 3) { S.deck = shuffleInPlace(S.deck.concat(S.discard), rng); S.discard = []; }
  }

  function applyPolicy(S, card) { if (card === "L") S.libEnacted++; else S.facEnacted++; }

  function checkPolicyWin(S) {
    if (S.libEnacted >= 5) { S.winner = "Liberal"; S.winReason = "Five Liberal policies enacted."; S.phase = "gameover"; return true; }
    if (S.facEnacted >= 6) { S.winner = "Fascist"; S.winReason = "Six Fascist policies enacted."; S.phase = "gameover"; return true; }
    return false;
  }

  function powerForCurrentSlot(S) {
    if (S.facEnacted < 1 || S.facEnacted > 5) return null;
    return (POWERS[S.n] || POWERS[10])[S.facEnacted - 1] || null;
  }

  function clearTurn(S) {
    S.nomineeUid = null; S.chancellorUid = null; S.votes = {};
    S.drawn = null; S.presClaim = null; S.passed = null;
  }

  function advancePresident(S) {
    clearTurn(S);
    let idx;
    if (S.specialTarget != null) { idx = seatIndex(S, S.specialTarget); S.specialTarget = null; }
    else if (S.specialReturnIdx != null) { idx = S.specialReturnIdx; S.specialReturnIdx = null; }
    else idx = nextPresIdx(S, S.presIdx);
    S.presIdx = idx;
    S.phase = "nominate";
  }

  function onFailedGovernment(S, rng) {
    S.tracker++;
    if (S.tracker >= 3) {
      ensureDeck(S, rng);
      const c = S.deck.shift();
      applyPolicy(S, c);
      S.tracker = 0;
      S.lastPresUid = null; S.lastChanUid = null; // chaos resets term limits
      S.events.push({ type: "chaos", enacted: c });
      checkPolicyWin(S);
    }
  }

  // -------------------------------------------------------------- reducer
  /**
   * Apply a player action to the state. PURE: returns { ok, state } with a fresh
   * state, or { ok:false, error } and the state unchanged. `rng` is used only for
   * reshuffles/chaos, so a given (state, action, rng) is deterministic.
   */
  function applyAction(state, action, rng) {
    rng = rng || Math.random;
    if (!action || !action.type) return { ok: false, error: "no action" };
    const S = JSON.parse(JSON.stringify(state));
    const by = action.by;
    const err = (m) => ({ ok: false, error: m });
    const done = () => ({ ok: true, state: S });

    if (S.phase === "gameover") return err("game is over");

    switch (action.type) {
      case "nominate": {
        if (S.phase !== "nominate") return err("not nominating");
        if (by !== presUid(S)) return err("only the President nominates");
        const t = action.target;
        if (!isAlive(S, t) || t === by) return err("invalid nominee");
        if (termLimited(S)[t]) return err("term-limited");
        S.nomineeUid = t; S.phase = "vote"; S.votes = {};
        return done();
      }
      case "vote": {
        if (S.phase !== "vote") return err("not voting");
        if (!isAlive(S, by)) return err("dead players don't vote");
        if (action.vote !== "ja" && action.vote !== "nein") return err("bad vote");
        S.votes[by] = action.vote;
        // resolve once every living player has voted
        const alive = aliveUids(S);
        if (alive.some((u) => !(u in S.votes))) return done();
        const ja = alive.filter((u) => S.votes[u] === "ja").length;
        const passed = ja * 2 > alive.length;
        S.lastElection = { presUid: presUid(S), nomineeUid: S.nomineeUid, votes: Object.assign({}, S.votes), passed };
        const pIdx = seatIndex(S, presUid(S)), cIdx = seatIndex(S, S.nomineeUid);
        if (passed) {
          S.lastPresUid = presUid(S); S.lastChanUid = S.nomineeUid;
          if (S.facEnacted >= 3 && S.roleOf[S.nomineeUid] === "hitler") {
            S.events.push({ type: "hitler", presidentIdx: pIdx, chancellorIdx: cIdx });
            S.winner = "Fascist"; S.winReason = "Hitler was elected Chancellor."; S.phase = "gameover";
            return done();
          }
          S.chancellorUid = S.nomineeUid;
          ensureDeck(S, rng);
          S.drawn = [S.deck.shift(), S.deck.shift(), S.deck.shift()];
          S.phase = "president_play";
        } else {
          S.events.push({ type: "fail", presidentIdx: pIdx });
          onFailedGovernment(S, rng);
          if (S.phase !== "gameover") advancePresident(S);
        }
        return done();
      }
      case "president_play": {
        if (S.phase !== "president_play") return err("not the President's turn");
        if (by !== presUid(S)) return err("only the President plays");
        const di = action.discard;
        if (!(di === 0 || di === 1 || di === 2)) return err("bad discard");
        const claim = action.claim;
        if (!(claim >= 0 && claim <= 3)) return err("bad claim");
        const cards = S.drawn.slice();
        S.discard.push(cards[di]);
        S.passed = cards.filter((_, i) => i !== di);
        S.presClaim = claim;
        S.drawn = null;
        S.phase = "chancellor_play";
        return done();
      }
      case "chancellor_play": {
        if (S.phase !== "chancellor_play") return err("not the Chancellor's turn");
        if (by !== S.chancellorUid) return err("only the Chancellor plays");
        // Veto (only once 5 Fascist policies are enacted).
        if (action.veto) {
          if (S.facEnacted < 5) return err("veto not available");
          S.phase = "veto"; return done();
        }
        const ei = action.enact;
        if (!(ei === 0 || ei === 1)) return err("bad enact");
        const card = S.passed[ei];
        S.discard.push(S.passed[1 - ei]);
        S.passed = null;
        return resolveEnact(S, card, rng);
      }
      case "veto": {
        if (S.phase !== "veto") return err("no veto pending");
        if (by !== presUid(S)) return err("only the President answers a veto");
        if (action.agree) {
          S.discard.push(S.passed[0], S.passed[1]); S.passed = null;
          const pIdx = seatIndex(S, presUid(S)), cIdx = seatIndex(S, S.chancellorUid);
          S.events.push({ type: "gov", presidentIdx: pIdx, chancellorIdx: cIdx, claimLibs: S.presClaim, conflict: false, enacted: null, vetoed: true });
          onFailedGovernment(S, rng);
          if (S.phase !== "gameover") advancePresident(S);
        } else {
          S.phase = "chancellor_play"; // chancellor must now enact
        }
        return done();
      }
      case "power": {
        return resolvePower(S, action, rng);
      }
      default:
        return err("unknown action");
    }
  }

  // Enact a policy, log the government, then trigger a power / win / advance.
  function resolveEnact(S, card, rng) {
    applyPolicy(S, card);
    S.tracker = 0; // any enacted policy resets the tracker
    const pIdx = seatIndex(S, presUid(S)), cIdx = seatIndex(S, S.chancellorUid);
    const ev = { type: "gov", presidentIdx: pIdx, chancellorIdx: cIdx, claimLibs: S.presClaim, conflict: false, enacted: card };
    S.events.push(ev);
    if (checkPolicyWin(S)) return { ok: true, state: S };
    if (card === "F") {
      const power = powerForCurrentSlot(S);
      if (power) { S._powerEventIdx = S.events.length - 1; S.phase = "power_" + power; return { ok: true, state: S }; }
    }
    advancePresident(S);
    return { ok: true, state: S };
  }

  // Presidential powers. The acting President submits {type:'power', ...}.
  function resolvePower(S, action, rng) {
    if (S.phase.indexOf("power_") !== 0) return { ok: false, error: "no power pending" };
    if (action.by !== presUid(S)) return { ok: false, error: "only the President uses the power" };
    const kind = S.phase.slice("power_".length);
    const ev = S.events[S._powerEventIdx];
    const attach = (p) => { if (ev) ev.power = p; };

    if (kind === "investigate") {
      const t = action.target;
      if (!isAlive(S, t) || t === action.by) return { ok: false, error: "bad target" };
      if (S.investigatedUids.indexOf(t) >= 0) return { ok: false, error: "already investigated" };
      const party = S.roleOf[t] === "liberal" ? "Liberal" : "Fascist";
      S.investigatedUids.push(t);
      (S.learned[action.by] = S.learned[action.by] || []).push({ type: "investigate", target: t, party });
      attach({ type: "investigation", target: seatIndex(S, t) });
    } else if (kind === "special") {
      const t = action.target;
      if (!isAlive(S, t) || t === action.by) return { ok: false, error: "bad target" };
      S.specialTarget = t;
      if (S.specialReturnIdx == null) S.specialReturnIdx = nextPresIdx(S, S.presIdx);
      attach({ type: "special-election", target: seatIndex(S, t) });
    } else if (kind === "peek") {
      ensureDeck(S, rng);
      const top = S.deck.slice(0, 3);
      (S.learned[action.by] = S.learned[action.by] || []).push({ type: "peek", cards: top });
      attach({ type: "policy-peek" });
    } else if (kind === "execute") {
      const t = action.target;
      if (!isAlive(S, t) || t === action.by) return { ok: false, error: "bad target" };
      S.deadUids.push(t);
      attach({ type: "execution", target: seatIndex(S, t) });
      if (t === S.hitlerUid) {
        S.winner = "Liberal"; S.winReason = "Hitler was executed."; S.phase = "gameover";
        delete S._powerEventIdx;
        return { ok: true, state: S };
      }
    } else {
      return { ok: false, error: "unknown power" };
    }
    delete S._powerEventIdx;
    advancePresident(S);
    return { ok: true, state: S };
  }

  // ------------------------------------------------------------- views
  /** Everything every player may see (the table doc). No secrets. */
  function publicView(S) {
    const v = {
      seatOrder: S.seatOrder, names: S.names, n: S.n,
      libEnacted: S.libEnacted, facEnacted: S.facEnacted, tracker: S.tracker,
      presUid: presUid(S), presIdx: S.presIdx,
      nomineeUid: S.nomineeUid, chancellorUid: S.chancellorUid,
      lastPresUid: S.lastPresUid, lastChanUid: S.lastChanUid,
      deadUids: S.deadUids, investigatedUids: S.investigatedUids,
      phase: S.phase, events: S.events,
      lastElection: S.lastElection,
      termLimited: Object.keys(termLimited(S)),
      votedUids: Object.keys(S.votes),
      deckCount: S.deck.length, discardCount: S.discard.length,
      firstPres: null,
      winner: S.winner, winReason: S.winReason,
    };
    // At game over, reveal every role so the table (and the recorded game) shows them.
    if (S.phase === "gameover") {
      v.roleOf = S.roleOf; v.hitlerUid = S.hitlerUid; v.fascistUids = S.fascistUids;
    }
    return v;
  }

  /** What ONE player may see privately: their night reveal + current secrets. */
  function privateView(S, uid) {
    const r = S.reveals[uid] || null;
    const out = {
      role: r && r.role, seat: r && r.seat,
      knownFascists: (r && r.knownFascists) || [], knownHitler: (r && r.knownHitler) || null,
      learned: S.learned[uid] || [],
      drawn: null, passed: null,
    };
    if (uid === presUid(S) && S.phase === "president_play") out.drawn = S.drawn;
    if (uid === S.chancellorUid && (S.phase === "chancellor_play" || S.phase === "veto")) out.passed = S.passed;
    return out;
  }

  /**
   * The finished game as a recorded-game record (same shape stats/replay expect):
   * players[] in seat order, the event log, and the true result. Called by
   * online.js when the game ends, to save it to the group.
   */
  function toRecordedGame(S) {
    const players = S.seatOrder.map((u) => ({ name: S.names[u] || "Player" }));
    const fascistIdxs = S.fascistUids.map((u) => seatIndex(S, u));
    return {
      players,
      playerCount: S.n,
      firstPres: 0,
      events: S.events,
      roundMods: {},
      result: { winner: S.winner, hitlerIdx: seatIndex(S, S.hitlerUid), fascistIdxs },
    };
  }

  const api = {
    fascistTotal, hitlerKnowsFascists, shuffleInPlace, setupGame,
    initGame, applyAction, publicView, privateView, toRecordedGame,
    // exposed for hosts/tests
    presUid, aliveUids, isAlive, termLimited, powerForCurrentSlot, POWERS,
  };
  if (typeof window !== "undefined") window.Engine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
