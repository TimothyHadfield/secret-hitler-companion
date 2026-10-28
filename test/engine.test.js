/* Node test for the pure game engine (role dealing). Run: node test/engine.test.js */
const E = require("../js/engine.js");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.log("  FAIL " + label); }
}

// A tiny seeded PRNG (mulberry32) so tests are deterministic.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Expected fascist TEAM totals INCLUDING Hitler, by count (= ceil(n/2) − 1):
// 5–6 → 1 fascist + Hitler = 2; 7–8 → 2 + Hitler = 3; 9–10 → 3 + Hitler = 4.
const EXPECT = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 4, 10: 4 };

for (let n = 5; n <= 10; n++) {
  ok(E.fascistTotal(n) === EXPECT[n], `fascistTotal(${n})=${EXPECT[n]}`);
}
ok(E.hitlerKnowsFascists(5) && E.hitlerKnowsFascists(6), "Hitler knows fascists at 5–6");
ok(!E.hitlerKnowsFascists(7) && !E.hitlerKnowsFascists(10), "Hitler blind at 7+");

for (let n = 5; n <= 10; n++) {
  const uids = Array.from({ length: n }, (_, i) => "u" + i);
  const g = E.setupGame(uids.slice(), rng(1000 + n));

  ok(g.seatOrder.length === n, `n=${n}: seatOrder length`);
  ok(new Set(g.seatOrder).size === n, `n=${n}: seat order is a permutation (no dupes)`);
  ok(g.firstPres >= 0 && g.firstPres < n, `n=${n}: firstPres in range`);

  const roles = g.seatOrder.map((u) => g.roleOf[u]);
  const nHitler = roles.filter((r) => r === "hitler").length;
  const nFascist = roles.filter((r) => r === "fascist").length;
  const nLiberal = roles.filter((r) => r === "liberal").length;
  ok(nHitler === 1, `n=${n}: exactly one Hitler`);
  ok(nHitler + nFascist === EXPECT[n], `n=${n}: fascist team total = ${EXPECT[n]}`);
  ok(nLiberal === n - EXPECT[n], `n=${n}: liberal count`);
  ok(g.fascistUids.length === EXPECT[n] - 1, `n=${n}: regular fascist count`);
  ok(g.fascistUids.indexOf(g.hitlerUid) < 0, `n=${n}: Hitler not in the regular-fascist list`);

  // Reveal correctness — what each role is allowed to know.
  g.seatOrder.forEach((uid) => {
    const r = g.reveals[uid];
    if (r.role === "liberal") {
      ok(r.knownFascists.length === 0 && r.knownHitler === null, `n=${n}: liberal knows nothing`);
    } else if (r.role === "fascist") {
      // sees Hitler and every OTHER regular fascist, never themselves
      ok(r.knownHitler === g.hitlerUid, `n=${n}: fascist knows Hitler`);
      ok(r.knownFascists.indexOf(uid) < 0, `n=${n}: fascist not told about self`);
      const expect = g.fascistUids.filter((u) => u !== uid).sort().join(",");
      ok(r.knownFascists.slice().sort().join(",") === expect, `n=${n}: fascist sees the other fascists`);
    } else { // hitler
      if (n <= 6) {
        ok(r.knownFascists.slice().sort().join(",") === g.fascistUids.slice().sort().join(","),
          `n=${n}: Hitler sees the fascist(s)`);
      } else {
        ok(r.knownFascists.length === 0 && r.knownHitler === null, `n=${n}: Hitler blind at 7+`);
      }
    }
  });
}

// Determinism: same uids + same seed → identical deal.
const a = E.setupGame(["a", "b", "c", "d", "e", "f", "g"], rng(42));
const b = E.setupGame(["a", "b", "c", "d", "e", "f", "g"], rng(42));
ok(JSON.stringify(a) === JSON.stringify(b), "same seed ⇒ identical deal (replayable)");

// ============================ full-game reducer ============================
function inHand(S) { return (S.drawn ? S.drawn.length : 0) + (S.passed ? S.passed.length : 0); }
function invariants(S, label) {
  const total = S.deck.length + S.discard.length + S.libEnacted + S.facEnacted + inHand(S);
  ok(total === 17, `${label}: 17 cards conserved (got ${total})`);
  ok(S.tracker >= 0 && S.tracker < 3, `${label}: tracker in [0,3)`);
  ok(S.libEnacted <= 5 && S.facEnacted <= 6, `${label}: policy counts in range`);
  ok(S.deadUids.length < S.n, `${label}: someone is still alive`);
}

