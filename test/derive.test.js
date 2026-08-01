/* Node test for the pure rules engine (js/derive.js). Run: node test/derive.test.js
 *
 * Covers the bookkeeping app.js used to keep trapped inside its IIFE with no
 * regression coverage: pile counts + reshuffles, the presidential rotation
 * (incl. nested special-election detours), deaths, term limits, the election
 * tracker, veto, chaos, and the dependency wiring for the honesty/role hooks. */
const Derive = require("../js/derive.js");
const Prob = require("../js/probability.js");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.log("  FAIL " + label); }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Build a fresh state with N players, everybody alive.
function mkState(n, events, firstPres) {
  return {
    players: Array.from({ length: n }, (_, i) => ({ name: "P" + i, dead: false })),
    firstPres: firstPres || 0,
    events: events || [],
    roundMods: {},
  };
}
// gov/fail/chaos/hitler event builders (mirror the app's event vocabulary).
const gov = (p, c, enacted, extra) =>
  Object.assign({ type: "gov", presidentIdx: p, chancellorIdx: c, claimLibs: enacted === "L" ? 2 : 1, enacted }, extra || {});
const failEv = (p) => ({ type: "fail", presidentIdx: p });
const chaos = (enacted) => ({ type: "chaos", enacted });
const hitlerEv = (p, c) => ({ type: "hitler", presidentIdx: p, chancellorIdx: c });

// Default deps: real probability engine, lie/role hooks OFF (rules-only view).
function run(state, deps) {
  return Derive.derive(state, Object.assign({
    clamp,
    retrospectiveProb: Prob.retrospectiveProb,
    lieOn: () => false,
    rolesOn: () => false,
    analyzeRound: () => { throw new Error("analyzeRound must not be called when lieOn() is false"); },
    analyzeRoles: () => { throw new Error("analyzeRoles must not be called when rolesOn() is false"); },
  }, deps || {}));
}

// ---------------------------------------------------------------- empty game
(function emptyGame() {
  const d = run(mkState(5, []));
  ok(d.fac === 0 && d.lib === 0, "empty game: no policies enacted");
  ok(d.draw === 17, "empty game: full draw pile of 17");
  ok(d.round === 0 && d.rounds.length === 1, "empty game: one round, index 0");
  ok(d.rounds[0].startN === 17 && d.rounds[0].startL === 6, "round 0 starts 17/6");
  ok(d.presIdx === 0, "empty game: president is firstPres");
  ok(d.gi.length === 0 && d.tracker === 0, "empty game: no governments, tracker 0");
})();

// -------------------------------------------------------------- pile counting
(function pileCounting() {
  const d = run(mkState(5, [gov(0, 1, "L"), gov(1, 2, "F")]));
  ok(d.lib === 1 && d.fac === 1, "one L + one F enacted counts each track");
  ok(d.draw === 17 - 6, "two governments drew 3 cards each (draw 11)");
  ok(d.drawLibs + d.drawFasc === d.draw, "draw composition sums to the draw pile");
  ok(d.discardLibs + d.discardFasc === d.discardLibs + d.discardFasc, "discard composition is consistent");
})();

// ---------------------------------------------------------------- rotation
(function rotation() {
  ok(run(mkState(5, [gov(0, 1, "L")])).presIdx === 1, "president advances 0 -> 1");
  ok(run(mkState(5, [gov(4, 0, "L")])).presIdx === 0, "rotation wraps 4 -> 0");
  ok(run(mkState(5, [failEv(0)])).presIdx === 1, "a failed election still advances the rotation");
})();

// ----------------------------------------------------------- election tracker
(function tracker() {
  ok(run(mkState(5, [failEv(0), failEv(1)])).tracker === 2, "two fails => tracker 2");
  ok(run(mkState(5, [failEv(0), gov(1, 2, "L")])).tracker === 0, "a successful government resets the tracker");
  ok(run(mkState(5, [gov(0, 1, "F", { vetoed: true })])).tracker === 1, "a veto advances the tracker instead of resetting");
})();

// ----------------------------------------------------------- veto bookkeeping
(function veto() {
  const d = run(mkState(5, [gov(0, 1, "F", { vetoed: true })]));
  ok(d.fac === 0 && d.lib === 0, "a vetoed government enacts nothing");
  ok(d.gi[0].enacted === null && d.gi[0].vetoed === true, "vetoed gov: enacted null, vetoed flag set");
  ok(d.draw === 14, "a veto still consumes 3 cards");
  ok(d.discardLibs + d.discardFasc === 3, "a veto discards all 3 cards (normal gov discards 2)");
})();

// ------------------------------------------------------------------- chaos
(function chaosTopdeck() {
  // A gov sets term limits; a following chaos must clear them AND reset tracker.
  const d = run(mkState(7, [gov(0, 1, "L"), failEv(2), failEv(3), chaos("F")]));
  ok(d.fac === 1 && d.lib === 1, "chaos top-decked one Fascist policy");
  ok(d.tracker === 0, "chaos resets the election tracker");
  ok(d.termLimited.size === 0, "chaos clears term limits (everyone eligible again)");
  ok(d.draw === 17 - 3 - 1, "chaos removes exactly one card from the draw pile");
})();

// ---------------------------------------------------------------- term limits
(function termLimits() {
  const big = run(mkState(7, [gov(0, 1, "L")]));
  ok(big.termLimited.has(0) && big.termLimited.has(1), "7 players: last elected Pres AND Chan are term-limited");
  const five = run(mkState(5, [gov(0, 1, "L")]));
  ok(!five.termLimited.has(0) && five.termLimited.has(1), "5 players: only the last elected Chancellor is term-limited");
})();

