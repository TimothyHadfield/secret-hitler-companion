/* ============================================================================
 * engine.js — the PURE authoritative game logic for online play.
 *
 * This is the "referee": given a game's inputs it decides roles, the deck, legal
 * moves, and outcomes — with NO network, DOM, or randomness of its own (callers
 * pass an rng, so tests are deterministic and the host can replay). js/online.js
 * wraps this with Firestore sync; keeping the rules here means they're unit-
 * testable in Node with no Firebase.
 *
 * The board/event vocabulary matches the analyzer (js/app.js `derive`, js/stats):
 * an online game emits the SAME `events` log, so when it ends it records to the
 * group as an ordinary reviewable game.
 *
 * Classic script exposing `window.Engine`; also `module.exports` for Node tests.
 * ==========================================================================*/
(function () {
  // Fascists INCLUDING Hitler, by player count (5–10). = ceil(n/2) − 1.
  function fascistTotal(n) { return Math.ceil(n / 2) - 1; }
  // In 5–6 player games Hitler knows the other fascist(s); in 7+ Hitler is blind.
  function hitlerKnowsFascists(n) { return n <= 6; }

  // Fisher–Yates using a supplied rng (() => [0,1)). Mutates + returns arr.
  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * Deal an entire game's opening: a randomized seat order, the first President,
   * and every player's role + exactly the knowledge that role is entitled to.
   *
   * Returns:
   *   seatOrder   [uid,…] clockwise
   *   firstPres   index into seatOrder
   *   playerCount n
   *   roleOf      { uid: 'liberal' | 'fascist' | 'hitler' }
   *   hitlerUid   uid
   *   fascistUids [uid,…]  regular fascists (NOT Hitler)
   *   reveals     { uid: { role, seat, knownFascists:[uid], knownHitler:uid|null } }
   *               — this is the PER-PLAYER secret written to their private doc.
   *               A player only ever learns what the real game would reveal:
   *               fascists see each other + Hitler; Hitler sees the fascists only
   *               in 5–6; liberals learn nothing.
   */
  function setupGame(uids, rng) {
    rng = rng || Math.random;
    const seatOrder = shuffleInPlace(uids.slice(), rng);
    const n = seatOrder.length;
    const firstPres = Math.floor(rng() * n);

    // Choose which SEATS are fascist; the first of them is Hitler.
    const seats = shuffleInPlace(seatOrder.map((_, i) => i), rng);
    const fascistSeats = seats.slice(0, fascistTotal(n));
    const hitlerSeat = fascistSeats[0];
    const regularFascistSeats = fascistSeats.slice(1);

    const roleOf = {};
    seatOrder.forEach((uid, i) => {
      roleOf[uid] = i === hitlerSeat ? "hitler"
        : fascistSeats.indexOf(i) >= 0 ? "fascist" : "liberal";
    });
    const hitlerUid = seatOrder[hitlerSeat];
    const fascistUids = regularFascistSeats.map((i) => seatOrder[i]);

    const reveals = {};
    seatOrder.forEach((uid, i) => {
      const role = roleOf[uid];
      let knownFascists = [], knownHitler = null;
      if (role === "fascist") {
        knownFascists = fascistUids.filter((u) => u !== uid);
        knownHitler = hitlerUid;
      } else if (role === "hitler" && hitlerKnowsFascists(n)) {
        knownFascists = fascistUids.slice();
      }
      reveals[uid] = { role, seat: i, knownFascists, knownHitler };
    });

    return { seatOrder, firstPres, playerCount: n, roleOf, hitlerUid, fascistUids, reveals };
  }

  const api = { fascistTotal, hitlerKnowsFascists, shuffleInPlace, setupGame };
  if (typeof window !== "undefined") window.Engine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