// A bot that always plays a LEGAL move for the current actor, so any illegal
// move surfaces as an engine bug (applyAction returning !ok).
function botAction(S, voteMode) {
  const pres = E.presUid(S);
  const alive = E.aliveUids(S);
  switch (S.phase) {
    case "nominate": {
      const tl = E.termLimited(S);
      const t = alive.find((u) => u !== pres && !tl[u]);
      return { type: "nominate", by: pres, target: t };
    }
    case "vote": {
      const u = alive.find((x) => !(x in S.votes));
      // voteMode 'ja' → always elect; 'mix' → nein unless it's the only way forward
      const v = voteMode === "mix" ? (S.seatOrder.indexOf(u) % 2 === 0 ? "ja" : "nein") : "ja";
      return { type: "vote", by: u, vote: v };
    }
    case "president_play": {
      const libs = S.drawn.filter((c) => c === "L").length;
      return { type: "president_play", by: pres, discard: 0, claim: libs };
    }
    case "chancellor_play":
      return { type: "chancellor_play", by: S.chancellorUid, enact: 0 };
    case "veto":
      return { type: "veto", by: pres, agree: true };
    case "power_investigate": {
      const t = alive.find((u) => u !== pres && S.investigatedUids.indexOf(u) < 0) || alive.find((u) => u !== pres);
      return { type: "power", by: pres, target: t };
    }
    case "power_special":
    case "power_execute": {
      const t = alive.find((u) => u !== pres);
      return { type: "power", by: pres, target: t };
    }
    case "power_peek":
      return { type: "power", by: pres };
  }
  return null;
}

function runGame(seed, voteMode) {
  const uids = Array.from({ length: 5 + (seed % 6) }, (_, i) => "p" + i); // 5..10
  let S = E.initGame(uids.map((u) => ({ uid: u, name: u.toUpperCase() })), rng(seed));
  const r = rng(seed * 7 + 1);
  let steps = 0, illegal = 0;
  invariants(S, "seed" + seed + " init");
  while (S.phase !== "gameover" && steps < 3000) {
    const act = botAction(S, voteMode);
    if (!act) { illegal++; break; }
    const res = E.applyAction(S, act, r);
    if (!res.ok) { illegal++; break; }
    S = res.state;
    steps++;
    if (steps % 25 === 0 || S.phase === "gameover") invariants(S, "seed" + seed + " step" + steps);
  }
  return { S, steps, illegal };
}

const endings = {};
let anyIllegal = 0, anyStuck = 0;
for (let seed = 1; seed <= 60; seed++) {
  const mode = seed % 3 === 0 ? "mix" : "ja";
  const { S, steps, illegal } = runGame(seed, mode);
  anyIllegal += illegal;
  if (S.phase !== "gameover") anyStuck++;
  else {
    ok(S.winner === "Liberal" || S.winner === "Fascist", `seed${seed}: valid winner`);
    endings[S.winReason] = (endings[S.winReason] || 0) + 1;
    // recorded-game record is well formed
    const rec = E.toRecordedGame(S);
    ok(rec.result && (rec.result.winner === S.winner) && Array.isArray(rec.events) && rec.players.length === S.n,
      `seed${seed}: toRecordedGame well-formed`);
    ok(rec.result.hitlerIdx >= 0 && rec.result.hitlerIdx < S.n, `seed${seed}: hitlerIdx valid`);
  }
}
ok(anyIllegal === 0, `no illegal bot moves across all games (got ${anyIllegal})`);
ok(anyStuck === 0, `every game reached game over (stuck: ${anyStuck})`);
// We should see several distinct win reasons across 60 games.
ok(Object.keys(endings).length >= 2, "multiple distinct endings occurred: " + JSON.stringify(endings));

// -------- targeted rule checks --------
(function termLimitCheck() {
  let S = E.initGame(["a", "b", "c", "d", "e"].map((u) => ({ uid: u, name: u })), rng(3));
  const pres = E.presUid(S);
  const other = E.aliveUids(S).find((u) => u !== pres);
  // elect pres+other so both become last-elected
  S = E.applyAction(S, { type: "nominate", by: pres, target: other }, rng(1)).state;
  E.aliveUids(S).forEach((u) => { const rr = E.applyAction(S, { type: "vote", by: u, vote: "ja" }, rng(1)); if (rr.ok) S = rr.state; });
  ok(S.phase === "president_play", "electing a chancellor moves to the President's turn");
})();

