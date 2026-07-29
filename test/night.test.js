/* ============================================================================
 * night.test.js — tests for the "in the night" narration (js/night.js).
 *
 * The pure parts (script selection, pacing, voice picking, display text) run
 * with BARE `node test/night.test.js` — no dependencies. The IndexedDB storage
 * layer additionally runs when `fake-indexeddb` is installed (dev-only, in
 * test/); it's skipped, not failed, when that package is absent, so the pure
 * checks always run.
 * ==========================================================================*/
"use strict";
const Night = require("../js/night.js");

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.error("  ✗ " + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ` (got ${JSON.stringify(a)})`); }

// ---- script selection: 5–6 ⇒ small, 7+ ⇒ large --------------------------
eq(Night.scriptKeyFor(5), "small", "5 players ⇒ small");
eq(Night.scriptKeyFor(6), "small", "6 players ⇒ small");
eq(Night.scriptKeyFor(7), "large", "7 players ⇒ large");
eq(Night.scriptKeyFor(8), "large", "8 players ⇒ large");
eq(Night.scriptKeyFor(10), "large", "10 players ⇒ large");

// ---- both scripts exist and end sensibly --------------------------------
ok(Night.SEGMENTS.small.length >= 3, "small script has segments");
ok(Night.SEGMENTS.large.length >= 4, "large script has segments");
ok(/close your eyes/i.test(Night.SEGMENTS.small[0].say), "small opens with eyes closed");
ok(/fist|thumb/i.test(Night.SEGMENTS.large[0].say), "large opens with the thumb/fist setup");
ok(Night.SEGMENTS.large.some((s) => /raise your thumb/i.test(s.say)), "large has Hitler raise their thumb");
ok(!Night.SEGMENTS.large.some((s) => /fascists, open your eyes.*hitler.*open/i.test(s.say)),
  "large never tells Hitler to open their eyes");
ok(!Night.SEGMENTS.small.some((s) => /if you.?re hitler|you now know who the other fascist/i.test(s.say)),
  "small no longer calls out Hitler after the fascists open their eyes");
ok(!Night.SEGMENTS.small.some((s) => /problems in the night/i.test(s.say)),
  "small no longer has the 'problems in the night' line");
eq(Night.SEGMENTS.small[Night.SEGMENTS.small.length - 1].wait, 0, "small ends with no trailing pause");
eq(Night.SEGMENTS.large[Night.SEGMENTS.large.length - 1].wait, 0, "large ends with no trailing pause");

// ---- pacing: the between-line pauses are the scripted ~3s ----------------
ok(Night.SEGMENTS.small.filter((s) => s.wait === 3000).length >= 2, "small has 3s pauses");
ok(Night.SEGMENTS.large.filter((s) => s.wait === 3000).length >= 2, "large has 3s pauses");
ok(!Night.SEGMENTS.small.concat(Night.SEGMENTS.large).some((s) => s.wait === 5000), "no 5s pauses remain");

// ---- display script carries pause cues for a human reader ----------------
const dispL = Night.displayScript("large");
ok(/pause about 3 seconds/.test(dispL), "display script shows the 3-second cue");
ok(/raise your thumb/i.test(dispL), "display script includes the thumb signal");

// ---- gender guessing + best-voice picking --------------------------------
eq(Night.guessGender("Microsoft Aria Online (Natural)"), "female", "Aria ⇒ female");
eq(Night.guessGender("Microsoft Guy Online (Natural)"), "male", "Guy ⇒ male");
eq(Night.guessGender("Microsoft David Desktop"), "male", "David ⇒ male");
eq(Night.guessGender("Google US English"), "female", "Google US English ⇒ female (default)");
eq(Night.guessGender("Some Voice Female"), "female", "…Female ⇒ female (keyword)");

const voices = [
  { name: "Microsoft David Desktop", lang: "en-US", localService: true },
  { name: "Microsoft Zira Desktop", lang: "en-US", localService: true },
  { name: "Microsoft Aria Online (Natural)", lang: "en-US", localService: false },
  { name: "Microsoft Guy Online (Natural)", lang: "en-US", localService: false },
];
eq(Night.pickVoice("female", voices).name, "Microsoft Aria Online (Natural)", "prefers the natural female voice");
eq(Night.pickVoice("male", voices).name, "Microsoft Guy Online (Natural)", "prefers the natural male voice");
ok(Night.pickVoice("female", []) === null, "no voices ⇒ null");

