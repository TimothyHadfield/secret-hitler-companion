/* ============================================================================
 * cloud.js — accounts, cross-device sync, and groups. Phases 1-2 of BACKEND_PLAN.md.
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
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const GAMES_KEY = "secretHitler.games.v1";
const SYNCED_KEY = "secretHitler.cloud.synced.v1"; // ids known to exist in the cloud
const GROUPS_KEY = "secretHitler.cloud.groups.v1"; // cached group metadata
const ACTIVE_KEY = "secretHitler.cloud.activeGroup.v1";
const membersKey = (gid) => `secretHitler.cloud.members.${gid}`;

const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let activeGroupId = null;
let myGroups = [];        // [{ id, name, ownerUid, inviteCode, memberUids }]
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

// ---- group + roster caches, so the UI works offline and renders instantly ----
function readGroupCache() {
  try { return JSON.parse(lsGet(GROUPS_KEY)) || []; } catch (e) { return []; }
}
function writeGroupCache(gs) { lsSet(GROUPS_KEY, JSON.stringify(gs)); }

function readMembers(gid) {
  try { return JSON.parse(lsGet(membersKey(gid))) || []; } catch (e) { return []; }
}
function writeMembers(gid, ms) { lsSet(membersKey(gid), JSON.stringify(ms)); }

const normName = (s) => String(s || "").trim().toLowerCase();

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
function toCloud(g, gid, seats) {
  return clean({
    createdBy: currentUser.uid,
    groupId: gid,
    playedAt: g.date || new Date().toISOString(),
    playerCount: g.playerCount || (g.players || []).length,
    firstPres: g.firstPres == null ? 0 : g.firstPres,
    // Names are kept alongside seats so a game still reads correctly even if a
    // member is later renamed or the roster is unavailable.
    players: (g.players || []).map((p) => ({ name: p.name })),
    seats: seats || [],   // roster member ids, positionally matching players
    events: g.events || [],
    roundMods: g.roundMods || {},
    result: g.result,
    schema: 1,
  });
}

function fromCloud(id, d, gid) {
  return {
    id,
    players: d.players || [],
    playerCount: d.playerCount || (d.players || []).length,
    firstPres: d.firstPres == null ? 0 : d.firstPres,
    events: d.events || [],
    roundMods: d.roundMods || {},
    result: d.result,
    date: d.playedAt,
    groupId: d.groupId || gid || null,
    seats: d.seats || [],
  };
}

// ------------------------------------------------------- profile + groups
const newId = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  "g-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const myDisplayName = () =>
  (currentUser.displayName || "").trim() ||
  (currentUser.email || "").split("@")[0] ||
  "Player";

/** Read the profile's group list, drop any that no longer exist, and cache. */
async function loadGroups() {
  const uid = currentUser.uid;
  const snap = await getDoc(doc(db, "profiles", uid));
  const ids = (snap.exists() && Array.isArray(snap.data().groupIds) && snap.data().groupIds) || [];
  const found = [];
  for (const gid of ids) {
    const g = await getDoc(doc(db, "groups", gid));
    if (g.exists()) found.push({ id: gid, ...g.data() });
  }
  myGroups = found;
  writeGroupCache(found.map((g) => ({
    id: g.id, name: g.name, ownerUid: g.ownerUid, inviteCode: g.inviteCode,
    memberUids: g.memberUids || [],
  })));
  return found;
}

/**
 * Make sure the signed-in user has a profile and at least one group, and pick
 * the active one. Group ids live on the profile because the rules deny
 * listing /groups — nobody can enumerate other people's groups.
 */
async function ensureProfileAndGroup() {
  const uid = currentUser.uid;
  await loadGroups();

  if (!myGroups.length) {
    // A solo user gets a group of one, so there is a single data model and
    // personal statistics are simply group statistics.
    await createGroup("My Games");
  }

  const saved = lsGet(ACTIVE_KEY);
  activeGroupId = myGroups.some((g) => g.id === saved) ? saved : myGroups[0].id;
  lsSet(ACTIVE_KEY, activeGroupId);

  // Keep the profile's display name fresh without clobbering groupIds.
  await setDoc(doc(db, "profiles", uid), { displayName: myDisplayName() }, { merge: true });
}

async function addGroupToProfile(gid) {
  const pref = doc(db, "profiles", currentUser.uid);
  const snap = await getDoc(pref);
  const ids = (snap.exists() && Array.isArray(snap.data().groupIds) && snap.data().groupIds) || [];
  if (ids.includes(gid)) return;
  await setDoc(pref, { displayName: myDisplayName(), groupIds: [...ids, gid] }, { merge: true });
}

