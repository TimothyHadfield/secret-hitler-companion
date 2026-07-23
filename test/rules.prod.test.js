/* ============================================================================
 * rules.prod.test.js — tests the DEPLOYED firestore.rules against the real
 * project, using the real Firebase SDK and real signed-in users.
 *
 * These rules are the ENTIRE security boundary: there is no server and no Cloud
 * Functions, so anything the rules permit is permitted to any signed-in user on
 * the internet. "It compiled" is not the same as "it is correct".
 *
 * (The Firestore emulator refuses to start on this machine — it exits with
 * code -1 and no output, whether launched by `firebase emulators:exec` or
 * directly from the jar. Testing production is stronger evidence anyway: it
 * exercises exactly what is live.)
 *
 * Everything it creates is namespaced under a __test_<runId> group and torn
 * down at the end. Run from the project root:
 *     node test/rules.prod.test.js
 * ==========================================================================*/

const { initializeApp } = require("firebase/app");
const {
  getAuth, createUserWithEmailAndPassword, signOut, deleteUser,
} = require("firebase/auth");
const {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, addDoc,
} = require("firebase/firestore");

const CONFIG = require("../js/firebase-config.js");

const RUN = Math.random().toString(36).slice(2, 8);
const GID = `__test_${RUN}`;
const log = (s) => console.log(s);

let pass = 0, fail = 0;
function record(ok, label, detail) {
  if (ok) { log("  PASS  " + label); pass++; }
  else { log("  FAIL  " + label + (detail ? "\n          → " + detail : "")); fail++; }
}
const isDenied = (e) =>
  e && (e.code === "permission-denied" || /insufficient permissions|PERMISSION_DENIED/i.test(e.message || ""));

async function allowed(label, fn) {
  try { await fn(); record(true, label); }
  catch (e) { record(false, label, "expected ALLOW, got " + (e.code || e.message)); }
}
async function denied(label, fn) {
  try { await fn(); record(false, label, "expected DENY, but it SUCCEEDED"); }
  catch (e) { record(isDenied(e), label, isDenied(e) ? "" : "expected DENY, got " + (e.code || e.message)); }
}

// one isolated SDK instance per identity
function makeUser(name) {
  const app = initializeApp(CONFIG, `${name}-${RUN}`);
  return { app, auth: getAuth(app), db: getFirestore(app), name };
}

