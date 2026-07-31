/* ============================================================================
 * online.js — real-time ONLINE PLAY (Phase 1: lobby, secret roles, night).
 *
 * HOST-AUTHORITATIVE, serverless. One player hosts; their browser is the dealer
 * and referee. Public state lives in a table doc every group member can read;
 * each player's SECRETS live in a private doc only they can read (enforced by
 * firestore.rules). The pure rules live in js/engine.js; this module is the
 * Firestore sync + host loop around it.
 *
 * Data model (under the active group, so membership + recording come for free):
 *   groups/{gid}/tables/{tid}                       — public table + board state
 *   groups/{gid}/tables/{tid}/players/{uid}         — lobby seats (each writes own)
 *   groups/{gid}/tables/{tid}/private/{uid}         — that player's secrets (host writes)
 *   groups/{gid}/tables/{tid}/actions/{autoId}      — player action queue (later phases)
 *
 * ES module (loads AFTER cloud.js, reusing the same Firebase app so it shares
 * auth). Talks to app.js only through `window.Online` + `online:*` DOM events.
 * ==========================================================================*/
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection,
  getDocs, onSnapshot, serverTimestamp, query, where,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// Reuse the app cloud.js created (same default app ⇒ same auth session).
const app = getApps().length ? getApp() : initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const E = () => window.Engine;

const MIN_PLAYERS = 5, MAX_PLAYERS = 10;

let me = null;                 // { uid, displayName }
let gid = null;                // active group id (mirrored from Cloud)
let tableId = null;            // the table we're at
let table = null;             // its public doc data
let players = [];              // [{ uid, name }]
let myPrivate = null;          // my secret doc
let subs = [];                 // active onSnapshot unsubscribers

const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
const myName = () =>
  (me && (me.displayName || (me.email || "").split("@")[0])) || "Player";
const isHost = () => !!(table && me && table.hostUid === me.uid);

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pathTable(t) { return doc(db, "groups", gid, "tables", t); }
function colPlayers(t) { return collection(db, "groups", gid, "tables", t, "players"); }
function pathPlayer(t, uid) { return doc(db, "groups", gid, "tables", t, "players", uid); }
function pathPrivate(t, uid) { return doc(db, "groups", gid, "tables", t, "private", uid); }

function stopSubs() { subs.forEach((u) => { try { u(); } catch (e) {} }); subs = []; }

function emitState() {
  emit("online:state", {
    table, players: players.slice(), myPrivate, tableId,
    isHost: isHost(), me,
  });
}

// --------------------------------------------------------------- listeners
function subscribe(t) {
  stopSubs();
  tableId = t;
  subs.push(onSnapshot(pathTable(t), (snap) => {
    table = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    if (!table) { // host deleted / it vanished
      cleanupLocal();
      emit("online:closed", {});
      return;
    }
    runHostLoop();
    emitState();
  }, () => { /* permission/transient — ignore */ }));

  subs.push(onSnapshot(colPlayers(t), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ uid: d.id, ...d.data() }));
    // Keep a stable order: seatOrder if the game has started, else join time.
    players = list;
    emitState();
  }, () => {}));

  subs.push(onSnapshot(pathPrivate(t, me.uid), (snap) => {
    myPrivate = snap.exists() ? snap.data() : null;
    emitState();
  }, () => {}));
}

function cleanupLocal() {
  stopSubs();
  tableId = null; table = null; players = []; myPrivate = null;
}

// ----------------------------------------------------------- lobby actions
async function hostGame() {
  if (!me) return { ok: false, message: "Sign in to host a game." };
  if (!gid) return { ok: false, message: "Join or create a group first — online games belong to a group." };
  const t = newId();
  try {
    await setDoc(pathTable(t), {
      hostUid: me.uid,
      hostName: myName(),
      status: "lobby",
      createdAt: serverTimestamp(),
      seatOrder: [],
      firstPres: 0,
      playerCount: 0,
      names: {},
    });
    await setDoc(pathPlayer(t, me.uid), { name: myName(), joinedAt: serverTimestamp() });
    subscribe(t);
    return { ok: true, id: t };
  } catch (e) { return { ok: false, message: humanError(e) }; }
}

async function listTables() {
  if (!me || !gid) return [];
  try {
    const q = query(collection(db, "groups", gid, "tables"), where("status", "in", ["lobby", "night", "playing"]));
    const snap = await getDocs(q);
    const out = [];
    snap.forEach((d) => { const x = d.data(); out.push({ id: d.id, hostName: x.hostName || "Someone", status: x.status, playerCount: x.playerCount || 0 }); });
    return out;
  } catch (e) { return []; }
}

async function joinTable(t) {
  if (!me || !gid) return { ok: false, message: "Sign in and join a group first." };
  try {
    const snap = await getDoc(pathTable(t));
    if (!snap.exists()) return { ok: false, message: "That game is no longer available." };
    if (snap.data().status !== "lobby") return { ok: false, message: "That game has already started." };
    await setDoc(pathPlayer(t, me.uid), { name: myName(), joinedAt: serverTimestamp() });
    subscribe(t);
    return { ok: true };
  } catch (e) { return { ok: false, message: humanError(e) }; }
}