async function createGroup(name) {
  const uid = currentUser.uid;
  const gid = newId();
  const clean = String(name || "").trim().slice(0, 60) || "New group";
  await setDoc(doc(db, "groups", gid), {
    name: clean,
    ownerUid: uid,
    inviteCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
    memberUids: [uid],           // rules require exactly [creator] on create
    createdAt: serverTimestamp(),
  });
  await addGroupToProfile(gid);
  // Seat the creator on the roster so games they play in map to a member.
  await addDoc(collection(db, "groups", gid, "members"), {
    displayName: myDisplayName(), uid, createdAt: serverTimestamp(),
  });
  await loadGroups();
  return gid;
}

/**
 * Join via an invite link. The rules allow a non-member to append ONLY their
 * own uid and to change nothing else, which is what replaces the Cloud
 * Function this would otherwise need.
 */
async function joinGroup(gid) {
  const gref = doc(db, "groups", gid);
  const snap = await getDoc(gref);
  if (!snap.exists()) return { ok: false, message: "That invite link doesn't point to a group any more." };
  const g = snap.data();
  const uid = currentUser.uid;
  const already = (g.memberUids || []).includes(uid);

  if (!already) {
    try {
      await updateDoc(gref, { memberUids: [...(g.memberUids || []), uid] });
    } catch (e) {
      return { ok: false, message: "Couldn't join that group — the invite may be invalid." };
    }
  }
  // Membership itself is what matters and has already been written. Seating
  // them on the roster is best-effort: if it fails here it is retried by the
  // next sync, so a slow rules propagation must not fail the whole join.
  try {
    await addGroupToProfile(gid);
    await loadGroups();
  } catch (e) {
    return { ok: false, message: "Joined, but couldn't load the group: " + (e.message || e) };
  }
  if (!already) {
    try {
      const ms = await fetchMembers(gid);
      if (!ms.some((m) => m.uid === uid)) {
        await addDoc(collection(db, "groups", gid, "members"), {
          displayName: myDisplayName(), uid, createdAt: serverTimestamp(),
        });
      }
    } catch (e) {
      /* roster seat deferred to the next sync */
    }
  }
  await setActiveGroup(gid);
  return { ok: true, name: g.name, already };
}

async function setActiveGroup(gid) {
  if (!myGroups.some((g) => g.id === gid)) return false;
  activeGroupId = gid;
  lsSet(ACTIVE_KEY, gid);
  emit("cloud:groups", { groups: groupList(), activeGroupId });
  return true;
}

// ------------------------------------------------------------- roster
/**
 * Retry a read that can transiently fail with permission-denied.
 * Right after joining a group, the rules engine can still be evaluating
 * `isMember` against a pre-join view of the group document, so a read that
 * will shortly be allowed is refused. Observed to clear within seconds.
 */
async function withRetry(fn, tries = 5, delayMs = 1200) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (e.code !== "permission-denied") throw e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}

async function fetchMembers(gid) {
  const snap = await withRetry(() => getDocs(collection(db, "groups", gid, "members")));
  const ms = [];
  snap.forEach((d) => ms.push({ id: d.id, ...d.data() }));
  writeMembers(gid, ms);
  return ms;
}

async function addMember(gid, displayName) {
  const name = String(displayName || "").trim().slice(0, 60);
  if (!name) return null;
  const ms = readMembers(gid);
  const hit = ms.find((m) => normName(m.displayName) === normName(name));
  if (hit) return hit.id;
  const ref = await addDoc(collection(db, "groups", gid, "members"), {
    displayName: name, uid: null, createdAt: serverTimestamp(),
  });
  ms.push({ id: ref.id, displayName: name, uid: null });
  writeMembers(gid, ms);
  return ref.id;
}

/**
 * Map a game's player names onto roster member ids, creating members for names
 * not seen before. Done at UPLOAD time rather than when the game is recorded,
 * so recording a game never needs the network and free-typed names still work
 * at the table.
 */
async function resolveSeats(gid, players) {
  let ms = readMembers(gid);
  if (!ms.length) ms = await fetchMembers(gid);
  const seats = [];
  for (const p of players || []) {
    const name = String((p && p.name) || "").trim();
    if (!name) { seats.push(null); continue; }
    let hit = ms.find((m) => normName(m.displayName) === normName(name));
    if (!hit) {
      const ref = await addDoc(collection(db, "groups", gid, "members"), {
        displayName: name, uid: null, createdAt: serverTimestamp(),
      });
      hit = { id: ref.id, displayName: name, uid: null };
      ms.push(hit);
      writeMembers(gid, ms);
    }
    seats.push(hit.id);
  }
  return seats;
}

