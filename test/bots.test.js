/* Computer players: legality + measured strength by node self-play.
 * Run: node test/bots.test.js          (quick: ~1,800 games)
 *      SH_BOTS_GAMES=2000 node test/bots.test.js   (per matchup, for the report)
 * Bots see only Engine.publicView + their own Engine.privateView — the same
 * thing a human sees — so every game here is a fair game. */
const E = require("../js/engine.js");
const B = require("../js/bots.js");

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log("  FAIL " + label); } }

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Play one all-computer game. levelOf(uid, role) → level. Returns the result. */
// oppLevel (optional): levelOf returns null for seats that take "Normal if on p0's
// team, else oppLevel" (the solo rule).
function playGame(n, levelOf, r, oppLevel) {
  const uids = Array.from({ length: n }, (_, i) => "p" + i);
  let S = E.initGame(uids.map((u) => ({ uid: u, name: u })), r);
  const mem = {}; uids.forEach((u) => { mem[u] = B.newMemory(); });
  let steps = 0, illegal = 0;
  while (S.phase !== "gameover" && steps < 600) {
    const pub = E.publicView(S);
    let acted = false;
    for (const u of S.seatOrder) {
      const priv = E.privateView(S, u);
      B.observe(mem[u], pub, priv, u);
    }
    for (const u of S.seatOrder) {
      const lv = levelOf(u, S.roleOf[u]) ||
        (((S.roleOf[u] === "liberal") === (S.roleOf.p0 === "liberal")) ? "normal" : oppLevel);
      const a = B.act(pub, E.privateView(S, u), u, lv, mem[u], r);
      if (!a) continue;
      const res = E.applyAction(S, Object.assign({ by: u }, a), r);
      if (!res.ok) { illegal++; continue; }
      S = res.state; acted = true; steps++;
      break; // re-read the table after every move
    }
    if (!acted) break;
  }
  const pub = E.publicView(S);
  return { winner: S.winner, reason: S.winReason, roleOf: S.roleOf, steps, illegal, stalled: S.phase !== "gameover", events: S.events, pub };
}

const QUICK = +(process.env.SH_BOTS_GAMES || 0) || 0;
const G = QUICK || 150; // games per matchup cell

// 1) Legality + termination across every player count and level mix.
{
  let games = 0, illegal = 0, stalled = 0, libWins = 0;
  const reasons = {};
  for (let n = 5; n <= 10; n++) {
    for (let s = 0; s < (QUICK ? 200 : 60); s++) {
      const r = rng(1000 * n + s);
      const lv = ["easy", "normal", "hard"];
      const res = playGame(n, (u) => lv[(+u.slice(1) + s) % 3], r);
      games++; illegal += res.illegal; if (res.stalled) stalled++;
      if (res.winner === "Liberal") libWins++;
      reasons[res.reason] = (reasons[res.reason] || 0) + 1;
    }
  }
  ok(illegal === 0, `no illegal computer moves (${illegal} in ${games} games)`);
  ok(stalled === 0, `every game finishes (${stalled} stalled of ${games})`);
  ok(Object.keys(reasons).length >= 4, "games end in several ways: " + JSON.stringify(reasons));
  console.log(`  mixed tables: ${games} games, Liberal win ${(100 * libWins / games).toFixed(1)}%  ` + JSON.stringify(reasons));
}

// 2) Team strength: liberals at one level vs fascists at another (n = 5..10 mixed).
function teamRate(libLv, facLv, seed) {
  let w = 0;
  for (let s = 0; s < G; s++) {
    const n = 5 + (s % 6);
    const res = playGame(n, (u, role) => (role === "liberal" ? libLv : facLv), rng(seed + s));
    if (res.winner === "Liberal") w++;
  }
  return w / G;
}
const cell = {};
for (const L of ["easy", "normal", "hard"]) for (const F of ["easy", "normal", "hard"]) {
  if (!QUICK && !((L === "normal") || (F === "normal"))) continue;
  cell[L + "/" + F] = teamRate(L, F, 77000);
}
console.log("  Liberal win rate (rows = liberal level, cols = fascist level):");
for (const L of ["easy", "normal", "hard"]) {
  console.log("   " + L.padEnd(7) + ["easy", "normal", "hard"].map((F) => (cell[L + "/" + F] == null ? "  -  " : (100 * cell[L + "/" + F]).toFixed(0).padStart(4) + "%")).join(" "));
}
ok(cell["hard/normal"] > cell["normal/normal"], "hard liberals beat normal fascists more often than normal liberals do");
ok(cell["normal/normal"] > cell["easy/normal"], "normal liberals beat easy liberals (vs normal fascists)");
ok(cell["normal/hard"] < cell["normal/normal"], "hard fascists beat normal liberals more often than normal fascists do");
ok(cell["normal/easy"] > cell["normal/normal"], "easy fascists lose more than normal fascists");

