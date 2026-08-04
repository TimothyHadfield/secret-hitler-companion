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
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection,
  getDocs, serverTimestamp, query, where,
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
    // Who recorded it — lets the app show the "edit roles" affordance only to the
    // author (the rules enforce it too).
    createdBy: d.createdBy || null,
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
    joinOpen: g.joinOpen !== false, // absent on groups predating the field
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

/**
 * Change the signed-in user's display name and push it everywhere it is stored,
 * so it updates across the whole app AND for everyone who shares a group.
 *   1. the Firebase Auth profile (what `currentUser.displayName` reads),
 *   2. the user's own profile document, and
 *   3. every roster seat that is THIS user (uid === me) in every group they are
 *      in — roster docs are shared group data, so other members see the new name
 *      on their next read/sync. The rules allow this: changing displayName while
 *      leaving `uid` untouched is a permitted roster edit.
 * Historical games keep the free-typed name used at the table (that is a snapshot
 * of what was played, not an identity), so they are deliberately not rewritten.
 */
async function setDisplayName(name) {
  if (!currentUser) return { ok: false, message: "Sign in to set a display name." };
  const clean = String(name || "").trim().slice(0, 60);
  if (!clean) return { ok: false, message: "A display name can't be empty." };
  try {
    if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: clean });
    currentUser = { ...currentUser, displayName: clean };
    await setDoc(doc(db, "profiles", currentUser.uid), { displayName: clean }, { merge: true });

    // Rename my seat in each group, best-effort (a slow/denied group must not
    // fail the whole operation — the name is already saved on the account).
    await loadGroups();
    for (const g of myGroups) {
      let ms;
      try { ms = await fetchMembers(g.id); } catch (e) { continue; }
      for (const m of ms) {
        if (m.uid === currentUser.uid && m.displayName !== clean) {
          try { await updateDoc(doc(db, "groups", g.id, "members", m.id), { displayName: clean }); }
          catch (e) { /* best effort per seat */ }
        }
      }
      try { await fetchMembers(g.id); } catch (e) { /* refresh cache */ }
    }

    emit("cloud:auth", { user: currentUser });
    emit("cloud:groups", { groups: groupList(), activeGroupId });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: humanError(e) };
  }
}

async function renameGroup(gid, name) {
  const clean = String(name || "").trim().slice(0, 60);
  if (!clean) return { ok: false, message: "A group needs a name." };
  await updateDoc(doc(db, "groups", gid), { name: clean });
  await loadGroups();
  emit("cloud:groups", { groups: groupList(), activeGroupId });
  return { ok: true };
}

/**
 * Leave a group: drop yourself from its member list and from your own profile.
 * The rules permit this because you are still a member at evaluation time.
 * Games already downloaded stay on the device but fall out of scope.
 */