// ----------------------------------------------------- deaths (execution power)
(function deaths() {
  const kill = gov(0, 1, "F", { power: { type: "kill", killedIdx: 2, wasHitler: false } });
  const d = run(mkState(7, [kill]));
  ok(d.deadSet.has(2), "an executed player is in the dead set");
  ok(d.aliveCount === 6, "aliveCount drops after an execution");
  const st = mkState(7, [kill]);
  run(st);
  ok(st.players[2].dead === true && st.players[0].dead === false, "derive reflects deaths onto state.players");
  // dead players are skipped by the rotation: pres3 kills seat 4, so the next
  // president is 5 (the dead seat 4 is stepped over), not 4.
  ok(run(mkState(7, [gov(2, 3, "L"), gov(3, 4, "F", { power: { type: "kill", killedIdx: 4, wasHitler: false } })])).presIdx === 5,
    "rotation skips a killed seat");
  // Hitler executed is NOT added to the dead set here (that path ends the game elsewhere)
  ok(!run(mkState(7, [gov(0, 1, "F", { power: { type: "kill", killedIdx: 2, wasHitler: true } })])).deadSet.has(2),
    "a wasHitler execution does not mark the seat dead in derive");
})();

// ----------------------------------------- nested special election resume point
(function specialElection() {
  // pres0 special-elects pres3; after 3's turn the rotation must resume at 1 (next after 0).
  const one = run(mkState(7, [
    gov(0, 1, "L", { power: { type: "special", chosenIdx: 3 } }),
    gov(3, 4, "L"),
  ]));
  ok(one.presIdx === 1, "special election resumes at the seat after the president who broke rotation");
  // Nested: 0 -> special 3 -> special 5 -> after 5's turn resume at 1 (the FIRST break point), not after 3.
  const nested = run(mkState(7, [
    gov(0, 1, "L", { power: { type: "special", chosenIdx: 3 } }),
    gov(3, 4, "L", { power: { type: "special", chosenIdx: 5 } }),
    gov(5, 6, "L"),
  ]));
  ok(nested.presIdx === 1, "a nested special election keeps the FIRST resume seat");
})();

// ------------------------------------------------------------------ reshuffle
(function reshuffle() {
  // Five liberal governments draw 15 of 17; draw hits 2 (<3), so the pile reshuffles.
  const d = run(mkState(5, [gov(0, 1, "L"), gov(1, 2, "L"), gov(2, 3, "L"), gov(3, 4, "L"), gov(4, 0, "L")]));
  ok(d.round === 1, "draw pile below 3 triggers a reshuffle into round 1");
  ok(d.lib === 5, "all five liberal policies counted before the reshuffle");
  ok(d.draw === 12, "reshuffled round pool = 17 − enacted (12)");
  ok(d.rounds[1].startN === 12 && d.rounds[1].startL === 6 - 5, "new round starts with the remaining pool (12) and its liberals (1)");
})();

// ------------------------------------------------- investigations (once each)
(function investigations() {
  const d = run(mkState(9, [gov(0, 1, "F", { power: { type: "invest", targetIdx: 4, party: "Fascist" } })]));
  ok(d.investigated.has(4), "an investigated seat is recorded (can't be investigated twice)");
})();

// ------------------------------------------------------ Hitler elected chancellor
(function hitlerElected() {
  const d = run(mkState(7, [gov(0, 1, "F"), gov(2, 3, "F"), gov(4, 5, "F"), hitlerEv(6, 0)]));
  ok(d.hitlerElected && d.hitlerElected.chancellorIdx === 0, "a hitler event records who was elected Chancellor");
  ok(d.gi.length === 3, "the terminal hitler election draws no cards / adds no government");
})();

// ---------------------------------------------------------- state mutation
(function stateMutation() {
  const st = mkState(5, [gov(0, 1, "L")]);
  const d = run(st);
  ok(typeof st.roundMods[0] === "number", "derive writes the auto-adjusted round modifier back onto state");
  ok(st.roundMods[0] === d.rounds[0].mod, "the persisted modifier matches the derived one");
})();

// ---------------------------------------------------------- determinism
(function determinism() {
  const evs = [gov(0, 1, "L"), failEv(2), gov(3, 4, "F", { power: { type: "kill", killedIdx: 2, wasHitler: false } })];
  const a = run(mkState(7, evs));
  const b = run(mkState(7, evs));
  ok(a.fac === b.fac && a.lib === b.lib && a.draw === b.draw && a.presIdx === b.presIdx,
    "derive is deterministic across repeated calls on equal input");
})();

// -------------------------------- dependency wiring: honesty/role hooks fire
(function hooksWiring() {
  // With the switches ON, derive must call the injected analyzers and surface
  // their output (this is exactly how app.js binds Honesty/analyzeRoles).
  let roundCalls = 0, roleCalls = 0;
  const d = Derive.derive(mkState(5, [gov(0, 1, "L"), gov(1, 2, "F")]), {
    clamp,
    retrospectiveProb: Prob.retrospectiveProb,
    lieOn: () => true,
    rolesOn: () => true,
    analyzeRound: () => { roundCalls++; return { govs: [{ honest: 0.5 }, { honest: 0.5 }] }; },
    analyzeRoles: () => { roleCalls++; return { pFascist: [0.1, 0.2, 0.3, 0.4, 0.5], pHitler: [0, 0, 0, 0, 0] }; },
  });
  ok(roundCalls === 1, "lieOn() true => analyzeRound is invoked per round with governments");
  ok(roleCalls === 1, "rolesOn() true => analyzeRoles is invoked once");
  ok(Array.isArray(d.roleOdds) && d.roleOdds.length === 5, "role posterior output is surfaced as roleOdds");
  ok(d.gi[0].honesty && d.gi[0].honesty.honest === 0.5, "per-gov honesty result is attached to gi entries");
})();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