function groupList() {
  const cached = readGroupCache();
  const live = myGroups.length ? myGroups : cached;
  return live.map((g) => ({
    id: g.id,
    name: g.name,
    isOwner: g.ownerUid === (currentUser && currentUser.uid),
    memberCount: (g.memberUids || []).length,
  }));
}

function inviteLink(gid) {
  const base = location.origin + location.pathname.replace(/index\.html$/, "");
  return base + "?join=" + encodeURIComponent(gid);
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
      await loadGroups();
      if (!myGroups.length) { setStatus("idle"); return { uploaded: 0, downloaded: 0 }; }
      if (!myGroups.some((g) => g.id === activeGroupId)) activeGroupId = myGroups[0].id;

      const local = readLocal();
      const synced = readSynced();
      const mayUpload = uploadAllowed() !== false;
      let uploaded = 0, downloaded = 0, dirty = false;

      // Games recorded before joining/creating a group (or while signed out)
      // belong to whatever group is active when they finally sync.
      if (mayUpload) {
        for (const g of local) {
          if (g.result && !g.groupId) { g.groupId = activeGroupId; dirty = true; }
        }
      }

      for (const grp of myGroups) {
        const col = collection(db, "groups", grp.id, "games");
        const snap = await withRetry(() => getDocs(col));
        const remote = new Map();
        snap.forEach((d) => remote.set(d.id, d.data()));
        const localIds = new Set(local.map((g) => g.id).filter(Boolean));

        if (mayUpload) {
          for (const g of local) {
            if (!g.id || !g.result) continue;   // only completed, identified games
            if (g.groupId !== grp.id) continue;
            if (remote.has(g.id)) { synced.add(g.id); continue; }
            const seats = await resolveSeats(grp.id, g.players);
            await setDoc(doc(col, g.id), toCloud(g, grp.id, seats));
            synced.add(g.id);
            uploaded++;
          }
        }

        for (const [id, d] of remote) {
          synced.add(id);
          if (localIds.has(id)) continue;
          local.push(fromCloud(id, d, grp.id));
          downloaded++;
          dirty = true;
        }
        // Also repairs a roster seat that a just-completed join couldn't create.
        const ms = await fetchMembers(grp.id);
        if (!ms.some((m) => m.uid === currentUser.uid)) {
          try {
            await addDoc(collection(db, "groups", grp.id, "members"), {
              displayName: myDisplayName(), uid: currentUser.uid, createdAt: serverTimestamp(),
            });
          } catch (e) { /* try again next sync */ }
        }
      }

      if (dirty) writeLocal(local);
      writeSynced(synced);

      setStatus("idle");
      emit("cloud:groups", { groups: groupList(), activeGroupId });
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

// ------------------------------------------------- invite links (?join=…)
// Captured immediately, because the visitor may not be signed in yet: the id is
// held until an account exists, then the join happens automatically.
const PENDING_JOIN = "secretHitler.cloud.pendingJoin";
const pendingJoin = () => lsGet(PENDING_JOIN);
function clearPendingJoin() { try { localStorage.removeItem(PENDING_JOIN); } catch (e) {} }

(function captureInvite() {
  const m = /[?&]join=([^&]+)/.exec(location.search || "");
  if (!m) return;
  const gid = decodeURIComponent(m[1]);
  lsSet(PENDING_JOIN, gid);
  // Strip it from the URL so a refresh (or a shared screenshot) can't re-trigger.
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  emit("cloud:invite", { groupId: gid });
})();

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
      // Someone arriving through an invite link signs in first, then joins.
      const want = pendingJoin();
      if (want) {
        const r = await joinGroup(want);
        clearPendingJoin();
        emit("cloud:joined", r);
      }
      setStatus("idle");
      emit("cloud:groups", { groups: groupList(), activeGroupId });
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
  get groupName() {
    const g = groupList().find((x) => x.id === activeGroupId);
    return g ? g.name : null;
  },
  pendingJoin,
  clearPendingJoin,

  pendingCount,
  sync,
  uploadAllowed,
  setUploadAllowed,

  // ---- groups ----
  groups: groupList,
  members: (gid) => readMembers(gid || activeGroupId),
  inviteLink,
  setActiveGroup,
  async createGroup(name) {
    try { const gid = await createGroup(name); await setActiveGroup(gid); await sync(); return { ok: true, id: gid }; }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async joinGroup(gid) {
    try { const r = await joinGroup(gid); if (r.ok) await sync(); return r; }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async addMember(name, gid) {
    try { const id = await addMember(gid || activeGroupId, name); return { ok: !!id, id }; }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },

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