async function leaveGroup(gid) {
  const uid = currentUser.uid;
  const gref = doc(db, "groups", gid);
  const snap = await getDoc(gref);
  if (snap.exists()) {
    const rest = (snap.data().memberUids || []).filter((u) => u !== uid);
    // Never strand a group with no members who can administer it.
    if (!rest.length) return { ok: false, message: "You're the only member — delete the group instead." };
    await updateDoc(gref, { memberUids: rest });
  }
  const pref = doc(db, "profiles", uid);
  const p = await getDoc(pref);
  const ids = ((p.exists() && p.data().groupIds) || []).filter((g) => g !== gid);
  await setDoc(pref, { displayName: myDisplayName(), groupIds: ids }, { merge: true });
  try { localStorage.removeItem(membersKey(gid)); } catch (e) {}
  await loadGroups();
  if (!myGroups.length) await createGroup("My Games");
  await setActiveGroup(myGroups[0].id);
  return { ok: true };
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

// ---------------------------------------------- seats, admin, invitations
/** Attach your account to a guest seat (or release your own). */
async function claimSeat(gid, memberId, claim) {
  await updateDoc(doc(db, "groups", gid, "members", memberId), {
    uid: claim ? currentUser.uid : null,
  });
  await fetchMembers(gid);
  return { ok: true };
}

async function removeMember(gid, memberId) {
  await deleteDoc(doc(db, "groups", gid, "members", memberId));
  await fetchMembers(gid);
  return { ok: true };
}

/** Close or re-open a group to invite links. */
async function setJoinOpen(gid, open) {
  await updateDoc(doc(db, "groups", gid), { joinOpen: !!open });
  await loadGroups();
  emit("cloud:groups", { groups: groupList(), activeGroupId });
  return { ok: true };
}

/**
 * Everyone with an account who shares a group with you — the "people you've
 * played with" list. This is what replaces a friend graph: no requests, no
 * accept/decline state, nothing to keep in sync.
 */
function knownPeople() {
  const seen = new Map();
  for (const g of myGroups) {
    for (const m of readMembers(g.id)) {
      if (m.uid && m.uid !== (currentUser && currentUser.uid) && !seen.has(m.uid)) {
        seen.set(m.uid, { uid: m.uid, displayName: m.displayName });
      }
    }
  }
  return [...seen.values()];
}

/** Drop an invitation in someone's inbox. Carries no access by itself. */
async function invitePerson(targetUid, gid) {
  const g = myGroups.find((x) => x.id === gid);
  await setDoc(doc(db, "profiles", targetUid, "invites", gid), {
    from: currentUser.uid,
    fromName: myDisplayName(),
    groupName: (g && g.name) || "a group",
    at: serverTimestamp(),
  });
  return { ok: true };
}

async function loadInvites() {
  if (!currentUser) return [];
  try {
    const snap = await getDocs(collection(db, "profiles", currentUser.uid, "invites"));
    const list = [];
    snap.forEach((d) => list.push({ groupId: d.id, ...d.data() }));
    return list;
  } catch (e) { return []; }
}

async function dismissInvite(gid) {
  try { await deleteDoc(doc(db, "profiles", currentUser.uid, "invites", gid)); } catch (e) {}
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
            if (!g.createdBy) { g.createdBy = currentUser.uid; dirty = true; } // it's mine — remember, so I can edit its roles
            synced.add(g.id);
            uploaded++;
          }
        }

        for (const [id, d] of remote) {
          synced.add(id);
          if (localIds.has(id)) {
            // Keep an existing local copy in step with two mutable bits: its
            // author (for the edit-roles affordance) and a corrected `result`
            // (the author may fix a mis-recorded role — the event LOG never
            // changes). Everything else is append-only, so we don't touch it.
            const lg = local.find((x) => x.id === id);
            if (lg) {
              if (!lg.createdBy && d.createdBy) { lg.createdBy = d.createdBy; dirty = true; }
              if (d.result && JSON.stringify(lg.result) !== JSON.stringify(d.result)) { lg.result = d.result; dirty = true; }
            }
            continue;
          }
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

      // Apply the user's personal per-game labels/favorites (stored apart from
      // the immutable game docs) onto the local games. Best-effort: metadata
      // must never fail a sync.
      try {
        const meta = await pullGameMeta();
        for (const g of local) {
          if (!g.id) continue;
          const m = meta[g.id];
          if (!m) continue;
          if ((g.label || "") !== (m.label || "")) {
            if (m.label) g.label = m.label; else delete g.label;
            dirty = true;
          }
          if (!!g.favorite !== !!m.favorite) {
            if (m.favorite) g.favorite = true; else delete g.favorite;
            dirty = true;
          }
        }
      } catch (e) { /* metadata is best-effort */ }

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

/**
 * Delete a recorded game's CLOUD copy so it can't re-download on the next sync.
 * Only touches the network when the game is actually known to be in the cloud
 * (its id is in the synced set) — a purely-local game just needs its synced
 * bookkeeping cleared. The security rules allow this only for the game's creator
 * or the group owner; anyone else gets a permission error surfaced to the app.
 * The localStorage copy is removed by the app (Stats.deleteGame) after this
 * resolves ok, so a failed cloud delete leaves the game intact everywhere.
 */
async function deleteGame(id, gid) {
  if (!id) return { ok: false, message: "No game id." };
  const synced = readSynced();
  if (currentUser && gid && synced.has(id)) {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      return { ok: false, message: "You're offline — reconnect to delete this game from your account." };
    try {
      await deleteDoc(doc(db, "groups", gid, "games", id));
    } catch (e) {
      return { ok: false, message: humanError(e) };
    }
  }
  if (synced.delete(id)) writeSynced(synced);
  return { ok: true };
}

// ------------------------------------ personal game metadata (label/favorite)
// A user's label + favorite flag for a game are PERSONAL and MUTABLE, so they
// can't live on the append-only game doc. They're stored per-user under
// profiles/{uid}/gameMeta/{gameId} and mirrored onto the local game record, so
// they follow the user across devices without ever touching shared history.
async function setGameMeta(id, meta) {
  if (!currentUser || !id) return { ok: false };
  const label = String((meta && meta.label) || "").slice(0, 60);
  const favorite = !!(meta && meta.favorite);
  const ref = doc(db, "profiles", currentUser.uid, "gameMeta", id);
  try {
    // Nothing to remember → remove the doc rather than store an empty one.
    if (!label && !favorite) { await deleteDoc(ref); return { ok: true }; }
    await setDoc(ref, clean({ label, favorite }));
    return { ok: true };
  } catch (e) { return { ok: false, message: humanError(e) }; }
}

async function pullGameMeta() {
  const out = {};
  if (!currentUser) return out;
  const snap = await getDocs(collection(db, "profiles", currentUser.uid, "gameMeta"));
  snap.forEach((d) => { const x = d.data(); out[d.id] = { label: x.label || "", favorite: !!x.favorite }; });
  return out;
}

/**
 * Correct the recorded RESULT (roles/winner) of a synced game. The rules allow
 * this only for the game's author, and only the `result` field may change (the
 * event log stays immutable). A purely-local game (not yet uploaded) needs no
 * network — it uploads with the corrected result later.
 */
async function updateGameResult(id, gid, result) {
  if (!id) return { ok: false, message: "No game id." };
  const synced = readSynced();
  if (currentUser && gid && synced.has(id)) {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      return { ok: false, message: "You're offline — reconnect to save this change to your account." };
    try {
      await updateDoc(doc(db, "groups", gid, "games", id), { result: clean(result) });
    } catch (e) {
      return { ok: false, message: humanError(e) };
    }
  }
  return { ok: true };
}

// -------------------------------------- shared "in the night" voices
// A custom voice can be SHARED with the group: its two clips are base64-encoded
// and stored in Firestore (there is no Firebase Storage on this project), under
// groups/{gid}/voices/{id} (metadata) + …/clips/{small|large} (the audio). Each
// clip is one document, so it has the full ~1 MB Firestore budget; the app caps
// clips well under that. The encode/decode helpers live in night.js so they're
// unit-testable; this module just moves bytes.
const B64_MAX = 990000; // base64 chars; keeps a clip doc under Firestore's 1 MiB

async function uploadVoice(voiceId, name, clips) {
  if (!currentUser || !activeGroupId) return { ok: false, message: "Sign in and pick a group to share a voice." };
  const B = typeof window !== "undefined" && window.Night;
  if (!B) return { ok: false, message: "Audio storage isn't available." };
  const gid = activeGroupId;
  const enc = {};
  for (const key of ["small", "large"]) {
    if (!clips[key]) return { ok: false, message: "Both clips are needed to share a voice." };
    const b64 = await B.blobToBase64(clips[key]);
    if (b64.length > B64_MAX) {
      const kb = Math.round((clips[key].size || 0) / 1024);
      return { ok: false, message: `The ${key === "small" ? "5–6" : "7+"}-player clip is too big to sync (~${kb} KB; the limit is about 700 KB). Record a shorter clip, or keep this voice on this device.` };
    }
    enc[key] = clean({ data: b64, mime: clips[key].type || "audio/webm" });
  }
  try {
    const base = ["groups", gid, "voices", voiceId];
    await setDoc(doc(db, ...base), clean({ createdBy: currentUser.uid, name: String(name || "Voice").slice(0, 40), createdAt: serverTimestamp(), schema: 1 }));
    await setDoc(doc(db, ...base, "clips", "small"), enc.small);
    await setDoc(doc(db, ...base, "clips", "large"), enc.large);
    return { ok: true };
  } catch (e) { return { ok: false, message: humanError(e) }; }
}

async function deleteVoice(voiceId) {
  if (!currentUser || !activeGroupId) return { ok: true };
  const gid = activeGroupId;
  const base = ["groups", gid, "voices", voiceId];
  try {
    // clips first — their delete rule reads the parent voice's owner
    try { await deleteDoc(doc(db, ...base, "clips", "small")); } catch (e) {}
    try { await deleteDoc(doc(db, ...base, "clips", "large")); } catch (e) {}
    await deleteDoc(doc(db, ...base));
    return { ok: true };
  } catch (e) { return { ok: false, message: humanError(e) }; }
}

async function listRemoteVoices() {
  if (!currentUser || !activeGroupId) return [];
  const snap = await withRetry(() => getDocs(collection(db, "groups", activeGroupId, "voices")));
  const list = [];
  snap.forEach((d) => { const x = d.data(); list.push({ id: d.id, name: x.name, createdBy: x.createdBy }); });
  return list;
}

async function downloadVoiceClips(voiceId) {
  if (!currentUser || !activeGroupId) return {};
  const out = {};
  for (const key of ["small", "large"]) {
    const s = await getDoc(doc(db, "groups", activeGroupId, "voices", voiceId, "clips", key));
    if (s.exists()) { const d = s.data(); out[key] = { data: d.data, mime: d.mime }; }
  }
  return out;
}

// -------------------------------------- community comments (Rules & Theory)
// A global, wiki-style layer: anyone signed in can attach an attributed note to
// any handbook item (target = `${kind}:${itemId}`) and read everyone else's.
// Comments live in their OWN top-level `comments` collection — completely apart
// from games/voices, so nothing here can ever touch a user's recorded history.
// Filtered by a single equality on `target`, so no composite index is needed;
// sorted client-side by time. The rules cap sizes and pin authorship.
const COMMENT_MAX = 1000;

async function addComment(target, text) {
  if (!currentUser) return { ok: false, message: "Sign in to add a note." };
  const body = String(text || "").trim();
  if (!body) return { ok: false, message: "The note is empty." };
  if (body.length > COMMENT_MAX) return { ok: false, message: `Please keep notes under ${COMMENT_MAX} characters.` };
  try {
    const ref = await addDoc(collection(db, "comments"), clean({
      target: String(target || "").slice(0, 200),
      text: body,
      authorUid: currentUser.uid,
      authorName: myDisplayName(),
      createdAt: serverTimestamp(),
    }));
    return { ok: true, id: ref.id };
  } catch (e) { return { ok: false, message: humanError(e) }; }
}

async function listComments(target) {
  if (!currentUser) return [];
  const q = query(collection(db, "comments"), where("target", "==", String(target || "")));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach((d) => {
    const x = d.data();
    out.push({
      id: d.id, text: x.text, authorName: x.authorName || "Someone",
      authorUid: x.authorUid,
      // serverTimestamp() is null for a beat right after a local write; treat as "now".
      at: x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() : Date.now(),
      mine: x.authorUid === currentUser.uid,
    });
  });
  out.sort((a, b) => a.at - b.at);
  return out;
}

async function deleteComment(id) {
  if (!currentUser || !id) return { ok: false, message: "Nothing to delete." };
  try { await deleteDoc(doc(db, "comments", id)); return { ok: true }; }
  catch (e) { return { ok: false, message: humanError(e) }; }
}

// ------------------------------------------------- admin: editable site content
// One privileged account may curate shared content (the Game Theory handbook).
// The REAL enforcement is firestore.rules (write allowed only for the admin's
// signed token); this client check just decides whether to show the UI.
const ADMIN_EMAIL = "timhadfield7@gmail.com";
function isAdmin() {
  return !!(currentUser && currentUser.email && currentUser.email.toLowerCase() === ADMIN_EMAIL);
}
// Read a shared content doc (e.g. "gameTheory", "rules"). Public (works signed-out),
// so every visitor sees the admin's edits; returns null when it hasn't been edited
// yet (use the bundled fallback) or on any error (offline).
async function getContent(name) {
  try {
    const snap = await getDoc(doc(db, "content", String(name)));
    if (snap.exists()) {
      const d = snap.data();
      if (Array.isArray(d.strategy)) return { strategy: d.strategy };
    }
  } catch (e) { /* offline / not readable → fall back to bundled content */ }
  return null;
}
// Persist a whole content doc. Admin only; the rules reject anyone else even if they
// bypass the UI. setDoc (not merge) so removed sections truly go away.
async function saveContent(name, strategy) {
  if (!isAdmin()) return { ok: false, message: "Only the site admin can edit this." };
  if (!Array.isArray(strategy)) return { ok: false, message: "That content is not valid." };
  try {
    await setDoc(doc(db, "content", String(name)), {
      strategy, updatedAt: serverTimestamp(), updatedBy: currentUser.uid,
    });
    return { ok: true };
  } catch (e) { return { ok: false, message: humanError(e) }; }
}
// Back-compat aliases (the Game Theory handbook used these before Rules joined).
const getGameTheory = () => getContent("gameTheory");
const saveGameTheory = (strategy) => saveContent("gameTheory", strategy);

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
  get isAdmin() { return isAdmin(); },
  getContent,
  saveContent,
  getGameTheory,
  saveGameTheory,
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
  async deleteGame(id, gid) {
    try { return await deleteGame(id, gid); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async setGameMeta(id, meta) {
    try { return await setGameMeta(id, meta); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async updateGameResult(id, gid, result) {
    try { return await updateGameResult(id, gid, result); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  // ---- shared night voices ----
  uploadVoice,
  async deleteVoice(voiceId) {
    try { return await deleteVoice(voiceId); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async listRemoteVoices() {
    try { return await listRemoteVoices(); }
    catch (e) { return []; }
  },
  async downloadVoiceClips(voiceId) {
    try { return await downloadVoiceClips(voiceId); }
    catch (e) { return {}; }
  },
  uploadAllowed,
  setUploadAllowed,
  async setDisplayName(name) {
    try { return await setDisplayName(name); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },

  // ---- community comments (Rules & Game Theory handbook) ----
  async addComment(target, text) {
    try { return await addComment(target, text); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async listComments(target) {
    try { return await listComments(target); }
    catch (e) { return []; }
  },
  async deleteComment(id) {
    try { return await deleteComment(id); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },

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
  async renameGroup(name, gid) {
    try { return await renameGroup(gid || activeGroupId, name); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async leaveGroup(gid) {
    try { const r = await leaveGroup(gid || activeGroupId); if (r.ok) await sync(); return r; }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  knownPeople,
  loadInvites,
  async claimSeat(memberId, claim, gid) {
    try { return await claimSeat(gid || activeGroupId, memberId, claim); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async removeMember(memberId, gid) {
    try { return await removeMember(gid || activeGroupId, memberId); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async setJoinOpen(open, gid) {
    try { return await setJoinOpen(gid || activeGroupId, open); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  joinOpen(gid) {
    const g = (myGroups.length ? myGroups : readGroupCache()).find((x) => x.id === (gid || activeGroupId));
    return !g || g.joinOpen !== false;
  },
  async invitePerson(targetUid, gid) {
    try { return await invitePerson(targetUid, gid || activeGroupId); }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  async acceptInvite(gid) {
    try { const r = await joinGroup(gid); await dismissInvite(gid); if (r.ok) await sync(); return r; }
    catch (e) { return { ok: false, message: humanError(e) }; }
  },
  dismissInvite,
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
