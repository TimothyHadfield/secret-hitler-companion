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
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc,
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

// Host-only: the full authoritative game state + the action-processing pump.
let hostState = null;          // parsed full secret state (host device only)
let processing = false;        // reentrancy guard for the action loop
let rerun = false;             // an action snapshot arrived mid-process
let recorded = false;          // the finished game has been saved once

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
function colActions(t) { return collection(db, "groups", gid, "tables", t, "actions"); }
function pathHostState(t) { return doc(db, "groups", gid, "tables", t, "host", "state"); }

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

// The host watches the action queue and processes moves. Attached lazily once we
// know we're the host (only the host may read the queue), detached otherwise.
let actionsUnsub = null;
function ensureHostLoop() {
  if (isHost() && !actionsUnsub && tableId) {
    actionsUnsub = onSnapshot(colActions(tableId), (snap) => { processActions(snap); }, () => {});
  } else if (!isHost() && actionsUnsub) {
    try { actionsUnsub(); } catch (e) {}
    actionsUnsub = null;
  }
}

function cleanupLocal() {
  stopSubs();
  if (actionsUnsub) { try { actionsUnsub(); } catch (e) {} actionsUnsub = null; }
  tableId = null; table = null; players = []; myPrivate = null;
  hostState = null; processing = false; rerun = false; recorded = false;
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
// Builds the full authoritative state (js/engine.js), writes every player's
// SECRET private doc + the public table doc + the host-only secret state, and
// flips the table to "night". Only the host runs this (rules enforce it).
async function startGame() {
  if (!isHost()) return { ok: false, message: "Only the host can start the game." };
  const roster = players.slice();
  if (roster.length < MIN_PLAYERS) return { ok: false, message: `Need at least ${MIN_PLAYERS} players.` };
  if (roster.length > MAX_PLAYERS) return { ok: false, message: `Secret Hitler is ${MIN_PLAYERS}–${MAX_PLAYERS} players.` };
  try {
    hostState = E().initGame(roster.map((p) => ({ uid: p.uid, name: p.name || "Player" })), Math.random);
    recorded = false;
    await pushState();
    await updateDoc(pathTable(tableId), { status: "night", playerCount: hostState.n, names: hostState.names });
    return { ok: true };
  } catch (e) { return { ok: false, message: humanError(e) }; }
}

// Host advances the night reveal → live play. The engine is already at the first
// nomination; this only flips the table status so clients switch views.
async function beginPlay() {
  if (!isHost()) return { ok: false, message: "Only the host can start play." };
  try { await updateDoc(pathTable(tableId), { status: "playing" }); return { ok: true }; }
  catch (e) { return { ok: false, message: humanError(e) }; }
}

// --------------------------------------------------- host: the action pump
// Write the current authoritative state out: the host-only secret copy (so a
// host reload can resume), the PUBLIC projection (table doc), and each player's
// PRIVATE doc. Firestore forbids nested arrays, so the secret blob is a JSON
// string; the public/private views are plain maps the rules already allow.
async function pushState() {
  if (!hostState) return;
  await setDoc(pathHostState(tableId), { s: JSON.stringify(hostState), updatedAt: serverTimestamp() });
  const pub = E().publicView(hostState);
  await updateDoc(pathTable(tableId), pub);
  for (const uid of hostState.seatOrder) {
    await setDoc(pathPrivate(tableId, uid), E().privateView(hostState, uid));
  }
  if (hostState.phase === "gameover" && !recorded) { recorded = true; await finishGame(); }
}

async function loadHostState() {
  try {
    const snap = await getDoc(pathHostState(tableId));
    if (snap.exists() && snap.data().s) hostState = JSON.parse(snap.data().s);
  } catch (e) { /* not host / not ready */ }
}

// Drain the action queue: apply each move to the authoritative state (invalid
// ones are dropped), delete it, then publish the new state once. Serialized via
// `processing`; a snapshot that lands mid-run re-runs afterwards.
async function processActions(snap) {
  if (!isHost()) return;
  if (processing) { rerun = true; return; }
  processing = true;
  try {
    if (!hostState) await loadHostState();
    if (!hostState) return;
    const docs = snap.docs.slice().sort((a, b) => {
      const ta = a.data().at && a.data().at.toMillis ? a.data().at.toMillis() : 0;
      const tb = b.data().at && b.data().at.toMillis ? b.data().at.toMillis() : 0;
      return ta - tb;
    });
    let changed = false;
    for (const d of docs) {
      const act = d.data();
      const res = E().applyAction(hostState, act, Math.random);
      if (res.ok) { hostState = res.state; changed = true; }
      try { await deleteDoc(d.ref); } catch (e) {}
      if (hostState.phase === "gameover") break;
    }
    if (changed) await pushState();
  } catch (e) { /* transient; the next snapshot retries */ }
  finally {
    processing = false;
    if (rerun) { rerun = false; try { const s = await getDocs(colActions(tableId)); await processActions(s); } catch (e) {} }
  }
}

// A player (including the host) submits a move; the host applies it. `by` is
// pinned to the sender so the rules can verify authorship.
async function submitAction(action) {
  if (!me || !tableId) return { ok: false, message: "Not at a table." };
  try {
    await addDoc(colActions(tableId), Object.assign({}, action, { by: me.uid, at: serverTimestamp() }));
    return { ok: true };
  } catch (e) { return { ok: false, message: humanError(e) }; }
}

// The game finished — record it to the group as an ordinary reviewable game
// (true roles included), exactly once, by the host. app.js saves + uploads it.
async function finishGame() {
  try { await updateDoc(pathTable(tableId), { status: "finished" }); } catch (e) {}
  const rec = E().toRecordedGame(hostState);
  rec.id = newId();
  emit("online:finished", { record: rec, isHost: isHost() });
}

// Called from the table snapshot: keep the host loop attached and, on a host
// reload mid-game, reload the authoritative state and resume.
function runHostLoop() {
  ensureHostLoop();
  if (isHost() && table && (table.status === "playing" || table.status === "night") && !hostState) {
    loadHostState().then(() => { if (hostState) processCatchUp(); });
  }
}
async function processCatchUp() {
  try { const s = await getDocs(colActions(tableId)); await processActions(s); } catch (e) {}
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
  async submitAction(a) { try { return await submitAction(a); } catch (e) { return { ok: false, message: humanError(e) }; } },
  refresh: emitState,
};

// Pick up the group if cloud.js already resolved it before we loaded.
if (window.Cloud && window.Cloud.groupId) gid = window.Cloud.groupId;
emit("online:loaded", {});