(async () => {
  const bob = makeUser("bob");     // owner + member
  const alice = makeUser("alice"); // signed in, NOT a member
  const created = [];

  for (const u of [bob, alice]) {
    const email = `claude-rulestest-${RUN}-${u.name}@example.com`;
    const cred = await createUserWithEmailAndPassword(u.auth, email, `Tmp-${RUN}-Pass!9`);
    u.uid = cred.user.uid;
    created.push(u);
  }
  log(`\nTest users created (bob=${bob.uid.slice(0, 6)}…, alice=${alice.uid.slice(0, 6)}…)`);

  const GROUP = () => ({
    name: "Rules Test Group",
    ownerUid: bob.uid,
    inviteCode: "ABC123",
    memberUids: [bob.uid],
  });
  const GAME = (by) => ({
    createdBy: by,
    playedAt: "2026-07-23T00:00:00.000Z",
    playerCount: 5,
    seats: ["m1", "m2", "m3", "m4", "m5"],
    events: [{ type: "gov", presidentIdx: 0, chancellorIdx: 1, claimLibs: 2, enacted: "L" }],
    roundMods: { 0: 0 },
    result: { winner: "Liberal", hitlerIdx: 2, fascistIdxs: [3] },
  });
  const resetGroup = () => setDoc(doc(bob.db, `groups/${GID}`), GROUP());

  log("\n1. Group creation must be honest");
  await allowed("owner CAN create their own group", resetGroup);
  await denied("CANNOT create a group owned by someone else", () =>
    setDoc(doc(alice.db, `groups/${GID}_x`), { ...GROUP(), ownerUid: bob.uid, memberUids: [alice.uid] }));
  await denied("CANNOT create a group pre-stuffed with other members", () =>
    setDoc(doc(alice.db, `groups/${GID}_y`), { ...GROUP(), ownerUid: alice.uid, memberUids: [alice.uid, bob.uid] }));

  log("\n2. A member has normal access");
  await allowed("member CAN record a game", () =>
    setDoc(doc(bob.db, `groups/${GID}/games/game1`), GAME(bob.uid)));
  await allowed("member CAN read a game", () => getDoc(doc(bob.db, `groups/${GID}/games/game1`)));
  await allowed("member CAN list games", () => getDocs(collection(bob.db, `groups/${GID}/games`)));
  await allowed("member CAN write the roster", () =>
    setDoc(doc(bob.db, `groups/${GID}/members/m1`), { displayName: "Bob", uid: bob.uid }));
  await denied("member CANNOT record a game as someone else", () =>
    addDoc(collection(bob.db, `groups/${GID}/games`), GAME(alice.uid)));

  log("\n3. Recorded history is append-only");
  await denied("CANNOT edit a recorded game", () =>
    updateDoc(doc(bob.db, `groups/${GID}/games/game1`), { result: { winner: "Fascist" } }));
  await denied("CANNOT delete a recorded game", () =>
    deleteDoc(doc(bob.db, `groups/${GID}/games/game1`)));

  log("\n4. A stranger cannot reach a group's data");
  await denied("non-member CANNOT read a game", () => getDoc(doc(alice.db, `groups/${GID}/games/game1`)));
  await denied("non-member CANNOT list games", () => getDocs(collection(alice.db, `groups/${GID}/games`)));
  await denied("non-member CANNOT write a game", () =>
    setDoc(doc(alice.db, `groups/${GID}/games/evil`), GAME(alice.uid)));
  await denied("non-member CANNOT read the roster", () => getDocs(collection(alice.db, `groups/${GID}/members`)));

  log("\n5. Groups cannot be enumerated (invite links are the only way in)");
  await denied("nobody can LIST groups", () => getDocs(collection(alice.db, "groups")));
  await allowed("but a signed-in user CAN get a group by id (the invite link)", () =>
    getDoc(doc(alice.db, `groups/${GID}`)));

  log("\n6. Invite-join: a stranger may add ONLY themselves, and change nothing else");
  await denied("CANNOT join AND rename the group", () =>
    updateDoc(doc(alice.db, `groups/${GID}`), { memberUids: [bob.uid, alice.uid], name: "Hijacked" }));
  await denied("CANNOT join AND seize ownership", () =>
    updateDoc(doc(alice.db, `groups/${GID}`), { memberUids: [bob.uid, alice.uid], ownerUid: alice.uid }));
  await denied("CANNOT join AND rotate the invite code", () =>
    updateDoc(doc(alice.db, `groups/${GID}`), { memberUids: [bob.uid, alice.uid], inviteCode: "STOLEN" }));
  await denied("CANNOT evict existing members while joining", () =>
    updateDoc(doc(alice.db, `groups/${GID}`), { memberUids: [alice.uid] }));
  await denied("CANNOT add somebody ELSE to the group", () =>
    updateDoc(doc(alice.db, `groups/${GID}`), { memberUids: [bob.uid, "mallory-uid"] }));
  await denied("CANNOT smuggle an extra uid alongside their own", () =>
    updateDoc(doc(alice.db, `groups/${GID}`), { memberUids: [bob.uid, alice.uid, "mallory-uid"] }));
  await denied("CANNOT rename the group without joining", () =>
    updateDoc(doc(alice.db, `groups/${GID}`), { name: "Hijacked" }));
  await denied("CANNOT delete somebody else's group", () => deleteDoc(doc(alice.db, `groups/${GID}`)));
  await allowed("CAN join by appending exactly their own uid", () =>
    updateDoc(doc(alice.db, `groups/${GID}`), { memberUids: [bob.uid, alice.uid] }));

  log("\n7. Joining actually grants access (invite flow works end to end)");
  await allowed("after joining, they CAN read games", () => getDoc(doc(alice.db, `groups/${GID}/games/game1`)));
  await allowed("after joining, they CAN record a game", () =>
    setDoc(doc(alice.db, `groups/${GID}/games/game2`), GAME(alice.uid)));

  log("\n8. Profiles");
  await allowed("CAN write their own profile", () =>
    setDoc(doc(alice.db, `profiles/${alice.uid}`), { displayName: "Alice" }));
  await denied("CANNOT write someone else's profile", () =>
    setDoc(doc(alice.db, `profiles/${bob.uid}`), { displayName: "Not Bob" }));
  await allowed("signed-in user CAN read a profile", () => getDoc(doc(bob.db, `profiles/${alice.uid}`)));
  await denied("CANNOT delete a profile (would orphan history)", () =>
    deleteDoc(doc(alice.db, `profiles/${alice.uid}`)));

  log("\n9. Nothing outside the modelled collections is writable");
  await denied("random top-level collection is denied", () =>
    setDoc(doc(alice.db, `whatever/${RUN}`), { a: 1 }));

  log("\n10. Accounts cannot be enumerated");
  await denied("CANNOT list every profile on the service", () => getDocs(collection(alice.db, "profiles")));
  await allowed("but CAN fetch a specific profile by id", () => getDoc(doc(alice.db, `profiles/${bob.uid}`)));

  log("\n11. The account link on a roster seat is protected");
  await resetGroup();
  await setDoc(doc(bob.db, `groups/${GID}`), { ...GROUP(), memberUids: [bob.uid, alice.uid] });
  await setDoc(doc(bob.db, `groups/${GID}/members/guest1`), { displayName: "Cal", uid: null });
  await setDoc(doc(bob.db, `groups/${GID}/members/bobseat`), { displayName: "Bob", uid: bob.uid });

  await allowed("a guest seat CAN be claimed by the person claiming it", () =>
    updateDoc(doc(alice.db, `groups/${GID}/members/guest1`), { uid: alice.uid }));
  await denied("CANNOT claim a seat already linked to somebody else", () =>
    updateDoc(doc(alice.db, `groups/${GID}/members/bobseat`), { uid: alice.uid }));
  await denied("CANNOT assign a seat to a third party", () =>
    updateDoc(doc(alice.db, `groups/${GID}/members/guest1`), { uid: "mallory-uid" }));
  await denied("CANNOT unlink somebody else's seat", () =>
    updateDoc(doc(alice.db, `groups/${GID}/members/bobseat`), { uid: null }));
  await allowed("CAN rename a seat without touching its link", () =>
    updateDoc(doc(alice.db, `groups/${GID}/members/bobseat`), { displayName: "Bobby" }));

  log("\n12. Invite links are revocable");
  await resetGroup();
  await setDoc(doc(bob.db, `groups/${GID}`), { ...GROUP(), joinOpen: false });
  await denied("CANNOT join once the group is closed", () =>
    updateDoc(doc(alice.db, `groups/${GID}`), { memberUids: [bob.uid, alice.uid] }));
  await denied("CANNOT re-open the group to let yourself in", () =>
    updateDoc(doc(alice.db, `groups/${GID}`), { memberUids: [bob.uid, alice.uid], joinOpen: true }));
  await allowed("the owner CAN re-open it", () =>
    updateDoc(doc(bob.db, `groups/${GID}`), { joinOpen: true }));
  await allowed("and then joining works again", () =>
    updateDoc(doc(alice.db, `groups/${GID}`), { memberUids: [bob.uid, alice.uid] }));

  log("\n13. The invitation inbox");
  await allowed("CAN drop an invite in someone else's inbox", () =>
    setDoc(doc(alice.db, `profiles/${bob.uid}/invites/${GID}`),
      { from: alice.uid, groupName: "Rules Test Group" }));
  await denied("CANNOT forge an invite as somebody else", () =>
    setDoc(doc(alice.db, `profiles/${bob.uid}/invites/${GID}_f`),
      { from: bob.uid, groupName: "Forged" }));
  await allowed("the recipient CAN read their own inbox", () =>
    getDocs(collection(bob.db, `profiles/${bob.uid}/invites`)));
  await denied("CANNOT read someone else's inbox", () =>
    getDocs(collection(alice.db, `profiles/${bob.uid}/invites`)));
  await denied("CANNOT clear someone else's invite", () =>
    deleteDoc(doc(alice.db, `profiles/${bob.uid}/invites/${GID}`)));
  await allowed("the recipient CAN clear their own", () =>
    deleteDoc(doc(bob.db, `profiles/${bob.uid}/invites/${GID}`)));

  // ---- teardown ----
  log("\nCleaning up…");
  for (const u of created) {
    try { await deleteUser(u.auth.currentUser); log(`  deleted test user ${u.name}`); }
    catch (e) { log(`  ! could not delete user ${u.name}: ${e.code || e.message}`); }
    try { await signOut(u.auth); } catch (e) {}
  }
  log(`  NOTE: documents under groups/${GID} are append-only by design.`);
  log(`  Remove them with:  firebase firestore:delete groups/${GID} --recursive --force`);

  log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("harness error:", e);
  process.exit(1);
});
