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
  const POWER_ICON = { invest: "🔍", special: "⚡", peek: "👁", kill: "💀", win: "🏆", "": "" };
  const POWER_TITLE = {
    invest: "Investigate Loyalty",
    special: "Special Election",
    peek: "Policy Peek",
    kill: "Execution",
    win: "Fascists win",
    "": "",
  };

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

  function newGameState(players, firstPres) {
    return {
      date: null,
      players: players.map((n) => ({ name: n, dead: false })),
      firstPres,
      events: [],
      roundMods: {},
      lastChanIdx: null, // for chancellor auto-rotation
      form: { presIdx: firstPres, chanIdx: null, claimLibs: null, conflict: false },
      pendingChaos: false,
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

    state.events.forEach((ev, n) => {
      if (ev.type === "fail") {
        tracker++;
        failsByPlayer[ev.presidentIdx] = (failsByPlayer[ev.presidentIdx] || 0) + 1;
        evInfo.push({ type: "fail", presidentIdx: ev.presidentIdx, tracker });
        return;
      }
      if (ev.type === "chaos") {
        if (draw < 1) {
          round++;
          draw = 17 - (fac + lib);
          rounds.push(mkRound(round, draw, 6 - lib));
        }
        draw -= 1;
        if (ev.enacted === "L") { lib++; rounds[round].chaosLib++; }
        else { fac++; rounds[round].chaosFac++; }
        tracker = 0;
        evInfo.push({ type: "chaos", enacted: ev.enacted });
        return;
      }
      // gov
      if (draw < 3) {
        round++;
        draw = 17 - (fac + lib);
        rounds.push(mkRound(round, draw, 6 - lib));
      }
      const enacted = ev.enacted;
      const info = {
        type: "gov",
        n,
        round,
        libs: ev.claimLibs,
        conflict: !!ev.conflict,
        enacted,
        presidentIdx: ev.presidentIdx,
        chancellorIdx: ev.chancellorIdx,
        prob: null,
      };
      const giIdx = gi.push(info) - 1;
      rounds[round].govs.push(giIdx);
      lastGovByPlayer[ev.presidentIdx] = info;
      evInfo.push({ type: "gov", giIdx });
      draw -= 3;
      if (enacted === "L") lib++;
      else fac++;
      tracker = 0;
    });

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
      drawLibs,
      drawFasc,
      discardLibs,
      discardFasc,
    };
  }

  // ------------------------------ screens ------------------------------------
  function show(id) {
    ["setupScreen", "gameScreen", "endScreen", "statsScreen"].forEach((s) =>
      $(s).classList.toggle("hidden", s !== id)
    );
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
    renderGame();
  }

  // ------------------------------ GAME ---------------------------------------
  function aliveIdxs() {
    return state.players.map((p, i) => i).filter((i) => !state.players[i].dead);
  }
  function nextAliveAfter(idx) {
    const n = state.players.length;
    for (let step = 1; step <= n; step++) {
      const j = (idx + step) % n;
      if (!state.players[j].dead) return j;
    }
    return idx;
  }
  // suggested chancellor: rotates one seat past the last elected chancellor
  function defaultChancellor(presIdx) {
    if (state.lastChanIdx === null) return null; // first government: user must choose
    let c = nextAliveAfter(state.lastChanIdx);
    if (c === presIdx) c = nextAliveAfter(c);
    return c;
  }

  function renderGame() {
    const d = derive();
    renderTable(d);
    renderBoards(d);
    renderRoundBar(d);
    renderNextDraw(d);
    renderForm(d);
    renderHistory(d);
    $("chaosPrompt").classList.toggle("hidden", !state.pendingChaos);
  }

  function renderTable(d) {
    const area = $("tableArea");
    area.querySelectorAll(".seatNode").forEach((el) => el.remove());
    const n = state.players.length;

    state.players.forEach((p, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const x = 50 + 43 * Math.cos(ang);
      const y = 50 + 45 * Math.sin(ang);
      const node = document.createElement("div");
      node.className = "seatNode";
      node.dataset.seat = i;
      if (i === state.form.presIdx) node.classList.add("pres");
      if (i === state.form.chanIdx) node.classList.add("chan");
      if (p.dead) node.classList.add("dead");
      node.style.left = x + "%";
      node.style.top = y + "%";

      let badge = "";
      if (i === state.form.presIdx) badge = "🔨"; // president
      else if (i === state.form.chanIdx) badge = "🎖";

      const info = d.lastGovByPlayer[i];
      let extra = "";
      if (info) {
        const cards = [];
        for (let k = 0; k < 3; k++) cards.push(k < 3 - info.libs ? "F" : "L");
        extra +=
          `<div class="miniHand">` +
          cards.map((c) => `<div class="miniCard ${c}"></div>`).join("") +
          `</div><div class="odds">${Prob.fmtPct(info.prob)}</div>`;
        if (info.conflict)
          extra += `<div class="conflict-tag">⚔ conflict</div>`;
      }
      const fails = d.failsByPlayer[i] || 0;
      if (fails) extra += `<div class="fail-x">${"✕".repeat(Math.min(fails, 5))}</div>`;

      node.innerHTML =
        `<div class="avatar">${escapeHtml(initials(p.name))}${
          badge ? `<span class="badge">${badge}</span>` : ""
        }</div>` +
        `<div class="name">${escapeHtml(p.name)}${i === state.firstPres ? " ·①" : ""}</div>` +
        extra;
      area.appendChild(node);
    });
  }

  function renderBoards(d) {
    const n = state.players.length;
    const powers = FAC_POWERS[n] || FAC_POWERS[10];

    const pw = $("facPowers");
    pw.innerHTML = powers
      .map(
        (p) =>
          `<div class="sh-power ${p ? "" : "empty"}" title="${POWER_TITLE[p]}">${
            POWER_ICON[p] || "·"
          }</div>`
      )
      .join("");

    const fac = $("facTrack");
    fac.innerHTML = "";
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("div");
      s.className = "sh-slot" + (i === 5 ? " win" : "");
      if (i < d.fac) s.innerHTML = `<div class="policy-card F"><span class="glyph">✕</span></div>`;
      else if (i === 5) s.innerHTML = `<span class="win-x">WIN</span>`;
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

    // election tracker (3 dots; 3rd = chaos)
    const et = $("electionTracker");
    et.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("div");
      dot.className = "sh-dot" + (i < d.tracker ? " on" : "") + (i === 2 && d.tracker >= 3 ? " chaos" : "");
      et.appendChild(dot);
    }

    $("drawPile").textContent = `${d.draw} (${d.drawFasc}F / ${d.drawLibs}L)`;
    $("discardPile").textContent = `${d.discardFasc + d.discardLibs} (${d.discardFasc}F / ${d.discardLibs}L)`;
    $("deckReadout").textContent = `Enacted: ${d.fac}F / ${d.lib}L · Deck 17 = 11F/6L`;
  }

  function renderRoundBar(d) {
    const r = d.rounds[d.round];
    $("roundNum").textContent = d.round + 1;
    $("roundMod").textContent = fmtSigned(r.mod);
    $("modBounds").textContent =
      `(${fmtSigned(r.modLo)} … ${fmtSigned(r.modHi)})` + (r.forced ? " • auto-adjusted" : "");
    $("modMinus").disabled = r.mod <= r.modLo;
    $("modPlus").disabled = r.mod >= r.modHi;

    const wrap = $("bottomCards");
    if (d.draw < 3 && r.govs.length > 0 && r.leftover > 0) {
      const cards = [];
      for (let k = 0; k < r.leftover; k++) cards.push(k < r.bottomLibs ? "L" : "F");
      wrap.innerHTML = cards.map((c) => `<span class="miniCard ${c}"></span>`).join("");
    } else {
      wrap.textContent = "— (round in progress)";
    }
  }

  function renderNextDraw(d) {
    let n = d.draw,
      l = d.drawLibs;
    if (n < 3) {
      n = 17 - (d.fac + d.lib);
      l = 6 - d.lib;
    }
    const dist = Prob.drawDistribution(n, l); // index = liberals
    const labels = ["3F", "2F·1L", "1F·2L", "3L"];
    $("nextDraw").innerHTML = dist
      .map((p, libs) => ({ p, label: labels[libs] }))
      .reverse()
      .map(
        (o) => `<div class="nd-item"><div class="p">${Prob.fmtPct(o.p)}</div><div class="l">${o.label}</div></div>`
      )
      .join("");
  }

  function renderForm(d) {
    const alive = aliveIdxs();
    const optable = (idx) =>
      alive
        .map(
          (i) => `<option value="${i}" ${i === idx ? "selected" : ""}>${escapeHtml(state.players[i].name)}</option>`
        )
        .join("");
    $("selPres").innerHTML = optable(state.form.presIdx);
    $("selChan").innerHTML =
      `<option value="">— select —</option>` +
      alive
        .filter((i) => i !== state.form.presIdx)
        .map(
          (i) => `<option value="${i}" ${i === state.form.chanIdx ? "selected" : ""}>${escapeHtml(state.players[i].name)}</option>`
        )
        .join("");

    // ratio pick buttons
    const cp = $("claimPick");
    cp.innerHTML = RATIOS.map(
      (r) =>
        `<button class="ratio-btn ${state.form.claimLibs === r.libs ? "sel" : ""}" data-libs="${r.libs}" style="background:${ratioColor(
          r.libs
        )}"><span class="ratio-name ${r.cls}">${r.name}</span><span class="ratio-sub">${r.sub}</span></button>`
    ).join("");
    cp.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        state.form.claimLibs = +b.dataset.libs;
        if (state.form.claimLibs === 0 || state.form.claimLibs === 3) state.form.conflict = false;
        renderForm(d);
      };
    });

    // conflict button — only Golden (1L) / Silver (2L)
    const cf = $("btnConflict");
    const conflictable = state.form.claimLibs === 1 || state.form.claimLibs === 2;
    cf.disabled = !conflictable;
    cf.classList.toggle("on", conflictable && state.form.conflict);

    $("btnRecord").disabled = !(state.form.chanIdx !== null && state.form.claimLibs !== null);
    $("btnUndo").disabled = state.events.length === 0;
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
          }</td>` +
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
  function recordGovernment() {
    const presIdx = +$("selPres").value;
    const chanVal = $("selChan").value;
    if (chanVal === "" || state.form.claimLibs === null) return;
    const chanIdx = +chanVal;
    const enacted = inferEnacted(state.form.claimLibs, state.form.conflict);
    state.events.push({
      type: "gov",
      presidentIdx: presIdx,
      chancellorIdx: chanIdx,
      claimLibs: state.form.claimLibs,
      conflict: state.form.conflict && (state.form.claimLibs === 1 || state.form.claimLibs === 2),
      enacted,
    });
    state.lastChanIdx = chanIdx;
    const nextPres = nextAliveAfter(presIdx);
    state.form = { presIdx: nextPres, chanIdx: defaultChancellor(nextPres), claimLibs: null, conflict: false };
    renderGame();
    animateEnact(presIdx, enacted);
  }

  function recordFail() {
    const presIdx = +$("selPres").value;
    state.events.push({ type: "fail", presidentIdx: presIdx });
    const nextPres = nextAliveAfter(presIdx);
    state.form.presIdx = nextPres;
    state.form.chanIdx = defaultChancellor(nextPres);
    // has the tracker just hit 3?
    const d = derive();
    if (d.tracker >= 3) state.pendingChaos = true;
    renderGame();
  }

  // Undo the most recent event (government, failed election, or chaos) and
  // restore the president/chancellor turn state to just before it.
  function undoLast() {
    if (!state.events.length) return;
    state.events.pop();
    let cand = state.firstPres;
    let lastChan = null;
    for (const ev of state.events) {
      if (ev.type === "gov") {
        cand = nextAliveAfter(ev.presidentIdx);
        lastChan = ev.chancellorIdx;
      } else if (ev.type === "fail") {
        cand = nextAliveAfter(ev.presidentIdx);
      }
    }
    state.lastChanIdx = lastChan;
    state.form = { presIdx: cand, chanIdx: defaultChancellor(cand), claimLibs: null, conflict: false };
    state.pendingChaos = derive().tracker >= 3; // re-open chaos prompt if a chaos was undone
    renderGame();
  }

  function resolveChaos(policy) {
    state.pendingChaos = false;
    state.events.push({ type: "chaos", enacted: policy });
    // chaos resets term limits; keep suggested president/chancellor as-is
    renderGame();
    animateChaos(policy);
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
    const src = $("drawPile");
    const slot = slotForType(type);
    if (src && slot) flyFromTo(src.getBoundingClientRect(), slot.getBoundingClientRect(), type);
  }

  // ------------------------------ END GAME -----------------------------------
  function openEnd() {
    $("selHitler").innerHTML = state.players
      .map((p, i) => `<option value="${i}">${escapeHtml(p.name)}</option>`)
      .join("");
    const wrap = $("fascistToggles");
    wrap.innerHTML = "";
    state.players.forEach((p, i) => {
      const b = document.createElement("button");
      b.textContent = p.name;
      b.dataset.idx = i;
      b.dataset.on = "0";
      b.onclick = () => {
        const on = b.dataset.on === "1";
        b.dataset.on = on ? "0" : "1";
        b.classList.toggle("primary", !on);
      };
      wrap.appendChild(b);
    });
    show("endScreen");
  }

  function saveGame() {
    const hitlerIdx = +$("selHitler").value;
    const fascistIdxs = Array.from($("fascistToggles").querySelectorAll('button[data-on="1"]')).map(
      (b) => +b.dataset.idx
    );
    state.result = { winner: $("selWinner").value, hitlerIdx, fascistIdxs };
    state.date = new Date().toISOString();
    Stats.recordGame(JSON.parse(JSON.stringify(state)));
    alert("Game saved to statistics.");
    resetToSetup();
  }

  // ------------------------------ STATS --------------------------------------
  function renderStats() {
    const s = Stats.summary();
    $("summaryGrid").innerHTML = [
      tile(s.totalGames, "Games recorded"),
      tile(s.liberalWins, "Liberal wins"),
      tile(s.fascistWins, "Fascist wins"),
      tile((s.fascistWinRate * 100).toFixed(0) + "%", "Fascist win rate"),
      tile(s.avgGovernments.toFixed(1), "Avg governments / game"),
    ].join("");
    const tb = $("playerStatsTable").querySelector("tbody");
    const rows = Stats.playerStats();
    tb.innerHTML = rows.length
      ? rows
          .map(
            (p) =>
              `<tr><td>${escapeHtml(p.name)}</td><td>${p.games}</td><td>${p.wins}</td>` +
              `<td>${(p.winRate * 100).toFixed(0)}%</td><td>${p.presidencies}</td>` +
              `<td>${p.chancellorships}</td><td>${p.asHitler}</td><td>${p.conflicts}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="8" class="muted">No games recorded yet.</td></tr>`;
    show("statsScreen");
  }
  function tile(big, lbl) {
    return `<div class="stat-tile"><div class="big">${big}</div><div class="lbl">${lbl}</div></div>`;
  }

  // ------------------------------ misc ---------------------------------------
  function resetToSetup() {
    state = null;
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
    $("btnNew").onclick = () => {
      if (!state || confirm("Start a new game? Current game is not saved unless you end & save it."))
        resetToSetup();
    };
    $("btnStats").onclick = renderStats;
    $("btnBackFromStats").onclick = () => show(state ? "gameScreen" : "setupScreen");
    $("btnClearStats").onclick = () => {
      if (confirm("Delete ALL saved statistics? This cannot be undone.")) {
        Stats.clearAll();
        renderStats();
      }
    };

    $("btnRecord").onclick = recordGovernment;
    $("btnFail").onclick = recordFail;
    $("btnUndo").onclick = undoLast;
    $("btnConflict").onclick = () => {
      state.form.conflict = !state.form.conflict;
      renderForm(derive());
    };
    $("selPres").onchange = () => {
      state.form.presIdx = +$("selPres").value;
      if (state.form.chanIdx === state.form.presIdx) state.form.chanIdx = null;
      renderForm(derive());
    };
    $("selChan").onchange = () => {
      state.form.chanIdx = $("selChan").value === "" ? null : +$("selChan").value;
      $("btnRecord").disabled = !(state.form.chanIdx !== null && state.form.claimLibs !== null);
    };
    $("modMinus").onclick = () => adjustRoundMod(-1);
    $("modPlus").onclick = () => adjustRoundMod(1);
    $("chaosLib").onclick = () => resolveChaos("L");
    $("chaosFac").onclick = () => resolveChaos("F");

    $("btnEnd").onclick = openEnd;
    $("btnSaveGame").onclick = saveGame;
    $("btnCancelEnd").onclick = () => show("gameScreen");
  }

  function adjustRoundMod(delta) {
    const d = derive();
    const r = d.rounds[d.round];
    state.roundMods[d.round] = clamp(r.mod + delta, r.modLo, r.modHi);
    renderGame();
  }

  // ------------------------------ boot ---------------------------------------
  wire();
  renderSetup();
})();