(function hitlerChancellorWin() {
  let S = E.initGame(["a", "b", "c", "d", "e"].map((u) => ({ uid: u, name: u })), rng(9));
  S.facEnacted = 3;                       // in the danger zone
  S.phase = "nominate";
  const pres = E.presUid(S);
  const hit = S.hitlerUid === pres ? null : S.hitlerUid;
  if (hit) {
    S = E.applyAction(S, { type: "nominate", by: pres, target: hit }, rng(1)).state;
    E.aliveUids(S).forEach((u) => { const rr = E.applyAction(S, { type: "vote", by: u, vote: "ja" }, rng(1)); if (rr.ok) S = rr.state; });
    ok(S.winner === "Fascist" && /Hitler was elected/.test(S.winReason), "Hitler elected Chancellor after 3F ⇒ Fascist win");
  } else { ok(true, "Hitler was the President (skip)"); }
})();

(function hitlerExecutionWin() {
  let S = E.initGame(["a", "b", "c", "d", "e", "f", "g"].map((u) => ({ uid: u, name: u })), rng(11));
  S.phase = "power_execute"; S.facEnacted = 4;
  S.events.push({ type: "gov", presidentIdx: 0, chancellorIdx: 1, claimLibs: 0, enacted: "F" });
  S._powerEventIdx = 0;
  const pres = E.presUid(S);
  const r = E.applyAction(S, { type: "power", by: pres, target: S.hitlerUid }, rng(1));
  ok(r.ok && r.state.winner === "Liberal" && /Hitler was executed/.test(r.state.winReason), "executing Hitler ⇒ Liberal win");
})();

(function vetoCheck() {
  let S = E.initGame(["a", "b", "c", "d", "e"].map((u) => ({ uid: u, name: u })), rng(13));
  S.phase = "chancellor_play"; S.facEnacted = 5; S.chancellorUid = E.aliveUids(S)[1];
  S.passed = ["F", "F"]; S.presClaim = 0; S.tracker = 0;
  const chan = S.chancellorUid;
  let r = E.applyAction(S, { type: "chancellor_play", by: chan, veto: true }, rng(1));
  ok(r.ok && r.state.phase === "veto", "chancellor may propose veto at 5 Fascist policies");
  const pres = E.presUid(r.state);
  r = E.applyAction(r.state, { type: "veto", by: pres, agree: true }, rng(1));
  ok(r.ok && r.state.tracker === 1, "an agreed veto advances the election tracker");
})();

(function privacyCheck() {
  let S = E.initGame(["a", "b", "c", "d", "e"].map((u) => ({ uid: u, name: u })), rng(17));
  const pub = E.publicView(S);
  ok(!("roleOf" in pub) && !("deck" in pub) && !("drawn" in pub), "public view leaks no roles/deck/hands mid-game");
  const liberalUid = S.seatOrder.find((u) => S.roleOf[u] === "liberal");
  const pv = E.privateView(S, liberalUid);
  ok(pv.role === "liberal" && pv.knownFascists.length === 0, "a liberal's private view reveals nothing about others");
  // at gameover the public view DOES reveal roles (for the reveal + recording)
  S.phase = "gameover"; S.winner = "Liberal";
  ok("roleOf" in E.publicView(S), "game-over public view reveals roles");
})();

// ---- sweep 2026-10-16 regressions ----------------------------------------
(function firstPresIsPublished() {
  // The night screen labels t.firstPres as "first President"; it must be the
  // seat the engine actually starts at, not always seat 0.
  let hits = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const S = E.initGame(["a", "b", "c", "d", "e", "f", "g"].map((u) => ({ uid: u, name: u })), rng(seed));
    if (E.publicView(S).firstPres === S.presIdx) hits++;
  }
  ok(hits === 20, `public view's firstPres is the engine's first President (${hits}/20)`);
})();

