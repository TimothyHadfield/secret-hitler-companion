/* ============================================================================
 * app.js — Secret Hitler companion: state, randomization, bookkeeping, UI.
 * Depends on Prob (probability.js) and Stats (stats.js).
 *
 * Event model: state.events is an ordered list of mixed events:
 *   { type:'gov',   presidentIdx, chancellorIdx, claimLibs, conflict, enacted }
 *   { type:'fail',  presidentIdx }                       // failed election → tracker +1
 *   { type:'chaos', enacted }                            // top-deck after 3 fails
 * ==========================================================================*/

(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---- Player counts → fascist track powers (see SECRET_HITLER_RULES.md) ----
  const FAC_POWERS = {
    5: ["", "", "peek", "kill", "kill", "win"],
    6: ["", "", "peek", "kill", "kill", "win"],
    7: ["", "invest", "special", "kill", "kill", "win"],
    8: ["", "invest", "special", "kill", "kill", "win"],
    9: ["invest", "invest", "special", "kill", "kill", "win"],
    10: ["invest", "invest", "special", "kill", "kill", "win"],
  };
  const POWER_LABEL = { invest: "Investigation", special: "Special Election", peek: "Policy Peek", kill: "Kill" };
  const POWER_ICON = { invest: "🔍", special: "⚡", peek: "👁", kill: "💀" };

  // number of Fascists to record (excluding Hitler), by player count
  const FASCIST_COUNT = { 5: 1, 6: 1, 7: 2, 8: 2, 9: 3, 10: 3 };

  // ---- Ratio metadata (claim = liberals drawn of 3) ----
  const RATIOS = [
    { libs: 0, name: "Coal", cls: "coal", sub: "3F" },
    { libs: 1, name: "Golden", cls: "golden", sub: "2F / 1L" },
    { libs: 2, name: "Silver", cls: "silver", sub: "1F / 2L" },
    { libs: 3, name: "Bronze", cls: "bronze", sub: "3L" },
  ];
  // background colour scales full red (0 liberals) → full blue (3 liberals)
  function ratioColor(libs) {
    const t = libs / 3;
    const r = Math.round(181 + (43 - 181) * t);
    const g = Math.round(50 + (140 - 50) * t);
    const b = Math.round(31 + (176 - 31) * t);
    return `rgb(${r},${g},${b})`;
  }

  function inferEnacted(claimLibs, conflict) {
    if (claimLibs === 0) return "F"; // Coal — only fascists available
    if (conflict) return "F"; // Chancellor enacted fascist despite a claimed liberal
    return "L"; // a liberal was available and played
  }

  // ------------------------------ state --------------------------------------
  let setupPlayers = [];
  let state = null;
  let stashedState = null; // holds the live game while reviewing a saved one

  // ------------------------------ persistence --------------------------------
  // The active game and the setup roster are saved locally so a refresh, a
  // browser close/reopen, or a redeploy never loses an in-progress game.
  const ACTIVE_KEY = "secretHitler.activeGame.v1";
  const SETUP_KEY = "secretHitler.setupPlayers.v1";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

  function saveActive() { if (state && !state.review) lsSet(ACTIVE_KEY, JSON.stringify(state)); }
  function clearActive() { lsDel(ACTIVE_KEY); }
  function saveSetup() { lsSet(SETUP_KEY, JSON.stringify(setupPlayers)); }

  function loadActive() {
    try {
      const s = JSON.parse(lsGet(ACTIVE_KEY));
      if (!s || !s.players || !Array.isArray(s.events)) return null;
      // backfill fields that may be absent in a game saved by an older version
      if (!Array.isArray(s.undoStack)) s.undoStack = [];
      if (!s.form) s.form = { chanIdxOverride: null, conflictArmed: false };
      if (!s.roundMods) s.roundMods = {};
      if (!("gameOver" in s)) s.gameOver = null;
      if (!("pendingPower" in s)) s.pendingPower = null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function newGameState(players, firstPres) {
    return {
      date: null,
      players: players.map((n) => ({ name: n, dead: false })),
      firstPres,
      events: [],
      roundMods: {},
      // President, suggested Chancellor, and deaths are DERIVED from events.
      // The form only holds the user's current Chancellor tap + conflict arm.
      form: { chanIdxOverride: null, conflictArmed: false },
      pendingChaos: false,
      pendingPower: null, // { type, govIndex, presidentIdx } while a power is unresolved
      gameOver: null, // { winner, reason } once a terminal outcome occurs
      recordingRoles: false, // showing the role-recording panel in place of controls
      roleDraft: { hitlerIdx: null, fascistIdxs: [] },
      winnerDraft: null, // manual winner when the game didn't auto-detect one
      review: false, // read-only review of a saved game
      autoResult: null,
      undoStack: [], // full-state snapshots for exact revert
      result: null,
    };
  }

  // ---------------------- derived bookkeeping --------------------------------
  function derive() {
    let fac = 0,
      lib = 0,
      draw = 17,
      round = 0,
      tracker = 0;
    const mkRound = (index, startN, startL) => ({
      index,
      startN,
      startL,
      govs: [],
      chaosLib: 0,
      chaosFac: 0,
    });
    const rounds = [mkRound(0, 17, 6)];
    const gi = [];
    const evInfo = [];
    const lastGovByPlayer = {};
    const failsByPlayer = {};
    const eventsByPlayer = {}; // player idx -> [gov info | {type:'fail'}] in order
    const pushPlayerEvent = (idx, e) => (eventsByPlayer[idx] = eventsByPlayer[idx] || []).push(e);
    const N = state.players.length;

    // Turn order + deaths, walked alongside the pile bookkeeping.
    const deadSet = new Set();
    let pointer = state.firstPres; // the current presidential candidate
    let pendingResume = null; // seat to resume at after a Special-Election detour
    let lastChan = null;
    const nextAlive = (idx) => {
      for (let s = 1; s <= N; s++) {
        const j = (idx + s) % N;
        if (!deadSet.has(j)) return j;
      }
      return idx;
    };
    const advanceAfter = (presIdx, ev) => {
      if (ev && ev.power && ev.power.type === "special" && ev.power.chosenIdx != null) {
        pendingResume = nextAlive(presIdx); // normal order resumes here after the detour
        pointer = ev.power.chosenIdx;
      } else if (pendingResume !== null) {
        pointer = pendingResume;
        pendingResume = null;
      } else {
        pointer = nextAlive(presIdx);
      }
    };

    const reshuffleIfNeeded = () => {
      const pool = 17 - fac - lib;
      if (draw < 3 && pool > draw) {
        round++;
        draw = pool;
        rounds.push(mkRound(round, draw, 6 - lib));
      }
    };

    state.events.forEach((ev, n) => {
      if (ev.type === "fail") {
        tracker++;
        failsByPlayer[ev.presidentIdx] = (failsByPlayer[ev.presidentIdx] || 0) + 1;
        pushPlayerEvent(ev.presidentIdx, { type: "fail" });
        evInfo.push({ type: "fail", presidentIdx: ev.presidentIdx, tracker });
        advanceAfter(ev.presidentIdx, null);
        return;
      }
      if (ev.type === "chaos") {
        draw -= 1;
        if (ev.enacted === "L") { lib++; rounds[round].chaosLib++; }
        else { fac++; rounds[round].chaosFac++; }
        tracker = 0;
        evInfo.push({ type: "chaos", enacted: ev.enacted });
        reshuffleIfNeeded();
        return; // chaos does not change the presidential rotation
      }
      // gov
      reshuffleIfNeeded(); // safety (normally already reshuffled after prior event)
      const enacted = ev.enacted;
      // apply a resolved Kill before advancing so the dead player is skipped
      if (ev.power && ev.power.type === "kill" && ev.power.killedIdx != null && !ev.power.wasHitler) {
        deadSet.add(ev.power.killedIdx);
      }
      const info = {
        type: "gov",
        n,
        round,
        libs: ev.claimLibs,
        conflict: !!ev.conflict,
        enacted,
        presidentIdx: ev.presidentIdx,
        chancellorIdx: ev.chancellorIdx,
        power: ev.power || null,
        prob: null,
      };
      const giIdx = gi.push(info) - 1;
      rounds[round].govs.push(giIdx);
      lastGovByPlayer[ev.presidentIdx] = info;
      pushPlayerEvent(ev.presidentIdx, info);
      evInfo.push({ type: "gov", giIdx });
      draw -= 3;
      if (enacted === "L") lib++;
      else fac++;
      tracker = 0;
      lastChan = ev.chancellorIdx;
      advanceAfter(ev.presidentIdx, ev);
      reshuffleIfNeeded();
    });

    // reflect deaths on the player objects (used by tap/chancellor validation)
    state.players.forEach((p, i) => (p.dead = deadSet.has(i)));

    // suggested chancellor: one seat past the last elected chancellor
    let suggestedChan = null;
    if (lastChan !== null) {
      let c = nextAlive(lastChan);
      if (c === pointer) c = nextAlive(c);
      suggestedChan = c;
    }

    // retrospective probability + modifier bounds, per round
    rounds.forEach((r) => {
      const g = r.govs.length;
      const claims = r.govs.map((idx) => gi[idx].libs);
      const claimSum = claims.reduce((a, b) => a + b, 0);
      const R = r.startN - 3 * g;
      r.leftover = R;
      r.claimSum = claimSum;
      // Physical feasibility window: keeps every claim in the round possible
      // (0 <= liberals drawn <= pool liberals, and bottom cards in [0,R]).
      // This window is never empty, so a feasible modifier always exists.
      const physLo = g ? Math.max(claimSum - r.startL, -r.startL) : 0;
      const physHi = g ? Math.min(claimSum - r.startL + R, r.startN - r.startL) : 0;
      // Plausibility cap: each presidency can lie at most ±1 (# presidents so far).
      const capLo = Math.max(physLo, -g);
      const capHi = Math.min(physHi, g);
      const raw = state.roundMods[r.index] || 0;
      if (capLo <= capHi) {
        r.modLo = capLo;
        r.modHi = capHi;
        r.forced = false;
      } else {
        // The ±(#presidents) cap can't reach a feasible value — an impossible
        // claim was recorded, so we auto-adjust beyond the plausible cap.
        r.modLo = physLo;
        r.modHi = physHi;
        r.forced = true;
      }
      r.mod = clamp(raw, r.modLo, r.modHi);
      // Persist the auto-adjusted (feasible) value so the stepper reflects it
      // and no government is ever shown at an impossible 0%.
      state.roundMods[r.index] = r.mod;
      r.effL = clamp(r.startL + r.mod, 0, r.startN);
      r.govs.forEach((idx, localIdx) => {
        gi[idx].prob = Prob.retrospectiveProb(r.startN, r.effL, claims, localIdx);
      });
      r.bottomLibs = clamp(r.effL - claimSum, 0, R);
    });

    // current draw / discard composition
    const cur = rounds[round];
    const drawLibs = clamp(cur.effL - cur.claimSum - cur.chaosLib, 0, draw);
    const drawFasc = draw - drawLibs;
    const libEnactedGov = cur.govs.filter((idx) => gi[idx].enacted === "L").length;
    const discardLibs = Math.max(0, cur.claimSum - libEnactedGov);
    const discardFasc = Math.max(0, cur.govs.length * 2 - discardLibs);

    return {
      fac,
      lib,
      draw,
      round,
      tracker,
      rounds,
      gi,
      evInfo,
      lastGovByPlayer,
      failsByPlayer,
      eventsByPlayer,
      drawLibs,
      drawFasc,
      discardLibs,
      discardFasc,
      presIdx: pointer,
      suggestedChan,
      deadSet,
    };
  }

  // effective chancellor for the current turn: user's tap, else the suggestion
  function effChan(d) {
    const o = state.form.chanIdxOverride;
    if (o != null && !state.players[o].dead && o !== d.presIdx) return o;
    return d.suggestedChan;
  }

  // ------------------------------ screens ------------------------------------
  function show(id) {
    ["setupScreen", "gameScreen", "statsScreen"].forEach((s) =>
      $(s).classList.toggle("hidden", s !== id)
    );
    // the game screen carries its own top row (tabs + New/End); hide the global topbar there
    $("topbar").classList.toggle("hidden", id === "gameScreen");
  }

  // ------------------------------ SETUP --------------------------------------
  function renderSetup() {
    const ul = $("playerList");
    ul.innerHTML = "";
    setupPlayers.forEach((name, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="seat">${i + 1}</span><span style="flex:1">${escapeHtml(
        name
      )}</span>`;
      const del = document.createElement("button");
      del.textContent = "Remove";
      del.onclick = () => {
        setupPlayers.splice(i, 1);
        renderSetup();
      };
      li.appendChild(del);
      ul.appendChild(li);
    });
    const n = setupPlayers.length;
    const ok = n >= 5 && n <= 10;
    $("btnRandomize").disabled = !ok;
    $("setupHint").textContent = ok ? `${n} players ready.` : `${n} player(s) — need 5 to 10.`;
    saveSetup(); // remember the roster across sessions/games
  }

  function addPlayer() {
    const v = $("nameInput").value.trim();
    if (!v || setupPlayers.length >= 10) return;
    setupPlayers.push(v);
    $("nameInput").value = "";
    $("nameInput").focus();
    renderSetup();
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startGame() {
    const seated = shuffle(setupPlayers);
    const firstPres = Math.floor(Math.random() * seated.length);
    state = newGameState(seated, firstPres);
    show("gameScreen");
    switchTab("play");
    renderGame();
  }

  // ------------------------------ GAME ---------------------------------------
  function aliveIdxs() {
    return state.players.map((p, i) => i).filter((i) => !state.players[i].dead);
  }

  function renderGame() {
    const d = derive();
    renderRounds(d);
    renderTable(d);
    renderBoards(d);
    renderControls(d);
    renderPower(d);
    renderGameOver();
    renderHistory(d);
    $("chaosPrompt").classList.toggle("hidden", !(state.pendingChaos && !state.gameOver));
    saveActive(); // persist the full game state after every change
  }

  function renderGameOver() {
    const m = $("gameOverModal");
    if (!state.gameOver || state.recordingRoles) {
      m.classList.add("hidden");
      return;
    }
    m.classList.remove("hidden");
    const g = state.gameOver;
    const cls = g.winner === "Liberal" ? "c-lib" : "c-fac";
    $("gameOverBody").innerHTML =
      `<div class="power-title"><span class="${cls}">${g.winner}s win!</span></div>` +
      `<p style="font-size:15px">${escapeHtml(g.reason)} The game is over.</p>` +
      `<p class="muted" style="font-size:13px">Record who was Hitler and the Fascists to save this game to your statistics.</p>` +
      `<div class="control-row"><button id="goEnd" class="primary">Record roles →</button>` +
      `<button id="goBack" class="ghost">↶ Back</button></div>`;
    $("goEnd").onclick = enterRoleRecording;
    $("goBack").onclick = undoLast;
  }

  // per-round blocks: "Round N" + finished-round bottom cards inline to its right,
  // with the modifier stepper below. (No "bottom" label — kept compact so it fits the
  // desktop side column and leaves vertical room for the seats on phones.)
  function renderRounds(d) {
    const bar = $("roundsBar");
    bar.innerHTML = "";
    d.rounds.forEach((r) => {
      const finished = r.index < d.round; // a later round exists ⇒ this one has ended
      const block = document.createElement("div");
      block.className = "round-block" + (r.index === d.round ? " current" : "");
      let bottom = "";
      if (finished && r.leftover > 0) {
        const cards = [];
        for (let k = 0; k < r.leftover; k++) cards.push(k < r.bottomLibs ? "L" : "F");
        bottom =
          `<div class="round-bottom" title="bottom cards">` +
          cards.map((c) => `<span class="miniCard ${c}"></span>`).join("") +
          `</div>`;
      }
      block.innerHTML =
        `<div class="round-head"><div class="round-title">Round ${r.index + 1}</div>${bottom}</div>` +
        `<div class="round-mod">` +
        `<button data-r="${r.index}" data-d="-1" ${r.mod <= r.modLo ? "disabled" : ""}>−</button>` +
        `<b>${fmtSigned(r.mod)}</b>` +
        `<button data-r="${r.index}" data-d="1" ${r.mod >= r.modHi ? "disabled" : ""}>+</button>` +
        `</div>`;
      bar.appendChild(block);
    });
    bar.querySelectorAll("button[data-r]").forEach((b) => {
      b.onclick = () => adjustRoundModFor(+b.dataset.r, +b.dataset.d);
    });
    placeRoundsBar();
  }

  // The rounds bar lives above the table on phones (short blocks, more room for the
  // top seats) but moves into the right-hand control column on wider screens (above
  // the policy options), freeing the table's top band for seats + presidencies.
  function placeRoundsBar() {
    const bar = $("roundsBar");
    const slot = $("roundsSlot");
    const playTab = $("playTab");
    if (!bar || !slot || !playTab) return;
    const desktop = window.innerWidth > 640;
    if (desktop) {
      if (bar.parentElement !== slot) slot.appendChild(bar);
    } else if (bar.parentElement !== playTab || playTab.firstElementChild !== bar) {
      playTab.insertBefore(bar, playTab.firstElementChild);
    }
  }

  // Seat placement around a rectangular table.
  // Phones (<=640px): everyone on the top & bottom edges only, so the board can
  // run nearly the full width. Wider screens: spread across all 4 sides, never a
  // corner. Indices run clockwise (top L→R, right T→B, bottom R→L, left B→T) so
  // seat order still reads as a ring.
  function computeSeats(n) {
    const mobile = window.innerWidth <= 640;
    const seats = new Array(n);
    const along = (count, lo, hi) =>
      Array.from({ length: count }, (_, k) =>
        count === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * k) / (count - 1));

    let counts;
    if (mobile) {
      const topC = Math.ceil(n / 2);
      counts = { top: topC, right: 0, bottom: n - topC, left: 0 };
    } else {
      const base = Math.floor(n / 4);
      counts = { top: base, right: base, bottom: base, left: base };
      // give the leftovers to the wider edges first (top, then bottom)
      ["top", "bottom", "left", "right"].slice(0, n % 4).forEach((e) => counts[e]++);
    }

    // Seats are pulled well clear of the board so each has room for a full
    // 3-presidency stack (top seats grow up, everyone else grows down). On phones
    // the bottom seats straddle the felt's bottom edge to free space beneath them.
    const TOPY = mobile ? 25 : 24, BOTY = mobile ? 72 : 74;
    const LEFTX = 9, RIGHTX = 91;
    const xLo = mobile ? 11 : 26, xHi = mobile ? 89 : 74; // keep off the corners
    const yLo = 40, yHi = 58; // side seats stay in the middle band

    let i = 0;
    along(counts.top, xLo, xHi).forEach((x) => (seats[i++] = { x, y: TOPY, edge: "top" }));
    along(counts.right, yLo, yHi).forEach((y) => (seats[i++] = { x: RIGHTX, y, edge: "right" }));
    along(counts.bottom, xHi, xLo).forEach((x) => (seats[i++] = { x, y: BOTY, edge: "bottom" }));
    along(counts.left, yHi, yLo).forEach((y) => (seats[i++] = { x: LEFTX, y, edge: "left" }));
    return seats;
  }

  function renderTable(d) {
    const area = $("tableArea");
    area.querySelectorAll(".seatNode").forEach((el) => el.remove());
    const n = state.players.length;
    const seats = computeSeats(n);

    const chanIdx = effChan(d);
    // known/assigned roles color the circles (recording, review, or saved game)
    const roles = state.result || (state.recordingRoles ? state.roleDraft : null);
    state.players.forEach((p, i) => {
      const { x, y, edge } = seats[i];
      const node = document.createElement("div");
      node.className = "seatNode edge-" + edge;
      node.dataset.seat = i;
      if (roles) {
        if (i === roles.hitlerIdx) node.classList.add("role-hitler");
        else if ((roles.fascistIdxs || []).includes(i)) node.classList.add("role-fascist");
        else node.classList.add("role-liberal");
      } else {
        if (i === d.presIdx) node.classList.add("pres");
        if (i === chanIdx) node.classList.add("chan");
      }
      if (p.dead) node.classList.add("dead");
      node.style.left = x + "%";
      node.style.top = y + "%";
      node.onclick = () => setChancellor(i);

      // one row per presidency: [3 cards | odds + details]  (X for a failed election)
      const evs = d.eventsByPlayer[i] || [];
      const extra = evs
        .map((ev) => {
          if (ev.type === "fail") {
            return `<div class="pres-row"><span class="fail-x">✕</span></div>`;
          }
          const cards = [];
          for (let k = 0; k < 3; k++) cards.push(k < 3 - ev.libs ? "F" : "L");
          const hand =
            `<div class="miniHand">` + cards.map((c) => `<div class="miniCard ${c}"></div>`).join("") + `</div>`;
          const side =
            `<div class="odds">${Prob.fmtPct(ev.prob)}</div>` + presDetails(ev);
          return `<div class="pres-row">${hand}<div class="pres-side">${side}</div></div>`;
        })
        .join("");

      let badge = "";
      if (!roles) {
        if (i === d.presIdx) badge = `<span class="role-badge p" title="President">P</span>`;
        else if (i === chanIdx) badge = `<span class="role-badge c" title="Chancellor">C</span>`;
      }

      node.innerHTML =
        `<div class="seat-head">` +
        `<div class="avatar">${escapeHtml(initials(p.name))}${badge}${
          p.dead ? `<span class="skull">💀</span>` : ""
        }</div>` +
        `<div class="name">${escapeHtml(p.name)}${i === state.firstPres ? " ·①" : ""}</div>` +
        `</div>` +
        `<div class="seat-pres"><div class="pres-stack">${extra}</div></div>`;
      area.appendChild(node);
    });
    // Each seat reserves room for 3 presidencies; if a seat's stack is taller than
    // that slot (a 3rd presidency, or tall detail chips), shrink it to fit so no
    // presidency data is ever clipped or lost.
    fitPresStacks(area);
  }

  function fitPresStacks(area) {
    area.querySelectorAll(".seat-pres").forEach((box) => {
      const stack = box.firstElementChild;
      if (!stack) return;
      stack.style.transform = "";
      const slotH = box.clientHeight; // reserved (max) height, from CSS
      const boxW = box.clientWidth; // = seat width
      const natH = stack.scrollHeight, natW = stack.scrollWidth;
      let k = 1;
      if (natH > slotH + 0.5 && natH > 0) k = Math.min(k, slotH / natH);
      if (natW > boxW + 0.5 && natW > 0) k = Math.min(k, boxW / natW);
      if (k < 0.999) stack.style.transform = "scale(" + k + ")";
    });
  }

  function renderBoards(d) {
    const n = state.players.length;
    const powers = FAC_POWERS[n] || FAC_POWERS[10];

    $("facPowers").innerHTML = powers
      .map((p) => {
        const has = p && p !== "win";
        return `<div class="sh-power ${has ? "" : "empty"}">${has ? POWER_LABEL[p] : ""}</div>`;
      })
      .join("");

    const fac = $("facTrack");
    fac.innerHTML = "";
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("div");
      const empty = i >= d.fac;
      // Hitler territory = the 4th+ fascist slots (electing Hitler wins from 3 policies on)
      s.className = "sh-slot" + (i === 5 ? " win" : "") + (empty && i >= 3 ? " hitler" : "");
      if (i < d.fac) s.innerHTML = `<div class="policy-card F"><span class="glyph">✕</span></div>`;
      else if (i === 5) s.innerHTML = `<span class="win-x">WIN</span>`;
      if (i === 4) {
        const v = document.createElement("div");
        v.className = "veto-sign";
        v.textContent = "Veto";
        s.appendChild(v);
      }
      fac.appendChild(s);
    }

    const lib = $("libTrack");
    lib.innerHTML = "";
    for (let i = 0; i < 5; i++) {
      const s = document.createElement("div");
      s.className = "sh-slot" + (i === 4 ? " win" : "");
      if (i < d.lib) s.innerHTML = `<div class="policy-card L"><span class="glyph">★</span></div>`;
      else if (i === 4) s.innerHTML = `<span class="win-x">WIN</span>`;
      lib.appendChild(s);
    }

    const et = $("electionTracker");
    et.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("div");
      dot.className = "sh-dot" + (i < d.tracker ? " on" : "") + (i === 2 && d.tracker >= 3 ? " chaos" : "");
      et.appendChild(dot);
    }

    $("drawCounts").innerHTML = `<span class="cf">${d.drawFasc}F</span><span class="cl">${d.drawLibs}L</span>`;
    $("discardCounts").innerHTML = `<span class="cf">${d.discardFasc}F</span><span class="cl">${d.discardLibs}L</span>`;
  }

  function renderControls(d) {
    $("hint").textContent = "";
    const cp = $("claimPick");
    const cr = document.querySelector(".controls > .control-row");

    if (state.review) {
      if (cr) cr.style.display = "none";
      renderReviewPanel(cp, d);
      return;
    }
    if (state.recordingRoles) {
      if (cr) cr.style.display = "none";
      renderRolePanel(cp, d);
      return;
    }
    if (cr) cr.style.display = "";

    // draw distribution from the current pool (post eager-reshuffle)
    let n = d.draw,
      l = d.drawLibs;
    if (n < 3) {
      n = 17 - (d.fac + d.lib);
      l = 6 - d.lib;
    }
    const dist = Prob.drawDistribution(n, l); // index = liberals
    cp.innerHTML = RATIOS.map((r) => {
      const armed = state.form.conflictArmed && (r.libs === 1 || r.libs === 2);
      return (
        `<div class="ratio-cell"><div class="ratio-pct">${Prob.fmtPct(dist[r.libs])}</div>` +
        `<button class="ratio-btn ${armed ? "armed" : ""}" data-libs="${r.libs}" style="background:${ratioColor(r.libs)}">` +
        `<span class="ratio-name ${r.cls}">${r.name}</span><span class="ratio-sub">${r.sub}</span></button></div>`
      );
    }).join("");
    cp.querySelectorAll("button").forEach((b) => {
      b.onclick = () => submitClaim(+b.dataset.libs);
    });

    $("btnConflict").classList.toggle("on", state.form.conflictArmed);
    $("btnUndo").disabled = !state.undoStack || state.undoStack.length === 0;
  }

  // ------------------------------ role recording -----------------------------
  const fascistNeed = () => FASCIST_COUNT[state.players.length] || 1;

  function enterRoleRecording() {
    if (state.review) return;
    state.recordingRoles = true;
    if (!state.roleDraft) state.roleDraft = { hitlerIdx: null, fascistIdxs: [] };
    if (state.autoResult && state.autoResult.hitlerIdx != null && state.roleDraft.hitlerIdx == null)
      state.roleDraft.hitlerIdx = state.autoResult.hitlerIdx;
    renderGame();
  }

  function roleReady() {
    const winnerOk = state.gameOver ? true : !!state.winnerDraft;
    return winnerOk && state.roleDraft.hitlerIdx != null && state.roleDraft.fascistIdxs.length === fascistNeed();
  }

  function toggleRole(role, i) {
    const draft = state.roleDraft;
    if (role === "hitler") {
      draft.hitlerIdx = draft.hitlerIdx === i ? null : i;
      draft.fascistIdxs = draft.fascistIdxs.filter((x) => x !== draft.hitlerIdx); // can't be both
    } else {
      if (i === draft.hitlerIdx) return;
      const at = draft.fascistIdxs.indexOf(i);
      if (at >= 0) draft.fascistIdxs.splice(at, 1);
      else if (draft.fascistIdxs.length < fascistNeed()) draft.fascistIdxs.push(i);
    }
    renderGame();
  }

  function renderRolePanel(cp, d) {
    const players = state.players;
    const need = fascistNeed();
    const draft = state.roleDraft;
    const winner = state.gameOver ? state.gameOver.winner : state.winnerDraft;
    const winnerHtml = state.gameOver
      ? `<div class="role-winner ${winner === "Fascist" ? "c-fac" : "c-lib"}">${winner}s win</div>`
      : `<div class="role-field"><label>Who won?</label> <span class="seg">` +
        `<button id="rwLib" class="${winner === "Liberal" ? "sel L" : ""}">Liberal</button>` +
        `<button id="rwFac" class="${winner === "Fascist" ? "sel F" : ""}">Fascist</button></span></div>`;
    const pbtns = (role) =>
      players
        .map((p, i) => {
          const sel = role === "hitler" ? draft.hitlerIdx === i : draft.fascistIdxs.includes(i);
          return `<button class="role-pick ${role} ${sel ? "sel" : ""}" data-role="${role}" data-i="${i}">${escapeHtml(p.name)}</button>`;
        })
        .join("");
    cp.innerHTML =
      `<div class="role-panel">` +
      `<div class="role-title">Record roles</div>` +
      winnerHtml +
      `<div class="role-field"><label>Who was Hitler?</label><div class="role-btns">${pbtns("hitler")}</div></div>` +
      `<div class="role-field"><label>${need > 1 ? "Who were the " + need + " Fascists" : "Who was the Fascist"}? (${draft.fascistIdxs.length}/${need})</label>` +
      `<div class="role-btns">${pbtns("fascist")}</div></div>` +
      `<div class="control-row"><button id="btnSaveRoles" class="primary" ${roleReady() ? "" : "disabled"}>Save game</button></div>` +
      `</div>`;
    cp.querySelectorAll(".role-pick").forEach((b) => {
      b.onclick = () => toggleRole(b.dataset.role, +b.dataset.i);
    });
    if (!state.gameOver) {
      $("rwLib").onclick = () => { state.winnerDraft = "Liberal"; renderGame(); };
      $("rwFac").onclick = () => { state.winnerDraft = "Fascist"; renderGame(); };
    }
    $("btnSaveRoles").onclick = saveRoles;
  }

  function saveRoles() {
    if (!roleReady()) return;
    const winner = state.gameOver ? state.gameOver.winner : state.winnerDraft;
    const record = {
      players: state.players.map((p) => ({ name: p.name })),
      playerCount: state.players.length,
      firstPres: state.firstPres,
      events: state.events,
      roundMods: state.roundMods,
      result: { winner, hitlerIdx: state.roleDraft.hitlerIdx, fascistIdxs: state.roleDraft.fascistIdxs.slice() },
      date: new Date().toISOString(),
    };
    Stats.recordGame(record);
    alert("Game saved to statistics.");
    resetToSetup();
  }

  // ------------------------------ review a saved game ------------------------
  function openReview(idx) {
    const games = Stats.loadGames().filter((g) => g.result);
    const g = games[idx];
    if (!g) return;
    if (state) stashedState = state;
    state = {
      players: g.players.map((p) => ({ name: p.name, dead: false })),
      firstPres: g.firstPres || 0,
      events: g.events || [],
      roundMods: g.roundMods || {},
      form: { chanIdxOverride: null, conflictArmed: false },
      result: g.result,
      review: true,
      recordingRoles: false,
      pendingChaos: false,
      pendingPower: null,
      gameOver: null,
      roleDraft: { hitlerIdx: null, fascistIdxs: [] },
      undoStack: [],
      _reviewGame: g,
    };
    show("gameScreen");
    switchTab("play");
    renderGame();
  }

  function closeReview() {
    state = stashedState;
    stashedState = null;
    renderStats();
  }

  function renderReviewPanel(cp, d) {
    const g = state._reviewGame;
    const r = g.result;
    const events = g.events || [];
    const govs = events.filter((e) => (e.type || "gov") === "gov").length;
    const fails = events.filter((e) => e.type === "fail").length;
    const facNames = (r.fascistIdxs || []).map((i) => (g.players[i] ? escapeHtml(g.players[i].name) : "?")).join(", ");
    cp.innerHTML =
      `<div class="review-panel">` +
      `<div class="role-winner ${r.winner === "Fascist" ? "c-fac" : "c-lib"}">${r.winner}s won</div>` +
      `<div class="review-stat"><b>${d.lib}</b> Liberal &middot; <b>${d.fac}</b> Fascist policies</div>` +
      `<div class="review-stat">${govs} governments &middot; ${fails} failed elections</div>` +
      `<div class="review-stat">Hitler: <b class="c-hit">${g.players[r.hitlerIdx] ? escapeHtml(g.players[r.hitlerIdx].name) : "?"}</b></div>` +
      `<div class="review-stat">Fascists: <b class="c-fac">${facNames || "—"}</b></div>` +
      `<div class="control-row"><button id="btnCloseReview" class="ghost">← Back to stats</button></div>` +
      `</div>`;
    $("btnCloseReview").onclick = closeReview;
  }

  function renderGamesList(container) {
    if (!container) return;
    const games = Stats.loadGames().filter((g) => g.result);
    if (!games.length) {
      container.innerHTML = `<span class="muted">No games recorded yet.</span>`;
      return;
    }
    container.innerHTML = games
      .map((g, idx) => {
        const cls = g.result.winner === "Fascist" ? "gl-fac" : "gl-lib";
        const hit = g.players[g.result.hitlerIdx] ? g.players[g.result.hitlerIdx].name : "?";
        const facs = (g.result.fascistIdxs || [])
          .map((i) => (g.players[i] ? g.players[i].name : ""))
          .filter(Boolean);
        return (
          `<button class="game-box ${cls}" data-idx="${idx}">` +
          `<div class="gl-win">${g.result.winner} win</div>` +
          `<div class="gl-hitler">♛ ${escapeHtml(hit)}</div>` +
          `<div class="gl-facs">${facs.map((f) => `<span>${escapeHtml(f)}</span>`).join("")}</div>` +
          `</button>`
        );
      })
      .join("");
    container.querySelectorAll(".game-box").forEach((b) => {
      b.onclick = () => openReview(+b.dataset.idx);
    });
  }

  function renderHistory(d) {
    const tb = $("histTable").querySelector("tbody");
    tb.innerHTML = "";
    d.evInfo.forEach((ev, idx) => {
      const tr = document.createElement("tr");
      if (ev.type === "fail") {
        const p = state.players[ev.presidentIdx];
        tr.className = "ev-fail";
        tr.innerHTML =
          `<td>${idx + 1}</td><td class="tag-round">—</td><td>Failed election ✕</td>` +
          `<td>${escapeHtml(p.name)}</td><td>—</td><td>—</td><td>tracker ${ev.tracker}</td><td>—</td>`;
      } else if (ev.type === "chaos") {
        tr.className = "ev-chaos";
        tr.innerHTML =
          `<td>${idx + 1}</td><td class="tag-round">—</td><td>⚠ Chaos top-deck</td><td>—</td><td>—</td><td>—</td>` +
          `<td>${ev.enacted === "L" ? "🟦 Lib" : "🟥 Fac"}</td><td>—</td>`;
      } else {
        const g = d.gi[ev.giIdx];
        const ratio = RATIOS[g.libs];
        tr.innerHTML =
          `<td>${idx + 1}</td>` +
          `<td class="tag-round">${g.round + 1}</td>` +
          `<td><span class="ratio-name ${ratio.cls}">${ratio.name}</span>${
            g.conflict ? ` <span style="color:var(--fac-2)">⚔ conflict ${escapeHtml(state.players[g.chancellorIdx].name)}</span>` : ""
          }${powerAnnotation(g.power)}</td>` +
          `<td>${escapeHtml(state.players[g.presidentIdx].name)}</td>` +
          `<td>${escapeHtml(state.players[g.chancellorIdx].name)}</td>` +
          `<td>${ratio.sub}</td>` +
          `<td>${g.enacted === "L" ? "🟦 Lib" : "🟥 Fac"}</td>` +
          `<td><b style="color:var(--gold)">${Prob.fmtPct(g.prob)}</b></td>`;
      }
      tb.appendChild(tr);
    });
  }

  // ------------------------------ recording ----------------------------------
  const busy = () => state.pendingChaos || state.pendingPower || state.gameOver || state.recordingRoles || state.review;

  // Detect an automatic terminal outcome (policy-track wins).
  function checkGameOver(d) {
    if (state.gameOver) return;
    if (d.lib >= 5) state.gameOver = { winner: "Liberal", reason: "Five Liberal policies were enacted." };
    else if (d.fac >= 6) state.gameOver = { winner: "Fascist", reason: "Six Fascist policies were enacted." };
    if (state.gameOver) state.autoResult = { winner: state.gameOver.winner };
  }

  // Tapping a player on the table sets the Chancellor (moves highlight + tile).
  function setChancellor(i) {
    if (busy() || state.players[i].dead || i === derive().presIdx) return;
    state.form.chanIdxOverride = i;
    renderGame();
  }

  function flashTurn(msg) {
    $("hint").textContent = msg;
  }

  // Which power (if any) a fascist policy on the just-filled slot grants.
  function powerForFascistCount(facCount) {
    const powers = FAC_POWERS[state.players.length] || FAC_POWERS[10];
    const key = powers[facCount - 1];
    return key && key !== "win" ? key : null;
  }

  // Clicking the claimed outcome auto-submits the presidency.
  function submitClaim(libs) {
    if (busy()) return;
    const d0 = derive();
    const chanIdx = effChan(d0);
    if (chanIdx == null) {
      flashTurn("Tap a player on the table to set the Chancellor first.");
      return;
    }
    const presIdx = d0.presIdx;
    const conflict = !!state.form.conflictArmed && (libs === 1 || libs === 2);
    const enacted = inferEnacted(libs, conflict);
    pushUndo();
    state.events.push({
      type: "gov",
      presidentIdx: presIdx,
      chancellorIdx: chanIdx,
      claimLibs: libs,
      conflict,
      enacted,
    });
    state.form = { chanIdxOverride: null, conflictArmed: false };
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    // does this fascist policy trigger a presidential power?
    const d1 = derive();
    if (enacted === "F") {
      const power = powerForFascistCount(d1.fac);
      if (power) state.pendingPower = { type: power, govIndex: state.events.length - 1, presidentIdx: presIdx };
    }
    checkGameOver(d1);
    renderGame();
    animateEnact(presIdx, enacted);
  }

  function recordFail() {
    if (busy()) return;
    pushUndo();
    state.events.push({ type: "fail", presidentIdx: derive().presIdx });
    state.form = { chanIdxOverride: null, conflictArmed: false };
    if (derive().tracker >= 3) state.pendingChaos = true;
    renderGame();
  }

  // Snapshot the full game state before a state-changing action so Undo can
  // restore EVERYTHING exactly (events, round modifiers, powers, deaths,
  // game-over, conflicts, turn state) — not just pop one event.
  function pushUndo() {
    const snap = {};
    for (const k in state) if (k !== "undoStack") snap[k] = state[k];
    state.undoStack.push(JSON.stringify(snap));
  }

  // Revert to exactly the state before the most recent action.
  function undoLast() {
    if (!state.undoStack || !state.undoStack.length) return;
    const stack = state.undoStack;
    const snap = JSON.parse(stack.pop());
    snap.undoStack = stack;
    state = snap;
    renderGame();
  }

  function resolveChaos(policy) {
    pushUndo();
    state.pendingChaos = false;
    state.events.push({ type: "chaos", enacted: policy });
    // chaos resets term limits; keep suggested president/chancellor as-is
    checkGameOver(derive());
    renderGame();
    animateChaos(policy);
  }

  // Compact per-presidency detail chips (conflict / power) shown beside the cards.
  function presDetails(ev) {
    let s = "";
    if (ev.conflict) s += `<div class="pres-detail c-fac">⚔ conflict</div>`;
    const p = ev.power;
    if (p) {
      if (p.type === "invest" && p.party) {
        s += `<div class="pres-detail ${p.party === "F" ? "c-fac" : "c-lib"}">🔍 ${escapeHtml(
          state.players[p.targetIdx].name
        )}, ${p.party === "F" ? "Fac" : "Lib"}</div>`;
      } else if (p.type === "special" && p.chosenIdx != null) {
        s += `<div class="pres-detail c-gold">⚡→ ${escapeHtml(state.players[p.chosenIdx].name)}</div>`;
      } else if (p.type === "peek" && p.order) {
        s += `<div class="pres-detail">👁 ${p.order.join("·")}</div>`;
      } else if (p.type === "kill" && p.killedIdx != null) {
        s += `<div class="pres-detail c-fac">💀 ${escapeHtml(state.players[p.killedIdx].name)}</div>`;
      }
    }
    return s;
  }

  // ------------------------------ presidential powers ------------------------
  function powerAnnotation(power) {
    if (!power) return "";
    if (power.type === "invest" && power.party) {
      const t = state.players[power.targetIdx];
      const c = power.party === "F" ? "var(--fac-2)" : "var(--lib-2)";
      return ` <span style="color:${c}">🔍 ${escapeHtml(t.name)}, ${power.party === "F" ? "Fascist" : "Liberal"}</span>`;
    }
    if (power.type === "special" && power.chosenIdx != null) {
      return ` <span style="color:var(--gold)">⚡→ ${escapeHtml(state.players[power.chosenIdx].name)}</span>`;
    }
    if (power.type === "peek" && power.order) {
      return ` <span class="muted">👁 ${power.order.join("·")}</span>`;
    }
    if (power.type === "kill" && power.killedIdx != null) {
      return ` <span style="color:var(--fac-2)">💀 ${escapeHtml(state.players[power.killedIdx].name)}${
        power.wasHitler ? " (Hitler!)" : ""
      }</span>`;
    }
    return "";
  }

  // draft answer for the pending power while the user fills the modal
  let powerDraft = null;

  function renderPower(d) {
    const pm = $("powerModal");
    if (!state.pendingPower) {
      pm.classList.add("hidden");
      powerDraft = null;
      return;
    }
    pm.classList.remove("hidden");
    const pp = state.pendingPower;
    const pres = state.players[pp.presidentIdx];
    const body = $("powerBody");
    const aliveSel = (id, exclude) =>
      `<select id="${id}">` +
      state.players
        .map((p, i) => (i === exclude || p.dead ? "" : `<option value="${i}">${escapeHtml(p.name)}</option>`))
        .join("") +
      `</select>`;

    if (pp.type === "invest") {
      if (!powerDraft) powerDraft = { targetIdx: null, party: null };
      body.innerHTML =
        `<div class="power-title">🔍 Investigation — <span class="who">${escapeHtml(pres.name)}</span> investigates a player</div>` +
        `<div class="power-field"><label>Who was investigated?</label>${aliveSel("pwWho", pp.presidentIdx)}</div>` +
        `<div class="power-field"><label>Their party membership</label> ` +
        `<span class="seg"><button id="pwLib" class="${powerDraft.party === "L" ? "sel L" : ""}">Liberal</button>` +
        `<button id="pwFac" class="${powerDraft.party === "F" ? "sel F" : ""}">Fascist</button></span></div>` +
        `<div class="control-row"><button id="pwConfirm" class="primary" ${powerDraft.party ? "" : "disabled"}>Confirm</button></div>`;
      $("pwLib").onclick = () => { powerDraft.party = "L"; renderGame(); };
      $("pwFac").onclick = () => { powerDraft.party = "F"; renderGame(); };
      $("pwConfirm").onclick = () => {
        resolvePower({ targetIdx: +$("pwWho").value, party: powerDraft.party });
      };
    } else if (pp.type === "special") {
      body.innerHTML =
        `<div class="power-title">⚡ Special Election — <span class="who">${escapeHtml(pres.name)}</span> picks the next President</div>` +
        `<div class="power-field"><label>Next President</label>${aliveSel("pwWho", pp.presidentIdx)}</div>` +
        `<div class="muted" style="font-size:12px">After their turn, the normal order resumes.</div>` +
        `<div class="control-row"><button id="pwConfirm" class="primary">Confirm</button></div>`;
      $("pwConfirm").onclick = () => resolvePower({ chosenIdx: +$("pwWho").value });
    } else if (pp.type === "peek") {
      if (!powerDraft) powerDraft = { order: ["F", "F", "F"] };
      const pos = ["Top", "Middle", "Bottom"];
      body.innerHTML =
        `<div class="power-title">👁 Policy Peek — set the top 3 as <span class="who">${escapeHtml(pres.name)}</span> claimed</div>` +
        `<div class="peek-cards">` +
        powerDraft.order
          .map(
            (c, k) =>
              `<div class="peek-card"><div class="peek-pos">${pos[k]}</div>` +
              `<div class="peek-face ${c}" data-k="${k}">${c === "F" ? "✕" : "★"}</div></div>`
          )
          .join("") +
        `</div><div class="control-row"><button id="pwConfirm" class="primary">Confirm</button></div>`;
      body.querySelectorAll(".peek-face").forEach((el) => {
        el.onclick = () => {
          const k = +el.dataset.k;
          powerDraft.order[k] = powerDraft.order[k] === "F" ? "L" : "F";
          renderGame();
        };
      });
      $("pwConfirm").onclick = () => resolvePower({ order: powerDraft.order.slice() });
    } else if (pp.type === "kill") {
      body.innerHTML =
        `<div class="power-title">💀 Kill — <span class="who">${escapeHtml(pres.name)}</span> executes a player</div>` +
        `<div class="power-field"><label>Who was executed?</label>${aliveSel("pwWho", pp.presidentIdx)}</div>` +
        `<div class="control-row"><button id="pwHitler" class="primary">They were Hitler</button>` +
        `<button id="pwNot" class="warn">Not Hitler</button></div>`;
      $("pwHitler").onclick = () => resolvePower({ killedIdx: +$("pwWho").value, wasHitler: true });
      $("pwNot").onclick = () => resolvePower({ killedIdx: +$("pwWho").value, wasHitler: false });
    }
    // a Back button on every power prompt reverts the presidency that triggered it
    const cr = body.querySelector(".control-row");
    if (cr) {
      cr.insertAdjacentHTML("beforeend", `<button id="pwBack" class="ghost">↶ Back</button>`);
      $("pwBack").onclick = undoLast;
    }
  }

  function resolvePower(data) {
    const pp = state.pendingPower;
    if (!pp) return;
    const ev = state.events[pp.govIndex];
    ev.power = Object.assign({ type: pp.type }, data);
    state.pendingPower = null;
    powerDraft = null;
    if (pp.type === "kill" && data.wasHitler) {
      state.gameOver = { winner: "Liberal", reason: "Hitler was executed." };
      state.autoResult = { winner: "Liberal", hitlerIdx: data.killedIdx };
    }
    renderGame();
  }

  // ------------------------------ animation ----------------------------------
  function slotForType(type) {
    const d = derive();
    if (type === "F") {
      const track = $("facTrack");
      return track.children[Math.max(0, d.fac - 1)];
    }
    const track = $("libTrack");
    return track.children[Math.max(0, d.lib - 1)];
  }

  function flyFromTo(aRect, bRect, type) {
    if (!aRect || !bRect) return;
    const fly = document.createElement("div");
    fly.className = "fly-card " + type;
    fly.innerHTML = `<span>${type === "F" ? "✕" : "★"}</span>`;
    document.body.appendChild(fly);
    const sx = aRect.left + aRect.width / 2 - 15;
    const sy = aRect.top + aRect.height / 2 - 21;
    fly.style.left = sx + "px";
    fly.style.top = sy + "px";
    fly.style.transform = "translate(0,0) scale(1)";
    fly.getBoundingClientRect(); // reflow
    const dx = bRect.left + bRect.width / 2 - (sx + 15);
    const dy = bRect.top + bRect.height / 2 - (sy + 21);
    requestAnimationFrame(() => {
      fly.style.transform = `translate(${dx}px,${dy}px) scale(0.85)`;
    });
    setTimeout(() => (fly.style.opacity = "0"), 620);
    setTimeout(() => {
      fly.remove();
      const slot = slotForType(type);
      const card = slot && slot.querySelector(".policy-card");
      if (card) card.classList.add("pop");
    }, 780);
  }

  function animateEnact(presidentIdx, type) {
    const seat = document.querySelector(`.seatNode[data-seat="${presidentIdx}"] .avatar`);
    const slot = slotForType(type);
    if (seat && slot) flyFromTo(seat.getBoundingClientRect(), slot.getBoundingClientRect(), type);
  }
  function animateChaos(type) {
    const src = document.querySelector("#drawCol .pile-card");
    const slot = slotForType(type);
    if (src && slot) flyFromTo(src.getBoundingClientRect(), slot.getBoundingClientRect(), type);
  }


  // ------------------------------ STATS --------------------------------------
  function fillStats(gridEl, tbodyEl) {
    const s = Stats.summary();
    gridEl.innerHTML = [
      tile(s.totalGames, "Games recorded"),
      tile(s.liberalWins, "Liberal wins"),
      tile(s.fascistWins, "Fascist wins"),
      tile((s.fascistWinRate * 100).toFixed(0) + "%", "Fascist win rate"),
      tile(s.avgGovernments.toFixed(1), "Avg governments / game"),
    ].join("");
    const rows = Stats.playerStats();
    tbodyEl.innerHTML = rows.length
      ? rows
          .map(
            (p) =>
              `<tr><td>${escapeHtml(p.name)}</td><td>${p.games}</td><td>${p.wins}</td>` +
              `<td>${(p.winRate * 100).toFixed(0)}%</td><td>${p.presidencies}</td>` +
              `<td>${p.chancellorships}</td><td>${p.asHitler}</td><td>${p.conflicts}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="8" class="muted">No games recorded yet.</td></tr>`;
  }
  function renderStats() {
    fillStats($("summaryGrid"), $("playerStatsTable").querySelector("tbody"));
    renderGamesList($("gamesList"));
    show("statsScreen");
  }
  function tile(big, lbl) {
    return `<div class="stat-tile"><div class="big">${big}</div><div class="lbl">${lbl}</div></div>`;
  }

  // in-game tab switching (Play / History / Stats)
  function switchTab(name) {
    ["play", "history", "stats"].forEach((t) => {
      $(t + "Tab").classList.toggle("hidden", t !== name);
    });
    document.querySelectorAll(".tabbar .tab").forEach((b) => {
      b.classList.toggle("sel", b.dataset.tab === name);
    });
    if (name === "stats") {
      fillStats($("summaryGridInline"), $("playerStatsTableInline").querySelector("tbody"));
      renderGamesList($("gamesListInline"));
    }
  }

  // ------------------------------ misc ---------------------------------------
  function resetToSetup() {
    state = null;
    clearActive(); // the game is finished/abandoned; only the roster is kept
    show("setupScreen");
    renderSetup();
  }
  function initials(name) {
    return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  }
  function fmtSigned(v) {
    return v > 0 ? "+" + v : "" + v;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ------------------------------ wiring -------------------------------------
  function wire() {
    $("btnAddPlayer").onclick = addPlayer;
    $("nameInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addPlayer();
    });
    $("btnRandomize").onclick = startGame;
    const newGame = () => {
      if (!state || confirm("Start a new game? Current game is not saved unless you end & save it."))
        resetToSetup();
    };
    $("btnNewTop").onclick = () => {
      if (state && state.review) { closeReview(); return; }
      newGame();
    };
    $("btnEndTop").onclick = () => {
      if (state && state.review) { closeReview(); return; }
      if (!state.recordingRoles) enterRoleRecording();
    };
    $("btnStats").onclick = renderStats;
    $("btnBackFromStats").onclick = () => show(state && !state.review ? "gameScreen" : "setupScreen");
    $("btnClearStats").onclick = () => {
      if (confirm("Delete ALL saved statistics? This cannot be undone.")) {
        Stats.clearAll();
        renderStats();
      }
    };

    $("btnFail").onclick = recordFail;
    $("btnUndo").onclick = undoLast;
    $("btnConflict").onclick = () => {
      state.form.conflictArmed = !state.form.conflictArmed;
      renderControls(derive());
    };
    $("chaosLib").onclick = () => resolveChaos("L");
    $("chaosFac").onclick = () => resolveChaos("F");
    $("chaosBack").onclick = undoLast;

    document.querySelectorAll(".tabbar .tab").forEach((b) => {
      b.onclick = () => switchTab(b.dataset.tab);
    });
  }

  function adjustRoundModFor(roundIdx, delta) {
    const r = derive().rounds[roundIdx];
    if (!r) return;
    state.roundMods[roundIdx] = clamp(r.mod + delta, r.modLo, r.modHi);
    renderGame();
  }

  // re-lay the seats + relocate the rounds bar when crossing the phone/desktop breakpoint
  window.addEventListener("resize", () => {
    if (state && Array.isArray(state.players) && !$("gameScreen").classList.contains("hidden")) {
      renderTable(derive());
      placeRoundsBar();
    }
  });

  // ------------------------------ boot ---------------------------------------
  wire();
  const resumed = loadActive();
  if (resumed) {
    // resume the in-progress game exactly where it left off
    state = resumed;
    setupPlayers = JSON.parse(lsGet(SETUP_KEY) || "[]");
    show("gameScreen");
    switchTab("play");
    renderGame();
  } else {
    // no active game — restore any previously entered roster
    try {
      const saved = JSON.parse(lsGet(SETUP_KEY));
      if (Array.isArray(saved)) setupPlayers = saved;
    } catch (e) {}
    renderSetup();
  }
})();
