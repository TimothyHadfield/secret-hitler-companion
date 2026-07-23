/* ============================================================================
 * cloud.js — accounts + cross-device sync. Phase 1 of BACKEND_PLAN.md.
 *
 * ARCHITECTURE: this module sits BEHIND localStorage, never in front of it.
 * The app keeps reading and writing `secretHitler.games.v1` exactly as it
 * always has; this is a background reconciler that pushes local games up and
 * pulls remote ones down, writing them into that same array. Nothing in
 * app.js or stats.js needs to know the network exists — which is why the app
 * still works with no account and no connection, and why a sync bug can never
 * break a game in progress.
 *
 * EVERYTHING IS A GROUP. A solo user gets a group of one ("My Games"), so
 * there is a single data model and personal stats are literally group stats.
 * Groups are found via `profiles/{uid}.groupIds` — security rules deny
 * listing the groups collection (so ids can't be enumerated), so the profile
 * is what remembers which groups you belong to.
 *
 * This is an ES module and loads Firebase from a CDN, so there is still no
 * build step. It talks to the rest of the app through `window.Cloud` and
 * `cloud:*` DOM events; app.js stays a classic script.
 * ==========================================================================*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut as fbSignOut, updateProfile,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const GAMES_KEY = "secretHitler.games.v1";
const SYNCED_KEY = "secretHitler.cloud.synced.v1"; // ids known to exist in the cloud

const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let activeGroupId = null;
let status = "signed-out"; // signed-out | idle | syncing | offline | error
let lastError = null;

// ---------------------------------------------------------------- utilities
const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

function setStatus(s, err) {
  status = s;
  lastError = err || null;
  emit("cloud:status", { status: s, error: lastError, pending: pendingCount() });
}

// Firestore rejects `undefined`; a JSON round-trip drops those keys and leaves
// nulls (a vetoed government's `enacted: null`) intact.
const clean = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

function readLocal() {
  try { return JSON.parse(lsGet(GAMES_KEY)) || []; } catch (e) { return []; }
}
function writeLocal(games) {
  if (!lsSet(GAMES_KEY, JSON.stringify(games))) emit("cloud:error", { message: "Local storage is full — some downloaded games were not saved." });
}
function readSynced() {
  try { return new Set(JSON.parse(lsGet(SYNCED_KEY)) || []); } catch (e) { return new Set(); }
}
function writeSynced(set) { lsSet(SYNCED_KEY, JSON.stringify([...set])); }

/** Local games not yet known to exist in the cloud. */
function pendingCount() {
  if (!currentUser) return 0;
  const synced = readSynced();
  return readLocal().filter((g) => g.id && !synced.has(g.id)).length;
}

// Whether this device's existing games may be pushed into this account.
// Signing in should never silently absorb a shared device's history into
// whichever account happened to log in, so the app asks once per account.
// null = not asked yet.
const uploadKey = (uid) => `secretHitler.cloud.upload.${uid}`;
function uploadAllowed() {
  if (!currentUser) return false;
  const v = lsGet(uploadKey(currentUser.uid));
  return v === null ? null : v === "yes";
}
function setUploadAllowed(yes) {
  if (!currentUser) return;
  lsSet(uploadKey(currentUser.uid), yes ? "yes" : "no");
}

// ------------------------------------------------------- record conversions
function toCloud(g) {
  return clean({
    createdBy: currentUser.uid,
    groupId: activeGroupId,
    playedAt: g.date || new Date().toISOString(),
    playerCount: g.playerCount || (g.players || []).length,
    firstPres: g.firstPres == null ? 0 : g.firstPres,
    players: (g.players || []).map((p) => ({ name: p.name })),
    seats: [],            // phase 2: group-member ids
    events: g.events || [],
    roundMods: g.roundMods || {},
    result: g.result,
    schema: 1,
  });
}

function fromCloud(id, d) {
  return {
    id,
    players: d.players || [],
    playerCount: d.playerCount || (d.players || []).length,
    firstPres: d.firstPres == null ? 0 : d.firstPres,
    events: d.events || [],
    roundMods: d.roundMods || {},
    result: d.result,
    date: d.playedAt,
    groupId: d.groupId || null,
  };
}

// ------------------------------------------------------- profile + group
/**
 * Make sure the signed-in user has a profile and at least one group, and pick
 * the active one. Group ids live on the profile because the rules deny
 * listing /groups (so nobody can enumerate other people's groups).
 */
async function ensureProfileAndGroup() {
  const uid = currentUser.uid;
  const displayName =
    (currentUser.displayName || "").trim() ||
    (currentUser.email || "").split("@")[0] ||
    "Player";

  const pref = doc(db, "profiles", uid);
  const snap = await getDoc(pref);
  const data = snap.exists() ? snap.data() : null;
  const existing = (data && Array.isArray(data.groupIds) && data.groupIds) || [];

  if (existing.length) {
    activeGroupId = existing[0];
    // The profile could point at a group that was deleted; fall through to
    // creating a fresh one rather than leaving the user unable to sync.
    const g = await getDoc(doc(db, "groups", activeGroupId));
    if (g.exists()) return;
  }

  const gid = (crypto.randomUUID && crypto.randomUUID()) ||
    "g-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await setDoc(doc(db, "groups", gid), {
    name: "My Games",
    ownerUid: uid,
    inviteCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
    memberUids: [uid],           // rules require exactly [creator] on create
    createdAt: serverTimestamp(),
  });
  await setDoc(pref, { displayName, groupIds: [gid] }, { merge: true });
  activeGroupId = gid;
}