(function vetoRefusedOnce() {
  let S = E.initGame(["a", "b", "c", "d", "e"].map((u) => ({ uid: u, name: u })), rng(13));
  S.phase = "chancellor_play"; S.facEnacted = 5; S.chancellorUid = E.aliveUids(S).find((u) => u !== E.presUid(S));
  S.passed = ["F", "L"]; S.presClaim = 1; S.tracker = 0;
  const chan = S.chancellorUid, pres = E.presUid(S);
  let r = E.applyAction(S, { type: "chancellor_play", by: chan, veto: true }, rng(1));
  r = E.applyAction(r.state, { type: "veto", by: pres, agree: false }, rng(1));
  ok(r.ok && r.state.phase === "chancellor_play", "a refused veto sends the Chancellor back to enact");
  const again = E.applyAction(r.state, { type: "chancellor_play", by: chan, veto: true }, rng(1));
  ok(!again.ok, "after a refused veto the Chancellor must enact (no second veto proposal)");
  ok(E.publicView(r.state).vetoRefused === true, "public view tells the table the veto was refused");
})();

(function specialReturnSeatExecuted() {
  // 7p: seat0 calls a special election on seat3 (return seat = 1); seat3's
  // government enacts the 4th Fascist and executes seat1. The presidency must
  // resume at the next LIVING seat (2), never hand it to the dead seat 1.
  let S = E.initGame(["a", "b", "c", "d", "e", "f", "g"].map((u) => ({ uid: u, name: u })), rng(5));
  const so = S.seatOrder;
  S.presIdx = 0; S.facEnacted = 3; S.phase = "power_special";
  S.events.push({ type: "gov", presidentIdx: 0, chancellorIdx: 4, claimLibs: 0, enacted: "F" });
  S._powerEventIdx = 0;
  let r = E.applyAction(S, { type: "power", by: so[0], target: so[3] }, rng(1));
  ok(r.ok && E.presUid(r.state) === so[3], "special election hands the presidency to the chosen seat");
  S = r.state;
  S.facEnacted = 4; S.phase = "power_execute"; S.chancellorUid = so[5];
  S.events.push({ type: "gov", presidentIdx: 3, chancellorIdx: 5, claimLibs: 0, enacted: "F" });
  S._powerEventIdx = S.events.length - 1;
  const victim = so[1] === S.hitlerUid ? null : so[1];
  if (victim) {
    r = E.applyAction(S, { type: "power", by: so[3], target: victim }, rng(1));
    ok(r.ok && E.isAlive(r.state, E.presUid(r.state)), "presidency never resumes at an executed seat");
    ok(r.ok && E.presUid(r.state) === so[2], "it resumes at the next living seat after the special election's caller");
  } else ok(true, "return seat was Hitler (skip)");
})();

