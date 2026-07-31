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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