// 3) What a player feels: one "normal" seat (stand-in for a person) at a table of
//    computers of each level. Its team's win rate should fall as the level rises.
//    Split by the seat's role: as a Fascist the computers are your opponents'
//    brains (harder = caught more); as a Liberal they are also your teammates.
function seatRate(level, seed) {
  const w = { Liberal: 0, Fascist: 0 }, c = { Liberal: 0, Fascist: 0 };
  for (let s = 0; s < G; s++) {
    const n = 5 + (s % 6);
    const res = playGame(n, (u) => (u === "p0" ? "normal" : level), rng(seed + s));
    const team = res.roleOf.p0 === "liberal" ? "Liberal" : "Fascist";
    c[team]++; if (res.winner === team) w[team]++;
  }
  return { lib: w.Liberal / Math.max(1, c.Liberal), fac: w.Fascist / Math.max(1, c.Fascist) };
}
const seat = {};
["easy", "normal", "hard"].forEach((lv) => { seat[lv] = seatRate(lv, 99000); });
console.log("  One normal seat vs computers — as Fascist: " + ["easy", "normal", "hard"].map((lv) => `${lv} ${(100 * seat[lv].fac).toFixed(0)}%`).join(" · ") +
  "   as Liberal: " + ["easy", "normal", "hard"].map((lv) => `${lv} ${(100 * seat[lv].lib).toFixed(0)}%`).join(" · "));
ok(seat.easy.fac > seat.hard.fac, `as a Fascist you win more vs easy (${(100 * seat.easy.fac).toFixed(0)}%) than vs hard (${(100 * seat.hard.fac).toFixed(0)}%) computers`);

// 4) Bots behave like their role: fascists lie, liberals tell the truth.
{
  let libLies = 0, libClaims = 0;
  for (let s = 0; s < 40; s++) {
    const n = 7, r = rng(5000 + s);
    const uids = Array.from({ length: n }, (_, i) => "p" + i);
    let S = E.initGame(uids.map((u) => ({ uid: u, name: u })), r);
    const mem = {}; uids.forEach((u) => { mem[u] = B.newMemory(); });
    let guard = 0;
    while (S.phase !== "gameover" && guard++ < 600) {
      const pub = E.publicView(S);
      let moved = false;
      for (const u of S.seatOrder) {
        const pv = E.privateView(S, u);
        B.observe(mem[u], pub, pv, u);
        const a = B.act(pub, pv, u, "hard", mem[u], r);
        if (!a) continue;
        if (a.type === "president_play" && S.roleOf[u] === "liberal") {
          libClaims++; if (a.claim !== pv.drawn.filter((c) => c === "L").length) libLies++;
        }
        const res = E.applyAction(S, Object.assign({ by: u }, a), r);
        if (res.ok) { S = res.state; moved = true; break; }
      }
      if (!moved) break;
    }
  }
  ok(libClaims > 20 && libLies === 0, `liberal Presidents always claim their real draw (${libLies}/${libClaims})`);
}

// 5) Inference sanity: a President who claims Bronze (3 L) and then a Fascist is
//    enacted is suspected far more than a random seat.
{
  const pub = {
    seatOrder: ["a", "b", "c", "d", "e"], n: 5, deadUids: [], phase: "nominate", libEnacted: 0, facEnacted: 1,
    events: [{ type: "gov", presidentIdx: 1, chancellorIdx: 2, claimLibs: 3, enacted: "F" }],
  };
  const priv = { role: "liberal", knownFascists: [], learned: [] };
  const bel = B.beliefs(pub, priv, "a", "normal", B.newMemory(), "private");
  ok(bel.pF.b > 0.7 && bel.pF.b > bel.pF.d + 0.3, `a "3 Liberals → Fascist enacted" government is suspected (b ${bel.pF.b.toFixed(2)}, c ${bel.pF.c.toFixed(2)}, d ${bel.pF.d.toFixed(2)})`);
  ok(Math.abs(bel.pF.a) < 1e-9, "a liberal never suspects itself");
}

// 6) The difficulty ladder a person feels (js/solo.js): one Normal-strength seat
// ("you"), teammates Normal, the other team at the chosen level. Measured with
// 900 games a level on 2026-10-27: 70% / 53% / 40% → Elo 1070 / 1200 / 1290
// (the ratings js/app.js gives Profile). Here 300 a level, with margins.
{
  const G6 = QUICK ? 900 : 300;
  const rate = {};
  for (const L of ["easy", "normal", "hard"]) {
    let w = 0;
    for (let s = 0; s < G6; s++) {
      const r = rng(77000 + s * 7 + L.length);
      const n = 5 + (s % 6);
      const res = playGame(n, (u, role) => (u === "p0" ? "normal" : null), r, L);
      if (res.winner === (res.roleOf.p0 === "liberal" ? "Liberal" : "Fascist")) w++;
    }
    rate[L] = w / G6;
  }
  console.log("  you (Normal) vs opponents at each level, win rate:", JSON.stringify(rate));
  ok(rate.easy - rate.normal > 0.08, `Easy opponents are clearly easier than Normal (${rate.easy.toFixed(2)} vs ${rate.normal.toFixed(2)})`);
  ok(rate.normal - rate.hard > 0.05, `Hard opponents are clearly harder than Normal (${rate.hard.toFixed(2)} vs ${rate.normal.toFixed(2)})`);
}

console.log(`bots: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
