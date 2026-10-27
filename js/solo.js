/* ============================================================================
 * solo.js — play a full game on one device against computer players.
 *
 * Runs the same pure rules engine as online play (js/engine.js) right here in
 * the browser, with computer players (js/bots.js) in every seat but yours. It
 * exposes the SAME surface as window.Online (table, players, myPrivate, me,
 * isHost, submitAction, …) and fires the same `online:state` event, so app.js
 * draws a solo game with the online-play screens unchanged.
 *
 * Nothing here touches the network or the recorded-games history (computer
 * games are not real table games). The game in progress is kept in
 * localStorage so a reload resumes it.
 *
 * Classic script exposing `window.Solo`.
 * ==========================================================================*/
(function () {
  const KEY = "secretHitler.solo.v1";
  const MIN_PLAYERS = 5, MAX_PLAYERS = 10;
  const ME = "you";
  // Plain, short names that fit a phone row. (Wording is Tim's call.)
  const NAMES = ["Ada", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo"];

  let S = null;          // full engine state (secret)
  let status = null;     // "night" | "playing" | "finished"
  let level = "normal";
  let mems = {};         // bot uid -> Bots memory
  let myName = "You";
  let timer = null;
  let active = false;
  let finishedFired = false;

  const E = () => window.Engine;
  const B = () => window.Bots;
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  function save() {
    try {
      if (!S || status === "finished") { localStorage.removeItem(KEY); return; }
      // Bot memories hold derived caches; drop them (they rebuild on demand).
      const m = {};
      Object.keys(mems).forEach((u) => { m[u] = Object.assign({}, mems[u], { cache: null }); });
      localStorage.setItem(KEY, JSON.stringify({ S, status, level, mems: m, myName }));
    } catch (e) { /* storage full/blocked: the game still plays, just won't resume */ }
  }

  function saved() {
    try { const x = JSON.parse(localStorage.getItem(KEY) || "null"); return x && x.S && x.S.phase !== "gameover" ? x : null; }
    catch (e) { return null; }
  }

  function table() {
    if (!S) return null;
    return Object.assign({ id: "solo", hostUid: ME, hostName: myName, status, solo: true, level }, E().publicView(S));
  }

  function emitState() {
    emit("online:state", { table: table(), players: api.players, myPrivate: api.myPrivate, tableId: S ? "solo" : null, isHost: true, me: api.me });
  }

  // One computer move at a time, with a short pause so a person can follow it.
  function delayFor(a) {
    const base = api.delay;
    if (!a) return base;
    if (a.type === "vote") return Math.round(base * 0.35);
    return base;
  }

  // The chosen level is your opponents' strength; your teammates always play Normal.
  // (Everyone at the same level barely moves your odds in a team game: measured, one
  // Normal player wins 47/53/52% at all-Easy/Normal/Hard tables, but 70/53/40% when
  // only the other team plays at that level. test/bots.test.js checks the ladder.)
  function levelFor(u) {
    const lib = (r) => r === "liberal";
    return lib(S.roleOf[u]) === lib(S.roleOf[ME]) ? "normal" : level;
  }

  function nextBotAction() {
    const pub = E().publicView(S);
    for (const u of S.seatOrder) {
      if (u === ME) continue;
      const priv = E().privateView(S, u);
      B().observe(mems[u], pub, priv, u);
    }
    for (const u of S.seatOrder) {
      if (u === ME) continue;
      const a = B().act(pub, E().privateView(S, u), u, levelFor(u), mems[u], Math.random);
      if (a) return Object.assign({ by: u }, a);
    }
    return null;
  }

  function pump() {
    clearTimeout(timer); timer = null;
    if (!S || status !== "playing" || S.phase === "gameover") return;
    const a = nextBotAction();
    if (!a) return; // waiting on the person
    timer = setTimeout(() => {
      timer = null;
      if (!S || status !== "playing") return;
      const res = E().applyAction(S, a, Math.random);
      if (res.ok) S = res.state;
      after();
    }, delayFor(a));
  }

  function after() {
    if (S && S.phase === "gameover") {
      status = "finished";
      if (!finishedFired) {
        finishedFired = true;
        const myRole = S.roleOf[ME];
        const team = myRole === "liberal" ? "Liberal" : "Fascist";
        emit("solo:finished", { winner: S.winner, reason: S.winReason, role: myRole, won: S.winner === team, level, n: S.n });
      }
    }
    // let every bot watch the new state (votes are only visible until the next election)
    if (S) {
      const pub = E().publicView(S);
      S.seatOrder.forEach((u) => { if (u !== ME && mems[u]) B().observe(mems[u], pub, E().privateView(S, u), u); });
    }
    save();
    emitState();
    pump();
  }

  const api = {
    MIN_PLAYERS, MAX_PLAYERS, ME,
    delay: 900,
    get active() { return active; },
    get level() { return level; },
    get me() { return { uid: ME, displayName: myName }; },
    get groupId() { return null; },
    get tableId() { return S ? "solo" : null; },
    get table() { return table(); },
    get players() { return S ? S.seatOrder.map((u) => ({ uid: u, name: S.names[u] })) : []; },
    get myPrivate() { return S ? E().privateView(S, ME) : null; },
    get isHost() { return true; },
    get state() { return S; }, // tests only

    hasSaved() { return !!saved(); },

    /** Start a new game: n players (you + n-1 computers) at a level. */
    start(opts) {
      opts = opts || {};
      const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, opts.n | 0 || 7));
      level = (B().LEVELS.indexOf(opts.level) >= 0) ? opts.level : "normal";
      myName = (opts.name || "You").slice(0, 24);
      const players = [{ uid: ME, name: myName }];
      for (let i = 0; i < n - 1; i++) players.push({ uid: "cpu" + (i + 1), name: NAMES[i] });
      S = E().initGame(players, Math.random);
      mems = {}; players.forEach((p) => { if (p.uid !== ME) mems[p.uid] = B().newMemory(); });
      status = "night"; active = true; finishedFired = false;
      save(); emitState();
      return { ok: true };
    },

    /** Pick up the saved game after a reload. */
    resume() {
      const x = saved();
      if (!x) return { ok: false };
      S = x.S; status = x.status; level = x.level; myName = x.myName || "You";
      mems = x.mems || {};
      S.seatOrder.forEach((u) => { if (u !== ME && !mems[u]) mems[u] = B().newMemory(); });
      active = true; finishedFired = false;
      emitState(); pump();
      return { ok: true };
    },

    async beginPlay() { if (!S) return { ok: false }; status = "playing"; save(); emitState(); pump(); return { ok: true }; },
    async startGame() { return { ok: true }; },
    async submitAction(a) {
      if (!S || status !== "playing") return { ok: false, message: "No game in progress." };
      const res = E().applyAction(S, Object.assign({}, a, { by: ME }), Math.random);
      if (!res.ok) return { ok: false, message: res.error };
      S = res.state;
      after();
      return { ok: true };
    },
    /** Leave the table: the game is dropped (a solo game has no one else). */
    async leaveTable() { return api.quit(); },
    async abortTable() { return api.quit(); },
    quit() {
      clearTimeout(timer); timer = null;
      S = null; status = null; active = false; mems = {};
      try { localStorage.removeItem(KEY); } catch (e) {}
      emit("online:left", { solo: true });
      return { ok: true };
    },
    async listTables() { return []; },
    async hostGame() { return { ok: false }; },
    async joinTable() { return { ok: false }; },
    refresh: emitState,
  };

  window.Solo = api;
})();
