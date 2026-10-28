/* ============================================================================
 * bots.js — computer players for Secret Hitler (pure, no DOM, no network).
 *
 * A bot sees ONLY what a real player sees: the public table view
 * (Engine.publicView), its own private view (Engine.privateView) and its own
 * memory of what it watched happen (votes, what it passed or was passed). It
 * never reads the host's secret state, so it plays fair at any table.
 *
 *   const mem = Bots.newMemory();
 *   Bots.observe(mem, pub, priv, uid);              // after every state change
 *   const a = Bots.act(pub, priv, uid, level, mem, rng); // null = nothing to do
 *   // a is an engine action without `by` ({type:'vote', vote:'ja'} …)
 *
 * Levels: "easy" (votes on gut feel, poor liar), "normal" (reads the policy
 * record, lies with a cover story), "hard" (also reads votes, nominations,
 * executions; fascists build trust early and steer Hitler into office).
 * Win rates per level are measured by test/bots.test.js (node self-play).
 *
 * Classic script exposing `window.Bots`; also `module.exports` for Node tests.
 * ==========================================================================*/
(function () {
  const LEVELS = ["easy", "normal", "hard"];
  const EPS = 0.02; // chance an "impossible" story is just a mistake

  function newMemory() {
    return { elections: [], myPres: {}, myChan: {}, peeks: [], cache: null };
  }

  // ------------------------------------------------------------ small helpers
  const idxOf = (pub, uid) => pub.seatOrder.indexOf(uid);
  const alive = (pub, uid) => (pub.deadUids || []).indexOf(uid) < 0;
  const aliveUids = (pub) => pub.seatOrder.filter((u) => alive(pub, u));
  const facTotal = (n) => Math.ceil(n / 2) - 1;
  const isElec = (e) => e && (e.type === "gov" || e.type === "fail" || e.type === "hitler");
  const LEGIS = { president_play: 1, chancellor_play: 1, veto: 1 };

  // Election ordinal k ↔ the k-th fail/gov/hitler event in the public log.
  function currentElectionOrdinal(pub) {
    const c = (pub.events || []).filter(isElec).length;
    return LEGIS[pub.phase] ? c : c - 1;
  }

  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
  function argBest(arr, score, rng) {
    let best = -Infinity, out = [];
    arr.forEach((x) => {
      const s = score(x) + rng() * 1e-6;
      if (s > best + 1e-9) { best = s; out = [x]; } else if (Math.abs(s - best) <= 1e-9) out.push(x);
    });
    return out.length ? pick(out, rng) : null;
  }
  const libsIn = (cards) => (cards || []).filter((c) => c === "L").length;

  // Hypergeometric P(k liberals in 3 draws) from a pool of N cards with L libs.
  function drawDist(N, L) {
    const C = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
    const tot = C(N, 3) || 1;
    return [0, 1, 2, 3].map((k) => C(L, k) * C(N - L, 3 - k) / tot);
  }

  // ----------------------------------------------------------- observation
  /** Record what this bot just watched: the vote record and its own hands. */
  function observe(mem, pub, priv, uid) {
    if (!pub) return;
    if (pub.lastElection) {
      const k = currentElectionOrdinal(pub);
      if (k >= 0 && !mem.elections[k]) mem.elections[k] = pub.lastElection;
    }
    const k = currentElectionOrdinal(pub);
    if (priv && priv.passed && pub.chancellorUid === uid && k >= 0) mem.myChan[k] = priv.passed.slice();
    if (priv && priv.learned) {
      // The j-th peek I learned belongs to the j-th gov event I presided that
      // carries a policy-peek power (the public log says when, not what).
      const me = idxOf(pub, uid);
      const peekEvents = [];
      (pub.events || []).forEach((e, ei) => {
        if (e.power && e.power.type === "policy-peek" && e.presidentIdx === me) peekEvents.push(ei);
      });
      let j = 0;
      priv.learned.forEach((l) => {
        if (l.type !== "peek") return;
        if (!mem.peeks[j] && peekEvents[j] != null) mem.peeks[j] = { cards: l.cards.slice(), afterEvent: peekEvents[j] };
        j++;
      });
    }
  }

  // ------------------------------------------------------------- inference
  // Likelihood of one government's public outcome given whether its President
  // and Chancellor are fascist. Sums over the hidden hand (h liberals drawn) and
  // what was passed (pl liberals), using what THIS bot privately knows.
  function govFactor(g, ctx, presF, chanF) {
    const d = ctx.knownH != null ? [0, 1, 2, 3].map((k) => (k === ctx.knownH ? 1 : 0)) : ctx.dist;
    let total = 0;
    for (let h = 0; h <= 3; h++) {
      if (!d[h]) continue;
      // President: what they pass and what they claim.
      const passOpts = [];
      if (!presF) passOpts.push([Math.min(h, 2), 1]);
      else if (h === 0) passOpts.push([0, 1]);
      else if (h === 1) { passOpts.push([0, 0.7]); passOpts.push([1, 0.3]); }
      else if (h === 2) { passOpts.push([1, 0.6]); passOpts.push([2, 0.4]); }
      else passOpts.push([2, 1]);
      for (const [pl, pp] of passOpts) {
        if (ctx.knownPassed != null && ctx.knownPassed !== pl) continue;
        let pc;
        if (!presF) pc = g.claimLibs === h ? 1 - EPS : EPS / 3;
        else { const cover = pl < 2 ? pl : h; pc = g.claimLibs === cover ? 0.85 : 0.05; }
        // Chancellor: what gets enacted from pl liberals + (2-pl) fascists.
        let pe;
        if (g.vetoed || g.enacted == null) pe = pl === 0 ? 0.8 : 0.2;
        else if (pl === 2) pe = g.enacted === "L" ? 1 : EPS;
        else if (pl === 0) pe = g.enacted === "F" ? 1 : EPS;
        else pe = chanF ? (g.enacted === "F" ? 0.8 : 0.2) : (g.enacted === "L" ? 1 - EPS : EPS);
        total += d[h] * pp * pc * pe;
      }
    }
    return Math.max(total, 1e-6);
  }

  /**
   * Belief over roles from `meUid`'s point of view: P(fascist team) and
   * P(Hitler) per seat. `view`: "private" (uses own knowledge) or "public" (what
   * a neutral onlooker would think — fascists use it to judge their cover).
   */
  function beliefs(pub, priv, uid, level, mem, view) {
    const n = pub.n, f = facTotal(n);
    const key = view + "|" + (pub.events || []).length + "|" + mem.elections.length + "|" + ((priv && priv.learned) || []).length + "|" + (pub.deadUids || []).length;
    mem.cache = mem.cache || {};
    const hit = mem.cache[view];
    if (hit && hit.key === key) return hit.res;

    const me = idxOf(pub, uid);
    const pvt = view === "private";
    const forcedL = new Set(), forcedF = new Set(), notH = new Set();
    let forcedH = null;
    if (pvt && priv && priv.role) {
      if (priv.role === "liberal") forcedL.add(me);
      else {
        forcedF.add(me);
        if (priv.role === "hitler") forcedH = me; else notH.add(me);
        (priv.knownFascists || []).forEach((u) => { forcedF.add(idxOf(pub, u)); notH.add(idxOf(pub, u)); });
        if (priv.knownHitler) { forcedF.add(idxOf(pub, priv.knownHitler)); forcedH = idxOf(pub, priv.knownHitler); }
      }
      (priv.learned || []).forEach((l) => {
        if (l.type === "investigate") (l.party === "Fascist" ? forcedF : forcedL).add(idxOf(pub, l.target));
      });
    }
    // A dead player who didn't end the game wasn't Hitler (public).
    (pub.deadUids || []).forEach((u) => { if (pub.phase !== "gameover") notH.add(idxOf(pub, u)); });

    // Per-government pair factors [LL, LF, FL, FF] (president, chancellor).
    const govs = [];
    let lib = 0, fac = 0, elec = -1, lastChaosAt = -1;
    (pub.events || []).forEach((e, ei) => {
      if (isElec(e)) elec++;
      if (e.type === "chaos") { lastChaosAt = ei; if (e.enacted === "L") lib++; else fac++; return; }
      if (e.type !== "gov") return;
      // deckFac: Fascist cards in the deck (11, or fewer in a rebalanced game)
      const deck = (pub.deckFac == null ? 11 : pub.deckFac) + 6;
      const ctx = { dist: drawDist(Math.max(3, deck - lib - fac), Math.max(0, 6 - lib)), knownH: null, knownPassed: null };
      if (pvt) {
        if (mem.myPres[elec]) { ctx.knownH = mem.myPres[elec].h; ctx.knownPassed = mem.myPres[elec].pl; }
        if (mem.myChan[elec] != null) ctx.knownPassed = libsIn(mem.myChan[elec]);
        mem.peeks.forEach((p) => {
          if (!p) return;
          // the first gov after the peek draws exactly those cards (no chaos between)
          if (ei > p.afterEvent && lastChaosAt <= p.afterEvent) {
            const firstGovAfter = (pub.events || []).findIndex((x, xi) => xi > p.afterEvent && x.type === "gov");
            if (firstGovAfter === ei) ctx.knownH = libsIn(p.cards);
          }
        });
      }
      const P = e.presidentIdx, C = e.chancellorIdx;
      const tab = [govFactor(e, ctx, false, false), govFactor(e, ctx, false, true), govFactor(e, ctx, true, false), govFactor(e, ctx, true, true)];
      govs.push({ P, C, tab, e, elec });
      if (e.enacted === "L") lib++; else if (e.enacted === "F") fac++;
    });

    const deep = level === "hard";
    // A "normal" reader weighs the evidence less sharply than a "hard" one.
    const temper = view === "private" && level !== "hard" ? 0.6 : 1;
    // enumerate fascist sets of size f with a Hitler inside
    const seats = [...Array(n).keys()];
    const out = { pF: new Array(n).fill(0), pH: new Array(n).fill(0) };
    let Z = 0;
    const set = new Array(n).fill(false);
    const choose = (start, left, chosen) => {
      if (left === 0) { scoreSet(chosen); return; }
      for (let i = start; i <= n - left; i++) { chosen.push(i); choose(i + 1, left - 1, chosen); chosen.pop(); }
    };
    const scoreSet = (S) => {
      for (const i of forcedL) if (S.indexOf(i) >= 0) return;
      for (const i of forcedF) if (S.indexOf(i) < 0) return;
      seats.forEach((i) => { set[i] = false; }); S.forEach((i) => { set[i] = true; });
      let base = 1;
      for (const g of govs) base *= g.tab[(set[g.P] ? 2 : 0) + (set[g.C] ? 1 : 0)];
      if (temper !== 1) base = Math.pow(base, temper);
      if (deep) {
        // Votes: fascists back their own governments, and F-results draw ja votes.
        mem.elections.forEach((el, k) => {
          if (!el || !el.votes) return;
          const pI = idxOf(pub, el.presUid), cI = idxOf(pub, el.nomineeUid);
          const team = set[pI] || set[cI];
          const g = govs.find((x) => x.elec === k);
          Object.keys(el.votes).forEach((u) => {
            const v = idxOf(pub, u); if (v < 0 || !set[v] || v === pI || v === cI) return;
            if (el.votes[u] === "ja") base *= team ? 1.25 : (g && g.e.enacted === "F" ? 1.1 : 0.9);
            else base *= team ? 0.7 : 1.05;
          });
        });
      }
      if (base <= 0) return;
      for (const H of S) {
        if (notH.has(H)) continue;
        if (forcedH != null && H !== forcedH) continue;
        let w = base;
        if (deep) {
          const knows = (i) => set[i] && (i !== H || n <= 6);
          govs.forEach((g) => { if (knows(g.P)) w *= set[g.C] ? 1.3 : 0.9; });
          (pub.events || []).forEach((e) => {
            const p = e.power; if (!p) return;
            if (p.type === "execution" && knows(e.presidentIdx)) w *= set[p.target] ? 0.08 : 1.1;
            if (p.type === "special-election" && knows(e.presidentIdx)) w *= set[p.target] ? 1.4 : 0.9;
          });
        }
        Z += w;
        S.forEach((i) => { out.pF[i] += w; });
        out.pH[H] += w;
      }
    };
    choose(0, f, []);
    if (Z > 0) { for (let i = 0; i < n; i++) { out.pF[i] /= Z; out.pH[i] /= Z; } }
    else { for (let i = 0; i < n; i++) { out.pF[i] = f / n; out.pH[i] = 1 / n; } }
    const res = { pF: {}, pH: {} };
    pub.seatOrder.forEach((u, i) => { res.pF[u] = out.pF[i]; res.pH[u] = out.pH[i]; });
    mem.cache[view] = { key, res }; // keep only the latest per view (memory stays small)
    return res;
  }

  // ------------------------------------------------------------- decisions
  function roleInfo(pub, priv, uid) {
    const role = (priv && priv.role) || "liberal";
    const allies = new Set();
    if (role !== "liberal") {
      (priv.knownFascists || []).forEach((u) => allies.add(u));
      if (priv.knownHitler) allies.add(priv.knownHitler);
    }
    const hitler = role === "fascist" ? priv.knownHitler : role === "hitler" ? uid : null;
    // a regular fascist (or a 5–6p Hitler) knows the team; a 7+ Hitler is blind
    const knowsTeam = role === "fascist" || (role === "hitler" && allies.size > 0);
    return { role, allies, hitler, knowsTeam, fasc: role !== "liberal" };
  }

  function noisy(level, rng) { return level === "easy" ? 0.35 : level === "normal" ? 0.12 : 0.04; }

  function act(pub, priv, uid, level, mem, rng) {
    rng = rng || Math.random;
    level = LEVELS.indexOf(level) >= 0 ? level : "normal";
    if (!pub || pub.phase === "gameover" || !alive(pub, uid)) return null;
    observe(mem, pub, priv, uid);
    const R = roleInfo(pub, priv, uid);
    const ph = pub.phase;
    const isPres = pub.presUid === uid;

    if (ph === "nominate" && isPres) return { type: "nominate", target: chooseNominee(pub, priv, uid, level, mem, rng, R) };
    if (ph === "vote" && (pub.votedUids || []).indexOf(uid) < 0) return { type: "vote", vote: chooseVote(pub, priv, uid, level, mem, rng, R) };
    if (ph === "president_play" && isPres && priv && priv.drawn) return presidentPlay(pub, priv, uid, level, mem, rng, R);
    if (ph === "chancellor_play" && pub.chancellorUid === uid && priv && priv.passed) return chancellorPlay(pub, priv, uid, level, mem, rng, R);
    if (ph === "veto" && isPres) {
      const k = currentElectionOrdinal(pub);
      const passedFF = mem.myPres[k] && mem.myPres[k].pl === 0;
      return { type: "veto", agree: !R.fasc && passedFF };
    }
    if (ph.indexOf("power_") === 0 && isPres) return usePower(ph.slice(6), pub, priv, uid, level, mem, rng, R);
    return null;
  }

  function chooseNominee(pub, priv, uid, level, mem, rng, R) {
    const tl = pub.termLimited || [];
    const opts = aliveUids(pub).filter((u) => u !== uid && tl.indexOf(u) < 0);
    if (!opts.length) return null;
    if (level === "easy" && (R.knowsTeam || rng() < 0.5)) {
      if (R.knowsTeam) { const al = opts.filter((u) => R.allies.has(u)); if (al.length) return pick(al, rng); }
      return pick(opts, rng);
    }
    if (R.role === "hitler" && level === "hard") {
      // Hitler hides: nominate whoever a liberal onlooker trusts most.
      const pubB = beliefs(pub, null, uid, level, mem, "public");
      return argBest(opts, (u) => -pubB.pF[u], rng);
    }
    if (R.knowsTeam) {
      const h = R.hitler;
      if (pub.facEnacted >= 3 && h && h !== uid && opts.indexOf(h) >= 0) {
        if (level !== "hard") return h;
        const pubB = beliefs(pub, null, uid, level, mem, "public");
        if (pubB.pF[h] < 0.75 || rng() < 0.4) return h;
      }
      const al = opts.filter((u) => R.allies.has(u));
      const libs = opts.filter((u) => !R.allies.has(u));
      const pAlly = level === "hard" ? 0.35 : 0.5;
      if (al.length && (rng() < pAlly || !libs.length)) return pick(al, rng);
      if (level === "hard") {
        const pubB = beliefs(pub, null, uid, level, mem, "public");
        return argBest(libs, (u) => -pubB.pF[u], rng); // look reasonable: pick the most trusted
      }
      return pick(libs.length ? libs : opts, rng);
    }
    const B = beliefs(pub, priv, uid, level, mem, "private");
    const late = pub.facEnacted >= 3;
    return argBest(opts, (u) => -(B.pF[u] + (late ? 2 * B.pH[u] : 0)) + (rng() - 0.5) * noisy(level), rng);
  }

  function chooseVote(pub, priv, uid, level, mem, rng, R) {
    const P = pub.presUid, C = pub.nomineeUid;
    if (P === uid || C === uid) return "ja";
    const late = pub.facEnacted >= 3;
    if (R.knowsTeam) {
      if (late && C === R.hitler) return "ja";
      if (R.allies.has(P) || R.allies.has(C)) return level === "easy" || rng() < (level === "hard" ? 0.75 : 0.9) ? "ja" : "nein";
      if (pub.libEnacted >= 4) return "nein";
      if (level === "easy") return rng() < 0.3 ? "ja" : "nein";
      if (pub.tracker >= 2) return rng() < 0.4 ? "ja" : "nein";
      // blend in: vote like a liberal onlooker would
      if (level === "hard") {
        const pubB = beliefs(pub, null, uid, level, mem, "public");
        return pubB.pF[P] + pubB.pF[C] < 0.9 ? (rng() < 0.6 ? "ja" : "nein") : "nein";
      }
      return rng() < 0.45 ? "ja" : "nein";
    }
    if (level === "easy") {
      if ((pub.events || []).filter(isElec).length === 0) return "ja";
      return rng() < 0.62 ? "ja" : "nein";
    }
    const B = beliefs(pub, priv, uid, level, mem, "private");
    const n = pub.n, f = facTotal(n);
    if (late && B.pH[C] > (level === "hard" ? 0.2 : 0.34)) return "nein";
    if ((pub.events || []).filter(isElec).length === 0) return "ja";
    const trust = (1 - B.pF[P]) * (1 - B.pF[C]);
    const baseline = Math.pow(1 - f / n, 2);
    let need = baseline * (level === "hard" ? 0.95 : 0.75);
    if (pub.tracker >= 2) need *= 0.55;
    if (pub.libEnacted >= 4) need *= 0.8;
    const jitter = (rng() - 0.5) * noisy(level, rng) * 0.6;
    return trust + jitter >= need ? "ja" : "nein";
  }

  function presidentPlay(pub, priv, uid, level, mem, rng, R) {
    const cards = priv.drawn;
    const h = libsIn(cards);
    const idxF = cards.indexOf("F"), idxL = cards.indexOf("L");
    const k = currentElectionOrdinal(pub);
    const done = (discard, claim) => {
      const passed = cards.filter((_, i) => i !== discard);
      mem.myPres[k] = { h, pl: libsIn(passed) };
      return { type: "president_play", discard, claim };
    };
    if (!R.fasc) return done(idxF >= 0 ? idxF : 0, h);
    if (h === 0) return done(0, 0);
    if (h === 3) return done(0, 3);
    const chanAlly = R.allies.has(pub.chancellorUid);
    const early = pub.facEnacted + pub.libEnacted <= 1;
    let honest;
    if (level === "easy") honest = rng() < 0.25;
    else if (pub.libEnacted >= 4) honest = false;
    else if (R.role === "hitler") honest = pub.libEnacted >= 3 && !chanAlly ? rng() < 0.3 : rng() < (level === "hard" ? 0.92 : 0.6);
    else if (h === 2 && !chanAlly) honest = true; // a liberal chancellor enacts L anyway — don't lie for nothing
    else honest = level === "hard" ? (early ? rng() < 0.45 : rng() < 0.15) : rng() < 0.08;
    if (honest) return done(idxF, h);
    // Pass as many fascists as possible and claim the matching cover story.
    const discard = idxL;
    const passedLibs = h - 1;
    let claim = passedLibs; // FF → "drew 3F", FL → "drew 2F 1L"
    if (level === "easy" && rng() < 0.5) claim = h; // a poor liar tells the truth about the draw
    return done(discard, claim);
  }

  function chancellorPlay(pub, priv, uid, level, mem, rng, R) {
    const cards = priv.passed;
    const k = currentElectionOrdinal(pub);
    mem.myChan[k] = cards.slice();
    const iL = cards.indexOf("L"), iF = cards.indexOf("F");
    if (!R.fasc) {
      if (iL < 0 && pub.facEnacted >= 5 && !pub.vetoRefused) return { type: "chancellor_play", veto: true };
      return { type: "chancellor_play", enact: iL >= 0 ? iL : 0 };
    }
    if (iF < 0) return { type: "chancellor_play", enact: 0 };
    if (iL < 0) return { type: "chancellor_play", enact: 0 };
    if (pub.facEnacted >= 5 || pub.libEnacted >= 4 || level === "easy") return { type: "chancellor_play", enact: iF };
    const presAlly = R.allies.has(pub.presUid);
    const early = pub.facEnacted + pub.libEnacted <= 1;
    let pL = 0.1;
    if (R.role === "hitler") pL = pub.facEnacted >= 3 ? 0.2 : level === "hard" ? 0.85 : 0.5; // Hitler keeps a clean record
    else if (level === "hard") pL = presAlly ? 0.05 : early ? 0.4 : 0.15;
    return { type: "chancellor_play", enact: rng() < pL ? iL : iF };
  }

  function usePower(kind, pub, priv, uid, level, mem, rng, R) {
    if (kind === "peek") return { type: "power" };
    const others = aliveUids(pub).filter((u) => u !== uid);
    let opts = others;
    if (kind === "investigate") opts = others.filter((u) => (pub.investigatedUids || []).indexOf(u) < 0);
    if (!opts.length) opts = others;
    let target;
    if (level === "easy" && rng() < 0.5) {
      target = R.knowsTeam && kind !== "special" ? pick(opts.filter((u) => !R.allies.has(u)).concat([]), rng) || pick(opts, rng) : pick(opts, rng);
    } else if (R.knowsTeam) {
      const libs = opts.filter((u) => !R.allies.has(u) && u !== R.hitler);
      const al = opts.filter((u) => R.allies.has(u) || u === R.hitler);
      if (kind === "special") target = al.length ? (al.indexOf(R.hitler) >= 0 && pub.facEnacted >= 3 ? R.hitler : pick(al, rng)) : pick(opts, rng);
      else if (kind === "execute" && level === "hard" && libs.length) {
        const pubB = beliefs(pub, null, uid, level, mem, "public");
        target = argBest(libs, (u) => -pubB.pF[u], rng); // the most trusted liberal
      } else target = libs.length ? pick(libs, rng) : pick(opts, rng);
    } else {
      const B = beliefs(pub, priv, uid, level, mem, "private");
      const nz = noisy(level, rng);
      if (kind === "investigate") target = argBest(opts, (u) => (level === "hard" ? -Math.abs(B.pF[u] - 0.5) : B.pF[u]) + (rng() - 0.5) * nz, rng);
      else if (kind === "special") target = argBest(opts, (u) => -B.pF[u] + (rng() - 0.5) * nz, rng);
      else target = argBest(opts, (u) => B.pF[u] + (level === "hard" ? B.pH[u] : 0.5 * B.pH[u]) + (rng() - 0.5) * nz, rng);
    }
    return { type: "power", target: target || opts[0] };
  }

  const api = { LEVELS, newMemory, observe, act, beliefs, _govFactor: govFactor, _drawDist: drawDist };
  if (typeof window !== "undefined") window.Bots = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