async function leaveTable() {
  if (!tableId) return { ok: true };
  const t = tableId;
  const wasHost = isHost();
  try {
    // The host leaving the lobby ends the table (they're the dealer). During a
    // game we just drop the player doc; abandonment handling comes in a later phase.
    if (wasHost && table && table.status === "lobby") {
      await abortTable();
    } else {
      try { await deleteDoc(pathPlayer(t, me.uid)); } catch (e) {}
    }
  } catch (e) {}
  cleanupLocal();
  emit("online:left", {});
  return { ok: true };
}

async function abortTable() {
  if (!tableId || !isHost()) return { ok: false };
  const t = tableId;
  try {
    // Best-effort teardown of the docs this table created (host-scoped, per-doc;
    // never a wholesale delete — see DATA_SAFETY.md).
    for (const sub of ["players", "private", "actions"]) {
      try {
        const snap = await getDocs(collection(db, "groups", gid, "tables", t, sub));
        for (const d of snap.docs) { try { await deleteDoc(d.ref); } catch (e) {} }
      } catch (e) {}
    }
    await deleteDoc(pathTable(t));
  } catch (e) {}
  cleanupLocal();
  emit("online:closed", {});
  return { ok: true };
}

// ----------------------------------------------------- host: start the game
// Deals roles + the night reveal. Only the host runs this; the rules also only
// let the host write the table doc and the private docs.
async function startGame() {
  if (!isHost()) return { ok: false, message: "Only the host can start the game." };
  const roster = players.slice();
  if (roster.length < MIN_PLAYERS) return { ok: false, message: `Need at least ${MIN_PLAYERS} players.` };
  if (roster.length > MAX_PLAYERS) return { ok: false, message: `Secret Hitler is ${MIN_PLAYERS}–${MAX_PLAYERS} players.` };

  const uids = roster.map((p) => p.uid);
  const names = {};
  roster.forEach((p) => { names[p.uid] = p.name || "Player"; });

  const g = E().setupGame(uids);   // pure deal (js/engine.js)

  try {
    // Write every player's SECRET first (only they can read it), then flip the
    // table to "night" so clients render the reveal against a ready private doc.
    for (const uid of g.seatOrder) {
      await setDoc(pathPrivate(tableId, uid), {
        role: g.reveals[uid].role,
        seat: g.reveals[uid].seat,
        knownFascists: g.reveals[uid].knownFascists,
        knownHitler: g.reveals[uid].knownHitler || null,
      });
    }
    await updateDoc(pathTable(tableId), {
      status: "night",
      seatOrder: g.seatOrder,
      firstPres: g.firstPres,
      playerCount: g.playerCount,
      names,
    });
    return { ok: true };
  } catch (e) { return { ok: false, message: humanError(e) }; }
}

// Host advances night → play. (Phase 2 builds the election/legislative loop;
// for now this just marks the game live so the table screen can show.)
async function beginPlay() {
  if (!isHost()) return { ok: false, message: "Only the host can start play." };
  try { await updateDoc(pathTable(tableId), { status: "playing" }); return { ok: true }; }
  catch (e) { return { ok: false, message: humanError(e) }; }
}

// The host reacts to state as it changes. Phase 1 has no automatic transitions
// (start/begin are explicit host actions); this is where the action-queue
// processor will live in later phases.
function runHostLoop() {
  if (!isHost() || !table) return;
}

// -------------------------------------------------------------- auth bridge
onAuthStateChanged(auth, (u) => {
  me = u ? { uid: u.uid, email: u.email, displayName: u.displayName } : null;
  if (!me) { cleanupLocal(); emit("online:left", {}); }
  emitState();
});
// The active group is owned by cloud.js; mirror it so a group switch is seen here.
document.addEventListener("cloud:groups", (e) => {
  const next = (e.detail && e.detail.activeGroupId) || (window.Cloud && window.Cloud.groupId) || null;
  if (next !== gid) { gid = next; if (tableId) { /* stay; group of the table is fixed */ } }
});
document.addEventListener("cloud:ready-to-sync", () => {
  gid = (window.Cloud && window.Cloud.groupId) || gid;
});

function humanError(e) {
  const c = (e && e.code) || "";
  if (c.includes("permission-denied")) return "You don't have access to that game.";
  if (c.includes("unavailable") || c.includes("network")) return "Connection problem — check your internet.";
  return (e && e.message) || "Something went wrong.";
}

window.Online = {
  get me() { return me; },
  get groupId() { return gid; },
  get tableId() { return tableId; },
  get table() { return table; },
  get players() { return players.slice(); },
  get myPrivate() { return myPrivate; },
  get isHost() { return isHost(); },
  MIN_PLAYERS, MAX_PLAYERS,

  hostGame,
  listTables,
  async joinTable(t) { try { return await joinTable(t); } catch (e) { return { ok: false, message: humanError(e) }; } },
  async leaveTable() { try { return await leaveTable(); } catch (e) { return { ok: false, message: humanError(e) }; } },
  async startGame() { try { return await startGame(); } catch (e) { return { ok: false, message: humanError(e) }; } },
  async beginPlay() { try { return await beginPlay(); } catch (e) { return { ok: false, message: humanError(e) }; } },
  async abortTable() { try { return await abortTable(); } catch (e) { return { ok: false, message: humanError(e) }; } },
  refresh: emitState,
};

// Pick up the group if cloud.js already resolved it before we loaded.
if (window.Cloud && window.Cloud.groupId) gid = window.Cloud.groupId;
emit("online:loaded", {});
