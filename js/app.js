/* ============================================================================
 * app.js — Secret Hitler companion: state, randomization, bookkeeping, UI.
 * Depends on Prob (probability.js) and Stats (stats.js).
 * ==========================================================================*/

(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---- Player counts → fascist track powers (see SECRET_HITLER_RULES.md) ----
  // 6 slots; last is the win. Values are short power labels or "" for none.
  const FAC_POWERS = {
    5: ["", "", "Peek", "Kill", "Kill", "WIN"],
    6: ["", "", "Peek", "Kill", "Kill", "WIN"],
    7: ["", "Invest.", "Sp.Elec", "Kill", "Kill", "WIN"],
    8: ["", "Invest.", "Sp.Elec", "Kill", "Kill", "WIN"],
    9: ["Invest.", "Invest.", "Sp.Elec", "Kill", "Kill", "WIN"],
    10: ["Invest.", "Invest.", "Sp.Elec", "Kill", "Kill", "WIN"],
  };

  // ------------------------------ state --------------------------------------
  let setupPlayers = []; // names before start
  let state = null; // active game

  function newGameState(players, firstPres) {
    return {
      date: null, // stamped at save time (Date.now unavailable mid-run here)
      players: players.map((n) => ({ name: n, dead: false })),
      firstPres,
      governments: [], // {presidentIdx, chancellorIdx, claimLibs, enacted, modifier}
      roundMods: {}, // roundIndex -> speculative liberal correction
      form: { presIdx: firstPres, chanIdx: null, claimLibs: 2, enacted: null, modifier: 0 },
      result: null,
    };
  }

  // ---------------------- derived bookkeeping --------------------------------
  // Walks recorded governments, reconstructing pile flow, rounds, and per-gov
  // true hands + retrospective probabilities.
  function derive() {
    let facEnacted = 0,
      libEnacted = 0,
      draw = 17,
      round = 0;
    const rounds = [{ index: 0, startN: 17, startL: 6, govs: [] }];
    const gi = [];

    state.governments.forEach((g, n) => {
      if (draw < 3) {
        // reshuffle: discard merges back; new pool = all non-enacted cards
        round++;
        draw = 17 - (facEnacted + libEnacted);
        rounds.push({ index: round, startN: draw, startL: 6 - libEnacted, govs: [] });
      }
      const trueLibs = clamp(g.claimLibs - g.modifier, 0, 3);
      const info = {
        n,
        round,
        trueLibs,
        drawBefore: draw,
        prob: null,
      };
      gi.push(info);
      rounds[round].govs.push(n);
      draw -= 3;
      if (g.enacted === "L") libEnacted++;
      else if (g.enacted === "F") facEnacted++;
    });

    // retrospective probability per government within its round
    rounds.forEach((r) => {
      const mod = state.roundMods[r.index] || 0;
      const effStartL = clamp(r.startL + mod, 0, r.startN);
      const libsArr = r.govs.map((n) => gi[n].trueLibs);
      r.govs.forEach((n, localIdx) => {
        gi[n].prob = Prob.retrospectiveProb(r.startN, effStartL, libsArr, localIdx);
      });
      // bottom (leftover) cards for a *completed* round
      r.leftover = r.startN - 3 * r.govs.length;
      const drawn = libsArr.reduce((a, b) => a + b, 0);
      r.bottomLibs = clamp(effStartL - drawn, 0, r.leftover);
    });

    // current draw & discard composition (within the active round)
    const cur = rounds[round];
    const curMod = state.roundMods[round] || 0;
    const curStartL = clamp(cur.startL + curMod, 0, cur.startN);
    const libsDrawn = cur.govs.reduce((a, n) => a + gi[n].trueLibs, 0);
    const drawLibs = clamp(curStartL - libsDrawn, 0, draw);
    const drawFasc = draw - drawLibs;
    const libEnactedInRound = cur.govs.filter((n) => state.governments[n].enacted === "L").length;
    const facEnactedInRound = cur.govs.filter((n) => state.governments[n].enacted === "F").length;
    const discardLibs = libsDrawn - libEnactedInRound;
    const discardFasc = cur.govs.length * 3 - libsDrawn - facEnactedInRound;

    return {
      facEnacted,
      libEnacted,
      draw,
      round,
      rounds,
      gi,
      drawLibs,
      drawFasc,
      discardLibs: Math.max(0, discardLibs),
      discardFasc: Math.max(0, discardFasc),
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
    $("setupHint").textContent = ok
      ? `${n} players ready.`
      : `${n} player(s) — need 5 to 10.`;
  }

  function addPlayer() {
    const v = $("nameInput").value.trim();
    if (!v) return;
    if (setupPlayers.length >= 10) return;
    setupPlayers.push(v);
    $("nameInput").value = "";
    $("nameInput").focus();
    renderSetup();
  }

  function shuffle(arr) {
    // Fisher–Yates. (Math.random is available in the browser at runtime.)
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

  function nextPresidentAfter(idx) {
    const n = state.players.length;
    for (let step = 1; step <= n; step++) {
      const j = (idx + step) % n;
      if (!state.players[j].dead) return j;
    }
    return idx;
  }

  function renderGame() {
    const d = derive();
    renderTable(d);
    renderBoards(d);
    renderRoundBar(d);
    renderNextDraw(d);
    renderForm(d);
    renderHistory(d);
  }

  function renderTable(d) {
    const area = $("tableArea");
    // remove existing seat nodes (keep felt + center-boards)
    area.querySelectorAll(".seatNode").forEach((el) => el.remove());
    const n = state.players.length;
    // most-recent presidency per player for the mini hand display
    const lastGovByPlayer = {};
    d.gi.forEach((info) => {
      lastGovByPlayer[state.governments[info.n].presidentIdx] = info;
    });

    state.players.forEach((p, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const x = 50 + 43 * Math.cos(ang);
      const y = 50 + 45 * Math.sin(ang);
      const node = document.createElement("div");
      node.className = "seatNode";
      if (i === d3state().curPres) node.classList.add("pres");
      if (p.dead) node.classList.add("dead");
      node.style.left = x + "%";
      node.style.top = y + "%";

      const info = lastGovByPlayer[i];
      let handHtml = "";
      if (info) {
        const g = state.governments[info.n];
        const libs = info.trueLibs;
        const cards = [];
        for (let k = 0; k < 3; k++) cards.push(k < 3 - libs ? "F" : "L");
        handHtml =
          `<div class="miniHand">` +
          cards.map((c) => `<div class="miniCard ${c}"></div>`).join("") +
          `</div>` +
          `<div class="odds">${Prob.fmtPct(info.prob)}</div>`;
      }

      node.innerHTML =
        `<div class="avatar">${escapeHtml(initials(p.name))}</div>` +
        `<div class="name">${escapeHtml(p.name)}${
          i === state.firstPres ? " ·①" : ""
        }</div>` +
        handHtml;
      area.appendChild(node);
    });
  }

  // small helper so renderTable can know the current suggested president
  function d3state() {
    return { curPres: state.form.presIdx };
  }

  function renderBoards(d) {
    const n = state.players.length;
    const powers = FAC_POWERS[n] || FAC_POWERS[10];
    const fac = $("facTrack");
    fac.innerHTML = "";
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("div");
      s.className = "slot" + (i < d.facEnacted ? " filled F" : "");
      if (powers[i] && powers[i] !== "WIN") s.classList.add("power");
      s.title = powers[i] || "";
      fac.appendChild(s);
    }
    const lib = $("libTrack");
    lib.innerHTML = "";
    for (let i = 0; i < 5; i++) {
      const s = document.createElement("div");
      s.className = "slot" + (i < d.libEnacted ? " filled L" : "");
      lib.appendChild(s);
    }
    $("drawPile").textContent = `${d.draw} (${d.drawFasc}F / ${d.drawLibs}L)`;
    $("discardPile").textContent = `${d.discardFasc + d.discardLibs} (${d.discardFasc}F / ${d.discardLibs}L)`;
    $("deckReadout").textContent = `Enacted: ${d.facEnacted}F / ${d.libEnacted}L · Pool 17 = 11F/6L`;
  }

  function renderRoundBar(d) {
    $("roundNum").textContent = d.round + 1;
    $("roundMod").textContent = fmtSigned(state.roundMods[d.round] || 0);
    // bottom cards: show for the current round only if it is complete (leftover known & <3 draw)
    const r = d.rounds[d.round];
    const wrap = $("bottomCards");
    if (d.draw < 3 && d.draw >= 0 && r.govs.length > 0) {
      const cards = [];
      for (let k = 0; k < r.leftover; k++) cards.push(k < r.bottomLibs ? "L" : "F");
      wrap.innerHTML = cards.length
        ? cards.map((c) => `<span class="miniCard ${c}"></span>`).join("")
        : "none";
    } else {
      wrap.textContent = "— (round in progress)";
    }
  }

  function renderNextDraw(d) {
    // pool the next president will draw from (reshuffle first if <3 remain)
    let n = d.draw,
      l = d.drawLibs;
    if (n < 3) {
      n = 17 - (d.facEnacted + d.libEnacted);
      l = 6 - d.libEnacted;
    }
    const dist = Prob.drawDistribution(n, l); // index = liberals: [3F,2F1L,1F2L,3L]
    const labels = ["3F", "2F·1L", "1F·2L", "3L"]; // index = liberals
    const wrap = $("nextDraw");
    wrap.innerHTML = dist
      .map((p, libs) => ({ p, label: labels[libs] }))
      .reverse() // show most-liberal (3L) first
      .map(
        (o) =>
          `<div class="nd-item"><div class="p">${Prob.fmtPct(o.p)}</div><div class="l">${o.label}</div></div>`
      )
      .join("");
  }

  function renderForm(d) {
    const alive = aliveIdxs();
    const selP = $("selPres");
    const selC = $("selChan");
    const optable = (idx) =>
      alive
        .map(
          (i) =>
            `<option value="${i}" ${i === idx ? "selected" : ""}>${escapeHtml(
              state.players[i].name
            )}</option>`
        )
        .join("");
    // default suggested president = state.form.presIdx (auto-advanced)
    selP.innerHTML = optable(state.form.presIdx);
    selC.innerHTML =
      `<option value="">— select —</option>` +
      alive
        .filter((i) => i !== state.form.presIdx)
        .map(
          (i) =>
            `<option value="${i}" ${
              i === state.form.chanIdx ? "selected" : ""
            }>${escapeHtml(state.players[i].name)}</option>`
        )
        .join("");

    // claim buttons
    const cp = $("claimPick");
    const handLabels = ["3F", "2F·1L", "1F·2L", "3L"]; // index = liberals
    cp.innerHTML = handLabels
      .map(
        (lbl, libs) =>
          `<button data-libs="${libs}" class="${
            state.form.claimLibs === libs ? "sel " + (libs >= 2 ? "L" : "F") : ""
          }">${lbl}</button>`
      )
      .join("");
    cp.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        state.form.claimLibs = +b.dataset.libs;
        renderForm(derive());
      };
    });

    // enacted buttons
    $("enactPick")
      .querySelectorAll("button")
      .forEach((b) => {
        b.classList.toggle("sel", state.form.enacted === b.dataset.e);
        b.classList.toggle(b.dataset.e, state.form.enacted === b.dataset.e);
        b.onclick = () => {
          state.form.enacted = b.dataset.e;
          renderForm(derive());
        };
      });

    $("gMod").textContent = fmtSigned(state.form.modifier);
    $("btnRecord").disabled = !(state.form.enacted && state.form.chanIdx !== null);
  }

  function renderHistory(d) {
    const tb = $("histTable").querySelector("tbody");
    tb.innerHTML = "";
    d.gi.forEach((info) => {
      const g = state.governments[info.n];
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${info.n + 1}</td>` +
        `<td class="tag-round">${info.round + 1}</td>` +
        `<td>${escapeHtml(state.players[g.presidentIdx].name)}</td>` +
        `<td>${escapeHtml(state.players[g.chancellorIdx].name)}</td>` +
        `<td>${Prob.handLabel(g.claimLibs)}</td>` +
        `<td>${Prob.handLabel(info.trueLibs)}${
          g.modifier ? ` <span class="muted">(${fmtSigned(g.modifier)})</span>` : ""
        }</td>` +
        `<td>${g.enacted === "L" ? "🟦 Lib" : "🟥 Fac"}</td>` +
        `<td><b style="color:var(--gold)">${Prob.fmtPct(info.prob)}</b></td>`;
      tb.appendChild(tr);
    });
  }

  function recordGovernment() {
    const presIdx = +$("selPres").value;
    const chanVal = $("selChan").value;
    if (chanVal === "" || !state.form.enacted) return;
    state.governments.push({
      presidentIdx: presIdx,
      chancellorIdx: +chanVal,
      claimLibs: state.form.claimLibs,
      enacted: state.form.enacted,
      modifier: state.form.modifier,
    });
    // advance suggested president; reset per-gov form fields
    state.form = {
      presIdx: nextPresidentAfter(presIdx),
      chanIdx: null,
      claimLibs: 2,
      enacted: null,
      modifier: 0,
    };
    renderGame();
  }

  // ------------------------------ END GAME -----------------------------------
  function openEnd() {
    const selH = $("selHitler");
    selH.innerHTML = state.players
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
    const fascistIdxs = Array.from(
      $("fascistToggles").querySelectorAll('button[data-on="1"]')
    ).map((b) => +b.dataset.idx);
    state.result = {
      winner: $("selWinner").value,
      hitlerIdx,
      fascistIdxs,
    };
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
              `<td>${p.chancellorships}</td><td>${p.asHitler}</td>` +
              `<td>${p.avgModifier.toFixed(2)}</td></tr>`
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
    return name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
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
    $("selPres").onchange = () => {
      state.form.presIdx = +$("selPres").value;
      if (state.form.chanIdx === state.form.presIdx) state.form.chanIdx = null; // can't be both
      renderForm(derive());
    };
    $("selChan").onchange = () => {
      state.form.chanIdx = $("selChan").value === "" ? null : +$("selChan").value;
      $("btnRecord").disabled = !(state.form.enacted && state.form.chanIdx !== null);
    };
    $("gMinus").onclick = () => {
      state.form.modifier = clamp(state.form.modifier - 1, -3, 3);
      renderForm(derive());
    };
    $("gPlus").onclick = () => {
      state.form.modifier = clamp(state.form.modifier + 1, -3, 3);
      renderForm(derive());
    };
    $("modMinus").onclick = () => adjustRoundMod(-1);
    $("modPlus").onclick = () => adjustRoundMod(1);

    $("btnEnd").onclick = openEnd;
    $("btnSaveGame").onclick = saveGame;
    $("btnCancelEnd").onclick = () => show("gameScreen");
  }

  function adjustRoundMod(delta) {
    const d = derive();
    const cur = state.roundMods[d.round] || 0;
    state.roundMods[d.round] = clamp(cur + delta, -6, 6);
    renderGame();
  }

  // ------------------------------ boot ---------------------------------------
  wire();
  renderSetup();
})();
