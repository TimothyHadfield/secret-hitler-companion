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
  // The undo stack lives in its OWN key, not inside the active-game blob. Each
  // snapshot is a full copy of the game, so folding all ~25 of them into the
  // per-render save meant re-serialising the whole stack on EVERY render
  // (O(n²) in a long game). It now writes only when the stack actually changes
  // (pushUndo/undoLast), while saveActive() persists just the live state.
  const UNDO_KEY = "secretHitler.activeGame.undo.v1";
  const SETUP_KEY = "secretHitler.setupPlayers.v1";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  // A failed save used to be invisible, so a full quota silently stopped the
  // game from being persisted — the next refresh would lose it. Warn once.
  let storageWarned = false;
  const lsSet = (k, v) => {
    try { localStorage.setItem(k, v); return true; }
    catch (e) {
      if (!storageWarned) {
        storageWarned = true;
        setTimeout(() => showToast("Storage is full — this game may not survive a refresh. Export your data."), 0);
      }
      return false;
    }
  };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

  // ------------------------------ settings -----------------------------------
  // `lieDetection` gates EVERYTHING the honesty model adds: with it off the
  // analysis is never run and nothing new is rendered anywhere. Defaults ON, but
  // a stored choice (either way) is always respected — so someone who turned it
  // off keeps it off across reloads.
  const SETTINGS_KEY = "secretHitler.settings.v1";
  // `boardOdds` shows a live per-player fascist % ON the shared table — off by
  // default on purpose: a table that can all see it plays a different game.
  const settings = { lieDetection: true, boardOdds: false };
  function loadSettings() {
    try {
      const s = JSON.parse(lsGet(SETTINGS_KEY) || "{}");
      if (typeof s.lieDetection === "boolean") settings.lieDetection = s.lieDetection;
      if (typeof s.boardOdds === "boolean") settings.boardOdds = s.boardOdds;
    } catch (e) { /* keep the defaults */ }
    applySettings();
  }
  function saveSettings() { lsSet(SETTINGS_KEY, JSON.stringify(settings)); }
  function applySettings() {
    document.body.classList.toggle("lie-on", settings.lieDetection);
    document.body.classList.toggle("board-odds-on", settings.boardOdds);
  }
  // The per-claim honesty layer is consulted only when lie detection is on.
  const lieOn = () => settings.lieDetection && typeof Honesty !== "undefined";
  // The role posterior (per-player fascist odds) is needed when EITHER the lie
  // detection review or the on-table odds are enabled — and always during a
  // review PLAYBACK (the chronological stepper shows the live odds regardless of
  // the two switches, because the user explicitly asked to watch them evolve).
  const pbActive = () => !!(state && state.review && state.playback);
  const rolesOn = () =>
    typeof Honesty !== "undefined" &&
    (settings.lieDetection || settings.boardOdds || pbActive());

  // Build the role-posterior input from derived rounds/govs and run it. Feeds the
  // engine every signal the app records (claims, enactments, conflicts,
  // nominations, investigations, executions, special elections, policy peeks) plus
  // the hard role deductions. Shared by derive() (live, gated by the switch) and
  // the game record (a permanent snapshot). Returns the full {pFascist,pHitler,…}
  // result, or null if the engine is absent / there's nothing to analyse.
  function analyzeRoles(rounds, gi, hitlerElected) {
    if (typeof Honesty === "undefined" || !gi.length) return null;
    const n = state.players.length;
    const forcedFascist = [];
    let forcedHitler = null;
    const notHitler = new Set();
    const investigations = [];
    const kills = [];
    const specials = [];
    // Policy Peek attaches to the NEXT government (the one that draws the peeked
    // cards); filled in below, keyed by that government's gi index.
    const peekByGov = {};

    // Hitler elected Chancellor, or an executed Hitler, reveals Hitler exactly.
    if (hitlerElected && hitlerElected.chancellorIdx != null) {
      forcedFascist.push(hitlerElected.chancellorIdx);
      forcedHitler = hitlerElected.chancellorIdx;
    }

    gi.forEach((g) => {
      const p = g.power;
      // A chancellor seated with 3+ fascist policies down, in a game that did NOT
      // end at that election, is provably not Hitler (else Fascists would've won).
      if (g.facBefore >= 3 && g.chancellorIdx != null) notHitler.add(g.chancellorIdx);
      if (!p) return;
      if (p.type === "invest" && p.targetIdx != null && p.party)
        investigations.push({ investIdx: g.presidentIdx, targetIdx: p.targetIdx, party: p.party });
      else if (p.type === "kill" && p.killedIdx != null) {
        if (p.wasHitler) { forcedFascist.push(p.killedIdx); forcedHitler = p.killedIdx; }
        else { kills.push({ killerIdx: g.presidentIdx, victimIdx: p.killedIdx }); notHitler.add(p.killedIdx); }
      } else if (p.type === "special" && p.chosenIdx != null)
        specials.push({ chooserIdx: g.presidentIdx, chosenIdx: p.chosenIdx });
    });

    // Policy Peek: the peek names the top 3 cards, which are a real 3-card sample
    // of the round pool. Two cases:
    //  • the NEXT government in the same round drew exactly those cards → the peek
    //    is a second report of that government's hand (tie them);
    //  • no government has drawn them yet (or a reshuffle carried them off) → the
    //    peek is still a report of 3 real cards, so add a PHANTOM hand to its round
    //    so the conservation law can catch an impossible claim right away (e.g.
    //    claiming 3 liberals when the round pool holds only 2).
    const phantomByRound = {};
    rounds.forEach((r) => {
      for (let k = 0; k < r.govs.length; k++) {
        const g = gi[r.govs[k]];
        if (!(g.power && g.power.type === "peek" && Array.isArray(g.power.order))) continue;
        const peekLibs = g.power.order.filter((c) => c === "L").length;
        if (k + 1 < r.govs.length) {
          peekByGov[r.govs[k + 1]] = { peekerIdx: g.presidentIdx, peekLibs };
        } else {
          (phantomByRound[r.index] = phantomByRound[r.index] || []).push({
            presIdx: g.presidentIdx,
            claim: peekLibs,
            enacted: null,
            vetoed: true, // no enacted-card constraint; still a 3-card sample
            conflict: false,
            facBefore: g.facBefore,
            libBefore: g.libBefore,
            phantom: true,
          });
        }
      }
    });

    return Honesty.analyzeGame({
      playerCount: n,
      fascistCount: Math.ceil(n / 2) - 1, // fascists incl. Hitler
      cautiousHitler: n >= 7, // Hitler is blind to the fascists in 7+ games
      forcedFascist,
      forcedHitler,
      notHitler: [...notHitler],
      investigations,
      kills,
      specials,
      rounds: rounds.map((r) => ({
        startN: r.startN,
        startL: r.startL,
        chaosLibs: r.chaosLib,
        chaosFascs: r.chaosFac,
        govs: r.govs
          .map((idx) => ({
            presIdx: gi[idx].presidentIdx,
            chanIdx: gi[idx].chancellorIdx,
            claim: gi[idx].libs,
            enacted: gi[idx].enacted,
            vetoed: gi[idx].vetoed,
            conflict: gi[idx].conflict,
            facBefore: gi[idx].facBefore,
            libBefore: gi[idx].libBefore,
            peek: peekByGov[idx] || undefined,
          }))
          // append any phantom peek "hands" for peeks nobody has drawn yet
          .concat((phantomByRound[r.index] || []).map((pg) => ({ chanIdx: pg.presIdx, ...pg }))),
      })),
    });
  }

  // A permanent snapshot for the saved game, computed even when the switch is off
  // (so every recorded game carries the estimate). Returns the full role result
  // {pFascist, pHitler, …} or null if the engine is absent.
  function computeRoleOdds() {
    const d = derive();
    return analyzeRoles(d.rounds, d.gi, d.hitlerElected);
  }

  // Persist the live game WITHOUT the undo stack — that's saved separately, only
  // when it changes, so a frequent render never re-serialises 25 full snapshots.
  function saveActive() {
    if (!state || state.review) return;
    const { undoStack, ...rest } = state;
    lsSet(ACTIVE_KEY, JSON.stringify(rest));
  }
  function saveUndo() {
    if (!state || state.review) return;
    lsSet(UNDO_KEY, JSON.stringify(state.undoStack || []));
  }
  function clearActive() { lsDel(ACTIVE_KEY); lsDel(UNDO_KEY); }
  function saveSetup() { lsSet(SETUP_KEY, JSON.stringify(setupPlayers)); }

  function loadActive() {
    try {
      const s = JSON.parse(lsGet(ACTIVE_KEY));
      if (!s || !s.players || !Array.isArray(s.events)) return null;
      // backfill fields that may be absent in a game saved by an older version
      // The undo stack now lives in its own key; older saves embedded it in the
      // blob (still an array), so prefer that if present, else read the new key.
      if (!Array.isArray(s.undoStack)) {
        try { s.undoStack = JSON.parse(lsGet(UNDO_KEY)); } catch (e) { s.undoStack = []; }
        if (!Array.isArray(s.undoStack)) s.undoStack = [];
      }
      if (!s.form) s.form = { chanIdxOverride: null, conflictArmed: false, vetoArmed: false };
      if (s.form.vetoArmed === undefined) s.form.vetoArmed = false;
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
      form: { chanIdxOverride: null, conflictArmed: false, vetoArmed: false },
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
  // The whole rules engine now lives in js/derive.js (Node-testable). This is a
  // thin binding that hands it the live `state` plus the collaborators it needs:
  // clamp, the probability engine, the two settings predicates, and the honesty/
  // role analyzers (deferred so `Honesty` is only touched when the switch is on).
  function derive() {
    return Derive.derive(state, {
      clamp,
      retrospectiveProb: Prob.retrospectiveProb,
      lieOn,
      rolesOn,
      analyzeRound: (arg) => Honesty.analyzeRound(arg),
      analyzeRoles,
    });
  }

  // effective chancellor for the current turn: user's tap, else the suggestion
  function effChan(d) {
    const o = state.form.chanIdxOverride;
    if (o != null && !state.players[o].dead && o !== d.presIdx && !d.termLimited.has(o)) return o;
    return d.suggestedChan;
  }

  // ------------------------------ screens ------------------------------------
  function show(id) {
    ["menuScreen", "setupScreen", "gameScreen", "statsScreen", "rulesScreen", "theoryScreen", "onlineScreen"].forEach((s) =>
      $(s).classList.toggle("hidden", s !== id)
    );
    if (id === "menuScreen") renderMenu();
  }

  // Navigation. The main menu is home; Players and Statistics are pages you step
  // INTO, and the top-left ← returns to whatever you came from (a small stack, so
  // it behaves like a back button everywhere). The game screen has its own exit
  // (undo while playing, Quit/New), so it isn't part of this stack.
  const NAV_SCREENS = ["menuScreen", "setupScreen", "statsScreen", "rulesScreen", "theoryScreen", "onlineScreen"];
  let navStack = [];
  function currentTopScreen() {
    return NAV_SCREENS.find((s) => !$(s).classList.contains("hidden")) || null;
  }
  function navTo(id) {
    const cur = currentTopScreen();
    if (cur && cur !== id) navStack.push(cur);
    show(id);
  }
  function navBack() {
    const prev = navStack.pop() || "menuScreen";
    show(prev);
  }
  // Home = the main menu. Clears ONLY the in-progress game autosave (recorded
  // games — local or synced — are never touched here) and empties the stack.
  function goHome() {
    state = null;
    clearActive();
    navStack = [];
    show("menuScreen");
  }
  function renderMenu() {
    renderAcctChip(); // the profile corner doubles as the sync-status chip
    const el = $("menuGroupName");
    if (el) el.textContent = activeGroupLabel();
  }
  function openSetup() { renderSetup(); navTo("setupScreen"); }
  function openStats() { renderStatsInto($("statsBody")); navTo("statsScreen"); }
  function openRules() { refReset("rule"); navTo("rulesScreen"); renderReference("rule"); }
  function openTheory() { refReset("theory"); navTo("theoryScreen"); renderReference("theory"); }

  // ------------------------------ RULES / GAME THEORY handbook ---------------
  // A browsable, searchable reference (content bundled in js/reference.js) with a
  // wiki-style community-comment layer on every item (stored in Firestore via
  // cloud.js). Navigation is category → subcategory → item ("bullet"); each item
  // expands to its full text plus its notes. Search cuts across everything.
  const refBrowser = {
    rule: { mount: "rulesBody", query: "", catId: null, subId: null, openItem: null, notes: {} },
    theory: { mount: "theoryBody", query: "", catId: null, subId: null, openItem: null, notes: {} },
  };
  const REF_META = {
    rule: { title: "Rules", tagline: "Find any rule — search, or browse by category.",
            search: "Search rules… (e.g. term limits, chaos, veto)" },
    theory: { title: "Game theory", tagline: "Strategy ideas, plus notes from the community. Add your own to any topic.",
              search: "Search strategy… (e.g. Hitler, chancellor, endgame)" },
  };
  function refReset(kind) {
    const s = refBrowser[kind];
    s.query = ""; s.catId = null; s.subId = null; s.openItem = null;
  }
  const R = () => window.Reference;
  const noteId = (target) => "notes_" + String(target).replace(/[^a-z0-9]+/gi, "_");

  function renderReference(kind) {
    const s = refBrowser[kind];
    const box = $(s.mount);
    if (!box || !R()) return;
    const meta = REF_META[kind];
    box.innerHTML =
      `<div class="ref-head"><h2 class="ref-title">${escapeHtml(meta.title)}</h2>` +
      `<p class="ref-tagline">${escapeHtml(meta.tagline)}</p></div>` +
      `<div class="ref-searchwrap">` +
      `<input id="refSearch_${kind}" class="ref-search" type="search" ` +
      `placeholder="${escapeHtml(meta.search)}" value="${escapeHtml(s.query)}" ` +
      `autocomplete="off" aria-label="${escapeHtml(meta.search)}">` +
      `</div>` +
      `<div class="ref-results" id="refResults_${kind}"></div>`;
    const inp = $(`refSearch_${kind}`);
    inp.oninput = () => { s.query = inp.value; s.openItem = null; renderRefResults(kind); };
    renderRefResults(kind);
  }

  function renderRefResults(kind) {
    const s = refBrowser[kind];
    const box = $(`refResults_${kind}`);
    if (!box) return;
    const q = s.query.trim();

    if (q) {
      const hits = R().search(kind, q);
      box.innerHTML =
        `<div class="ref-count">${hits.length} result${hits.length === 1 ? "" : "s"} for “${escapeHtml(q)}”</div>` +
        (hits.length
          ? hits.map((e) => itemCardHtml(kind, e.item, e.crumb)).join("")
          : `<div class="ref-empty">Nothing matched. Try fewer or different words.</div>`);
      wireItemCards(kind, box);
      return;
    }

    const tree = R().tree(kind);
    // Level 0 — categories.
    if (!s.catId) {
      box.innerHTML = tree.map((cat) => {
        const n = (cat.subcats || []).reduce((a, sc) => a + (sc.items || []).length, 0);
        return `<button class="ref-cat" data-cat="${escapeHtml(cat.id)}">` +
          `<span class="ref-cat-title">${escapeHtml(cat.title)}</span>` +
          `<span class="ref-cat-meta">${(cat.subcats || []).length} topics · ${n} entries ▸</span>` +
          `</button>`;
      }).join("");
      box.querySelectorAll(".ref-cat").forEach((b) => {
        b.onclick = () => { s.catId = b.dataset.cat; s.subId = null; s.openItem = null; renderRefResults(kind); };
      });
      return;
    }

    const cat = tree.find((c) => c.id === s.catId);
    if (!cat) { s.catId = null; return renderRefResults(kind); }

    // Level 1 — subcategories within the chosen category.
    if (!s.subId) {
      box.innerHTML =
        crumbHtml(kind, [{ label: cat.title }]) +
        (cat.subcats || []).map((sc) =>
          `<button class="ref-cat sub" data-sub="${escapeHtml(sc.id)}">` +
          `<span class="ref-cat-title">${escapeHtml(sc.title)}</span>` +
          `<span class="ref-cat-meta">${(sc.items || []).length} entries ▸</span>` +
          `</button>`).join("");
      wireCrumb(kind, box);
      box.querySelectorAll(".ref-cat.sub").forEach((b) => {
        b.onclick = () => { s.subId = b.dataset.sub; s.openItem = null; renderRefResults(kind); };
      });
      return;
    }

    // Level 2 — the items (bullets) of the chosen subcategory.
    const sub = (cat.subcats || []).find((x) => x.id === s.subId);
    if (!sub) { s.subId = null; return renderRefResults(kind); }
    box.innerHTML =
      crumbHtml(kind, [{ label: cat.title, catId: cat.id }, { label: sub.title }]) +
      (sub.items || []).map((it) => itemCardHtml(kind, it)).join("");
    wireCrumb(kind, box);
    wireItemCards(kind, box);
  }

  function crumbHtml(kind, parts) {
    // parts: [{label, catId?}] — the last is the current (not a link).
    const bits = [`<button class="ref-crumb-link" data-crumb="root">${escapeHtml(REF_META[kind].title)}</button>`];
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      bits.push(`<span class="ref-crumb-sep">›</span>`);
      bits.push(last
        ? `<span class="ref-crumb-cur">${escapeHtml(p.label)}</span>`
        : `<button class="ref-crumb-link" data-crumb="cat" data-cat="${escapeHtml(p.catId || "")}">${escapeHtml(p.label)}</button>`);
    });
    return `<nav class="ref-crumb">${bits.join(" ")}</nav>`;
  }
  function wireCrumb(kind, box) {
    const s = refBrowser[kind];
    box.querySelectorAll(".ref-crumb-link").forEach((b) => {
      b.onclick = () => {
        if (b.dataset.crumb === "root") { s.catId = null; s.subId = null; }
        else { s.catId = b.dataset.cat || s.catId; s.subId = null; }
        s.openItem = null; renderRefResults(kind);
      };
    });
  }

  function itemCardHtml(kind, item, crumb) {
    const s = refBrowser[kind];
    const open = s.openItem === item.id;
    const target = R().targetOf(kind, item.id);
    return `<div class="ref-item${open ? " open" : ""}">` +
      `<button class="ref-item-head" data-item="${escapeHtml(item.id)}">` +
      (crumb ? `<span class="ref-item-crumb">${escapeHtml(crumb)}</span>` : "") +
      `<span class="ref-item-title">${escapeHtml(item.title)}</span>` +
      `<span class="ref-item-caret">${open ? "▾" : "▸"}</span>` +
      `</button>` +
      (open
        ? `<div class="ref-item-body">` +
          `<p class="ref-item-text">${escapeHtml(item.body)}</p>` +
          `<div class="ref-notes-head">Community notes</div>` +
          `<div class="ref-notes" id="${noteId(target)}"></div>` +
          `</div>`
        : "") +
      `</div>`;
  }

  function wireItemCards(kind, box) {
    const s = refBrowser[kind];
    box.querySelectorAll(".ref-item-head").forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.item;
        s.openItem = s.openItem === id ? null : id;
        renderRefResults(kind);
        if (s.openItem === id) loadNotes(kind, R().targetOf(kind, id));
      };
    });
  }

  // ---- the community-comment layer on a single item ----
  function relTime(ms) {
    const d = Date.now() - ms;
    if (d < 60000) return "just now";
    if (d < 3600000) return Math.floor(d / 60000) + "m ago";
    if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
    if (d < 604800000) return Math.floor(d / 86400000) + "d ago";
    try { return new Date(ms).toLocaleDateString(); } catch (e) { return ""; }
  }
  const noteText = (t) => escapeHtml(t).replace(/\n/g, "<br>");

  async function loadNotes(kind, target) {
    const el = $(noteId(target));
    if (!el) return;
    const c = cloud();
    if (!c || !c.user) {
      el.innerHTML =
        `<div class="ref-notes-signedout">Sign in to read and add community notes.` +
        `<button class="linklike" id="notesSignin">Sign in</button></div>`;
      const b = $("notesSignin");
      if (b) b.onclick = () => openAccount();
      return;
    }
    el.innerHTML = `<div class="ref-notes-loading">Loading notes…</div>`;
    let list = [];
    try { list = await c.listComments(target); } catch (e) { list = []; }
    refBrowser[kind].notes[target] = list;
    paintNotes(kind, target);
  }

  function paintNotes(kind, target) {
    const el = $(noteId(target));
    if (!el) return;
    const list = refBrowser[kind].notes[target] || [];
    const rows = list.length
      ? list.map((n) =>
          `<div class="note">` +
          `<div class="note-meta"><span class="note-author">${escapeHtml(n.authorName)}</span>` +
          `<span class="note-time">${escapeHtml(relTime(n.at))}</span>` +
          (n.mine ? `<button class="note-del" data-id="${escapeHtml(n.id)}" title="Delete your note">Delete</button>` : "") +
          `</div><div class="note-text">${noteText(n.text)}</div></div>`).join("")
      : `<div class="ref-notes-empty">No notes yet — add the first.</div>`;
    el.innerHTML =
      `<div class="note-list">${rows}</div>` +
      `<div class="note-add">` +
      `<textarea class="note-input" id="ni_${noteId(target)}" maxlength="1000" rows="2" ` +
      `placeholder="Add a note, clarification, or strategy…"></textarea>` +
      `<button class="primary note-post" id="np_${noteId(target)}">Post note</button>` +
      `</div>`;

    const post = $(`np_${noteId(target)}`);
    const input = $(`ni_${noteId(target)}`);
    post.onclick = async () => {
      const text = (input.value || "").trim();
      if (!text) return;
      post.disabled = true; post.textContent = "Posting…";
      const c = cloud();
      const r = await c.addComment(target, text);
      if (r.ok) {
        input.value = "";
        try { refBrowser[kind].notes[target] = await c.listComments(target); } catch (e) {}
        paintNotes(kind, target);
      } else {
        post.disabled = false; post.textContent = "Post note";
        showToast(r.message || "Couldn't post that note.");
      }
    };
    el.querySelectorAll(".note-del").forEach((b) => {
      b.onclick = () => askConfirm(
        { title: "Delete your note?", body: "This removes your note for everyone.", confirm: "Delete", cancel: "Keep", danger: true },
        async () => {
          const c = cloud();
          const r = await c.deleteComment(b.dataset.id);
          if (r.ok) {
            try { refBrowser[kind].notes[target] = await c.listComments(target); } catch (e) {}
            paintNotes(kind, target);
          } else showToast(r.message || "Couldn't delete that note.");
        });
    });
  }

  // ------------------------------ ONLINE PLAY (real-time) --------------------
  // Phase 1: lobby, secret role deal, and the night reveal. js/online.js is the
  // Firestore/host layer (window.Online + online:* events); this is the UI. The
  // rest of the app works if online.js never loads (window.Online stays absent).
  let onlineTables = null; // cached list of joinable tables in the group

  function openOnline() { navTo("onlineScreen"); refreshOnlineTables(); renderOnline(); }

  const online = () => window.Online || null;

  function onlineNameOf(uid) {
    const O = online();
    const t = O && O.table;
    if (t && t.names && t.names[uid]) return t.names[uid];
    const p = (O ? O.players : []).find((x) => x.uid === uid);
    return (p && p.name) || "Player";
  }

  async function refreshOnlineTables() {
    const O = online(), c = cloud();
    if (!O || !c || !c.user || !O.groupId || O.tableId) return;
    onlineTables = await O.listTables();
    if (!$("onlineScreen").classList.contains("hidden")) renderOnline();
  }

  function renderOnline() {
    const box = $("onlineBody");
    if (!box) return;
    const O = online(), c = cloud();

    if (!c || !O) {
      box.innerHTML = onlineNotice("Online play needs the connection to load",
        "You may be offline. The rest of the app works normally — this page needs a network connection.");
      return;
    }
    if (!c.user) {
      box.innerHTML = onlineNotice("Sign in to play online",
        "Online games are played with your account so each player gets their secret role privately.") +
        `<div class="control-row"><button id="olSignin" class="primary">Sign in</button></div>`;
      $("olSignin").onclick = openAccount;
      return;
    }
    if (!O.groupId) {
      box.innerHTML = onlineNotice("Online games belong to a group",
        "Create or join a group first — the finished game records to it, and only its members can join.") +
        `<div class="control-row"><button id="olGroup" class="primary">Groups &amp; account</button></div>`;
      $("olGroup").onclick = openAccount;
      return;
    }

    const t = O.table;
    if (!t) return renderOnlineBrowse(box, O);
    if (t.status === "lobby") return renderOnlineLobby(box, O);
    if (t.status === "night") return renderOnlineNight(box, O);
    if (t.status === "playing" || t.status === "finished") return renderOnlinePlaying(box, O);
    return renderOnlineBrowse(box, O);
  }

  function onlineNotice(title, body) {
    return `<div class="online-head"><h2 class="online-title">Play online</h2></div>` +
      `<div class="online-card"><div class="online-card-title">${escapeHtml(title)}</div>` +
      `<p class="confirm-body" style="margin:6px 0 0">${escapeHtml(body)}</p></div>`;
  }

  // -- no table yet: host, or join an open one --------------------------------
  function renderOnlineBrowse(box, O) {
    const list = onlineTables || [];
    const rows = list.length
      ? list.map((tb) =>
          `<button class="ol-join" data-tid="${escapeHtml(tb.id)}">` +
          `<span class="ol-join-host">${escapeHtml(tb.hostName)}’s game</span>` +
          `<span class="ol-join-meta">${tb.playerCount} player${tb.playerCount === 1 ? "" : "s"} · ${escapeHtml(tb.status)} ▸</span>` +
          `</button>`).join("")
      : `<div class="muted" style="font-size:13px">No open games in <b>${escapeHtml(activeGroupLabel())}</b> right now.</div>`;
    box.innerHTML =
      `<div class="online-head"><h2 class="online-title">Play online</h2>` +
      `<p class="online-tagline">Host a live game for <b>${escapeHtml(activeGroupLabel())}</b>, or join one. ` +
      `Everyone plays on their own device; talk over voice or in person.</p></div>` +
      `<div class="control-row"><button id="olHost" class="primary">Host a game</button>` +
      `<button id="olRefresh" class="ghost">Refresh</button></div>` +
      `<div class="online-sub">Open games</div>` +
      `<div class="ol-join-list">${rows}</div>`;
    $("olHost").onclick = async () => {
      $("olHost").disabled = true;
      const r = await O.hostGame();
      if (!r.ok) { $("olHost").disabled = false; showToast(r.message); }
    };
    $("olRefresh").onclick = refreshOnlineTables;
    box.querySelectorAll(".ol-join").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const r = await O.joinTable(b.dataset.tid);
        if (!r.ok) { b.disabled = false; showToast(r.message); }
      };
    });
  }

  // -- lobby: waiting for players ---------------------------------------------
  function renderOnlineLobby(box, O) {
    const ps = O.players;
    const n = ps.length;
    const canStart = n >= O.MIN_PLAYERS && n <= O.MAX_PLAYERS;
    const rows = ps.map((p) =>
      `<div class="ol-seat">${escapeHtml(p.name || "Player")}` +
      (p.uid === O.table.hostUid ? `<span class="ol-badge">host</span>` : "") +
      (p.uid === (O.me && O.me.uid) ? `<span class="ol-badge you">you</span>` : "") +
      `</div>`).join("");
    box.innerHTML =
      `<div class="online-head"><h2 class="online-title">Lobby</h2>` +
      `<p class="online-tagline">${escapeHtml(activeGroupLabel())} · share this app with your group and have everyone open <b>Play online</b> to join.</p></div>` +
      `<div class="online-sub">Players <span class="muted">(${n} / ${O.MIN_PLAYERS}–${O.MAX_PLAYERS})</span></div>` +
      `<div class="ol-seats">${rows}</div>` +
      (O.isHost
        ? `<div class="online-hint">${canStart ? "Everyone in? Deal the roles when ready." : `Waiting for players — need ${O.MIN_PLAYERS}–${O.MAX_PLAYERS}.`}</div>` +
          `<div class="control-row"><button id="olStart" class="primary" ${canStart ? "" : "disabled"}>Start game</button>` +
          `<button id="olCancel" class="ghost-danger">Cancel game</button></div>`
        : `<div class="online-hint">Waiting for the host to start…</div>` +
          `<div class="control-row"><button id="olLeave" class="ghost">Leave</button></div>`);
    if ($("olStart")) $("olStart").onclick = async () => {
      $("olStart").disabled = true;
      const r = await O.startGame();
      if (!r.ok) { $("olStart").disabled = false; showToast(r.message); }
    };
    if ($("olCancel")) $("olCancel").onclick = () => askConfirm(
      { title: "Cancel this game?", body: "The lobby closes for everyone.", confirm: "Cancel game", cancel: "Keep waiting", danger: true },
      async () => { await O.leaveTable(); });
    if ($("olLeave")) $("olLeave").onclick = async () => { await O.leaveTable(); };
  }

  // -- night: your secret role, privately, on your own device -----------------
  function renderOnlineNight(box, O) {
    const t = O.table;
    const pv = O.myPrivate;
    const seatOrder = t.seatOrder || [];
    const firstName = onlineNameOf(seatOrder[t.firstPres || 0]);

    let reveal;
    if (!pv) {
      reveal = `<div class="ol-role loading">Dealing your role…</div>`;
    } else {
      const facNames = (pv.knownFascists || []).map(onlineNameOf);
      if (pv.role === "liberal") {
        reveal = `<div class="ol-role liberal"><div class="ol-role-name">You are a <b>Liberal</b></div>` +
          `<div class="ol-role-sub">You have no secret information. Enact Liberal policies and work out who the Fascists are.</div></div>`;
      } else if (pv.role === "fascist") {
        const hit = pv.knownHitler ? onlineNameOf(pv.knownHitler) : "unknown";
        reveal = `<div class="ol-role fascist"><div class="ol-role-name">You are a <b>Fascist</b></div>` +
          `<div class="ol-role-sub">Hitler is <b>${escapeHtml(hit)}</b>.` +
          (facNames.length ? ` Your fellow Fascist${facNames.length > 1 ? "s" : ""}: <b>${facNames.map(escapeHtml).join(", ")}</b>.` : ` You are the only regular Fascist.`) +
          ` Help Fascist policies pass and get Hitler elected Chancellor — without being spotted.</div></div>`;
      } else { // hitler
        reveal = `<div class="ol-role hitler"><div class="ol-role-name">You are <b>Hitler</b></div>` +
          (facNames.length
            ? `<div class="ol-role-sub">Your Fascist ally: <b>${facNames.map(escapeHtml).join(", ")}</b>. Stay hidden — if you're executed, the Liberals win.</div>`
            : `<div class="ol-role-sub">You don't know your Fascists (7+ players). Play like a Liberal, stay unsuspected, and get elected Chancellor after 3 Fascist policies.</div>`) +
          `</div>`;
      }
    }

    const seats = seatOrder.map((uid, i) =>
      `<div class="ol-seat${i === (t.firstPres || 0) ? " first" : ""}">` +
      `<span class="ol-seat-n">${i + 1}</span>${escapeHtml(onlineNameOf(uid))}` +
      (i === (t.firstPres || 0) ? `<span class="ol-badge">first President</span>` : "") +
      `</div>`).join("");

    box.innerHTML =
      `<div class="online-head"><h2 class="online-title">Night phase</h2>` +
      `<p class="online-tagline">Keep your screen to yourself. This is your secret role.</p></div>` +
      reveal +
      `<div class="online-sub">Seating &amp; first President</div>` +
      `<div class="ol-seats">${seats}</div>` +
      `<div class="online-hint">${escapeHtml(firstName)} is the first President. When everyone has seen their role, the host begins.</div>` +
      (O.isHost
        ? `<div class="control-row"><button id="olBegin" class="primary">Begin game</button>` +
          `<button id="olEnd" class="ghost-danger">End game</button></div>`
        : `<div class="online-hint">Waiting for the host to begin the game.</div>` +
          `<div class="control-row"><button id="olLeave" class="ghost">Leave</button></div>`);
    if ($("olBegin")) $("olBegin").onclick = async () => { $("olBegin").disabled = true; const r = await O.beginPlay(); if (!r.ok) { $("olBegin").disabled = false; showToast(r.message); } };
    if ($("olEnd")) $("olEnd").onclick = () => askConfirm(
      { title: "End this game?", body: "The game closes for everyone.", confirm: "End game", cancel: "Keep going", danger: true },
      async () => { await O.abortTable(); });
    if ($("olLeave")) $("olLeave").onclick = async () => { await O.leaveTable(); };
  }

  // -- live game: board + table + the current step's controls -----------------
  const CLAIM_LABELS = ["Coal · 3F", "Golden · 2F 1L", "Silver · 1F 2L", "Bronze · 3L"]; // index = #liberals claimed
  let olForm = { discard: null }; // transient President discard selection

  // Fascist odds per seat, reusing the analyzer — computed by briefly swapping in
  // an online-derived review state (restored immediately). Only when the setting
  // is on, and never mid-secret (public events only, so nothing leaks).
  function onlineSeatOdds(t) {
    if (!settings.boardOdds || !window.Honesty) return null;
    const saved = state;
    try {
      state = {
        players: t.seatOrder.map((u) => ({ name: t.names[u] || "?", dead: (t.deadUids || []).indexOf(u) >= 0 })),
        events: t.events || [], firstPres: 0, roundMods: {}, form: {}, review: true,
      };
      const ri = computeRoleOdds();
      return ri && ri.pFascist ? ri.pFascist : null;
    } catch (e) { return null; } finally { state = saved; }
  }

  function olBoard(t) {
    const fac = [];
    for (let i = 0; i < 6; i++) fac.push(`<span class="olp f${i < t.facEnacted ? " on" : ""}">${i === 5 ? "WIN" : ""}</span>`);
    const lib = [];
    for (let i = 0; i < 5; i++) lib.push(`<span class="olp l${i < t.libEnacted ? " on" : ""}"></span>`);
    const dots = [0, 1, 2].map((i) => `<span class="oltrk${i < t.tracker ? " on" : ""}"></span>`).join("");
    return `<div class="ol-board">` +
      `<div class="ol-track"><span class="ol-track-lbl">Fascist</span><div class="ol-slots">${fac.join("")}</div></div>` +
      `<div class="ol-track"><span class="ol-track-lbl">Liberal</span><div class="ol-slots">${lib.join("")}</div></div>` +
      `<div class="ol-meta"><span>Tracker ${dots}</span><span class="muted">Draw ${t.deckCount || 0} · Discard ${t.discardCount || 0}</span></div>` +
      `</div>`;
  }

  function olSeats(t, over) {
    const odds = over ? null : onlineSeatOdds(t);
    const tl = t.termLimited || [];
    const lastVotes = (t.lastElection && t.lastElection.votes) || null;
    return `<div class="ol-players">` + t.seatOrder.map((uid, i) => {
      const dead = (t.deadUids || []).indexOf(uid) >= 0;
      const isP = uid === t.presUid, isC = uid === t.chancellorUid, isNom = uid === t.nomineeUid;
      let roleCls = "", roleTag = "";
      if (over && t.roleOf) {
        const r = t.roleOf[uid];
        roleCls = r === "hitler" ? " r-hit" : r === "fascist" ? " r-fac" : " r-lib";
        roleTag = `<span class="ol-rt">${r === "hitler" ? "Hitler" : r === "fascist" ? "Fascist" : "Liberal"}</span>`;
      }
      const badges =
        (isP ? `<span class="ol-b p">P</span>` : "") +
        (isC ? `<span class="ol-b c">C</span>` : "") +
        (isNom && !isC ? `<span class="ol-b n">nominee</span>` : "") +
        (tl.indexOf(uid) >= 0 && !over ? `<span class="ol-b tl">termed</span>` : "") +
        (dead ? `<span class="ol-b d">💀</span>` : "");
      const vote = lastVotes && uid in lastVotes ? `<span class="ol-vote ${lastVotes[uid]}">${lastVotes[uid] === "ja" ? "Ja" : "Nein"}</span>` : "";
      const oddsChip = odds && odds[i] != null && !dead
        ? `<span class="ol-odds ${odds[i] >= 0.66 ? "hi" : odds[i] >= 0.4 ? "mid" : "lo"}">${Math.round(odds[i] * 100)}%</span>` : "";
      return `<div class="ol-player${dead ? " dead" : ""}${roleCls}">` +
        `<span class="ol-pn">${i + 1}. ${escapeHtml(t.names[uid] || "Player")}</span>` +
        `<span class="ol-pbadges">${badges}${vote}${oddsChip}${roleTag}</span></div>`;
    }).join("") + `</div>`;
  }

  function olHistory(t) {
    const evs = (t.events || []);
    if (!evs.length) return "";
    const nm = (i) => escapeHtml((t.names[t.seatOrder[i]] || "?"));
    const rows = evs.map((e) => {
      const ty = e.type || "gov";
      if (ty === "gov") {
        const pol = e.vetoed ? "vetoed" : (e.enacted === "F" ? "Fascist" : e.enacted === "L" ? "Liberal" : "—");
        const claim = CLAIM_LABELS[e.claimLibs] ? " · claim " + CLAIM_LABELS[e.claimLibs].split(" · ")[1] : "";
        const pw = e.power ? " · " + e.power.type.replace("-", " ") : "";
        return `<div class="ol-hrow"><b>${nm(e.presidentIdx)}</b> → ${nm(e.chancellorIdx)}: <span class="${e.enacted === "F" ? "c-fac" : "c-lib"}">${pol}</span>${claim}${pw}</div>`;
      }
      if (ty === "fail") return `<div class="ol-hrow muted">${nm(e.presidentIdx)}’s government failed</div>`;
      if (ty === "chaos") return `<div class="ol-hrow">Chaos: <span class="${e.enacted === "F" ? "c-fac" : "c-lib"}">${e.enacted === "F" ? "Fascist" : "Liberal"}</span> topdecked</div>`;
      if (ty === "hitler") return `<div class="ol-hrow c-fac">Hitler (${nm(e.chancellorIdx)}) elected Chancellor</div>`;
      return "";
    }).join("");
    return `<div class="online-sub">History</div><div class="ol-history">${rows}</div>`;
  }

  function olMyInfo(pv, t) {
    if (!pv || !pv.role) return "";
    const nm = (uid) => escapeHtml(t.names[uid] || "?");
    let s = `<div class="ol-myrole ${pv.role}">You are <b>${pv.role === "hitler" ? "Hitler" : pv.role === "fascist" ? "Fascist" : "Liberal"}</b>`;
    if (pv.role === "fascist") s += ` · Hitler: ${pv.knownHitler ? nm(pv.knownHitler) : "?"}` + (pv.knownFascists.length ? ` · Fascists: ${pv.knownFascists.map(nm).join(", ")}` : "");
    if (pv.role === "hitler" && pv.knownFascists.length) s += ` · Fascist: ${pv.knownFascists.map(nm).join(", ")}`;
    s += `</div>`;
    (pv.learned || []).forEach((l) => {
      if (l.type === "investigate") s += `<div class="ol-learned">🔍 You investigated <b>${nm(l.target)}</b>: <b class="${l.party === "Fascist" ? "c-fac" : "c-lib"}">${l.party}</b></div>`;
      if (l.type === "peek") s += `<div class="ol-learned">👁 You peeked the top 3: ${l.cards.map((c) => `<b class="${c === "F" ? "c-fac" : "c-lib"}">${c}</b>`).join(" ")}</div>`;
    });
    return s;
  }

  function renderOnlinePlaying(box, O) {
    const t = O.table, pv = O.myPrivate || {};
    const meUid = O.me && O.me.uid;
    const over = t.phase === "gameover" || t.status === "finished";
    box.innerHTML =
      `<div class="online-head"><h2 class="online-title">${escapeHtml(activeGroupLabel())}</h2></div>` +
      olBoard(t) +
      olSeats(t, over) +
      `<div id="olAction" class="ol-action"></div>` +
      olMyInfo(pv, t) +
      olHistory(t);
    renderOnlineAction(t, pv, meUid, O, over);
  }

  function renderOnlineAction(t, pv, meUid, O, over) {
    const wrap = $("olAction");
    if (!wrap) return;
    const nm = (uid) => escapeHtml(t.names[uid] || "Player");
    const isPres = meUid === t.presUid;
    const alive = (t.deadUids || []).indexOf(meUid) < 0;
    const waiting = (who) => `<div class="online-hint">Waiting for <b>${nm(who)}</b>${who === t.presUid ? " (President)" : ""}…</div>`;
    const send = async (a, btn) => { if (btn) btn.disabled = true; const r = await O.submitAction(a); if (!r.ok) { if (btn) btn.disabled = false; showToast(r.message || "Couldn't do that."); } };

    if (over) {
      const win = t.winner || "?";
      wrap.innerHTML =
        `<div class="ol-over ${win === "Fascist" ? "c-fac" : "c-lib"}">${escapeHtml(win)}s win</div>` +
        `<div class="online-hint">${escapeHtml(t.winReason || "")} The game has been recorded to ${escapeHtml(activeGroupLabel())} — find it in Statistics.</div>` +
        `<div class="control-row"><button id="olToStats" class="primary">View in Statistics</button>` +
        (O.isHost ? `<button id="olEnd" class="ghost">Close table</button>` : `<button id="olLeave" class="ghost">Leave</button>`) + `</div>`;
      if ($("olToStats")) $("olToStats").onclick = () => { O.leaveTable(); openStats(); };
      if ($("olEnd")) $("olEnd").onclick = async () => { await O.abortTable(); };
      if ($("olLeave")) $("olLeave").onclick = async () => { await O.leaveTable(); };
      return;
    }

    const phase = t.phase;
    if (phase === "nominate") {
      if (isPres) {
        const tl = t.termLimited || [];
        const opts = t.seatOrder.filter((u) => u !== meUid && (t.deadUids || []).indexOf(u) < 0 && tl.indexOf(u) < 0);
        wrap.innerHTML = `<div class="ol-prompt">You are President. Nominate a Chancellor:</div>` +
          `<div class="ol-choices">${opts.map((u) => `<button class="ol-choice" data-u="${escapeHtml(u)}">${nm(u)}</button>`).join("")}</div>`;
        wrap.querySelectorAll(".ol-choice").forEach((b) => b.onclick = () => send({ type: "nominate", target: b.dataset.u }, b));
      } else wrap.innerHTML = waiting(t.presUid);
    } else if (phase === "vote") {
      const voted = (t.votedUids || []).indexOf(meUid) >= 0;
      const head = `<div class="ol-prompt">Vote on President <b>${nm(t.presUid)}</b> & Chancellor <b>${nm(t.nomineeUid)}</b> — ${(t.votedUids || []).length}/${t.seatOrder.length - (t.deadUids || []).length} in</div>`;
      if (alive && !voted) {
        wrap.innerHTML = head + `<div class="control-row"><button id="olJa" class="primary">Ja</button><button id="olNein" class="ghost-danger">Nein</button></div>`;
        $("olJa").onclick = (e) => send({ type: "vote", vote: "ja" }, e.target);
        $("olNein").onclick = (e) => send({ type: "vote", vote: "nein" }, e.target);
      } else wrap.innerHTML = head + `<div class="online-hint">${voted ? "Your vote is in — waiting for the rest." : "Waiting for the vote."}</div>`;
    } else if (phase === "president_play") {
      if (isPres && pv.drawn) {
        const cards = pv.drawn;
        if (olForm.discard == null) {
          wrap.innerHTML = `<div class="ol-prompt">You drew these 3. Choose ONE to discard:</div>` +
            `<div class="ol-cards">${cards.map((c, i) => `<button class="ol-card ${c === "F" ? "f" : "l"}" data-i="${i}">${c === "F" ? "Fascist" : "Liberal"}</button>`).join("")}</div>`;
          wrap.querySelectorAll(".ol-card").forEach((b) => b.onclick = () => { olForm.discard = +b.dataset.i; renderOnlineAction(t, pv, meUid, O, over); });
        } else {
          const kept = cards.filter((_, i) => i !== olForm.discard);
          const trueLibs = cards.filter((c) => c === "L").length;
          wrap.innerHTML = `<div class="ol-prompt">Passing <b>${kept.map((c) => c === "F" ? "Fascist" : "Liberal").join(" + ")}</b> to ${nm(t.chancellorUid)}. Announce the hand you claim you drew (you may bluff):</div>` +
            `<div class="ol-choices">${CLAIM_LABELS.map((lbl, k) => `<button class="ol-choice${k === trueLibs ? " truth" : ""}" data-k="${k}">${lbl}${k === trueLibs ? " ✓" : ""}</button>`).join("")}</div>` +
            `<div class="control-row"><button id="olRepick" class="ghost">↩ Re-pick discard</button></div>`;
          wrap.querySelectorAll(".ol-choice").forEach((b) => b.onclick = () => { const d = olForm.discard; olForm.discard = null; send({ type: "president_play", discard: d, claim: +b.dataset.k }, b); });
          $("olRepick").onclick = () => { olForm.discard = null; renderOnlineAction(t, pv, meUid, O, over); };
        }
      } else wrap.innerHTML = waiting(t.presUid);
    } else if (phase === "chancellor_play") {
      if (meUid === t.chancellorUid && pv.passed) {
        const cards = pv.passed;
        wrap.innerHTML = `<div class="ol-prompt">You were passed these 2. Enact ONE:</div>` +
          `<div class="ol-cards">${cards.map((c, i) => `<button class="ol-card ${c === "F" ? "f" : "l"}" data-i="${i}">Enact ${c === "F" ? "Fascist" : "Liberal"}</button>`).join("")}</div>` +
          (t.facEnacted >= 5 ? `<div class="control-row"><button id="olVeto" class="ghost-danger">Propose veto</button></div>` : "");
        wrap.querySelectorAll(".ol-card").forEach((b) => b.onclick = () => send({ type: "chancellor_play", enact: +b.dataset.i }, b));
        if ($("olVeto")) $("olVeto").onclick = (e) => send({ type: "chancellor_play", veto: true }, e.target);
      } else wrap.innerHTML = waiting(t.chancellorUid);
    } else if (phase === "veto") {
      if (isPres) {
        wrap.innerHTML = `<div class="ol-prompt">${nm(t.chancellorUid)} proposes to VETO this agenda. Agree?</div>` +
          `<div class="control-row"><button id="olVy" class="primary">Agree — discard both</button><button id="olVn" class="ghost">Refuse</button></div>`;
        $("olVy").onclick = (e) => send({ type: "veto", agree: true }, e.target);
        $("olVn").onclick = (e) => send({ type: "veto", agree: false }, e.target);
      } else wrap.innerHTML = waiting(t.presUid);
    } else if (phase.indexOf("power_") === 0) {
      const kind = phase.slice(6);
      if (isPres) {
        if (kind === "peek") {
          const peek = (pv.learned || []).filter((l) => l.type === "peek").slice(-1)[0];
          wrap.innerHTML = `<div class="ol-prompt">Policy Peek — the top 3 cards are ${peek ? peek.cards.map((c) => `<b class="${c === "F" ? "c-fac" : "c-lib"}">${c === "F" ? "F" : "L"}</b>`).join(" ") : "…"}</div>` +
            `<div class="control-row"><button id="olPk" class="primary">Continue</button></div>`;
          $("olPk").onclick = (e) => send({ type: "power" }, e.target);
        } else {
          const label = kind === "investigate" ? "Investigate a player's party" : kind === "special" ? "Choose the next President" : "Execute a player";
          const opts = t.seatOrder.filter((u) => u !== meUid && (t.deadUids || []).indexOf(u) < 0 && (kind !== "investigate" || (t.investigatedUids || []).indexOf(u) < 0));
          wrap.innerHTML = `<div class="ol-prompt">${label}:</div><div class="ol-choices">${opts.map((u) => `<button class="ol-choice" data-u="${escapeHtml(u)}">${nm(u)}</button>`).join("")}</div>`;
          wrap.querySelectorAll(".ol-choice").forEach((b) => b.onclick = () => send({ type: "power", target: b.dataset.u }, b));
        }
      } else {
        const label = kind === "investigate" ? "investigating a player" : kind === "special" ? "calling a special election" : kind === "peek" ? "peeking at the deck" : "choosing who to execute";
        wrap.innerHTML = `<div class="online-hint"><b>${nm(t.presUid)}</b> is ${label}…</div>`;
      }
    }
    // reset the President's transient discard selection if we've moved on
    if (phase !== "president_play") olForm.discard = null;
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
    renderRosterChips();
  }

  // Tap-to-add suggestions from the active group's roster. Typing a new name
  // still works exactly as before — that name simply joins the roster when the
  // game syncs, so nothing here is required.
  function renderRosterChips() {
    const wrap = $("rosterChips");
    const head = $("groupBanner");
    if (!wrap || !head) return;
    const c = cloud();
    head.textContent = c && c.user ? `Recording into: ${activeGroupLabel()}` : "";
    head.classList.toggle("hidden", !(c && c.user));

    const taken = new Set(setupPlayers.map((p) => p.trim().toLowerCase()));
    const roster = c && c.user ? c.members() : [];
    const avail = roster
      .map((m) => m.displayName)
      .filter((nm) => nm && !taken.has(nm.trim().toLowerCase()));
    if (!avail.length || setupPlayers.length >= 10) { wrap.innerHTML = ""; wrap.classList.add("hidden"); return; }
    wrap.classList.remove("hidden");
    wrap.innerHTML =
      `<span class="muted roster-lbl">Tap to add:</span>` +
      avail.map((nm) => `<button class="roster-chip" data-name="${escapeHtml(nm)}">${escapeHtml(nm)}</button>`).join("");
    wrap.querySelectorAll(".roster-chip").forEach((b) => {
      b.onclick = () => {
        if (setupPlayers.length >= 10) return;
        setupPlayers.push(b.dataset.name);
        renderSetup();
      };
    });
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
    renderBackTop();
    // the night narration only makes sense at the very start of a live game —
    // before the first presidency (empty event log). Once anything is recorded,
    // or while reviewing / recording roles, hide it.
    const nb = $("btnNight");
    if (nb) nb.classList.toggle("hidden", !!(state.review || state.recordingRoles || (state.events && state.events.length > 0)));
    fitCenterBoards();
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
      backBtn("goBack") +
      `<div class="power-title"><span class="${cls}">${g.winner}s win!</span></div>` +
      `<p style="font-size:15px">${escapeHtml(g.reason)} The game is over.</p>` +
      `<p class="muted" style="font-size:13px">Record who was Hitler and the Fascists to save this game to your statistics.</p>` +
      `<div class="control-row"><button id="goEnd" class="primary">Record roles →</button></div>`;
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
      lockReviewRoundsBar(bar); // reserve a stable height BEFORE reading scrollHeight
      bar.scrollTop = bar.scrollHeight; // keep the current (last) round in view
    } else {
      bar.style.minHeight = ""; // phone strip is horizontal — no vertical reserve
      if (bar.parentElement !== playTab || playTab.firstElementChild !== bar) {
        playTab.insertBefore(bar, playTab.firstElementChild);
      }
      bar.scrollLeft = bar.scrollWidth; // current round in view on the phone's top strip
    }
  }

  // During a review, stepping back/forward adds or removes round blocks. On
  // desktop the rounds strip is a VERTICAL column sitting above the playback
  // controls, so that height change would shift the ◀ ▶ box under the cursor —
  // exactly the jitter that makes rapid clicking miss. Pin the strip to the FULL
  // game's height (measured once at the full step, where it's as tall as it ever
  // gets, and capped by the CSS max-height). Blocks still disappear as you step
  // back, but the box beneath never moves. Outside a review we clear the reserve,
  // so normal play is unchanged; phones are handled by placeRoundsBar (a
  // horizontal strip, whose height doesn't change with the number of rounds).
  function lockReviewRoundsBar(bar) {
    if (!state || !state.review) { bar.style.minHeight = ""; return; }
    const full = (state._reviewEvents || []).length;
    if (state.reviewStep >= full) {
      bar.style.minHeight = "";               // measure the natural full-extent height
      state._roundsReserve = bar.clientHeight; // clientHeight already respects max-height
    }
    if (state._roundsReserve) bar.style.minHeight = state._roundsReserve + "px";
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
    // During a review PLAYBACK we deliberately hide the true roles (so the live
    // fascist odds can be watched evolving) and instead highlight the President
    // and Chancellor of the step just revealed — the last event in the slice.
    const pb = !!state.playback;
    let pbPres = null, pbChan = null;
    if (pb && state.events.length) {
      const e = state.events[state.events.length - 1];
      const t = e.type || "gov";
      if (t === "gov" || t === "hitler") { pbPres = e.presidentIdx; pbChan = e.chancellorIdx; }
      else if (t === "fail") pbPres = e.presidentIdx; // chaos has no actors
    }
    // known/assigned roles color the circles (recording, review, or saved game).
    // Suppressed during playback — the reveal is the final step.
    const roles = pb ? null : (state.result || (state.recordingRoles ? state.roleDraft : null));
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
        const presHi = pb ? pbPres : d.presIdx;
        const chanHi = pb ? pbChan : chanIdx;
        if (i === presHi) node.classList.add("pres");
        if (i === chanHi) node.classList.add("chan");
        // ineligible as Chancellor this turn (term-limited by the last government).
        // The sitting President is never marked — they can't be Chancellor regardless.
        // Term-limit dashes describe the NEXT turn, so they're irrelevant mid-replay.
        if (!pb && d.termLimited.has(i) && i !== d.presIdx) node.classList.add("termed");
      }
      if (p.dead) node.classList.add("dead");
      node.style.left = x + "%";
      node.style.top = y + "%";
      node.onclick = () => setChancellor(i);

      // Accessibility: a seat is a plain informational token unless a tap would
      // act on it (live play, not the sitting president, not dead) — then it is a
      // keyboard-operable button. The aria-label narrates the seat's whole state so
      // a screen-reader user gets the same read as the visual badges/colours.
      const a11yPres = (pb ? pbPres : d.presIdx) === i;
      const a11yChan = (pb ? pbChan : chanIdx) === i;
      const lbl = [`Seat ${i + 1}`, p.name];
      if (roles) lbl.push(i === roles.hitlerIdx ? "Hitler" : (roles.fascistIdxs || []).includes(i) ? "Fascist" : "Liberal");
      else {
        if (a11yPres) lbl.push("President");
        else if (a11yChan) lbl.push("Chancellor");
        if (!pb && d.termLimited.has(i) && i !== d.presIdx) lbl.push("term-limited");
      }
      if (p.dead) lbl.push("executed");
      if (!roles && (settings.boardOdds || pb) && d.roleOdds && d.roleOdds[i] != null)
        lbl.push(Math.round(d.roleOdds[i] * 100) + "% fascist");
      const seatActive = !busy() && !p.dead && i !== d.presIdx;
      if (seatActive) {
        lbl.push("press Enter to set as Chancellor");
        node.setAttribute("role", "button");
        node.tabIndex = 0;
        node.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); setChancellor(i); }
        };
      } else {
        node.setAttribute("role", "img");
      }
      node.setAttribute("aria-label", lbl.join(", "));

      // one row per presidency: [3 cards | odds + details]. Consecutive failed
      // elections (with no passed presidency between them) share a single row of
      // side-by-side ✕✕ to save vertical space; a passed presidency splits the run,
      // so its ✕s sit above/below that row.
      const evs = d.eventsByPlayer[i] || [];
      const rows = [];
      let ei = 0;
      while (ei < evs.length) {
        if (evs[ei].type === "fail") {
          let cnt = 0;
          while (ei < evs.length && evs[ei].type === "fail") (cnt++, ei++);
          const xs = Array.from({ length: cnt }, () => `<span class="fail-x">✕</span>`).join("");
          rows.push(`<div class="pres-row fail-row">${xs}</div>`);
        } else {
          const ev = evs[ei++];
          const cards = [];
          for (let k = 0; k < 3; k++) cards.push(k < 3 - ev.libs ? "F" : "L");
          const hand =
            `<div class="miniHand${ev.vetoed ? " vetoed" : ""}">` +
            cards.map((c) => `<div class="miniCard ${c}"></div>`).join("") +
            `</div>`;
          const side = `<div class="odds">${Prob.fmtPct(ev.prob)}</div>` + presDetails(ev, d.round);
          rows.push(`<div class="pres-row">${hand}<div class="pres-side">${side}</div></div>`);
        }
      }
      const extra = rows.join("");

      let badge = "";
      if (!roles) {
        const presHi = pb ? pbPres : d.presIdx;
        const chanHi = pb ? pbChan : chanIdx;
        if (i === presHi) badge = `<span class="role-badge p" title="President">P</span>`;
        else if (i === chanHi) badge = `<span class="role-badge c" title="Chancellor">C</span>`;
      }

      // Live fascist-odds chip on the circle: opt-in on the live table
      // (`boardOdds`), but always shown while replaying a review, since the
      // point of the stepper is to watch the odds move. Only while roles are
      // hidden — a revealed circle is coloured instead.
      let oddsChip = "";
      if (!roles && (settings.boardOdds || pb) && d.roleOdds && d.roleOdds[i] != null) {
        const p0 = d.roleOdds[i];
        const cls = p0 >= 0.6 ? "hi" : p0 >= 0.35 ? "mid" : "lo";
        oddsChip = `<span class="seat-odds ${cls}" title="Model estimate that ${escapeHtml(p.name)} is on the Fascist team, from play so far. Not a measurement.">${Math.round(p0 * 100)}%</span>`;
      }

      node.innerHTML =
        `<div class="seat-head">` +
        `<div class="avatar">${escapeHtml(initials(p.name))}${badge}${
          p.dead ? `<span class="skull">💀</span>` : ""
        }</div>` +
        `<div class="name">${escapeHtml(p.name)}${i === state.firstPres ? " ·①" : ""}</div>` +
        oddsChip +
        `</div>` +
        `<div class="seat-pres"><div class="pres-stack">${extra}</div></div>`;
      area.appendChild(node);
    });
    // Each seat reserves room for 3 presidencies; if a seat's stack is taller than
    // that slot (a 3rd presidency, or tall detail chips), shrink it to fit so no
    // presidency data is ever clipped or lost.
    fitPresStacks(area);
  }

  // Keep the centre boards clear of the felt's edges. The tracks are sized from
  // their width (aspect-ratio slots), so on short/wide windows they can grow
  // taller than the felt — scale them down to fit rather than overlapping it.
  function fitCenterBoards() {
    const cb = document.querySelector("#tableArea .center-boards");
    const felt = document.querySelector("#tableArea .felt");
    if (!cb || !felt) return;
    cb.style.transform = "translate(-50%, -50%)"; // reset before measuring
    // Phones deliberately run the board nearly edge-to-edge inside a shallow felt,
    // so only the desktop layout is clamped.
    if (window.innerWidth <= 640) return;
    const fr = felt.getBoundingClientRect();
    const cr = cb.getBoundingClientRect();
    if (!fr.height || !cr.height) return;
    // Height only: the phone layout deliberately runs the board nearly edge-to-edge
    // (piles hugging the screen sides), so horizontal width is never clamped here.
    const availH = fr.height - 22 * 2; // clearance inside the felt (incl. its border)
    if (cr.height > availH && availH > 0) {
      cb.style.transform = `translate(-50%, -50%) scale(${availH / cr.height})`;
    }
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
    // Veto unlocks at 5 fascist policies; "Chancellor was Hitler" is only a win
    // once 3 fascist policies are down.
    const vetoOn = d.fac >= 5;
    $("btnVeto").classList.toggle("hidden", !vetoOn);
    $("btnVeto").classList.toggle("on", vetoOn && !!state.form.vetoArmed);
    $("btnConflict").disabled = vetoOn && !!state.form.vetoArmed;
    $("btnHitlerChan").classList.toggle("hidden", d.fac < 3);
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
    const ri = computeRoleOdds() || {};
    const record = {
      players: state.players.map((p) => ({ name: p.name })),
      playerCount: state.players.length,
      firstPres: state.firstPres,
      events: state.events,
      roundMods: state.roundMods,
      result: { winner, hitlerIdx: state.roleDraft.hitlerIdx, fascistIdxs: state.roleDraft.fascistIdxs.slice() },
      // The model's fascist/Hitler-odds estimate from gameplay alone (the recorded
      // roles above are the ground TRUTH — storing the prediction beside them is
      // what lets the model be calibrated later; see HONESTY_MODEL.md §7). Computed
      // unconditionally so the snapshot is permanent regardless of the setting.
      roleOdds: ri.pFascist || null,
      roleHitler: ri.pHitler || null,
      date: new Date().toISOString(),
      // Which group this game belongs to. Null when signed out — sync assigns it
      // to whatever group is active when the game is eventually uploaded.
      groupId: (cloud() && cloud().groupId) || null,
      // Remember who recorded it, so the "edit roles" affordance shows for them
      // right away (not only after the upload round-trip). Null when signed out.
      createdBy: (cloud() && cloud().user && cloud().user.uid) || null,
    };
    Stats.recordGame(record);
    goHome(); // back to the main menu, not the players list
    showToast("Game saved to statistics.");
    // cloud.js listens for this and syncs; a no-op when signed out or offline.
    document.dispatchEvent(new CustomEvent("game:recorded", { detail: { id: record.id } }));
  }

  // ------------------------------ review a saved game ------------------------
  function openReview(id) {
    const games = Stats.loadGames().filter((g) => g.result);
    const g = games.find((x) => x.id === id);
    if (!g) return;
    if (state) stashedState = state;
    state = {
      players: g.players.map((p) => ({ name: p.name, dead: false })),
      firstPres: g.firstPres || 0,
      events: g.events || [],
      roundMods: g.roundMods || {},
      form: { chanIdxOverride: null, conflictArmed: false, vetoArmed: false },
      result: g.result,
      review: true,
      recordingRoles: false,
      pendingChaos: false,
      pendingPower: null,
      gameOver: null,
      roleDraft: { hitlerIdx: null, fascistIdxs: [] },
      undoStack: [],
      _reviewGame: g,
      // Chronological playback: `reviewStep` = how many events are revealed
      // (0..N). It opens at the end (the reveal — true roles + who won, the
      // review's original behaviour); the stepper walks it back and forth.
      // `playback` is true whenever we're short of the end, which is what
      // switches the table from role colours to the live P(fascist) read.
      _reviewEvents: g.events || [],
      reviewStep: (g.events || []).length,
      playback: false,
    };
    show("gameScreen");
    switchTab("play");
    renderGame();
  }

  // Move the review to a given step (number of events revealed). Everything is
  // derived from `state.events`, so truncating it and re-rendering rewinds the
  // whole board — table, policy tracks, piles, history and the role model — to
  // that moment. The saved game is never touched (review never persists).
  function reviewGoto(step) {
    if (!state || !state.review) return;
    const full = state._reviewEvents || [];
    step = clamp(step, 0, full.length);
    state.reviewStep = step;
    state.playback = step < full.length; // at the end ⇒ reveal the true roles
    state.events = full.slice(0, step);
    renderGame();
  }

  function closeReview() {
    state = stashedState;
    stashedState = null;
    // a review is always opened from the Statistics page — return to it
    renderStatsInto($("statsBody"));
    show("statsScreen");
  }

  // Delete the game currently being reviewed. Removes the cloud copy first (so a
  // sync can't bring it back), then the local copy, then returns to Statistics.
  // Nothing is deleted until the user confirms, and a failed cloud delete aborts
  // the whole thing — the game stays intact everywhere rather than half-removed.
  function deleteReviewedGame() {
    const g = state && state._reviewGame;
    if (!g || !g.id) return;
    const c = cloud();
    const shared = !!(c && c.user && g.groupId);
    askConfirm(
      {
        title: "Delete this game?",
        body: shared
          ? "This removes the game from “" + escapeHtml(activeGroupLabel()) +
            "” for everyone in the group, and from your statistics. This can’t be undone."
          : "This permanently deletes this game from your statistics. This can’t be undone.",
        confirm: "Delete game",
        cancel: "Keep it",
        danger: true,
      },
      async () => {
        if (c && c.user) {
          const r = await c.deleteGame(g.id, g.groupId);
          if (!r || !r.ok) { showToast((r && r.message) || "Couldn’t delete this game — try again."); return; }
        }
        Stats.deleteGame(g.id);
        closeReview();
        showToast("Game deleted.");
      }
    );
  }

  // Only the person who recorded a game may correct its roles. Signed out, every
  // local game is "mine"; signed in, it's mine if I'm the author (or it's a local
  // unsynced game with no author on it yet). The rules enforce this server-side.
  function canEditReviewedGame(g) {
    if (!g || !g.id) return false;
    const c = cloud();
    if (!c || !c.user) return true;               // signed out → local games are mine
    if (g.createdBy) return g.createdBy === c.user.uid; // known author → only them
    return true; // author unknown (older/just-recorded game): allow — the security
                 // rules still reject a cloud write by a non-author, and a synced
                 // game backfills createdBy, so this only affects local edits.
  }

  const editFascistNeed = () => FASCIST_COUNT[state.players.length] || 1;
  function editDraftToResult() {
    const d = state.editRoles;
    return { winner: d.winner, hitlerIdx: d.hitlerIdx, fascistIdxs: d.fascistIdxs.slice() };
  }
  function enterEditRoles() {
    const r = state.result || {};
    reviewGoto((state._reviewEvents || []).length); // show the reveal while editing
    state._origResult = state.result;
    state.editRoles = { winner: r.winner || "Liberal", hitlerIdx: r.hitlerIdx == null ? null : r.hitlerIdx, fascistIdxs: (r.fascistIdxs || []).slice() };
    renderGame();
  }
  function cancelEditRoles() {
    state.result = state._origResult; state.editRoles = null; renderGame();
  }
  function toggleEditRole(role, i) {
    const d = state.editRoles, need = editFascistNeed();
    if (role === "hitler") {
      d.hitlerIdx = d.hitlerIdx === i ? null : i;
      d.fascistIdxs = d.fascistIdxs.filter((x) => x !== d.hitlerIdx);
    } else {
      if (i === d.hitlerIdx) return;
      const at = d.fascistIdxs.indexOf(i);
      if (at >= 0) d.fascistIdxs.splice(at, 1);
      else if (d.fascistIdxs.length < need) d.fascistIdxs.push(i);
    }
    state.result = editDraftToResult(); // live preview: recolour the table
    renderGame();
  }
  const editReady = () => {
    const d = state.editRoles;
    return d && d.winner && d.hitlerIdx != null && d.fascistIdxs.length === editFascistNeed();
  };
  async function saveEditRoles() {
    if (!editReady()) return;
    const g = state._reviewGame;
    const newResult = editDraftToResult();
    const c = cloud();
    // Cloud first for a synced game, so a failure aborts and nothing diverges.
    if (c && c.user && g.groupId) {
      const r = await c.updateGameResult(g.id, g.groupId, newResult);
      if (!r || !r.ok) { showToast((r && r.message) || "Couldn’t save — try again."); return; }
    }
    Stats.setResult(g.id, newResult);
    g.result = newResult; state._origResult = newResult; state.result = newResult;
    state.editRoles = null;
    renderGame();
    showToast("Roles updated.");
  }

  function renderRoleEditor(cp) {
    const players = state.players;
    const d = state.editRoles;
    const need = editFascistNeed();
    const pbtns = (role) => players.map((p, i) => {
      const sel = role === "hitler" ? d.hitlerIdx === i : d.fascistIdxs.indexOf(i) >= 0;
      return `<button class="role-pick ${role} ${sel ? "sel" : ""}" data-role="${role}" data-i="${i}">${escapeHtml(p.name)}</button>`;
    }).join("");
    cp.innerHTML =
      `<div class="role-panel">` +
      `<div class="role-title">Edit roles</div>` +
      `<div class="role-field"><label>Who won?</label> <span class="seg">` +
      `<button id="erLib" class="${d.winner === "Liberal" ? "sel L" : ""}">Liberal</button>` +
      `<button id="erFac" class="${d.winner === "Fascist" ? "sel F" : ""}">Fascist</button></span></div>` +
      `<div class="role-field"><label>Who was Hitler?</label><div class="role-btns">${pbtns("hitler")}</div></div>` +
      `<div class="role-field"><label>${need > 1 ? "Who were the " + need + " Fascists" : "Who was the Fascist"}? (${d.fascistIdxs.length}/${need})</label>` +
      `<div class="role-btns">${pbtns("fascist")}</div></div>` +
      `<div class="control-row"><button id="erSave" class="primary" ${editReady() ? "" : "disabled"}>Save changes</button>` +
      `<button id="erCancel" class="ghost">Cancel</button></div>` +
      `</div>`;
    cp.querySelectorAll(".role-pick").forEach((b) => b.onclick = () => toggleEditRole(b.dataset.role, +b.dataset.i));
    $("erLib").onclick = () => { d.winner = "Liberal"; state.result = editDraftToResult(); renderGame(); };
    $("erFac").onclick = () => { d.winner = "Fascist"; state.result = editDraftToResult(); renderGame(); };
    $("erSave").onclick = saveEditRoles;
    $("erCancel").onclick = cancelEditRoles;
  }

  function renderReviewPanel(cp, d) {
    const g = state._reviewGame;
    // Editing the recorded roles takes over the panel (author-only, at the reveal).
    if (state.editRoles) { renderRoleEditor(cp); return; }
    const full = state._reviewEvents || [];
    const N = full.length;
    const step = state.reviewStep;
    const atStart = step <= 0, atEnd = step >= N;

    // Playback controls: ⏮ ◀  k / N  ▶ ⏭  (arrow keys work too — see wire()).
    const controls =
      `<div class="pb-controls">` +
      `<button class="pb-btn" id="pbFirst" ${atStart ? "disabled" : ""} title="Jump to the start">⏮</button>` +
      `<button class="pb-btn" id="pbPrev" ${atStart ? "disabled" : ""} title="Previous turn (←)">◀</button>` +
      `<span class="pb-step">${step} / ${N}</span>` +
      `<button class="pb-btn" id="pbNext" ${atEnd ? "disabled" : ""} title="Next turn (→)">▶</button>` +
      `<button class="pb-btn" id="pbLast" ${atEnd ? "disabled" : ""} title="Jump to the end (reveal roles)">⏭</button>` +
      `</div>`;

    let body;
    if (atEnd) {
      // The reveal — the review's original summary (winner + true roles), plus
      // the stored model read scored against them.
      const r = g.result;
      const govs = full.filter((e) => (e.type || "gov") === "gov").length;
      const fails = full.filter((e) => e.type === "fail").length;
      const facNames = (r.fascistIdxs || []).map((i) => (g.players[i] ? escapeHtml(g.players[i].name) : "?")).join(", ");
      body =
        `<div class="role-winner ${r.winner === "Fascist" ? "c-fac" : "c-lib"}">${r.winner}s won</div>` +
        `<div class="review-stat"><b>${d.lib}</b> Liberal &middot; <b>${d.fac}</b> Fascist policies</div>` +
        `<div class="review-stat">${govs} governments &middot; ${fails} failed elections</div>` +
        `<div class="review-stat">Hitler: <b class="c-hit">${g.players[r.hitlerIdx] ? escapeHtml(g.players[r.hitlerIdx].name) : "?"}</b></div>` +
        `<div class="review-stat">Fascists: <b class="c-fac">${facNames || "—"}</b></div>` +
        roleOddsHtml(g.roleOdds, g.players, r) +
        `<div class="pb-hint">Step back with ◀ to replay the game turn by turn.</div>`;
    } else {
      // Mid-replay — describe the step just revealed and show the live read.
      body = reviewStepCaption(d) + livePlayerOdds(d);
    }

    // Label + favorite this game, and (with confirmation) delete it. These sit
    // at the bottom, step-independent, so they're reachable while replaying.
    const label = g.label ? `<div class="review-label">“${escapeHtml(g.label)}”</div>` : "";
    const actions =
      `<div class="review-actions">` +
      `<button id="btnFavGame" class="ghost">${g.favorite ? "★ Favorited" : "☆ Favorite"}</button>` +
      `<button id="btnLabelGame" class="ghost">${g.label ? "Rename" : "Add a label"}</button>` +
      (canEditReviewedGame(g) ? `<button id="btnEditRoles" class="ghost">Edit roles</button>` : "") +
      `<button id="btnDeleteGame" class="ghost-danger">Delete game</button>` +
      `</div>`;

    cp.innerHTML = `<div class="review-panel">${controls}${label}${body}${actions}</div>`;
    const go = (s) => reviewGoto(s);
    if ($("pbFirst")) $("pbFirst").onclick = () => go(0);
    if ($("pbPrev")) $("pbPrev").onclick = () => go(step - 1);
    if ($("pbNext")) $("pbNext").onclick = () => go(step + 1);
    if ($("pbLast")) $("pbLast").onclick = () => go(N);
    if ($("btnDeleteGame")) $("btnDeleteGame").onclick = deleteReviewedGame;
    if ($("btnEditRoles")) $("btnEditRoles").onclick = enterEditRoles;
    if ($("btnFavGame")) $("btnFavGame").onclick = () => {
      if (!g.id) return;
      g.favorite = !g.favorite;             // reflect immediately on the in-review copy
      setGameMeta(g.id, { favorite: g.favorite });
      renderGame();                         // re-render the panel with the new state
    };
    if ($("btnLabelGame")) $("btnLabelGame").onclick = () => {
      if (!g.id) return;
      promptText(
        "Name this game", "Give it a label so you can find it later.", "e.g. The 10-player comeback",
        (name) => { g.label = String(name || "").trim().slice(0, 60); setGameMeta(g.id, { label: g.label }); renderGame(); },
        g.label || ""
      );
    };
    // (leaving a review uses the shared top-left back arrow)
  }

  // A one-line description of the step just revealed: who governed, what they
  // enacted, and any power they used. Reuses powerAnnotation for the power text.
  function reviewStepCaption(d) {
    const step = state.reviewStep;
    const full = state._reviewEvents || [];
    if (step <= 0)
      return `<div class="pb-caption"><span class="muted">Game start — before the first government.</span></div>`;
    const ev = full[step - 1];
    const type = ev.type || "gov";
    const nm = (i) => (state.players[i] ? escapeHtml(state.players[i].name) : "?");
    let round = d.round + 1, line;
    if (type === "fail") {
      line = `<b>${nm(ev.presidentIdx)}</b>’s government <span class="c-fac">failed</span> to be elected.`;
    } else if (type === "chaos") {
      line = `⚠ <b>Chaos top-deck</b> — ${
        ev.enacted === "L" ? `<span class="c-lib">🟦 Liberal</span>` : `<span class="c-fac">🟥 Fascist</span>`
      } policy enacted.`;
    } else if (type === "hitler") {
      line = `⚑ <b>Hitler elected Chancellor</b>: ${nm(ev.presidentIdx)} → ${nm(ev.chancellorIdx)}. <span class="c-fac">Fascists win.</span>`;
    } else {
      // a gov: use its own round (a reshuffle may have advanced d.round since)
      const gInfo = d.gi.length ? d.gi[d.gi.length - 1] : null;
      if (gInfo) round = gInfo.round + 1;
      const ratio = RATIOS[ev.claimLibs];
      const enact = ev.vetoed
        ? `<span class="c-gold">⊘ vetoed — no policy</span>`
        : ev.enacted === "L"
        ? `<span class="c-lib">🟦 Liberal</span>`
        : `<span class="c-fac">🟥 Fascist</span>`;
      line =
        `<b>${nm(ev.presidentIdx)}</b> <span class="pb-role">P</span> → <b>${nm(ev.chancellorIdx)}</b> <span class="pb-role">C</span>: ` +
        `claimed <span class="ratio-name ${ratio.cls}">${ratio.name}</span> <span class="muted">(${ratio.sub})</span>, ` +
        `enacted ${enact}.${ev.conflict ? ` <span class="c-fac">⚔ conflict</span>` : ""}${powerAnnotation(ev.power)}`;
    }
    return `<div class="pb-caption"><span class="pb-round">Round ${round}</span> ${line}</div>`;
  }

  // The live model read at the current step: P(fascist) and its complement
  // P(liberal) per player, sorted most-suspect first, with a ♛ Hitler flag when
  // the Hitler suspicion is notable. NOT wrapped in `.lie-col` — the playback
  // always shows it, independent of the lie-detection switch (the user asked to
  // watch the odds move). Reuses the .ro-* styling of the stored role list.
  function livePlayerOdds(d) {
    if (!Array.isArray(d.roleOdds) || !d.roleOdds.some((x) => x != null))
      return `<div class="pb-hint muted">Role odds appear once there’s something to read.</div>`;
    const rows = state.players
      .map((p, i) => ({ i, name: p.name, f: d.roleOdds[i], h: d.roleHitler ? d.roleHitler[i] : null }))
      .filter((x) => x.f != null)
      .sort((a, b) => b.f - a.f);
    const body = rows
      .map((x) => {
        const pf = Math.round(x.f * 100), pl = 100 - pf;
        const cls = x.f >= 0.6 ? "lie-bad" : x.f >= 0.35 ? "lie-warn" : "lie-good";
        const hit =
          x.h != null && x.h >= 0.35
            ? ` <span class="ro-hit" title="Model’s suspicion this player is Hitler">♛${Math.round(x.h * 100)}%</span>`
            : "";
        return (
          `<div class="ro-row"><span class="ro-name">${escapeHtml(x.name)}</span>` +
          `<span class="ro-bar"><span class="ro-fill ${cls}" style="width:${pf}%"></span></span>` +
          `<span class="ro-pct ${cls}">${pf}%F</span><span class="ro-lib">${pl}%L</span>${hit}</div>`
        );
      })
      .join("");
    return (
      `<div class="role-odds">` +
      `<div class="ro-title">Model’s read after this turn <span class="muted">— fascist vs liberal, from play alone</span></div>` +
      body +
      `</div>`
    );
  }

  // The stored fascist-odds estimate as a ranked list. `truth` (a result with
  // hitlerIdx/fascistIdxs) is optional — when present, each row is marked ✓/✗
  // against who actually was fascist, which is the whole point of storing the
  // prediction beside the ground truth. Wrapped in `.lie-col` so it only shows
  // when lie detection is on. Wording stays about the MODEL, not accusations.
  function roleOddsHtml(roleOdds, players, truth) {
    if (!lieOn() || !Array.isArray(roleOdds) || !roleOdds.some((x) => x != null)) return "";
    const rows = roleOdds
      .map((p, i) => ({ i, p, name: players[i] ? players[i].name : "?" }))
      .filter((x) => x.p != null)
      .sort((a, b) => b.p - a.p);
    const wasFascist = (i) =>
      truth && (i === truth.hitlerIdx || (truth.fascistIdxs || []).includes(i));
    const body = rows
      .map((x) => {
        const pct = Math.round(x.p * 100);
        const cls = x.p >= 0.6 ? "lie-bad" : x.p >= 0.35 ? "lie-warn" : "lie-good";
        const mark = truth
          ? wasFascist(x.i)
            ? ` <span class="ro-hit" title="was on the Fascist team">✓ fascist</span>`
            : ` <span class="ro-miss" title="was a Liberal">✗ liberal</span>`
          : "";
        return (
          `<div class="ro-row"><span class="ro-name">${escapeHtml(x.name)}</span>` +
          `<span class="ro-bar"><span class="ro-fill ${cls}" style="width:${pct}%"></span></span>` +
          `<span class="ro-pct ${cls}">${pct}%</span>${mark}</div>`
        );
      })
      .join("");
    return (
      `<div class="role-odds lie-col">` +
      `<div class="ro-title">Model’s fascist read <span class="muted">— from play alone, not the recorded roles</span></div>` +
      body +
      `</div>`
    );
  }

  function renderGamesList(container) {
    if (!container) return;
    // Favorites float to the top; each box carries a ★ toggle and its label.
    const games = Stats.orderForDisplay(Stats.loadGames().filter((g) => g.result));
    if (!games.length) {
      container.innerHTML = `<span class="muted">No games recorded yet.</span>`;
      return;
    }
    container.innerHTML = games
      .map((g) => {
        const cls = g.result.winner === "Fascist" ? "gl-fac" : "gl-lib";
        const hit = g.players[g.result.hitlerIdx] ? g.players[g.result.hitlerIdx].name : "?";
        const facs = (g.result.fascistIdxs || [])
          .map((i) => (g.players[i] ? g.players[i].name : ""))
          .filter(Boolean);
        return (
          `<div class="game-box ${cls}${g.favorite ? " fav" : ""}" data-id="${escapeHtml(g.id)}" role="button" tabindex="0">` +
          `<span class="gl-star${g.favorite ? " on" : ""}" data-star="${escapeHtml(g.id)}" role="button" ` +
          `title="${g.favorite ? "Remove from favorites" : "Add to favorites"}" ` +
          `aria-label="${g.favorite ? "Remove from favorites" : "Add to favorites"}">${g.favorite ? "★" : "☆"}</span>` +
          (g.label ? `<div class="gl-label">${escapeHtml(g.label)}</div>` : "") +
          `<div class="gl-win">${g.result.winner} win</div>` +
          `<div class="gl-hitler">♛ ${escapeHtml(hit)}</div>` +
          `<div class="gl-facs">${facs.map((f) => `<span>${escapeHtml(f)}</span>`).join("")}</div>` +
          `</div>`
        );
      })
      .join("");
    // Star toggles favorite in place (and must not open the review).
    container.querySelectorAll(".gl-star").forEach((s) => {
      s.onclick = (e) => {
        e.stopPropagation();
        const id = s.dataset.star;
        const now = !Stats.loadAllGames().some((g) => g.id === id && g.favorite);
        setGameMeta(id, { favorite: now });
        renderGamesList(container);
      };
    });
    container.querySelectorAll(".game-box").forEach((b) => {
      b.onclick = () => openReview(b.dataset.id);
      b.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openReview(b.dataset.id); } };
    });
  }

  // Update a game's label/favorite: write it locally (source of truth on this
  // device) and mirror it to the user's per-account gameMeta so it follows them
  // to other devices. Never touches the immutable recorded game itself.
  function setGameMeta(id, patch) {
    if ("favorite" in patch) Stats.setFavorite(id, patch.favorite);
    if ("label" in patch) Stats.setLabel(id, patch.label);
    const c = cloud();
    if (c && c.user && c.setGameMeta) {
      const g = Stats.loadAllGames().find((x) => x.id === id) || {};
      c.setGameMeta(id, { label: g.label || "", favorite: !!g.favorite });
    }
  }

  // ---------------------------- lie detection (opt-in) -----------------------
  // Everything here renders into elements carrying `.lie-col`, which CSS hides
  // unless the body has `.lie-on` — so the feature leaves no trace when off.
  //
  // WORDING RULE (HONESTY_MODEL.md §11 F8): these are statements about the MODEL
  // and about CLAIMS, never a flat accusation. The maths is certain but the data
  // entry is not — a forgotten Conflict tap manufactures a contradiction, and the
  // app must not accuse a real person at a real table on the strength of a mis-tap.
  //
  // The History badge shows the PRESIDENT's fascist odds (the "% fascist" the user
  // asked for), plus a red flag when the round's cards make the claim provably
  // false. `presFasc` is that seat's P(fascist) from the role model (or null).
  function lieBadge(h, presFasc) {
    const parts = [];
    if (presFasc != null) {
      const cls = presFasc >= 0.6 ? "lie-bad" : presFasc >= 0.35 ? "lie-warn" : "lie-good";
      parts.push(
        `<span class="${cls}" title="Model estimate that this government's President is on the Fascist team, from play so far. Not a measurement.">${Math.round(presFasc * 100)}% fascist</span>`
      );
    }
    // hard claim-certainties still surface — a proven-false claim is prior-free.
    if (h && h.provenFalse)
      parts.push(`<span class="lie-bad" title="No possible deal of this round's cards makes this claim true — so it was false, or something was recorded wrong.">claim can’t be true</span>`);
    else if (h && h.impossibleStory)
      parts.push(`<span class="lie-bad" title="This claims a 1F2L hand passed as two liberals, yet a fascist policy was enacted — impossible. The hand or the pass is misstated.">story impossible</span>`);
    return parts.length ? ` <span class="lie-col lie-badge">${parts.join(" · ")}</span>` : "";
  }

  // A lie chip for a POWER claim (investigation / policy peek). The powers are
  // claims too: the president privately sees something (a party card, the top 3
  // cards) and announces it — and can lie. `pLie` in [0,1], or null = unverifiable.
  function lieClaimChip(pLie, title) {
    if (pLie == null)
      return ` <span class="lie-col lie-badge"><span class="muted" title="${title}">unverified</span></span>`;
    const cls = pLie >= 0.6 ? "lie-bad" : pLie >= 0.35 ? "lie-warn" : "lie-good";
    return ` <span class="lie-col lie-badge"><span class="${cls}" title="${title}">${Math.round(pLie * 100)}% likely a lie</span></span>`;
  }

  // The per-power lie estimate for a government's power claim, shown in History.
  //  • Investigation: P(target's true party ≠ the announced party) — which is just
  //    the target's fascist odds read the right way round.
  //  • Policy Peek: P(the peeked cards ≠ the claimed count) = 1 − P(the next
  //    government's hand had that many liberals), an independent check of the peek
  //    against the cards that were actually drawn.
  function powerLieChip(g, d) {
    if (!lieOn() || !g.power) return "";
    const p = g.power;
    if (p.type === "invest" && p.party && p.targetIdx != null && d.roleOdds && d.roleOdds[p.targetIdx] != null) {
      const tf = d.roleOdds[p.targetIdx];
      const pLie = p.party === "F" ? 1 - tf : tf; // announced F ⇒ lie iff target is Liberal
      return lieClaimChip(pLie,
        "Chance this investigation call is false — i.e. the target’s true party is not the one that was announced. Model estimate.");
    }
    if (p.type === "peek" && Array.isArray(p.order)) {
      const peekLibs = p.order.filter((c) => c === "L").length;
      const r = d.rounds[g.round] || {};
      const govList = r.govs || [];
      const pos = govList.findIndex((idx) => d.gi[idx] === g);
      const next = pos >= 0 && pos + 1 < govList.length ? d.gi[govList[pos + 1]] : null;
      if (next && next.honesty && next.honesty.handPosterior) {
        // the next government drew the peeked cards — check against its actual hand
        return lieClaimChip(Math.max(0, 1 - (next.honesty.handPosterior[peekLibs] || 0)),
          "Chance the peek was false, judged against the hand the next government actually drew. Model estimate.");
      }
      // nobody has drawn them yet — check the claim against the round pool by
      // conservation (catches an impossible claim, e.g. 3 liberals from a 2-liberal pool)
      const claims = govList.map((idx) => d.gi[idx].libs).concat(peekLibs);
      const chaosN = (r.chaosLib || 0) + (r.chaosFac || 0);
      const pt = Prob.retrospectiveProb(r.startN, r.startL, claims, claims.length - 1, chaosN, r.chaosLib || 0);
      const pLie = pt == null || Number.isNaN(pt) ? 1 : Math.max(0, 1 - pt);
      return lieClaimChip(pLie,
        "Chance the peek was false, checked against the cards left in the round pool. Sharpens once the next government draws. Model estimate.");
    }
    return "";
  }

  function renderLieSummary(d) {
    const el = $("lieSummary");
    if (!el) return;
    if (!lieOn()) { el.classList.add("hidden"); el.innerHTML = ""; return; }
    const lines = [];
    d.rounds.forEach((r) => {
      const h = r.honesty;
      if (!h || !h.govs.length) return;
      if (!h.feasible) {
        lines.push(`<b>Round ${r.index + 1}:</b> these claims cannot all be true — something was almost certainly recorded wrong.`);
      } else if (h.minLies > 0) {
        lines.push(
          `<b>Round ${r.index + 1}:</b> at least ${h.minLies} of these claim${h.minLies === 1 ? "" : "s"} must be false ` +
          `<span class="muted">(or was recorded wrong)</span>.`
        );
      }
    });
    const cur = d.rounds[d.round];
    const ev = cur && cur.honesty ? cur.honesty.evidence : null;
    if (ev === "weak")
      lines.push(`<span class="muted">This round has barely started — too many cards are still unseen for the percentages to mean much yet.</span>`);
    if (!lines.length)
      lines.push(`<span class="muted">Nothing in the claims so far is impossible.</span>`);
    el.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
    el.classList.remove("hidden");
  }

  function renderHistory(d) {
    renderLieSummary(d);
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
      } else if (ev.type === "hitler") {
        tr.className = "ev-chaos";
        tr.innerHTML =
          `<td>${idx + 1}</td><td class="tag-round">—</td><td>⚑ Hitler elected Chancellor</td>` +
          `<td>${escapeHtml(state.players[ev.presidentIdx].name)}</td>` +
          `<td>${escapeHtml(state.players[ev.chancellorIdx].name)}</td><td>—</td>` +
          `<td>Fascists win</td><td>—</td>`;
      } else {
        const g = d.gi[ev.giIdx];
        const ratio = RATIOS[g.libs];
        tr.innerHTML =
          `<td>${idx + 1}</td>` +
          `<td class="tag-round">${g.round + 1}</td>` +
          `<td><span class="ratio-name ${ratio.cls}">${ratio.name}</span>${
            g.vetoed ? ` <span style="color:var(--gold)">⊘ vetoed</span>` : ""
          }${
            g.conflict ? ` <span style="color:var(--fac-2)">⚔ conflict ${escapeHtml(state.players[g.chancellorIdx].name)}</span>` : ""
          }${powerAnnotation(g.power)}${powerLieChip(g, d)}${lieBadge(g.honesty, d.roleOdds ? d.roleOdds[g.presidentIdx] : null)}</td>` +
          `<td>${escapeHtml(state.players[g.presidentIdx].name)}</td>` +
          `<td>${escapeHtml(state.players[g.chancellorIdx].name)}</td>` +
          `<td>${ratio.sub}</td>` +
          `<td>${g.vetoed ? "— (veto)" : g.enacted === "L" ? "🟦 Lib" : "🟥 Fac"}</td>` +
          `<td><b style="color:var(--gold)">${Prob.fmtPct(g.prob)}</b></td>`;
      }
      // (The honesty verdict now rides inline in the Event cell above, so it is
      // visible without scrolling the table sideways on a phone.)
      // Correcting a mis-tap noticed several turns later — Undo only steps back
      // from the end, so without this the whole game has to be unwound.
      const canEdit = !state.review && !state.recordingRoles && ev.n != null;
      tr.innerHTML += `<td class="hist-fix">${
        canEdit ? `<button class="fix-btn" data-n="${ev.n}" title="Edit or delete this entry">✎</button>` : ""
      }</td>`;
      tb.appendChild(tr);
    });
    tb.querySelectorAll(".fix-btn").forEach((b) => {
      b.onclick = () => openEventEditor(+b.dataset.n);
    });
  }

  // ---------------------- editing a recorded entry ---------------------------
  // Everything is derived from the event log, so correcting history is just
  // "mutate the event and re-derive". The knock-on state that is NOT derived
  // (a pending power, a detected game-over) is cleared and recomputed.
  let editDraft = null;

  function openEventEditor(n) {
    const ev = state.events[n];
    if (!ev) return;
    editDraft = {
      n,
      libs: ev.claimLibs,
      conflict: !!ev.conflict,
      vetoed: !!ev.vetoed,
      enacted: ev.enacted,
    };
    renderEventEditor();
  }

  function renderEventEditor() {
    if (!editDraft) return;
    const n = editDraft.n;
    const ev = state.events[n];
    const type = ev.type || "gov";
    const m = $("confirmModal");
    let body = "";

    if (type === "gov") {
      const ratios = RATIOS.map((r) =>
        `<button class="ed-ratio${editDraft.libs === r.libs ? " sel" : ""}" data-libs="${r.libs}" ` +
        `style="background:${ratioColor(r.libs)}"><span class="ratio-name ${r.cls}">${r.name}</span>` +
        `<span class="ratio-sub">${r.sub}</span></button>`).join("");
      const canConflict = !editDraft.vetoed && (editDraft.libs === 1 || editDraft.libs === 2);
      body =
        `<p class="confirm-body">What did ${escapeHtml(state.players[ev.presidentIdx].name)} actually claim?</p>` +
        `<div class="ed-ratios">${ratios}</div>` +
        `<div class="control-row">` +
        `<button id="edConflict" class="conflict-btn${editDraft.conflict ? " on" : ""}"${canConflict ? "" : " disabled"}>⚔ Conflict</button>` +
        `<button id="edVeto" class="veto-btn${editDraft.vetoed ? " on" : ""}">⊘ Veto</button>` +
        `</div>`;
    } else if (type === "chaos") {
      body =
        `<p class="confirm-body">Which policy was top-decked?</p>` +
        `<div class="control-row">` +
        `<button id="edChaosL" class="primary btn-lib${editDraft.enacted === "L" ? " on" : ""}">Liberal</button>` +
        `<button id="edChaosF" class="primary${editDraft.enacted === "F" ? " on" : ""}">Fascist</button>` +
        `</div>`;
    } else {
      body = `<p class="confirm-body">This entry can be deleted, but has nothing to edit.</p>`;
    }

    $("confirmBox").innerHTML =
      backBtn("edBack", "Cancel") +
      `<div class="power-title">Fix entry ${n + 1}</div>` +
      body +
      `<p class="muted" style="font-size:12px;margin:6px 0 0">Later entries keep their order. A presidential power attached to a government that no longer enacts Fascist is removed.</p>` +
      `<div class="control-row">` +
      `<button id="edSave" class="primary">Save</button>` +
      `<button id="edDelete" class="danger">Delete entry</button>` +
      `<button id="edCancel" class="ghost">Cancel</button>` +
      `</div>`;
    m.classList.remove("hidden");

    const close = () => { m.classList.add("hidden"); editDraft = null; };
    $("edBack").onclick = close;
    $("edCancel").onclick = close;
    $("edSave").onclick = () => { applyEventEdit(); close(); };
    $("edDelete").onclick = () => {
      close();
      askConfirm(
        {
          title: "Delete this entry?",
          body: "It is removed from the game and everything after it is recalculated.",
          confirm: "Delete",
          cancel: "Keep it",
          danger: true,
        },
        () => deleteEvent(n)
      );
    };

    $("confirmBox").querySelectorAll(".ed-ratio").forEach((b) => {
      b.onclick = () => {
        editDraft.libs = +b.dataset.libs;
        if (editDraft.libs === 0 || editDraft.libs === 3) editDraft.conflict = false;
        renderEventEditor();
      };
    });
    if ($("edConflict")) $("edConflict").onclick = () => {
      editDraft.conflict = !editDraft.conflict;
      if (editDraft.conflict) editDraft.vetoed = false;
      renderEventEditor();
    };
    if ($("edVeto")) $("edVeto").onclick = () => {
      editDraft.vetoed = !editDraft.vetoed;
      if (editDraft.vetoed) editDraft.conflict = false;
      renderEventEditor();
    };
    if ($("edChaosL")) $("edChaosL").onclick = () => { editDraft.enacted = "L"; renderEventEditor(); };
    if ($("edChaosF")) $("edChaosF").onclick = () => { editDraft.enacted = "F"; renderEventEditor(); };
  }

  // Turn-state that is NOT derived from the event log has to be rebuilt by hand
  // after history changes underneath it.
  function afterHistoryEdit() {
    state.pendingPower = null;
    state.pendingChaos = false;
    state.gameOver = null;
    state.autoResult = null;
    state.form = { chanIdxOverride: null, conflictArmed: false, vetoArmed: false };
    const d = derive();
    // A Kill that revealed Hitler still ends the game, however history moved.
    const revealed = state.events.some(
      (e) => e.power && e.power.type === "kill" && e.power.wasHitler
    );
    if (revealed) {
      state.gameOver = { winner: "Liberal", reason: "Hitler was executed." };
      state.autoResult = { winner: "Liberal" };
    } else if (d.hitlerElected) {
      state.gameOver = { winner: "Fascist", reason: "Hitler was elected Chancellor." };
      state.autoResult = { winner: "Fascist", hitlerIdx: d.hitlerElected.chancellorIdx };
    } else {
      checkGameOver(d);
    }
    if (!state.gameOver && d.tracker >= 3) state.pendingChaos = true;
    renderGame();
  }

  function applyEventEdit() {
    if (!editDraft) return;
    const { n, libs, conflict, vetoed, enacted } = editDraft;
    const ev = state.events[n];
    if (!ev) return;
    pushUndo();
    if ((ev.type || "gov") === "gov") {
      ev.claimLibs = libs;
      ev.vetoed = vetoed;
      ev.conflict = vetoed ? false : conflict && (libs === 1 || libs === 2);
      ev.enacted = vetoed ? null : inferEnacted(libs, ev.conflict);
      // A power was granted by a Fascist policy; if this no longer enacts one,
      // the recorded power is meaningless.
      if (ev.enacted !== "F" && ev.power) delete ev.power;
    } else if (ev.type === "chaos") {
      ev.enacted = enacted;
    }
    afterHistoryEdit();
    showToast("Entry updated.");
  }

  function deleteEvent(n) {
    if (!state.events[n]) return;
    pushUndo();
    state.events.splice(n, 1);
    afterHistoryEdit();
    showToast("Entry deleted.");
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
    if (busy() || state.players[i].dead) return;
    const d = derive();
    if (i === d.presIdx) return;
    if (d.termLimited.has(i)) {
      // term limits: last elected Chancellor (and President, unless only 5 are alive)
      flashTurn(`${state.players[i].name} is term-limited from the last government.`);
      return;
    }
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
    // Veto is only unlocked once 5 fascist policies are down. A vetoed government
    // enacts nothing, discards all 3 cards and advances the election tracker.
    const vetoed = !!state.form.vetoArmed && d0.fac >= 5;
    const conflict = !vetoed && !!state.form.conflictArmed && (libs === 1 || libs === 2);
    const enacted = vetoed ? null : inferEnacted(libs, conflict);
    pushUndo();
    state.events.push({
      type: "gov",
      presidentIdx: presIdx,
      chancellorIdx: chanIdx,
      claimLibs: libs,
      conflict,
      enacted,
      vetoed,
    });
    state.form = { chanIdxOverride: null, conflictArmed: false, vetoArmed: false };
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    // does this fascist policy trigger a presidential power? (a veto enacts none)
    const d1 = derive();
    if (enacted === "F") {
      const power = powerForFascistCount(d1.fac);
      if (power) state.pendingPower = { type: power, govIndex: state.events.length - 1, presidentIdx: presIdx };
    }
    if (vetoed && d1.tracker >= 3) state.pendingChaos = true;
    checkGameOver(d1);
    renderGame();
    if (!vetoed) animateEnact(presIdx, enacted);
  }

  // Hitler elected Chancellor with 3+ fascist policies down ⇒ Fascists win now.
  // The app can't know who Hitler is, so the table declares it.
  function recordHitlerElected() {
    if (busy()) return;
    const d = derive();
    const chanIdx = effChan(d);
    if (chanIdx == null) {
      flashTurn("Tap the player who was elected Chancellor first.");
      return;
    }
    if (d.fac < 3) return;
    pushUndo();
    state.events.push({ type: "hitler", presidentIdx: d.presIdx, chancellorIdx: chanIdx });
    state.form = { chanIdxOverride: null, conflictArmed: false, vetoArmed: false };
    state.gameOver = { winner: "Fascist", reason: "Hitler was elected Chancellor." };
    state.autoResult = { winner: "Fascist", hitlerIdx: chanIdx };
    if (!state.roleDraft) state.roleDraft = { hitlerIdx: null, fascistIdxs: [] };
    state.roleDraft.hitlerIdx = chanIdx;
    renderGame();
  }

  function recordFail() {
    if (busy()) return;
    pushUndo();
    state.events.push({ type: "fail", presidentIdx: derive().presIdx });
    state.form = { chanIdxOverride: null, conflictArmed: false, vetoArmed: false };
    if (derive().tracker >= 3) state.pendingChaos = true;
    renderGame();
  }

  // Snapshot the full game state before a state-changing action so Undo can
  // restore EVERYTHING exactly (events, round modifiers, powers, deaths,
  // game-over, conflicts, turn state) — not just pop one event.
  // Capped: each snapshot holds the whole game, so an uncapped stack grows
  // without bound and can exhaust localStorage in a long game. Nobody steps
  // back further than this. (The stack persists to its own key via saveUndo(),
  // so it survives a refresh without weighing down the per-render save.)
  const UNDO_LIMIT = 25;
  function pushUndo() {
    const snap = {};
    for (const k in state) if (k !== "undoStack") snap[k] = state[k];
    state.undoStack.push(JSON.stringify(snap));
    while (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
    saveUndo();
  }

  // Revert to exactly the state before the most recent action.
  function undoLast() {
    if (!state.undoStack || !state.undoStack.length) return;
    const stack = state.undoStack;
    const snap = JSON.parse(stack.pop());
    snap.undoStack = stack;
    state = snap;
    saveUndo();
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
  function presDetails(ev, curRound) {
    let s = "";
    if (ev.vetoed) s += `<div class="pres-detail c-gold">⊘ vetoed</div>`;
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
        // a peek only describes the pile until the next reshuffle (= round boundary)
        const stale = curRound != null && ev.round != null && ev.round < curRound;
        s += `<div class="pres-detail${stale ? " stale" : ""}"${
          stale ? ' title="reshuffled since — no longer describes the pile"' : ""
        }>👁 ${p.order.join("·")}${stale ? " (reshuffled)" : ""}</div>`;
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
    const aliveSel = (id, exclude, skip) =>
      `<select id="${id}">` +
      state.players
        .map((p, i) =>
          i === exclude || p.dead || (skip && skip.has(i))
            ? ""
            : `<option value="${i}">${escapeHtml(p.name)}</option>`
        )
        .join("") +
      `</select>`;

    if (pp.type === "invest") {
      if (!powerDraft) powerDraft = { targetIdx: null, party: null };
      // nobody may be investigated twice in the same game
      let seen = d.investigated;
      const anyLeft = state.players.some(
        (p, i) => i !== pp.presidentIdx && !p.dead && !seen.has(i)
      );
      if (!anyLeft) seen = new Set(); // never dead-end the prompt
      body.innerHTML =
        `<div class="power-title">🔍 Investigation — <span class="who">${escapeHtml(pres.name)}</span> investigates a player</div>` +
        `<div class="power-field"><label>Who was investigated? ` +
        `<span class="muted" style="font-weight:400">(already-investigated players are excluded)</span></label>` +
        `${aliveSel("pwWho", pp.presidentIdx, seen)}</div>` +
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
    // top-left back arrow on every power prompt reverts the presidency that triggered it
    body.insertAdjacentHTML("afterbegin", backBtn("pwBack"));
    $("pwBack").onclick = undoLast;
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
  // ------------------------------ statistics ---------------------------------
  function tile(big, lbl) {
    return `<div class="stat-tile"><div class="big">${big}</div><div class="lbl">${lbl}</div></div>`;
  }
  const kv = (k, v) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const pct = (x) => (x * 100).toFixed(0) + "%";

  // Single-series magnitude bars. Identity comes from the row label, never the
  // colour, so one accent hue is used for every bar (no categorical palette).
  function barRow(label, value, max, note) {
    const w = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
      `<div class="bar-row"><span class="bar-lbl">${escapeHtml(label)}</span>` +
      `<span class="bar-track"><span class="bar-fill" style="width:${w}%"></span></span>` +
      `<span class="bar-val">${value}${note ? " · " + note : ""}</span></div>`
    );
  }

  function playerCard(p) {
    const roles = `${p.asLiberal}L · ${p.asFascist}F · ${p.asHitler}H`;
    return (
      `<div class="pstat">` +
      `<button class="pstat-head" type="button">` +
      `<span class="pstat-name">${escapeHtml(p.name)}</span>` +
      `<span class="pstat-quick">${p.games} games · ${pct(p.winRate)} won · ${roles}</span>` +
      `<span class="pstat-chev">▾</span></button>` +
      `<div class="pstat-detail hidden">` +
      `<div class="sub-head">Roles</div><div class="kv-grid">` +
      kv("As Liberal", p.asLiberal) +
      kv("As Fascist", p.asFascist) +
      kv("As Hitler", p.asHitler) +
      kv("Won as Liberal", p.asLiberal ? pct(p.libWinRate) : "—") +
      kv("Won as Fascist", p.asFascist + p.asHitler ? pct(p.facWinRate) : "—") +
      kv("Wins / games", p.wins + " / " + p.games) +
      `</div>` +
      `<div class="sub-head">Claimed hands as President</div><div class="kv-grid">` +
      p.claims.map((c, i) => kv(Stats.CLAIM_NAMES[i], c)).join("") +
      `</div>` +
      `<div class="sub-head">Powers used as President</div><div class="kv-grid">` +
      kv("Investigations", p.investigations) +
      kv("Policy peeks", p.peeks) +
      kv("Executions", p.kills) +
      kv("Special elections", p.specialElections) +
      `</div>` +
      `<div class="sub-head">Seats &amp; outcomes</div><div class="kv-grid">` +
      kv("Presidencies", p.presidencies) +
      kv("Chancellorships", p.chancellorships) +
      kv("Failed elections", p.failedElections) +
      kv("Conflicts as Chancellor", p.conflictsAsChancellor) +
      kv("Conflicts as President", p.conflictsAsPresident) +
      kv("Vetoes as President", p.vetoesAsPresident) +
      kv("Vetoes as Chancellor", p.vetoesAsChancellor) +
      kv("Enacted Liberal", p.libEnactedAsChancellor) +
      kv("Enacted Fascist", p.facEnactedAsChancellor) +
      kv("Times executed", p.timesKilled) +
      kv("Times investigated", p.timesInvestigated) +
      kv("Times special-elected", p.timesSpecialElected) +
      `</div></div></div>`
    );
  }

  // Calibration harness (§12.10): scores the stored fascist-odds predictions
  // against the recorded true roles across every game that has both. Tells us —
  // from the user's OWN games — whether the model beats just guessing the base
  // rate. Returns null when there isn't enough data to say anything yet.
  function calibrationStats() {
    const games = (Stats.loadAllGames ? Stats.loadAllGames() : Stats.loadGames())
      .filter((g) => g.result && Array.isArray(g.roleOdds) && g.roleOdds.some((x) => x != null));
    if (games.length < 3) return { games: games.length, enough: false };

    const clamp01 = (p) => Math.max(1e-6, Math.min(1 - 1e-6, p));
    const isFascist = (g, i) =>
      i === g.result.hitlerIdx || (g.result.fascistIdxs || []).includes(i);

    let n = 0, brier = 0, logloss = 0, brierBase = 0;
    let topHits = 0, topTotal = 0;
    const bins = Array.from({ length: 5 }, () => ({ sum: 0, fasc: 0, n: 0 }));

    games.forEach((g) => {
      const pc = g.playerCount || (g.players ? g.players.length : g.roleOdds.length);
      const f = Math.ceil(pc / 2) - 1;
      const base = f / pc;
      const preds = [];
      for (let i = 0; i < pc; i++) {
        const p = g.roleOdds[i];
        if (p == null) continue;
        const y = isFascist(g, i) ? 1 : 0;
        n++;
        brier += (p - y) * (p - y);
        brierBase += (base - y) * (base - y);
        logloss += -(y * Math.log(clamp01(p)) + (1 - y) * Math.log(1 - clamp01(p)));
        const b = Math.min(4, Math.floor(p * 5));
        bins[b].sum += p; bins[b].fasc += y; bins[b].n++;
        preds.push({ i, p, y });
      }
      // "top-f suspects": are the f highest-odds seats the actual fascists?
      preds.sort((a, b) => b.p - a.p);
      for (let k = 0; k < f && k < preds.length; k++) { topTotal++; if (preds[k].y) topHits++; }
    });
    if (!n) return { games: games.length, enough: false };
    return {
      games: games.length, enough: true, seats: n,
      brier: brier / n, brierBase: brierBase / n,
      skill: 1 - (brier / n) / (brierBase / n || 1), // Brier skill score vs base rate
      logloss: logloss / n,
      topAccuracy: topTotal ? topHits / topTotal : 0,
      bins: bins.map((b, i) => ({
        lo: i * 20, hi: i * 20 + 20,
        n: b.n, predicted: b.n ? b.sum / b.n : 0, actual: b.n ? b.fasc / b.n : 0,
      })),
    };
  }

  function calibrationHtml() {
    if (!lieOn()) return "";
    const c = calibrationStats();
    if (!c) return "";
    if (!c.enough)
      return (
        `<div class="panel lie-col"><h3 class="sec-title">Model calibration</h3>` +
        `<p class="muted" style="margin:0">Needs at least 3 recorded games with a stored fascist-odds ` +
        `read to score the model (have ${c.games}). Keep recording games — the prediction is saved ` +
        `beside the true roles every time.</p></div>`
      );
    const skillPct = Math.round(c.skill * 100);
    const skillWord = c.skill > 0.02 ? "better than" : c.skill < -0.02 ? "WORSE than" : "about the same as";
    const skillCls = c.skill > 0.02 ? "lie-good" : c.skill < -0.02 ? "lie-bad" : "lie-warn";
    const rows = c.bins
      .filter((b) => b.n)
      .map((b) => barRow(`${b.lo}–${b.hi}%`, Math.round(b.actual * 100), 100,
        `${b.n} seat${b.n === 1 ? "" : "s"} · said ~${Math.round(b.predicted * 100)}%`))
      .join("");
    return (
      `<div class="panel lie-col"><h3 class="sec-title">Model calibration ` +
      `<span class="sec-note">${c.games} games · ${c.seats} seats scored</span></h3>` +
      `<div class="statgrid">` +
      tile(`<span class="${skillCls}">${skillPct > 0 ? "+" : ""}${skillPct}%</span>`, "Skill vs base rate") +
      tile(pct(c.topAccuracy), "Top suspects correct") +
      tile(c.brier.toFixed(3), "Brier (lower better)") +
      tile(c.brierBase.toFixed(3), "Base-rate Brier") +
      `</div>` +
      `<p class="muted" style="margin:8px 0 0">The model is <b>${skillWord}</b> guessing the base rate ` +
      `on your games. Reliability — when it said a bin, how many actually were fascist:</p>` +
      `<div class="bar-list" style="margin-top:8px">${rows}</div></div>`
    );
  }

  function renderStatsInto(container) {
    const s = Stats.summary();
    const gid = container.id + "Games";

    if (!s.totalGames) {
      container.innerHTML =
        `<div class="panel"><h3 class="sec-title">Statistics</h3>` +
        `<p class="muted" style="margin:0">No games recorded yet — finish a game and record the roles ` +
        `to start building statistics.</p></div>`;
      return;
    }

    const claimTotal = s.claims.reduce((a, b) => a + b, 0);
    const claimMax = Math.max.apply(null, s.claims);
    const claimBars = s.claims
      .map((c, i) => barRow(Stats.CLAIM_NAMES[i], c, claimMax, claimTotal ? pct(c / claimTotal) : "0%"))
      .join("");
    const endings = Object.keys(s.endings)
      .sort((a, b) => s.endings[b] - s.endings[a])
      .map((k) => kv(k, s.endings[k]))
      .join("");

    container.innerHTML =
      `<div class="panel"><h3 class="sec-title">Overview</h3><div class="statgrid">` +
      tile(s.totalGames, "Games") +
      tile(s.liberalWins, "Liberal wins") +
      tile(s.fascistWins, "Fascist wins") +
      tile(pct(s.fascistWinRate), "Fascist win rate") +
      tile(s.avgGovernments.toFixed(1), "Govs / game") +
      tile(s.avgFailedElections.toFixed(1), "Fails / game") +
      `</div></div>` +
      `<div class="panel"><h3 class="sec-title">Claimed hands ` +
      `<span class="sec-note">${claimTotal} presidencies</span></h3>` +
      `<div class="bar-list">${claimBars}</div></div>` +
      `<div class="panel"><h3 class="sec-title">Game totals</h3><div class="kv-grid">` +
      kv("Governments", s.governments) +
      kv("Failed elections", s.failedElections) +
      kv("Liberal policies", s.policiesLib) +
      kv("Fascist policies", s.policiesFac) +
      kv("Conflicts", s.conflicts) +
      kv("Vetoed governments", s.vetoes) +
      kv("Chaos top-decks", s.chaosPolicies) +
      kv("Investigations", s.investigations) +
      kv("Policy peeks", s.peeks) +
      kv("Executions", s.kills) +
      kv("Special elections", s.specialElections) +
      kv("Hitler executed", s.hitlerExecuted) +
      kv("Avg players", s.avgPlayers.toFixed(1)) +
      `</div></div>` +
      `<div class="panel"><h3 class="sec-title">How games ended</h3>` +
      `<div class="kv-grid">${endings}</div></div>` +
      calibrationHtml() +
      `<div class="panel"><h3 class="sec-title">Players ` +
      `<span class="sec-note">tap for the full breakdown</span></h3>` +
      `<div class="player-list">${Stats.playerStats().map(playerCard).join("")}</div></div>` +
      `<div class="panel"><h3 class="sec-title">All games ` +
      `<span class="sec-note">tap a game to review it</span></h3>` +
      `<div class="games-list" id="${gid}"></div></div>`;

    renderGamesList($(gid));
    container.querySelectorAll(".pstat-head").forEach((b) => {
      b.onclick = () => {
        const det = b.nextElementSibling;
        const wasOpen = !det.classList.contains("hidden");
        det.classList.toggle("hidden", wasOpen);
        b.classList.toggle("open", !wasOpen);
      };
    });
  }

  // Re-render the Statistics page in place (after an import, a clear, or a group
  // switch). Navigation to the page is handled by openStats(); this never shows
  // or hides a screen, so it's safe to call whether or not Stats is on screen.
  function renderStats() {
    renderStatsInto($("statsBody"));
  }

  // in-game tab switching (Play / History / Stats)
  function switchTab(name) {
    ["play", "history", "stats"].forEach((t) => {
      $(t + "Tab").classList.toggle("hidden", t !== name);
    });
    document.querySelectorAll(".tabbar .tab").forEach((b) => {
      b.classList.toggle("sel", b.dataset.tab === name);
    });
    if (name === "stats") renderStatsInto($("statsBodyInline"));
  }

  // ------------------------------ misc ---------------------------------------
  // Go to the players list ready to start again (used by "New game"). Only the
  // in-progress autosave is cleared — recorded games are untouched. Seed the nav
  // stack with the menu so the back arrow here returns home.
  function resetToSetup() {
    state = null;
    clearActive();
    navStack = ["menuScreen"];
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

  // ------------------------------ data export / import -----------------------
  // All statistics live in this browser only, so the archive needs a way out:
  // a backup against cleared site data, a way to carry games between devices,
  // and the payload that will seed a cloud account later.
  // Write the whole archive out as a downloaded JSON file. Returns
  // {count, name} if a file was produced, or null if there was nothing to save.
  // Shared by the Export button and the safety backup taken before a bulk clear,
  // so there is exactly one place that knows how to serialise the archive.
  function downloadArchive(prefix) {
    const data = Stats.exportData();
    if (!data.games.length) return null;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${prefix}-${data.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { count: data.games.length, name: a.download };
  }

  function exportStats() {
    const res = downloadArchive("secret-hitler-stats");
    if (!res) {
      showToast("No games to export yet.");
      return;
    }
    showToast(`Exported ${res.count} game${res.count === 1 ? "" : "s"}.`);
  }

  function importStats(file) {
    const reader = new FileReader();
    reader.onerror = () => showToast("Couldn't read that file.");
    reader.onload = () => {
      let res;
      try {
        res = Stats.importData(JSON.parse(reader.result));
      } catch (err) {
        // Stats.importData throws a human-readable reason; JSON.parse doesn't.
        showToast(err instanceof SyntaxError ? "That file isn't valid JSON." : err.message);
        return;
      }
      renderStats();
      const skipped = res.skipped ? `, ${res.skipped} already saved` : "";
      showToast(
        res.added
          ? `Imported ${res.added} game${res.added === 1 ? "" : "s"}${skipped}.`
          : "Nothing new to import — those games are already saved."
      );
    };
    reader.readAsText(file);
  }

  // ------------------------------ account / cloud sync -----------------------
  // js/cloud.js (an ES module) does all Firebase work and talks to us only via
  // window.Cloud + `cloud:*` events. Everything here degrades to a no-op if
  // that module never loads, so the app still works with no account/network.
  let acctMode = "in"; // "in" | "up" — sign in vs create account
  let acctMsg = null;
  let acctView = "main"; // "main" | "members"

  const cloud = () => window.Cloud || null;

  // Which games the statistics describe. Signed out → everything on this
  // device (unchanged behaviour). Signed in → the active group, plus anything
  // not yet assigned to a group so a freshly recorded game never vanishes
  // while it waits to upload.
  function applyScope() {
    const c = cloud();
    if (!c || !c.user || !c.groupId) { Stats.setScope(null); return; }
    const gid = c.groupId;
    Stats.setScope((g) => !g.groupId || g.groupId === gid);
  }

  function activeGroupLabel() {
    const c = cloud();
    return c && c.user && c.groupName ? c.groupName : "This device";
  }

  function renderAcctChip() {
    // keep the menu's group box in sync too — it sits behind the account modal,
    // so switching/renaming/leaving a group there must refresh it underneath.
    const gn = $("menuGroupName");
    if (gn) gn.textContent = activeGroupLabel();
    const dot = $("acctDot"), label = $("acctLabel");
    if (!dot || !label) return;
    const c = cloud();
    dot.className = "acct-dot";
    if (!c || !c.user) { label.textContent = "Sign in"; return; }
    const pending = c.pendingCount();
    const st = c.status;
    if (st === "syncing") dot.classList.add("syncing");
    else if (st === "error") dot.classList.add("err");
    else if (st === "offline" || pending > 0) dot.classList.add("pending");
    else dot.classList.add("on");
    const name = c.user.displayName || (c.user.email || "").split("@")[0] || "Account";
    label.textContent = name.length > 14 ? name.slice(0, 13) + "…" : name;
  }

  function syncStateText(c) {
    const pending = c.pendingCount();
    if (c.status === "syncing") return "Syncing…";
    if (c.status === "error") return "Sync problem: " + (c.error || "unknown");
    if (c.status === "offline") return "Offline — will sync when you reconnect.";
    if (c.uploadAllowed() === false && pending) return `${pending} game${pending === 1 ? "" : "s"} on this device are not being uploaded.`;
    if (pending) return `${pending} game${pending === 1 ? "" : "s"} waiting to upload.`;
    return "All games are backed up to your account.";
  }

  function openAccount() {
    acctMsg = null;
    acctView = "main";
    renderAccount();
    $("accountModal").classList.remove("hidden");
  }
  function closeAccount() { $("accountModal").classList.add("hidden"); }

  function renderAccount() {
    const box = $("accountBox");
    if (!box || $("accountModal").classList.contains("hidden") && !box.innerHTML) { /* fallthrough */ }
    const c = cloud();
    const msgHtml = acctMsg
      ? `<div class="acct-msg ${acctMsg.bad ? "bad" : "good"}">${escapeHtml(acctMsg.text)}</div>`
      : `<div class="acct-msg"></div>`;

    if (!c) {
      box.innerHTML =
        backBtn("acBack", "Close") +
        `<div class="power-title">Account</div>` +
        `<p class="confirm-body">Cloud sync couldn't load — you may be offline. The app works normally; your games are saved on this device.</p>`;
      $("acBack").onclick = closeAccount;
      return;
    }

    if (c.user && acctView === "members") { renderMembersView(box, c); return; }

    if (c.user) {
      const pending = c.pendingCount();
      const dispName = (c.user.displayName || "").trim();
      const groups = c.groups();
      const groupRows = groups.map((g) =>
        `<button class="grp-row${g.id === c.groupId ? " sel" : ""}" data-gid="${escapeHtml(g.id)}">` +
        `<span class="grp-name">${escapeHtml(g.name)}</span>` +
        `<span class="grp-meta">${g.memberCount} member${g.memberCount === 1 ? "" : "s"}${g.isOwner ? " · yours" : ""}</span>` +
        `</button>`).join("");
      box.innerHTML =
        backBtn("acBack", "Close") +
        `<div class="power-title">Your account</div>` +
        `<div class="acct-panel">` +
        `<div class="acct-who">` +
          (dispName
            ? escapeHtml(dispName)
            : `<span class="muted">No display name yet</span>`) +
          `<button id="acSetName" class="acct-editname" title="Change your display name">Change name</button>` +
        `</div>` +
        (c.user.email ? `<div class="acct-sub">${escapeHtml(c.user.email)}</div>` : "") +
        `<div class="acct-state">${escapeHtml(syncStateText(c))}</div>` +
        invitesHtml() +
        msgHtml +
        `<div class="control-row">` +
        `<button id="acSync" class="primary">Sync now</button>` +
        (c.uploadAllowed() === false && pending
          ? `<button id="acEnableUp" class="ghost">Upload this device's games</button>` : "") +
        `<button id="acOut" class="ghost">Sign out</button>` +
        `</div>` +
        `<div class="grp-head">Groups <span class="muted">— games and stats belong to the selected one</span></div>` +
        `<div class="grp-list">${groupRows}</div>` +
        `<div class="control-row">` +
        `<button id="acNewGroup" class="ghost">+ New group</button>` +
        `<button id="acInvite" class="ghost">Invite someone</button>` +
        `<button id="acMembers" class="ghost">Members</button>` +
        `<button id="acRename" class="ghost">Rename</button>` +
        (groups.length > 1 ? `<button id="acLeave" class="ghost">Leave group</button>` : "") +
        `</div>` +
        `</div>`;
      $("acBack").onclick = closeAccount;
      // Change your display name — updates the account and every group roster
      // seat that is you, so it propagates to everyone sharing your groups.
      $("acSetName").onclick = () => promptText(
        "Your display name",
        "This is how you appear across the app and to others in your groups.",
        "e.g. Tim",
        async (name) => {
          acctMsg = { text: "Updating your name…", bad: false }; renderAccount();
          const r = await c.setDisplayName(name);
          acctMsg = r.ok ? { text: "Name updated everywhere.", bad: false } : { text: r.message, bad: true };
          renderAccount(); renderAcctChip(); renderSetup();
          if (!$("statsScreen").classList.contains("hidden")) renderStats();
        },
        dispName
      );
      wireInvites(box, c);
      box.querySelectorAll(".grp-row").forEach((b) => {
        b.onclick = async () => {
          await c.setActiveGroup(b.dataset.gid);
          applyScope();
          acctMsg = { text: "Switched to " + activeGroupLabel() + ".", bad: false };
          renderAccount(); renderAcctChip();
          if (!$("statsScreen").classList.contains("hidden")) renderStats();
        };
      });
      $("acNewGroup").onclick = () => promptText(
        "New group", "What should it be called?", "e.g. Thursday Night", async (name) => {
          acctMsg = { text: "Creating…", bad: false }; renderAccount();
          const r = await c.createGroup(name);
          applyScope();
          acctMsg = r.ok ? { text: "Group created.", bad: false } : { text: r.message, bad: true };
          renderAccount(); renderAcctChip();
        });
      $("acInvite").onclick = () => showInvite(c);
      $("acMembers").onclick = () => { acctView = "members"; acctMsg = null; renderAccount(); };
      $("acRename").onclick = () => promptText(
        "Rename group", `Currently "${activeGroupLabel()}".`, "New name", async (name) => {
          const r = await c.renameGroup(name);
          acctMsg = r.ok ? { text: "Renamed.", bad: false } : { text: r.message, bad: true };
          renderAccount(); renderAcctChip(); renderSetup();
        });
      if ($("acLeave")) $("acLeave").onclick = () => askConfirm(
        {
          title: `Leave ${activeGroupLabel()}?`,
          body: "You'll stop seeing this group's games and won't be able to add to it. You can rejoin with an invite link.",
          confirm: "Leave group",
          cancel: "Stay",
          danger: true,
        },
        async () => {
          const r = await c.leaveGroup();
          applyScope();
          acctMsg = r.ok ? { text: "You left the group.", bad: false } : { text: r.message, bad: true };
          renderAccount(); renderAcctChip(); renderSetup();
          if (!$("statsScreen").classList.contains("hidden")) renderStats();
        });
      $("acSync").onclick = async () => {
        acctMsg = null; renderAccount();
        const r = await c.sync();
        acctMsg = r && r.error
          ? { text: r.error, bad: true }
          : { text: `Uploaded ${r.uploaded || 0}, downloaded ${r.downloaded || 0}.`, bad: false };
        renderAccount();
      };
      const up = $("acEnableUp");
      if (up) up.onclick = async () => { c.setUploadAllowed(true); await c.sync(); renderAccount(); };
      $("acOut").onclick = async () => {
        await c.signOut();
        closeAccount();
        showToast("Signed out. Your games stay on this device.");
      };
      return;
    }

    const isUp = acctMode === "up";
    box.innerHTML =
      backBtn("acBack", "Close") +
      `<div class="power-title">${isUp ? "Create an account" : "Sign in"}</div>` +
      `<div class="acct-panel">` +
      `<p class="confirm-body" style="margin:0">Sign in to keep your games across devices. The app works fine without an account.</p>` +
      `<button id="acGoogle" class="acct-google">Continue with Google</button>` +
      `<div class="acct-sep">or</div>` +
      (isUp ? `<div class="acct-field"><label for="acName">Display name</label><input id="acName" autocomplete="nickname" placeholder="Tim"></div>` : "") +
      `<div class="acct-field"><label for="acEmail">Email</label><input id="acEmail" type="email" autocomplete="email" placeholder="you@example.com"></div>` +
      `<div class="acct-field"><label for="acPass">Password</label><input id="acPass" type="password" autocomplete="${isUp ? "new-password" : "current-password"}"></div>` +
      msgHtml +
      `<div class="control-row"><button id="acGo" class="primary">${isUp ? "Create account" : "Sign in"}</button></div>` +
      `<button id="acSwap" class="acct-toggle">${isUp ? "I already have an account" : "Create an account instead"}</button>` +
      `</div>`;
    $("acBack").onclick = closeAccount;
    $("acSwap").onclick = () => { acctMode = isUp ? "in" : "up"; acctMsg = null; renderAccount(); };
    $("acGoogle").onclick = async () => {
      acctMsg = { text: "Opening Google…", bad: false }; renderAccount();
      const r = await c.signInWithGoogle();
      if (!r.ok) { acctMsg = { text: r.message, bad: true }; renderAccount(); }
    };
    const submit = async () => {
      const email = ($("acEmail").value || "").trim();
      const pass = $("acPass").value || "";
      const name = isUp && $("acName") ? ($("acName").value || "").trim() : "";
      if (!email || !pass) { acctMsg = { text: "Email and password are both needed.", bad: true }; return renderAccount(); }
      acctMsg = { text: "Working…", bad: false }; renderAccount();
      const r = isUp ? await c.signUpEmail(email, pass, name) : await c.signInEmail(email, pass);
      if (!r.ok) { acctMsg = { text: r.message, bad: true }; renderAccount(); }
    };
    $("acGo").onclick = submit;
    $("acPass").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  // In-app text prompt (never window.prompt — see the no-native-dialogs rule).
  // `prefill` seeds the field (e.g. editing an existing display name).
  function promptText(title, body, placeholder, onOk, prefill) {
    const m = $("confirmModal");
    $("confirmBox").innerHTML =
      backBtn("ptBack", "Cancel") +
      `<div class="power-title">${escapeHtml(title)}</div>` +
      `<p class="confirm-body">${escapeHtml(body)}</p>` +
      `<div class="acct-field"><input id="ptInput" maxlength="60" placeholder="${escapeHtml(placeholder || "")}" value="${escapeHtml(prefill || "")}"></div>` +
      `<div class="control-row"><button id="ptOk" class="primary">OK</button>` +
      `<button id="ptNo" class="ghost">Cancel</button></div>`;
    m.classList.remove("hidden");
    const close = () => m.classList.add("hidden");
    const go = () => {
      const v = ($("ptInput").value || "").trim();
      if (!v) return;
      close();
      onOk(v);
    };
    $("ptOk").onclick = go;
    $("ptNo").onclick = close;
    $("ptBack").onclick = close;
    $("ptInput").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    setTimeout(() => { try { $("ptInput").focus(); $("ptInput").select(); } catch (e) {} }, 30);
  }

  function showInvite(c) {
    const link = c.inviteLink(c.groupId);
    const open = c.joinOpen();
    const people = c.knownPeople();
    const m = $("confirmModal");
    // "People you've played with" replaces a friend graph entirely: anyone with
    // an account who shares a group with you. No requests, no accept/decline
    // state, nothing to keep in sync.
    const peopleHtml = people.length
      ? `<div class="inv-people">` +
        people.map((p) =>
          `<button class="person-chip" data-uid="${escapeHtml(p.uid)}">${escapeHtml(p.displayName)}</button>`).join("") +
        `</div>`
      : `<p class="muted" style="font-size:12px;margin:0">Once you've played with people who have accounts, you'll be able to invite them by name here.</p>`;
    $("confirmBox").innerHTML =
      backBtn("ivBack", "Close") +
      `<div class="power-title">Invite to ${escapeHtml(activeGroupLabel())}</div>` +
      `<p class="confirm-body" style="margin-bottom:6px">Someone you've played with:</p>` +
      peopleHtml +
      `<p class="confirm-body" style="margin:12px 0 6px">…or send a link. Opening it joins the group; they'll sign in first.</p>` +
      `<div class="acct-field"><input id="ivLink" readonly value="${escapeHtml(link)}"></div>` +
      `<div class="control-row">` +
      `<button id="ivCopy" class="primary">Copy link</button>` +
      `<button id="ivToggle" class="ghost">${open ? "Stop new members" : "Allow new members"}</button>` +
      `</div>` +
      `<p class="muted" style="font-size:12px;margin:0">${
        open ? "Anyone with the link can join." : "The link is currently disabled — nobody new can join."
      }</p>` +
      `<div class="acct-msg" id="ivMsg"></div>`;
    m.classList.remove("hidden");
    $("ivBack").onclick = () => m.classList.add("hidden");
    $("ivToggle").onclick = async () => {
      const r = await c.setJoinOpen(!open);
      if (r.ok) showInvite(c);
      else { $("ivMsg").textContent = r.message; $("ivMsg").className = "acct-msg bad"; }
    };
    $("confirmBox").querySelectorAll(".person-chip").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const r = await c.invitePerson(b.dataset.uid);
        $("ivMsg").textContent = r.ok ? `Invited ${b.textContent}.` : (r.message || "Couldn't send that invite.");
        $("ivMsg").className = "acct-msg " + (r.ok ? "good" : "bad");
      };
    });
    $("ivCopy").onclick = async () => {
      const input = $("ivLink");
      input.select();
      let done = false;
      try { await navigator.clipboard.writeText(link); done = true; } catch (e) {
        try { done = document.execCommand("copy"); } catch (e2) { done = false; }
      }
      $("ivMsg").textContent = done ? "Copied." : "Couldn't copy — select the text and copy it manually.";
      $("ivMsg").className = "acct-msg " + (done ? "good" : "bad");
    };
  }

  function renderMembersView(box, c) {
    const ms = c.members();
    const uid = c.user.uid;
    const mine = ms.some((m) => m.uid === uid);
    const rows = ms.length
      ? ms.map((m) => {
          const isMe = m.uid === uid;
          const tag = isMe ? "you" : m.uid ? "has an account" : "guest";
          // Claiming a guest seat is what makes a player's whole history follow
          // them once they sign up. The rules only permit claiming an unclaimed
          // seat, and only for yourself.
          const act = isMe
            ? `<button class="mem-act" data-act="release" data-id="${escapeHtml(m.id)}">Not me</button>`
            : !m.uid && !mine
              ? `<button class="mem-act claim" data-act="claim" data-id="${escapeHtml(m.id)}">That's me</button>`
              : "";
          const del = m.uid ? "" :
            `<button class="mem-act del" data-act="remove" data-id="${escapeHtml(m.id)}" title="Remove from roster">✕</button>`;
          return `<div class="mem-row"><span class="mem-name">${escapeHtml(m.displayName)}</span>` +
                 `<span class="mem-tag">${tag}</span>${act}${del}</div>`;
        }).join("")
      : `<div class="muted" style="font-size:13px">No one on the roster yet — players are added automatically when you record a game.</div>`;
    box.innerHTML =
      backBtn("acBack", "Back") +
      `<div class="power-title">${escapeHtml(activeGroupLabel())} — members</div>` +
      `<div class="acct-panel">` +
      `<div class="mem-list">${rows}</div>` +
      (mine ? "" : `<p class="confirm-body" style="margin:0">If one of these guests is you, mark it — your games under that name become yours.</p>`) +
      `<p class="muted" style="font-size:12px;margin:0">Anyone you type into a game is added here automatically, with or without an account.</p>` +
      `<div class="control-row"><button id="acAddMem" class="ghost">+ Add someone</button></div>` +
      `</div>`;
    $("acBack").onclick = () => { acctView = "main"; renderAccount(); };
    $("acAddMem").onclick = () => promptText(
      "Add someone", "They don't need an account.", "Name", async (name) => {
        const r = await c.addMember(name);
        acctMsg = r.ok ? null : { text: r.message || "Couldn't add them.", bad: true };
        renderAccount();
      });
    box.querySelectorAll(".mem-act").forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.id;
        if (b.dataset.act === "remove") {
          const who = ms.find((m) => m.id === id);
          askConfirm(
            {
              title: "Remove from roster?",
              body: `${(who && who.displayName) || "This player"} disappears from the roster. Games they played in are unchanged.`,
              confirm: "Remove",
              cancel: "Keep",
              danger: true,
            },
            async () => { await c.removeMember(id); renderAccount(); }
          );
          return;
        }
        const r = await c.claimSeat(id, b.dataset.act === "claim");
        acctMsg = r.ok ? null : { text: r.message || "Couldn't update that seat.", bad: true };
        renderAccount();
      };
    });
  }

  // Pending invitations, shown at the top of the account panel.
  let pendingInvites = [];
  async function refreshInvites() {
    const c = cloud();
    if (!c || !c.user) { pendingInvites = []; return; }
    pendingInvites = await c.loadInvites();
    if (!$("accountModal").classList.contains("hidden")) renderAccount();
    renderAcctChip();
  }

  function invitesHtml() {
    if (!pendingInvites.length) return "";
    return `<div class="inv-box">` +
      pendingInvites.map((i) =>
        `<div class="inv-row"><span><b>${escapeHtml(i.fromName || "Someone")}</b> invited you to ` +
        `<b>${escapeHtml(i.groupName || "a group")}</b></span>` +
        `<span class="inv-acts">` +
        `<button class="inv-yes" data-gid="${escapeHtml(i.groupId)}">Join</button>` +
        `<button class="inv-no" data-gid="${escapeHtml(i.groupId)}">Dismiss</button>` +
        `</span></div>`).join("") +
      `</div>`;
  }

  function wireInvites(box, c) {
    box.querySelectorAll(".inv-yes").forEach((b) => {
      b.onclick = async () => {
        acctMsg = { text: "Joining…", bad: false }; renderAccount();
        const r = await c.acceptInvite(b.dataset.gid);
        await refreshInvites();
        applyScope();
        acctMsg = r.ok ? { text: "Joined " + (r.name || "the group") + ".", bad: false }
                       : { text: r.message || "Couldn't join.", bad: true };
        renderAccount(); renderAcctChip(); renderSetup();
      };
    });
    box.querySelectorAll(".inv-no").forEach((b) => {
      b.onclick = async () => { await c.dismissInvite(b.dataset.gid); await refreshInvites(); renderAccount(); };
    });
  }

  // Ask once per account before pushing this device's existing games into it.
  function maybeAskUpload() {
    const c = cloud();
    if (!c || !c.user || c.uploadAllowed() !== null) return;
    const n = c.pendingCount();
    if (!n) { c.setUploadAllowed(true); return; }
    askConfirm(
      {
        title: "Add this device's games?",
        body: `There ${n === 1 ? "is" : "are"} ${n} game${n === 1 ? "" : "s"} saved on this device. Add ${n === 1 ? "it" : "them"} to your account so you can see ${n === 1 ? "it" : "them"} on your other devices?`,
        confirm: "Add to my account",
        cancel: "Keep them local only",
      },
      () => { c.setUploadAllowed(true); c.sync(); },
      () => { c.setUploadAllowed(false); c.sync(); } // still download
    );
  }

  // Online play (js/online.js) talks to us over online:* events; re-render the
  // online screen whenever the live state changes. A table that closes/leaves
  // drops us back to the browser view.
  let onlineFinishedFor = null; // guards one finish-handling per table
  function wireOnline() {
    const rerender = () => { if (!$("onlineScreen").classList.contains("hidden")) renderOnline(); };
    document.addEventListener("online:state", (e) => {
      rerender();
      // Non-hosts: once a game finishes, pull the host's recorded copy so it shows
      // up in Statistics (the host uploads it; we just need to download it).
      const O = online(), d = e.detail || {};
      const t = d.table;
      if (t && t.status === "finished" && O && !O.isHost && onlineFinishedFor !== O.tableId) {
        onlineFinishedFor = O.tableId;
        const c = cloud();
        if (c && c.user) setTimeout(() => c.sync(), 1500);
      }
    });
    document.addEventListener("online:loaded", () => { refreshOnlineTables(); rerender(); });
    document.addEventListener("online:left", () => { onlineTables = null; onlineFinishedFor = null; refreshOnlineTables(); rerender(); });
    document.addEventListener("online:closed", () => {
      onlineTables = null; onlineFinishedFor = null; refreshOnlineTables(); rerender();
      if (!$("onlineScreen").classList.contains("hidden")) showToast("The game was closed.");
    });
    // The HOST fires this once when the game ends: save it locally + upload to the
    // group so every player gets it (they download it on their next sync).
    document.addEventListener("online:finished", (e) => {
      const d = e.detail || {};
      if (!d.record) return;
      try {
        const c = cloud();
        const rec = d.record;
        if (c && c.groupId) rec.groupId = c.groupId; // record straight into the active group
        if (c && c.user) rec.createdBy = c.user.uid; // the host recorded it → they can edit its roles
        Stats.recordGame(rec);
        applyScope();
        if (!$("statsScreen").classList.contains("hidden")) renderStats();
        if (c && c.user) c.sync();
        showToast("Game over — recorded to " + activeGroupLabel() + ".");
      } catch (err) { showToast("Game over. (Couldn't auto-record — check Statistics.)"); }
    });
  }

  function wireCloud() {
    const refresh = () => {
      applyScope();
      renderAcctChip();
      if (!$("menuScreen").classList.contains("hidden")) renderMenu();
      if (!$("accountModal").classList.contains("hidden")) renderAccount();
    };
    document.addEventListener("cloud:auth", refresh);
    document.addEventListener("cloud:status", refresh);
    document.addEventListener("cloud:groups", () => {
      refresh();
      renderSetup(); // the roster suggestions depend on the active group
      syncNightVoices(); // a different active group has different shared voices
    });
    document.addEventListener("cloud:ready-to-sync", () => { refresh(); maybeAskUpload(); refreshInvites(); syncNightVoices(); });

    // Arrived via an invite link.
    document.addEventListener("cloud:invite", () => {
      const c = cloud();
      if (c && !c.user) {
        showToast("Sign in to join the group you were invited to.");
        openAccount();
      }
    });
    document.addEventListener("cloud:joined", (e) => {
      const d = e.detail || {};
      refresh();
      renderSetup();
      if (d.ok) showToast(d.already ? `You're already in ${d.name}.` : `Joined ${d.name}.`);
      else showToast(d.message || "Couldn't join that group.");
      if (!$("statsScreen").classList.contains("hidden")) renderStats();
    });
    document.addEventListener("cloud:synced", (e) => {
      refresh();
      const d = e.detail || {};
      if (d.downloaded) {
        // New games arrived from another device — repaint whatever is on screen.
        if (!$("statsScreen").classList.contains("hidden")) renderStats();
        else if (state && !state.review) renderGame();
        showToast(`${d.downloaded} game${d.downloaded === 1 ? "" : "s"} downloaded from your account.`);
      }
    });
    document.addEventListener("cloud:error", (e) => showToast((e.detail && e.detail.message) || "Cloud error."));
    $("btnAccount").onclick = openAccount;
    applyScope();
    renderAcctChip();
    renderRosterChips();
  }

  // ------------------------------ in-app dialogs -----------------------------
  // The app never uses the browser's native alert/confirm (the ugly
  // "<site> says…" bar) — everything is rendered in the app's own styling.
  const backBtn = (id, title) =>
    `<button id="${id}" class="backbtn ovl" title="${title || "Back"}"><span class="arw">←</span></button>`;

  // `onNo` fires only for an explicit "no" click — dismissing with the back
  // arrow leaves the question unanswered, so a caller storing a preference
  // will ask again rather than record a choice the user never made.
  function askConfirm(opts, onYes, onNo) {
    const m = $("confirmModal");
    $("confirmBox").innerHTML =
      backBtn("cfBack", "Cancel") +
      `<div class="power-title">${escapeHtml(opts.title)}</div>` +
      `<p class="confirm-body">${escapeHtml(opts.body)}</p>` +
      `<div class="control-row">` +
      `<button id="cfYes" class="${opts.danger ? "danger" : "primary"}">${escapeHtml(opts.confirm || "Confirm")}</button>` +
      `<button id="cfNo" class="ghost">${escapeHtml(opts.cancel || "Cancel")}</button>` +
      `</div>`;
    m.classList.remove("hidden");
    const close = () => m.classList.add("hidden");
    $("cfYes").onclick = () => { close(); if (onYes) onYes(); };
    $("cfNo").onclick = () => { close(); if (onNo) onNo(); };
    $("cfBack").onclick = close;
  }

  // ------------------------------ settings panel -----------------------------
  function openSettings() {
    renderSettings();
    $("settingsModal").classList.remove("hidden");
  }
  function renderSettings() {
    const on = settings.lieDetection;
    const bo = settings.boardOdds;
    const toggle = (id, val) =>
      `<button id="${id}" class="toggle-btn${val ? " on" : ""}" role="switch" aria-checked="${val}">${val ? "On" : "Off"}</button>`;
    $("settingsBox").innerHTML =
      backBtn("setBack", "Back") +
      `<div class="power-title">Settings</div>` +
      `<div class="set-row">` +
      `<div class="set-text">` +
      `<div class="set-name">Lie detection</div>` +
      `<div class="set-desc">Adds a <b>Claim</b> badge in History: how likely each claimed hand is to be true, ` +
      `which claims the round's cards make outright impossible, and — in a finished game's review — ` +
      `a fascist-odds read for each player. ` +
      `<span class="muted">A table that can all see this plays a different game — turn it off if you'd rather not.</span></div>` +
      `</div>` +
      toggle("setLie", on) +
      `</div>` +
      `<div class="set-row">` +
      `<div class="set-text">` +
      `<div class="set-name">Fascist odds on the table</div>` +
      `<div class="set-desc">Shows a live <b>fascist %</b> beside every player's circle during the game. ` +
      `<span class="muted">This is a strong nudge that the whole table can see — it changes how the game plays. Off by default.</span></div>` +
      `</div>` +
      toggle("setBoard", bo) +
      `</div>`;
    $("setBack").onclick = () => $("settingsModal").classList.add("hidden");
    const apply = () => {
      saveSettings();
      applySettings();
      renderSettings();
      // re-derive so the analysis is actually run (or dropped) straight away
      if (state && Array.isArray(state.players) && !$("gameScreen").classList.contains("hidden"))
        renderGame();
    };
    $("setLie").onclick = () => { settings.lieDetection = !settings.lieDetection; apply(); };
    $("setBoard").onclick = () => { settings.boardOdds = !settings.boardOdds; apply(); };
  }

  // ------------------------ "in the night" narration -------------------------
  // A start-of-game helper that plays the fascist-reveal narration so nobody at
  // the table has to read it aloud. The right script (5–6 vs 7+) is chosen from
  // the player count. Voices: two device-speech defaults, or a user's own
  // recorded/uploaded clips (stored locally in IndexedDB via js/night.js).
  let nightView = "main";           // "main" | "record"
  let nightCtl = null;              // active playback controller (stop())
  let nightStep = null;             // { i, n } while narrating, for the UI
  let nightSets = [];               // cached custom voice sets
  let nightDraft = null;            // { name, clips:{small,large}, recording }

  const nightCount = () => (state && Array.isArray(state.players) ? state.players.length : 5);
  const hasNight = () => typeof Night !== "undefined";

  function openNight() {
    if (!hasNight()) { showToast("Night narration isn't available here."); return; }
    nightStopPlayback();
    nightView = "main";
    Night.ready(); // warm the voice list
    refreshNightSets();
    syncNightVoices(); // pull any group-shared voices (no-op signed out)
    $("nightModal").classList.remove("hidden");
    renderNight();
  }
  function closeNight() {
    nightStopPlayback();
    nightDiscardDraft();
    $("nightModal").classList.add("hidden");
  }
  async function refreshNightSets() {
    try { nightSets = await Night.listSets(); } catch (e) { nightSets = []; }
    if (!$("nightModal").classList.contains("hidden")) renderNight();
  }

  function nightStopPlayback() {
    if (nightCtl) { try { nightCtl.stop(); } catch (e) {} }
    nightCtl = null; nightStep = null;
  }

  function renderNight() {
    if (nightView === "record") return renderNightRecord();
    renderNightMain();
  }

  function renderNightMain() {
    const box = $("nightBox");
    const n = nightCount();
    const key = Night.scriptKeyFor(n);
    const sel = Night.getSelected();
    const playing = !!nightCtl;

    const opt = (id, name, sub, extra) =>
      `<button class="night-voice${sel === id ? " sel" : ""}" data-sel="${escapeHtml(id)}">` +
      `<span class="nv-dot"></span>` +
      `<span class="nv-text"><span class="nv-name">${escapeHtml(name)}</span>` +
      `<span class="nv-sub">${sub}</span></span>${extra || ""}</button>`;

    const c = cloud();
    const canShare = !!(c && c.user && c.groupId);
    const myUid = c && c.user ? c.user.uid : null;

    let voices =
      opt("female", "Default — Female", "Your device's speech voice") +
      opt("male", "Default — Male", "Your device's speech voice");
    nightSets.forEach((s) => {
      const missing = !s[key];
      const complete = s.small && s.large;
      const sub = s.shared
        ? "Shared with your group"
        : missing
          ? `<span class="nv-warn">no ${Night.SCRIPT_TITLE[key]} clip yet</span>`
          : "Saved on this device";
      let extra = "";
      if (!s.shared && canShare && complete)
        extra += `<span class="nv-share" data-share="${escapeHtml(s.id)}" title="Share with your group">Share</span>`;
      if (s.shared) extra += `<span class="nv-badge" title="Synced to your group">shared</span>`;
      // you can remove a local voice, or a shared one you created; a group voice
      // shared by someone else isn't yours to delete (it would just re-download).
      if (!s.shared || (myUid && s.createdBy === myUid))
        extra += `<span class="nv-del" data-del="${escapeHtml(s.id)}" title="Delete this voice">🗑</span>`;
      voices += opt("custom:" + s.id, s.name, sub, extra);
    });

    // is the current selection actually playable for this player count?
    let playable = true, why = "";
    if (sel.startsWith("custom:")) {
      const s = nightSets.find((x) => "custom:" + x.id === sel);
      if (!s || !s[key]) { playable = false; why = `This voice has no ${Night.SCRIPT_TITLE[key]} recording.`; }
    } else if (!Night.hasSpeech()) { playable = false; why = "This browser has no speech voices."; }

    const stepLine = playing && nightStep
      ? `<div class="night-step">Narrating… line ${nightStep.i + 1} of ${nightStep.n}</div>`
      : "";

    box.innerHTML =
      backBtn("nightBack", "Close") +
      `<div class="power-title">🌙 In the night</div>` +
      `<p class="confirm-body" style="margin:0 0 10px">` +
      `<b>${n} players</b> — the <b>${Night.SCRIPT_TITLE[key]}</b> narration will play` +
      `${key === "large" ? " (Hitler stays hidden and signals with a raised thumb)." : " (Hitler opens their eyes with the fascists)."}` +
      ` Close everyone's eyes, then press play.</p>` +
      `<div class="night-voices">${voices}</div>` +
      stepLine +
      `<div class="control-row">` +
      (playing
        ? `<button id="nightStop" class="danger" style="width:100%">■ Stop</button>`
        : `<button id="nightPlay" class="primary" style="width:100%" ${playable ? "" : "disabled"}>▶ Play narration</button>`) +
      `</div>` +
      (why ? `<div class="acct-msg bad">${escapeHtml(why)}</div>` : "") +
      `<div class="control-row"><button id="nightNew" class="ghost" style="width:100%">＋ Record or upload your own voice</button></div>` +
      `<p class="muted" style="font-size:12px;margin:8px 0 0">Your own recordings are saved on this device only. ` +
      `The default voices use your browser's speech engine, so how human they sound depends on your device.</p>`;

    $("nightBack").onclick = closeNight;
    box.querySelectorAll(".night-voice").forEach((b) => {
      b.onclick = (e) => {
        if (e.target.classList.contains("nv-del") || e.target.classList.contains("nv-share")) return; // handled below
        nightStopPlayback();
        Night.setSelected(b.dataset.sel);
        renderNight();
      };
    });
    box.querySelectorAll(".nv-del").forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); nightDeleteSet(b.dataset.del); };
    });
    box.querySelectorAll(".nv-share").forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); nightShareSet(b.dataset.share); };
    });
    if ($("nightPlay")) $("nightPlay").onclick = nightPlay;
    if ($("nightStop")) $("nightStop").onclick = () => { nightStopPlayback(); renderNight(); };
    $("nightNew").onclick = () => { nightView = "record"; nightDraft = { name: "", clips: { small: null, large: null }, recording: null }; renderNight(); };
  }

  function nightPlay() {
    const n = nightCount();
    const key = Night.scriptKeyFor(n);
    const sel = Night.getSelected();
    const handlers = {
      onStep: (i, total) => { nightStep = { i, n: total }; if ($("nightModal") && !$("nightModal").classList.contains("hidden")) renderNight(); },
      onDone: () => { nightStopPlayback(); renderNight(); },
      onError: (e) => { nightStopPlayback(); renderNight(); showToast(e === "play-blocked" ? "Tap play again to allow audio." : "Couldn't play that audio."); },
    };
    if (sel.startsWith("custom:")) {
      const id = sel.slice(7);
      Night.getClip(id, key).then((blob) => {
        if (!blob) { showToast(`That voice has no ${Night.SCRIPT_TITLE[key]} recording.`); return; }
        nightCtl = Night.playBlob(blob, handlers);
        nightStep = { i: 0, n: 1 };
        renderNight();
      });
      return;
    }
    nightCtl = Night.speak(key, sel === "male" ? "male" : "female", handlers);
    renderNight();
  }

  function nightDeleteSet(id) {
    const s = nightSets.find((x) => x.id === id);
    askConfirm(
      {
        title: "Delete this voice?",
        body: s && s.shared
          ? `“${escapeHtml(s.name)}” will be removed from your group for everyone, and from this device. This can't be undone.`
          : `“${escapeHtml((s && s.name) || "This voice")}” and both of its recordings will be removed from this device. This can't be undone.`,
        confirm: "Delete", cancel: "Keep it", danger: true,
      },
      async () => {
        if (s && s.shared) {
          const c = cloud();
          if (c && c.user) {
            const r = await c.deleteVoice(id);
            if (!r || !r.ok) { showToast((r && r.message) || "Couldn't remove the shared copy — try again."); return; }
          }
        }
        if (Night.getSelected() === "custom:" + id) Night.setSelected("female");
        try { await Night.deleteSet(id); } catch (e) {}
        await refreshNightSets();
        showToast("Voice deleted.");
      }
    );
  }

  // Share an existing local voice with the group (uploads both clips as base64).
  async function nightShareSet(id) {
    const c = cloud();
    if (!c || !c.user || !c.groupId) { showToast("Sign in and pick a group to share a voice."); return; }
    const s = nightSets.find((x) => x.id === id);
    if (!s) return;
    showToast("Sharing…");
    let small, large;
    try { small = await Night.getClip(id, "small"); large = await Night.getClip(id, "large"); } catch (e) {}
    if (!small || !large) { showToast("Both clips are needed to share a voice."); return; }
    const r = await c.uploadVoice(id, s.name, { small, large });
    if (!r.ok) { showToast(r.message || "Couldn't share that voice."); return; }
    try { await Night.markShared(id, { shared: true, groupId: c.groupId, createdBy: c.user.uid }); } catch (e) {}
    await refreshNightSets();
    showToast("Voice shared with your group.");
  }

  // Pull the active group's shared voices onto this device (cached in IndexedDB
  // so playback is instant/offline), and drop local caches of group voices that
  // were deleted remotely. Additive for everything else — never touches a
  // device-only voice. Fired on sign-in, sync, and group switch.
  async function syncNightVoices() {
    const c = cloud();
    if (!c || !c.user || !c.groupId || !hasNight()) return;
    let remote;
    try { remote = await c.listRemoteVoices(); } catch (e) { return; }
    let local;
    try { local = await Night.listSets(); } catch (e) { local = []; }
    const localIds = new Set(local.map((s) => s.id));
    const remoteIds = new Set(remote.map((v) => v.id));
    let changed = false;
    for (const v of remote) {
      if (localIds.has(v.id)) continue;
      try {
        const clips = await c.downloadVoiceClips(v.id);
        if (clips.small || clips.large) { await Night.saveRemoteVoice(v.id, v.name, c.groupId, v.createdBy, clips); changed = true; }
      } catch (e) {}
    }
    for (const s of local) {
      if (s.shared && s.groupId === c.groupId && !remoteIds.has(s.id)) {
        try { await Night.deleteSet(s.id); changed = true; } catch (e) {}
      }
    }
    if (changed && !$("nightModal").classList.contains("hidden")) refreshNightSets();
  }

  // ---- record / upload a custom voice (one clip per script) ----
  function renderNightRecord() {
    const box = $("nightBox");
    const d = nightDraft;
    const rec = d.recording;
    const card = (key) => {
      const clip = d.clips[key];
      const isRec = rec && rec.key === key;
      const status = isRec
        ? `<span class="nv-rec">● recording…<span id="recTime"></span></span>`
        : clip
          ? `<span class="nv-ok">✓ ${clip.source === "uploaded" ? "uploaded" : "recorded"}</span>`
          : `<span class="muted">not recorded yet</span>`;
      const preview = clip && !isRec ? `<audio class="night-prev" controls src="${clip.url}"></audio>` : "";
      return (
        `<div class="night-card">` +
        `<div class="night-card-head"><b>${Night.SCRIPT_TITLE[key]}</b> ${status}</div>` +
        `<pre class="night-script">${escapeHtml(Night.displayScript(key))}</pre>` +
        `<div class="control-row">` +
        (isRec
          ? `<button class="danger" data-stoprec="${key}" style="flex:1">■ Stop recording</button>`
          : `<button class="primary" data-rec="${key}" style="flex:1" ${rec ? "disabled" : ""}>● Record</button>` +
            `<button class="ghost" data-upload="${key}" style="flex:1" ${rec ? "disabled" : ""}>⤒ Upload file</button>`) +
        `</div>${preview}</div>`
      );
    };

    const c = cloud();
    const canShare = !!(c && c.user && c.groupId);
    const ready = d.name.trim() && d.clips.small && d.clips.large && !rec;
    box.innerHTML =
      backBtn("nightRecBack", "Back") +
      `<div class="power-title">Record your own voice</div>` +
      `<p class="muted" style="font-size:13px;margin:0 0 8px">Record (or upload) a clip for <b>each</b> script, reading it aloud and ` +
      `pausing where marked. Both are saved under one name; the game plays the right one for the player count.</p>` +
      `<div class="acct-field"><label for="nightName">Voice name</label>` +
      `<input id="nightName" maxlength="40" placeholder="e.g. Tim's voice" value="${escapeHtml(d.name)}"></div>` +
      card("small") +
      card("large") +
      (canShare
        ? `<label class="night-share-opt"><input type="checkbox" id="nightShareChk"${d.share ? " checked" : ""}> ` +
          `Share with your group <span class="muted">(syncs to everyone; clips must be small — recordings are)</span></label>`
        : "") +
      `<div class="control-row" style="margin-top:10px">` +
      `<button id="nightSave" class="primary" style="flex:2" ${ready ? "" : "disabled"}>Save voice</button>` +
      `<button id="nightCancel" class="ghost" style="flex:1">Cancel</button>` +
      `</div>` +
      `<p class="muted" style="font-size:12px;margin:8px 0 0">Recording asks for microphone permission.` +
      `${canShare ? "" : " Your voice is saved on this device."}</p>`;

    $("nightRecBack").onclick = () => { nightStopRecording(true); nightView = "main"; renderNight(); };
    $("nightCancel").onclick = () => { nightDiscardDraft(); nightView = "main"; renderNight(); };
    const nameEl = $("nightName");
    nameEl.oninput = () => { d.name = nameEl.value; const s = $("nightSave"); if (s) s.disabled = !(d.name.trim() && d.clips.small && d.clips.large && !d.recording); };
    if ($("nightShareChk")) $("nightShareChk").onchange = (e) => { d.share = e.target.checked; };
    box.querySelectorAll("[data-rec]").forEach((b) => (b.onclick = () => nightStartRecording(b.dataset.rec)));
    box.querySelectorAll("[data-stoprec]").forEach((b) => (b.onclick = () => nightStopRecording(false)));
    box.querySelectorAll("[data-upload]").forEach((b) => (b.onclick = () => nightPickUpload(b.dataset.upload)));
    $("nightSave").onclick = nightSaveDraft;
    if (rec) startRecTimer();
  }

  let recTimer = null;
  function startRecTimer() {
    stopRecTimer();
    recTimer = setInterval(() => {
      const el = $("recTime");
      if (!el || !nightDraft || !nightDraft.recording) return;
      const s = Math.round((performance.now() - nightDraft.recording.startedAt) / 1000);
      el.textContent = " " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }, 500);
  }
  function stopRecTimer() { if (recTimer) { clearInterval(recTimer); recTimer = null; } }

  async function nightStartRecording(key) {
    if (nightDraft.recording) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) { showToast("Recording isn't supported in this browser — try Upload file."); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { showToast("Microphone permission is needed to record — or use Upload file."); return; }
    const chunks = [];
    let rec;
    // A modest bitrate keeps a spoken clip small enough to sync (well under the
    // ~700 KB per-clip cap) while staying clearly intelligible.
    try { rec = new MediaRecorder(stream, { audioBitsPerSecond: 32000 }); }
    catch (e) { try { rec = new MediaRecorder(stream); } catch (e2) { stream.getTracks().forEach((t) => t.stop()); showToast("Couldn't start recording."); return; } }
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      stream.getTracks().forEach((t) => t.stop());
      stopRecTimer();
      if (nightDraft) { nightDraft.recording = null; if (blob.size) nightSetClip(key, blob, "recorded"); else renderNight(); }
    };
    nightDraft.recording = { key, rec, stream, startedAt: performance.now() };
    rec.start();
    renderNight();
  }
  function nightStopRecording(discard) {
    const r = nightDraft && nightDraft.recording;
    if (!r) return;
    if (discard) { // abandon without saving the take
      try { r.rec.onstop = null; r.rec.stop(); } catch (e) {}
      try { r.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      nightDraft.recording = null; stopRecTimer();
    } else {
      try { r.rec.stop(); } catch (e) {} // onstop stores the clip
    }
  }

  function nightPickUpload(key) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "audio/*";
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) nightSetClip(key, f, "uploaded"); };
    inp.click();
  }
  function nightSetClip(key, blob, source) {
    const old = nightDraft.clips[key];
    if (old && old.url) { try { URL.revokeObjectURL(old.url); } catch (e) {} }
    nightDraft.clips[key] = { blob, url: URL.createObjectURL(blob), source };
    renderNight();
  }
  function nightDiscardDraft() {
    if (recTimer) stopRecTimer();
    if (nightDraft) {
      if (nightDraft.recording) { try { nightDraft.recording.rec.onstop = null; nightDraft.recording.rec.stop(); } catch (e) {} try { nightDraft.recording.stream.getTracks().forEach((t) => t.stop()); } catch (e) {} }
      ["small", "large"].forEach((k) => { const c = nightDraft.clips[k]; if (c && c.url) { try { URL.revokeObjectURL(c.url); } catch (e) {} } });
    }
    nightDraft = null;
  }
  async function nightSaveDraft() {
    const d = nightDraft;
    if (!d || !d.name.trim() || !d.clips.small || !d.clips.large) return;
    let setRec;
    try {
      setRec = await Night.createSet(d.name.trim());
      await Night.putClip(setRec.id, "small", d.clips.small.blob);
      await Night.putClip(setRec.id, "large", d.clips.large.blob);
      Night.setSelected("custom:" + setRec.id);
    } catch (e) { showToast("Couldn't save that voice — storage may be full."); return; }
    // optional: share it with the group (upload both clips as base64)
    let toast = "Voice saved.";
    if (d.share) {
      const c = cloud();
      if (c && c.user && c.groupId) {
        const r = await c.uploadVoice(setRec.id, d.name.trim(), { small: d.clips.small.blob, large: d.clips.large.blob });
        if (r.ok) { try { await Night.markShared(setRec.id, { shared: true, groupId: c.groupId, createdBy: c.user.uid }); } catch (e) {} toast = "Voice saved and shared with your group."; }
        else toast = r.message || "Saved on this device — couldn't share it.";
      }
    }
    nightDiscardDraft();
    nightView = "main";
    await refreshNightSets();
    showToast(toast);
  }

  let toastTimer = null;
  function showToast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2400);
  }

  // The one back affordance: top-left arrow. It undoes during play (labelled
  // "undo") and leaves a review otherwise.
  function renderBackTop() {
    const b = $("btnBackTop");
    if (!b) return;
    const review = !!(state && state.review);
    b.classList.toggle("labeled", !review);
    b.title = review ? "Back to statistics" : "Undo last action";
    b.disabled = review ? false : !(state && state.undoStack && state.undoStack.length);
  }

  // ------------------------------ wiring -------------------------------------
  function wire() {
    $("btnAddPlayer").onclick = addPlayer;
    $("nameInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addPlayer();
    });
    $("btnRandomize").onclick = startGame;
    $("btnNewTop").onclick = () => {
      if (state && state.review) { closeReview(); return; }
      if (!state) { resetToSetup(); return; }
      askConfirm(
        {
          title: "Start a new game?",
          body: "This game will be erased. It is only kept in your statistics if you finish it and record the roles.",
          confirm: "New game",
          cancel: "Keep playing",
          danger: true,
        },
        resetToSetup
      );
    };
    $("btnQuitTop").onclick = () => {
      if (state && state.review) { closeReview(); return; }
      askConfirm(
        {
          title: "Quit game?",
          body: "All data for this game will be erased. Are you sure?",
          confirm: "Quit game",
          cancel: "Keep playing",
          danger: true,
        },
        goHome // abandon the game and return to the main menu
      );
    };
    $("btnBackTop").onclick = () => {
      if (state && state.review) { closeReview(); return; }
      undoLast();
    };
    // Arrow keys scrub a review playback back and forth.
    document.addEventListener("keydown", (e) => {
      if (!state || !state.review) return;
      const t = e.target && e.target.tagName;
      if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
      if (e.key === "ArrowLeft") { reviewGoto((state.reviewStep || 0) - 1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { reviewGoto((state.reviewStep || 0) + 1); e.preventDefault(); }
    });
    // main menu
    $("btnMenuStart").onclick = openSetup;
    $("btnMenuStats").onclick = openStats;
    $("btnMenuRules").onclick = openRules;
    $("btnMenuTheory").onclick = openTheory;
    $("btnMenuOnline").onclick = openOnline;
    $("btnGroupBox").onclick = openAccount; // group box is a shortcut to the switcher
    $("btnBackFromSetup").onclick = navBack;
    $("btnBackFromRules").onclick = navBack;
    $("btnBackFromTheory").onclick = navBack;
    $("btnBackFromOnline").onclick = navBack;
    $("btnSettings").onclick = openSettings;
    $("btnSettingsGame").onclick = openSettings;
    $("btnNight").onclick = openNight;
    $("btnBackFromStats").onclick = navBack;
    $("btnExportStats").onclick = exportStats;
    $("btnImportStats").onclick = () => $("importFile").click();
    $("importFile").onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = ""; // let the same file be picked again after a failure
      if (f) importStats(f);
    };
    // Clearing is the one bulk-delete a user can trigger, and for a signed-out
    // device that never synced it is unrecoverable — so it is deliberately hard
    // to do by accident: we take an automatic backup download FIRST, then ask a
    // second time before erasing anything. (Signed-in games also survive in the
    // account and re-download, so this only ever clears THIS device.)
    $("btnClearStats").onclick = () => {
      const total = Stats.loadAllGames().length;
      if (!total) {
        showToast("There are no statistics to clear.");
        return;
      }
      const plural = total === 1 ? "" : "s";
      askConfirm(
        {
          title: "Clear statistics from this device?",
          body:
            `This removes all ${total} saved game${plural} stored in this browser. ` +
            `A backup file will download first so nothing is lost — you can restore it any time with Import data. Continue?`,
          confirm: "Download backup & continue",
          cancel: "Cancel",
          danger: true,
        },
        () => {
          const backup = downloadArchive("secret-hitler-backup");
          askConfirm(
            {
              title: "Erase this device now?",
              body: backup
                ? `Your backup "${backup.name}" has downloaded. Permanently remove all ${total} game${plural} from this browser now? ` +
                  `Any games in a signed-in account stay safe and will sync back.`
                : `Permanently remove all statistics from this browser now?`,
              confirm: "Erase this device",
              cancel: "Keep my statistics",
              danger: true,
            },
            () => {
              Stats.clearAll();
              renderStats();
              showToast("Statistics cleared from this device.");
            }
          );
        }
      );
    };

    $("btnFail").onclick = recordFail;
    $("btnConflict").onclick = () => {
      state.form.conflictArmed = !state.form.conflictArmed;
      if (state.form.conflictArmed) state.form.vetoArmed = false;
      renderControls(derive());
    };
    $("btnVeto").onclick = () => {
      state.form.vetoArmed = !state.form.vetoArmed;
      if (state.form.vetoArmed) state.form.conflictArmed = false;
      renderControls(derive());
    };
    $("btnHitlerChan").onclick = recordHitlerElected;
    $("chaosLib").onclick = () => resolveChaos("L");
    $("chaosFac").onclick = () => resolveChaos("F");
    $("chaosBack").onclick = undoLast;

    document.querySelectorAll(".tabbar .tab").forEach((b) => {
      b.onclick = () => switchTab(b.dataset.tab);
    });

    wireCloud();
    wireOnline();
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

  // ------------------------------ accessibility ------------------------------
  // Centralised dialog a11y so the ~7 overlays don't each need retrofitting: mark
  // them as modal dialogs, and when one opens move focus into it, trap Tab inside,
  // close on Esc, and restore focus to whatever was focused before it opened.
  function initA11y() {
    const overlays = Array.prototype.slice.call(document.querySelectorAll(".overlay"));
    const focusablesIn = (el) =>
      Array.prototype.slice
        .call(el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((n) => n.getClientRects().length > 0);
    const isOpen = (o) => !o.classList.contains("hidden");
    const returnFocus = new WeakMap();

    overlays.forEach((o) => {
      o.setAttribute("role", "dialog");
      o.setAttribute("aria-modal", "true");
      const box = o.querySelector(".overlay-box") || o;
      const setLabel = () => {
        const t = box.querySelector(".power-title, .role-title, h3");
        if (t && t.textContent.trim()) o.setAttribute("aria-label", t.textContent.trim());
      };
      new MutationObserver(() => {
        if (isOpen(o)) {
          if (!returnFocus.get(o)) returnFocus.set(o, document.activeElement);
          setLabel();
          // focus the first real control, skipping the back arrow when there's an action
          const f = focusablesIn(box);
          const target = f.filter((n) => !n.classList.contains("backbtn"))[0] || f[0] || box;
          setTimeout(() => { try { target.focus(); } catch (e) {} }, 0);
        } else {
          const prev = returnFocus.get(o);
          returnFocus.set(o, null);
          if (prev && document.contains(prev)) { try { prev.focus(); } catch (e) {} }
        }
      }).observe(o, { attributes: true, attributeFilter: ["class"] });
    });

    // Key handling for whichever overlay is currently open (topmost in the DOM).
    document.addEventListener("keydown", (e) => {
      const open = overlays.filter(isOpen);
      if (!open.length) return;
      const o = open[open.length - 1];
      if (e.key === "Escape") {
        const back = o.querySelector(".backbtn");
        if (back) { e.preventDefault(); back.click(); }
      } else if (e.key === "Tab") {
        const f = focusablesIn(o);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  // ------------------------------ boot ---------------------------------------
  loadSettings();
  wire();
  initA11y();
  const resumed = loadActive();
  if (resumed) {
    // resume the in-progress game exactly where it left off
    state = resumed;
    setupPlayers = JSON.parse(lsGet(SETUP_KEY) || "[]");
    show("gameScreen");
    switchTab("play");
    renderGame();
  } else {
    // no active game — open the main menu. The roster is restored lazily when
    // the player opens "Start game" (renderSetup runs then).
    try {
      const saved = JSON.parse(lsGet(SETUP_KEY));
      if (Array.isArray(saved)) setupPlayers = saved;
    } catch (e) {}
    show("menuScreen");
  }
})();