// ---- IndexedDB storage layer (only if fake-indexeddb is available) --------
let idbAvailable = false;
try { require("fake-indexeddb/auto"); idbAvailable = true; } catch (e) { /* skipped */ }

async function idbTests() {
  if (typeof Blob === "undefined") { console.log("  (Blob unavailable — skipping IDB tests)"); return; }
  const blobS = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
  const blobL = new Blob([new Uint8Array([4, 5, 6, 7])], { type: "audio/webm" });

  ok((await Night.listSets()).length === 0, "starts with no custom voices");
  const setA = await Night.createSet("Tim's voice");
  ok(setA && setA.id, "createSet returns an id");
  await Night.putClip(setA.id, "small", blobS);
  await Night.putClip(setA.id, "large", blobL);

  const gotL = await Night.getClip(setA.id, "large");
  ok(gotL && gotL.size === 4, "getClip round-trips the large clip");
  const gotS = await Night.getClip(setA.id, "small");
  ok(gotS && gotS.size === 3, "getClip round-trips the small clip");

  let sets = await Night.listSets();
  eq(sets.length, 1, "one custom voice stored");
  ok(sets[0].name === "Tim's voice" && sets[0].small && sets[0].large,
    "listSets reports the name and that both clips are present");

  // a second set with only the large clip is reported as missing the small one
  const setB = await Night.createSet("Partial");
  await Night.putClip(setB.id, "large", blobL);
  sets = await Night.listSets();
  const b = sets.find((s) => s.id === setB.id);
  ok(b && b.large && !b.small, "a half-recorded voice reports the missing clip");

  await Night.deleteSet(setA.id);
  sets = await Night.listSets();
  ok(sets.length === 1 && !sets.find((s) => s.id === setA.id), "deleteSet removes the set");
  ok((await Night.getClip(setA.id, "large")) === undefined, "deleteSet removes its clips too");

  // ---- sharing metadata + base64 round-trip (the sync path) ----
  ok(await base64idempotent(blobL), "base64 encode→decode preserves clip bytes");

  const localV = await Night.createSet("Local only");
  eq((await Night.listSets()).find((s) => s.id === localV.id).shared, false, "new voice starts unshared");
  await Night.markShared(localV.id, { shared: true, groupId: "g1", createdBy: "u1" });
  const marked = (await Night.listSets()).find((s) => s.id === localV.id);
  ok(marked.shared === true && marked.groupId === "g1" && marked.createdBy === "u1", "markShared records who/where");

  // a voice downloaded from the group is cached (base64 in → blobs out)
  const b64s = await Night.blobToBase64(blobS);
  const b64l = await Night.blobToBase64(blobL);
  await Night.saveRemoteVoice("remoteX", "Group voice", "g1", "u2", {
    small: { data: b64s, mime: "audio/webm" }, large: { data: b64l, mime: "audio/webm" },
  });
  const rv = (await Night.listSets()).find((s) => s.id === "remoteX");
  ok(rv && rv.shared && rv.createdBy === "u2" && rv.small && rv.large, "saveRemoteVoice caches a group voice with both clips");
  const rvClip = await Night.getClip("remoteX", "large");
  ok(rvClip && rvClip.size === 4, "the cached remote clip round-trips to the right bytes");
}

async function base64idempotent(blob) {
  const b64 = await Night.blobToBase64(blob);
  const back = Night.base64ToBlob(b64, "audio/webm");
  const a = new Uint8Array(await blob.arrayBuffer());
  const b = new Uint8Array(await back.arrayBuffer());
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

(async () => {
  if (idbAvailable) { try { await idbTests(); } catch (e) { failed++; console.error("  ✗ IDB tests threw: " + (e && e.stack || e)); } }
  else console.log("  (fake-indexeddb not installed — IndexedDB tests skipped; run `npm i` in test/)");

  console.log(`\nnight.test.js: ${passed} passed, ${failed} failed${idbAvailable ? "" : " (IDB skipped)"}.`);
  process.exit(failed ? 1 : 0);
})();