// ------------------------------------------------------------------- sync
let syncing = null; // in-flight promise, so concurrent triggers coalesce

async function sync() {
  if (!currentUser || !activeGroupId) return { uploaded: 0, downloaded: 0, skipped: true };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setStatus("offline");
    return { uploaded: 0, downloaded: 0, offline: true };
  }
  if (syncing) return syncing;

  syncing = (async () => {
    setStatus("syncing");
    try {
      const col = collection(db, "groups", activeGroupId, "games");
      const snap = await getDocs(col);
      const remote = new Map();
      snap.forEach((d) => remote.set(d.id, d.data()));

      const local = readLocal();
      const localIds = new Set(local.map((g) => g.id).filter(Boolean));
      const synced = readSynced();

      // Downloading is always safe; uploading needs consent (see uploadAllowed).
      const mayUpload = uploadAllowed() !== false;
      let uploaded = 0;
      if (mayUpload) {
        for (const g of local) {
          if (!g.id || !g.result) continue;    // only completed, identified games
          if (remote.has(g.id)) { synced.add(g.id); continue; }
          await setDoc(doc(col, g.id), toCloud(g));
          synced.add(g.id);
          uploaded++;
        }
      }

      let downloaded = 0;
      for (const [id, d] of remote) {
        synced.add(id);
        if (localIds.has(id)) continue;
        local.push(fromCloud(id, d));
        downloaded++;
      }
      if (downloaded) writeLocal(local);
      writeSynced(synced);

      setStatus("idle");
      emit("cloud:synced", { uploaded, downloaded });
      return { uploaded, downloaded };
    } catch (e) {
      setStatus("error", e.message || String(e));
      emit("cloud:synced", { error: e.message || String(e) });
      return { uploaded: 0, downloaded: 0, error: e.message || String(e) };
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// ------------------------------------------------------------------- auth
let resolveReady;
const ready = new Promise((r) => (resolveReady = r));
let firstAuthSeen = false;

onAuthStateChanged(auth, async (u) => {
  currentUser = u ? { uid: u.uid, email: u.email, displayName: u.displayName } : null;
  if (!u) {
    activeGroupId = null;
    setStatus("signed-out");
    emit("cloud:auth", { user: null });
  } else {
    emit("cloud:auth", { user: currentUser });
    try {
      await ensureProfileAndGroup();
      setStatus("idle");
      emit("cloud:ready-to-sync", { user: currentUser, groupId: activeGroupId });
    } catch (e) {
      setStatus("error", e.message || String(e));
    }
  }
  if (!firstAuthSeen) { firstAuthSeen = true; resolveReady(currentUser); }
});

// Friendlier text than Firebase's raw codes.
function humanError(e) {
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "That email or password isn't right.";
  if (c.includes("email-already-in-use")) return "That email already has an account — sign in instead.";
  if (c.includes("weak-password")) return "Password needs to be at least 6 characters.";
  if (c.includes("invalid-email")) return "That doesn't look like an email address.";
  if (c.includes("popup-closed-by-user") || c.includes("cancelled-popup")) return "Sign-in was cancelled.";
  if (c.includes("popup-blocked")) return "Your browser blocked the sign-in popup.";
  if (c.includes("network-request-failed")) return "No connection — you can keep playing offline.";
  if (c.includes("too-many-requests")) return "Too many attempts. Wait a moment and try again.";
  return (e && e.message) || "Something went wrong.";
}

window.Cloud = {
  ready,
  get user() { return currentUser; },
  get status() { return status; },
  get error() { return lastError; },
  get groupId() { return activeGroupId; },
  pendingCount,
  sync,
  uploadAllowed,
  setUploadAllowed,

  async signInWithGoogle() {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); return { ok: true }; }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async signInEmail(email, password) {
    try { await signInWithEmailAndPassword(auth, email, password); return { ok: true }; }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async signUpEmail(email, password, displayName) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(cred.user, { displayName });
        currentUser = { uid: cred.user.uid, email: cred.user.email, displayName };
      }
      return { ok: true };
    } catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async signOut() {
    try { await fbSignOut(auth); return { ok: true }; }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
};

// Sync when the connection comes back, and whenever the app records a game.
window.addEventListener("online", () => { if (currentUser) sync(); });
window.addEventListener("offline", () => { if (currentUser) setStatus("offline"); });
document.addEventListener("game:recorded", () => { if (currentUser) sync(); });

emit("cloud:loaded", {});
