/* ============================================================================
 * derive.js — the pure "rules engine" for the Secret Hitler companion.
 *
 * derive(state, deps) walks state.events ONCE and returns all the bookkeeping the
 * app renders from: enacted counts, the draw/discard pile, per-round retrospective
 * probabilities + modifier bounds, the presidential rotation (incl. special-election
 * detours), deaths, term limits, investigations, and the (opt-in) honesty/role reads.
 * President, deaths, and the special-election detour are DERIVED here, not stored,
 * which is why Undo/resume "just work".
 *
 * It has NO DOM/global dependencies — every collaborator is passed in `deps`
 * (clamp, retrospectiveProb from probability.js, the two settings predicates, and
 * the honesty/role analyzers), so the rules logic (term limits, veto, nested
 * special elections, reshuffles, rotation, deaths, pile counts) is Node-testable.
 * NOTE: it MUTATES the passed state — it writes back the auto-adjusted round
 * modifiers (state.roundMods) and reflects deaths onto state.players[i].dead,
 * exactly as the original in-app version did.
 * ==========================================================================*/

const Derive = (() => {
  function derive(state, deps) {
    const { clamp, retrospectiveProb, lieOn, rolesOn, analyzeRound, analyzeRoles } = deps;

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
    // term limits: the last *elected* government (reset by a chaos top-deck)
    let lastElectedPres = null,
      lastElectedChan = null;
    let hitlerElected = null; // set if Hitler was elected Chancellor (game ends there)
    const investigated = new Set(); // nobody may be investigated twice in one game
    const nextAlive = (idx) => {
      for (let s = 1; s <= N; s++) {
        const j = (idx + s) % N;
        if (!deadSet.has(j)) return j;
      }
      return idx;
    };
    const advanceAfter = (presIdx, ev) => {
      if (ev && ev.power && ev.power.type === "special" && ev.power.chosenIdx != null) {
        // Normal order resumes after the president who first broke it. A nested
        // special election must NOT overwrite that seat, or the rotation would
        // resume from the detour instead of the original break point.
        if (pendingResume === null) pendingResume = nextAlive(presIdx);
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
        evInfo.push({ type: "fail", n, presidentIdx: ev.presidentIdx, tracker });
        advanceAfter(ev.presidentIdx, null);
        return;
      }
      if (ev.type === "chaos") {
        draw -= 1;
        if (ev.enacted === "L") { lib++; rounds[round].chaosLib++; }
        else { fac++; rounds[round].chaosFac++; }
        tracker = 0;
        // a chaos policy resets term limits — everyone is eligible again
        lastElectedPres = lastElectedChan = null;
        evInfo.push({ type: "chaos", n, enacted: ev.enacted });
        reshuffleIfNeeded();
        return; // chaos does not change the presidential rotation
      }
      if (ev.type === "hitler") {
        // Hitler was elected Chancellor with 3+ fascist policies down: the game ends
        // at the election, so no cards are drawn and nothing else moves.
        hitlerElected = { presidentIdx: ev.presidentIdx, chancellorIdx: ev.chancellorIdx };
        evInfo.push({ type: "hitler", n, presidentIdx: ev.presidentIdx, chancellorIdx: ev.chancellorIdx });
        return;
      }
      // gov
      reshuffleIfNeeded(); // safety (normally already reshuffled after prior event)
      // A vetoed government enacts nothing: all 3 drawn cards are discarded and the
      // election tracker advances. `enacted` is null in that case.
      const vetoed = !!ev.vetoed;
      const enacted = vetoed ? null : ev.enacted;
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
        vetoed,
        presidentIdx: ev.presidentIdx,
        chancellorIdx: ev.chancellorIdx,
        power: ev.power || null,
        prob: null,
        // policy counts BEFORE this government enacts — used by the role model's
        // state-dependent push rates and the "not Hitler past 3F" deduction.
        facBefore: fac,
        libBefore: lib,
      };
      const giIdx = gi.push(info) - 1;
      rounds[round].govs.push(giIdx);
      lastGovByPlayer[ev.presidentIdx] = info;
      pushPlayerEvent(ev.presidentIdx, info);
      evInfo.push({ type: "gov", n, giIdx });
      draw -= 3;
      if (enacted === "L") lib++;
      else if (enacted === "F") fac++;
      // a successful veto enacts no policy and advances the election tracker
      tracker = vetoed ? tracker + 1 : 0;
      if (ev.power && ev.power.type === "invest" && ev.power.targetIdx != null)
        investigated.add(ev.power.targetIdx);
      lastChan = ev.chancellorIdx;
      lastElectedPres = ev.presidentIdx;
      lastElectedChan = ev.chancellorIdx;
      advanceAfter(ev.presidentIdx, ev);
      reshuffleIfNeeded();
    });

    // reflect deaths on the player objects (used by tap/chancellor validation)
    state.players.forEach((p, i) => (p.dead = deadSet.has(i)));

    // Term limits: the last elected Chancellor is always ineligible; the last elected
    // President is too, UNLESS only 5 players are still alive (5-player game, or a
    // bigger game reduced to 5 by executions). A chaos top-deck clears both (above).
    const aliveCount = N - deadSet.size;
    const termLimited = new Set();
    if (lastElectedChan !== null && !deadSet.has(lastElectedChan)) termLimited.add(lastElectedChan);
    if (aliveCount > 5 && lastElectedPres !== null && !deadSet.has(lastElectedPres))
      termLimited.add(lastElectedPres);

    // suggested chancellor: first eligible seat past the last elected chancellor
    let suggestedChan = null;
    if (lastChan !== null) {
      let c = nextAlive(lastChan);
      for (let s = 0; s < N && (c === pointer || termLimited.has(c)); s++) c = nextAlive(c);
      if (c !== pointer && !termLimited.has(c)) suggestedChan = c;
    }

    // retrospective probability + modifier bounds, per round
    rounds.forEach((r) => {
      const g = r.govs.length;
      const claims = r.govs.map((idx) => gi[idx].libs);
      const claimSum = claims.reduce((a, b) => a + b, 0);
      // A chaos top-deck removes ONE card from the round pool without being a
      // government, and its colour is public — so it shrinks the unseen leftovers
      // and is already accounted for among the round's liberals.
      const chaosN = r.chaosLib + r.chaosFac;
      const R = Math.max(0, r.startN - 3 * g - chaosN);
      r.leftover = R;
      r.claimSum = claimSum;
      // Physical feasibility window: keeps every claim in the round possible
      // (0 <= liberals drawn <= pool liberals, and bottom cards in [0,R]).
      // Conservation for the round is  claimSum + chaosLib + bottomLibs = effL.
      // This window is never empty, so a feasible modifier always exists.
      const seenLibs = claimSum + r.chaosLib;
      const physLo = g ? Math.max(seenLibs - r.startL, -r.startL) : 0;
      const physHi = g ? Math.min(seenLibs - r.startL + R, r.startN - r.startL) : 0;
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
        gi[idx].prob = retrospectiveProb(
          r.startN, r.effL, claims, localIdx, chaosN, r.chaosLib
        );
      });
      r.bottomLibs = clamp(r.effL - seenLibs, 0, R);

      // Honesty analysis (opt-in). Deliberately uses the TRUE pool liberals
      // (startL), not effL: the point of the model is to marginalise over the
      // lie history rather than take the user's hand-set modifier as fact.
      if (lieOn() && g) {
        r.honesty = analyzeRound({
          startN: r.startN,
          startL: r.startL,
          chaosLibs: r.chaosLib,
          chaosFascs: r.chaosFac,
          govs: r.govs.map((idx) => ({
            claim: gi[idx].libs,
            enacted: gi[idx].enacted,
            vetoed: gi[idx].vetoed,
            conflict: gi[idx].conflict,
          })),
        });
        r.govs.forEach((idx, k) => (gi[idx].honesty = r.honesty.govs[k]));
      }
    });

    // Role posterior (opt-in): P(each player is fascist / Hitler) from the same
    // model, enumerated over assignments. Purely a read — never feeds gameplay.
    const roleInfo = rolesOn() ? analyzeRoles(rounds, gi, hitlerElected) : null;
    const roleOdds = roleInfo ? roleInfo.pFascist : null;
    const roleHitler = roleInfo ? roleInfo.pHitler : null;

    // current draw / discard composition
    const cur = rounds[round];
    const drawLibs = clamp(cur.effL - cur.claimSum - cur.chaosLib, 0, draw);
    const drawFasc = draw - drawLibs;
    const libEnactedGov = cur.govs.filter((idx) => gi[idx].enacted === "L").length;
    const discardLibs = Math.max(0, cur.claimSum - libEnactedGov);
    // a normal government discards 2 of its 3 cards; a vetoed one discards all 3
    const discardTotal = cur.govs.reduce((a, idx) => a + (gi[idx].vetoed ? 3 : 2), 0);
    const discardFasc = Math.max(0, discardTotal - discardLibs);

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
      termLimited,
      aliveCount,
      investigated,
      hitlerElected,
      roleOdds,
      roleHitler,
    };
  }

  return { derive };
})();

// Support both browser (global) and Node/module usage.
if (typeof module !== "undefined" && module.exports) module.exports = Derive;