(function recordedGameReplaysThroughDerive() {
  // A finished online game is saved as an ordinary game; stats/replay read its
  // powers with the companion's vocabulary (kill/invest/special/peek) and its
  // firstPres. Check the record against what the engine actually did.
  const Derive = require("../js/derive.js");
  const Prob = require("../js/probability.js");
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const deps = { clamp, retrospectiveProb: Prob.retrospectiveProb, lieOn: () => false, rolesOn: () => false };
  let games = 0, deathsOk = 0, powersOk = 0, firstOk = 0, killsSeen = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { S } = runGame(seed, seed % 3 === 0 ? "mix" : "ja");
    if (S.phase !== "gameover") continue;
    games++;
    const rec = E.toRecordedGame(S);
    const firstGov = S.events.find((e) => e.type === "gov" || e.type === "fail" || e.type === "hitler");
    if (!firstGov || rec.firstPres === firstGov.presidentIdx) firstOk++;
    const known = rec.events.every((e) => !e.power || ["invest", "special", "peek", "kill"].indexOf(e.power.type) >= 0);
    const shapes = rec.events.every((e) => {
      const p = e.power; if (!p) return true;
      if (p.type === "invest") return Number.isInteger(p.targetIdx) && (p.party === "L" || p.party === "F");
      if (p.type === "special") return Number.isInteger(p.chosenIdx);
      if (p.type === "peek") return Array.isArray(p.order) && p.order.length === 3;
      if (p.type === "kill") return Number.isInteger(p.killedIdx) && typeof p.wasHitler === "boolean";
      return false;
    });
    if (known && shapes) powersOk++;
    const st = { players: rec.players.map((p) => ({ name: p.name, dead: false })), firstPres: rec.firstPres, events: rec.events, roundMods: {} };
    const d = Derive.derive(st, deps);
    const engineDead = S.deadUids.filter((u) => u !== S.hitlerUid).map((u) => S.seatOrder.indexOf(u)).sort().join(",");
    killsSeen += S.deadUids.length;
    if ([...d.deadSet].sort().join(",") === engineDead) deathsOk++;
  }
  ok(games > 0 && killsSeen > 0, `bot games include executions (games ${games}, kills ${killsSeen})`);
  ok(firstOk === games, `recorded firstPres = the first President (${firstOk}/${games})`);
  ok(powersOk === games, `recorded powers use the companion's shapes (${powersOk}/${games})`);
  ok(deathsOk === games, `replaying the recorded game reproduces the executions (${deathsOk}/${games})`);
  // Mid-game the PUBLIC event log must not carry secrets (party / peeked cards).
  const live = E.initGame(["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((u) => ({ uid: u, name: u })), rng(77));
  live.phase = "power_investigate"; live.facEnacted = 1;
  live.events.push({ type: "gov", presidentIdx: live.presIdx, chancellorIdx: (live.presIdx + 1) % 9, claimLibs: 0, enacted: "F" });
  live._powerEventIdx = 0;
  const tgt = live.seatOrder.find((u) => u !== E.presUid(live));
  const rr = E.applyAction(live, { type: "power", by: E.presUid(live), target: tgt }, rng(1));
  ok(rr.ok && !JSON.stringify(E.publicView(rr.state).events).match(/party|"order"|Liberal|Fascist"/), "public events carry no investigation result mid-game");
})();

// Rebalanced start (vs-computers option; secrethitler.io "rebalanced" games, see
// its rules page): 6 players start with a Fascist policy enacted, 7 players play
// with 10 Fascist policies, 9 players with 9. Other counts are unchanged.
(function rebalanced() {
  const count = (d, c) => d.filter((x) => x === c).length;
  const WANT = { 5: [11, 0], 6: [10, 1], 7: [10, 0], 8: [11, 0], 9: [9, 0], 10: [11, 0] };
  for (let n = 5; n <= 10; n++) {
    const uids = Array.from({ length: n }, (_, i) => "p" + i);
    const S = E.initGame(uids, rng(n), { rebalance: true });
    const [fac, start] = WANT[n];
    ok(count(S.deck, "F") === fac && count(S.deck, "L") === 6, `rebalanced ${n}p: deck ${fac}F/6L (got ${count(S.deck, "F")}F/${count(S.deck, "L")}L)`);
    ok(S.facEnacted === start && S.libEnacted === 0, `rebalanced ${n}p: starts with ${start} Fascist enacted (got ${S.facEnacted})`);
    const pv = E.publicView(S);
    ok(pv.deckFac === fac && pv.facEnacted === start, `rebalanced ${n}p: public view says deckFac ${fac}`);
    const plain = E.initGame(uids, rng(n));
    ok(count(plain.deck, "F") === 11 && plain.facEnacted === 0 && !("deckFac" in E.publicView(plain)) && !("rules" in plain),
      `standard ${n}p unchanged (online tables stay byte-identical)`);
  }
  // 6p rebalanced: the first Fascist policy played lands in slot 2 (no power at 6p), then slot 3 = peek.
  const S6 = E.initGame(["a", "b", "c", "d", "e", "f"], rng(9), { rebalance: true });
  S6.deck = ["F", "F", "F"].concat(S6.deck.slice(3));
  let st = S6, r = rng(3);
  const pres = E.presUid(st), chan = st.seatOrder.find((u) => u !== pres);
  st = E.applyAction(st, { type: "nominate", by: pres, target: chan }, r).state;
  st.seatOrder.forEach((u) => { st = E.applyAction(st, { type: "vote", by: u, vote: "ja" }, r).state; });
  st = E.applyAction(st, { type: "president_play", by: pres, discard: 0, claim: 0 }, r).state;
  st = E.applyAction(st, { type: "chancellor_play", by: chan, enact: 0 }, r).state;
  ok(st.facEnacted === 2 && st.phase === "nominate", `rebalanced 6p: first Fascist enactment = 2nd slot, no power (fac ${st.facEnacted}, phase ${st.phase})`);
})();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
