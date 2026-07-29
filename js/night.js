/* ============================================================================
 * night.js — the "in the night" narration.
 *
 * At the start of a game the fascists need to learn who each other are. This
 * plays the classic narration that walks the table through eyes-closed / eyes-
 * open, so nobody at the table has to read it aloud. Two scripts:
 *   • small (5–6 players): Hitler opens their eyes WITH the fascists.
 *   • large (7+ players):  Hitler stays hidden and signals with a raised thumb.
 * The game picks the right one from the player count automatically.
 *
 * Voices:
 *   • the two built-in defaults (female / male) speak via the browser's speech
 *     engine (Web Speech API), preferring natural/neural voices, with the pauses
 *     timed by us — no audio files to ship.
 *   • a user can record or upload their OWN clip for each script; those are
 *     stored locally in IndexedDB (blobs) and played back as-is.
 *
 * This is a classic script (like stats.js): it exposes `window.Night` and, for
 * Node unit tests, `module.exports`. Everything browser-only (speech, mic,
 * IndexedDB) is feature-detected so the pure parts load anywhere.
 * ==========================================================================*/

const Night = (() => {
  // ---- the narration, as speakable segments with trailing pauses (ms) --------
  // Kept close to the wording a human narrator would use; the display text shown
  // while recording is derived from these so the two never drift apart.
  const SEGMENTS = {
    small: [
      { say: "Everyone, close your eyes.", wait: 5000 },
      { say: "Fascists, open your eyes. See who the other fascist is. If you are Hitler, then you now know who the other fascist is.", wait: 5000 },
      { say: "Fascists, close your eyes.", wait: 5000 },
      { say: "Everyone, open your eyes. If anyone had any problems in the night, bring them up now.", wait: 0 },
    ],
    large: [
      { say: "Everyone, put your fist on the table with your thumb on top. Everyone, close your eyes.", wait: 5000 },
      { say: "Hitler, keep your eyes closed and raise your thumb up.", wait: 2500 },
      { say: "Fascists, open your eyes. See who the other fascists are. Hitler's thumb is raised.", wait: 5000 },
      { say: "Fascists, close your eyes. Hitler, put your thumb down.", wait: 5000 },
      { say: "Everyone, open your eyes.", wait: 0 },
    ],
  };

  // Which script a game of `n` players uses. 5–6 ⇒ small (Hitler sees fascists);
  // 7+ ⇒ large (Hitler hidden, thumb signal). Games are always 5–10 players.
  function scriptKeyFor(n) { return n >= 7 ? "large" : "small"; }

  const SCRIPT_TITLE = { small: "5–6 players", large: "7+ players" };

  // Human-readable script with pause cues — shown to the user while they record
  // their own version, so their pauses line up with the timed defaults.
  function displayScript(key) {
    return SEGMENTS[key]
      .map((s) => s.say + (s.wait ? `\n\n( pause about ${Math.round(s.wait / 1000)} seconds )\n` : ""))
      .join("\n");
  }

  // =============================== speech ===================================
  const hasSpeech = () => typeof window !== "undefined" && "speechSynthesis" in window;

  let _voicesReady = null;
  // Voices load asynchronously in most browsers; resolve once they're available
  // (or after a short grace period, so a browser that never fires the event or
  // has no voices still lets playback fall through).
  function ready() {
    if (!hasSpeech()) return Promise.resolve([]);
    if (_voicesReady) return _voicesReady;
    _voicesReady = new Promise((resolve) => {
      const got = () => window.speechSynthesis.getVoices();
      if (got().length) return resolve(got());
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(got()); };
      window.speechSynthesis.onvoiceschanged = finish;
      setTimeout(finish, 1500);
    });
    return _voicesReady;
  }

  const FEMALE_NAMES = ["aria", "jenny", "michelle", "ava", "samantha", "sonia", "libby",
    "clara", "natasha", "emma", "joanna", "salli", "kimberly", "susan", "hazel", "catherine",
    "zira", "eva", "linda", "karen", "moira", "tessa", "fiona", "serena", "allison", "zoe",
    "nicky", "amber", "ashley", "elizabeth", "heera", "google us english"];
  const MALE_NAMES = ["guy", "andrew", "christopher", "eric", "ryan", "alex", "daniel",
    "george", "david", "mark", "brandon", "matthew", "james", "fred", "arthur", "oliver",
    "william", "liam", "aaron", "jason", "paul", "richard", "tom", "thomas"];

  function guessGender(name) {
    const n = String(name).toLowerCase();
    if (n.includes("female") || n.includes("woman")) return "female";
    if (n.includes("male") || n.includes("man")) return "male"; // after the female check
    if (FEMALE_NAMES.some((x) => n.includes(x))) return "female";
    if (MALE_NAMES.some((x) => n.includes(x))) return "male";
    return null;
  }

  // Score an English voice for the wanted gender, preferring natural/neural
  // (and networked) voices — the ones that don't sound like a robot.
  function scoreVoice(v, gender) {
    const n = (v.name || "").toLowerCase();
    let s = 0;
    const g = guessGender(v.name);
    if (g === gender) s += 100; else if (g) s -= 100;
    if (/natural|neural|online|premium|enhanced|siri|multilingual/.test(n)) s += 60;
    if (/^en-us/i.test(v.lang)) s += 12; else if (/^en/i.test(v.lang)) s += 6;
    if (v.localService === false) s += 6;
    return s;
  }

  // Best available voice for a gender ("female" | "male"), or null if none.
  function pickVoice(gender, voices) {
    const all = voices || (hasSpeech() ? window.speechSynthesis.getVoices() : []);
    if (!all || !all.length) return null;
    const eng = all.filter((v) => /^en(-|_|$)/i.test(v.lang) || /english/i.test(v.name));
    const pool = eng.length ? eng : all;
    let best = null, bestScore = -Infinity;
    pool.forEach((v) => { const sc = scoreVoice(v, gender); if (sc > bestScore) { bestScore = sc; best = v; } });
    return best;
  }

  // Some engines (notably Chrome) silently drop long speech unless nudged; the
  // segments here are short, but a resume() heartbeat keeps a queued utterance
  // from stalling during the timed pauses.
  function speak(key, gender, handlers) {
    handlers = handlers || {};
    const segs = SEGMENTS[key] || SEGMENTS.small;
    if (!hasSpeech()) { if (handlers.onError) handlers.onError("no-speech"); return { stop() {} }; }
    const synth = window.speechSynthesis;
    const voice = pickVoice(gender);
    let i = 0, stopped = false, timer = null;
    const beat = setInterval(() => { try { if (synth.speaking) synth.resume(); } catch (e) {} }, 4000);
    const cleanup = () => { stopped = true; clearInterval(beat); if (timer) clearTimeout(timer); try { synth.cancel(); } catch (e) {} };

    function next() {
      if (stopped) return;
      if (i >= segs.length) { clearInterval(beat); if (handlers.onDone) handlers.onDone(); return; }
      const seg = segs[i];
      if (handlers.onStep) handlers.onStep(i, segs.length, seg);
      const u = new SpeechSynthesisUtterance(seg.say);
      if (voice) u.voice = voice;
      u.rate = 0.95; u.pitch = 1; u.volume = 1;
      const after = () => {
        if (stopped) return;
        const w = seg.wait || 0;
        i++;
        timer = setTimeout(next, w);
      };
      u.onend = after;
      u.onerror = after; // don't stall the whole narration on one bad utterance
      try { synth.cancel(); } catch (e) {}
      synth.speak(u);
    }
    next();
    return { stop: cleanup, voiceName: voice ? voice.name : null };
  }

  // =============================== storage ==================================
  // Custom clips are blobs, too big/binary for localStorage — IndexedDB holds
  // them. Metadata (set id + name) lives in a tiny 'sets' store alongside.
  const DB_NAME = "secretHitlerNight";
  const CLIPS = "clips";   // key `${setId}:${scriptKey}` -> Blob
  const SETS = "sets";     // key setId -> { id, name, createdAt }
  const hasIDB = () => typeof indexedDB !== "undefined";

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!hasIDB()) return reject(new Error("no-indexeddb"));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CLIPS)) db.createObjectStore(CLIPS);
        if (!db.objectStoreNames.contains(SETS)) db.createObjectStore(SETS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function tx(db, store, mode) { return db.transaction(store, mode).objectStore(store); }
  function pReq(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  function uuid() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  async function listSets() {
    if (!hasIDB()) return [];
    const db = await openDB();
    const sets = await pReq(tx(db, SETS, "readonly").getAll());
    const keys = await pReq(tx(db, CLIPS, "readonly").getAllKeys());
    const have = new Set(keys);
    return (sets || [])
      .map((s) => ({ ...s, small: have.has(s.id + ":small"), large: have.has(s.id + ":large") }))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  async function createSet(name) {
    const db = await openDB();
    // shared/groupId/createdBy are filled once a voice is shared to a group (or
    // when it was downloaded from one) — see markShared / saveRemoteVoice.
    const rec = { id: uuid(), name: String(name || "My voice").slice(0, 40), createdAt: Date.now(), shared: false, groupId: null, createdBy: null };
    await pReq(tx(db, SETS, "readwrite").put(rec, rec.id));
    return rec;
  }

  // Update a set's sharing metadata (after a successful upload, or when a share
  // is withdrawn). Merges onto whatever is stored.
  async function markShared(id, patch) {
    const db = await openDB();
    const cur = await pReq(tx(db, SETS, "readonly").get(id));
    if (!cur) return false;
    await pReq(tx(db, SETS, "readwrite").put(Object.assign({}, cur, patch), id));
    return true;
  }

  // Cache a voice downloaded from the group into local IndexedDB, so it plays
  // instantly and offline. Clips arrive base64-encoded (Firestore stores text).
  async function saveRemoteVoice(id, name, groupId, createdBy, clips) {
    const db = await openDB();
    await pReq(tx(db, SETS, "readwrite").put(
      { id, name: String(name || "Voice").slice(0, 40), createdAt: Date.now(), shared: true, groupId: groupId || null, createdBy: createdBy || null }, id));
    for (const key of ["small", "large"]) {
      const c = clips && clips[key];
      if (c && c.data) await pReq(tx(db, CLIPS, "readwrite").put(base64ToBlob(c.data, c.mime), id + ":" + key));
    }
    return true;
  }
  async function putClip(setId, key, blob) {
    const db = await openDB();
    await pReq(tx(db, CLIPS, "readwrite").put(blob, setId + ":" + key));
    return true;
  }
  async function getClip(setId, key) {
    const db = await openDB();
    return pReq(tx(db, CLIPS, "readonly").get(setId + ":" + key));
  }
  async function deleteSet(setId) {
    const db = await openDB();
    await pReq(tx(db, SETS, "readwrite").delete(setId));
    await pReq(tx(db, CLIPS, "readwrite").delete(setId + ":small"));
    await pReq(tx(db, CLIPS, "readwrite").delete(setId + ":large"));
    return true;
  }

  // ---- base64 <-> Blob (Firestore stores audio as text) --------------------
  // Cross-environment (browser + Node test): uses atob/btoa when present, else
  // Buffer. Chunked to avoid blowing the argument limit on large clips.
  const _btoa = typeof btoa !== "undefined" ? btoa : (s) => Buffer.from(s, "binary").toString("base64");
  const _atob = typeof atob !== "undefined" ? atob : (s) => Buffer.from(s, "base64").toString("binary");
  async function blobToBase64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    return _btoa(bin);
  }
  function base64ToBlob(b64, mime) {
    const bin = _atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || "audio/webm" });
  }

  // Play a stored/custom clip. Returns a controller with the same shape as
  // speak(), so the caller treats TTS and custom clips identically.
  function playBlob(blob, handlers) {
    handlers = handlers || {};
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const cleanup = () => { try { audio.pause(); } catch (e) {} URL.revokeObjectURL(url); };
    audio.onended = () => { cleanup(); if (handlers.onDone) handlers.onDone(); };
    audio.onerror = () => { cleanup(); if (handlers.onError) handlers.onError("play-failed"); };
    audio.play().catch(() => { if (handlers.onError) handlers.onError("play-blocked"); });
    return { stop: cleanup };
  }

  // ---- selected voice preference (localStorage; small + text) ----------------
  const SEL_KEY = "secretHitler.night.voice.v1"; // 'female' | 'male' | 'custom:<setId>'
  function getSelected() {
    try { return localStorage.getItem(SEL_KEY) || "female"; } catch (e) { return "female"; }
  }
  function setSelected(v) { try { localStorage.setItem(SEL_KEY, v); } catch (e) {} }

  return {
    SEGMENTS, SCRIPT_TITLE,
    scriptKeyFor, displayScript,
    // speech
    ready, pickVoice, guessGender, speak, hasSpeech,
    // storage
    listSets, createSet, putClip, getClip, deleteSet, playBlob, hasIDB,
    markShared, saveRemoteVoice, blobToBase64, base64ToBlob,
    // preference
    getSelected, setSelected,
  };
})();

if (typeof window !== "undefined") window.Night = Night;
if (typeof module !== "undefined" && module.exports) module.exports = Night;
