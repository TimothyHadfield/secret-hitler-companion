/* ============================================================================
 * rules.test.js — automated tests for firestore.rules.
 *
 * These rules are the ENTIRE security boundary: there is no server and no Cloud
 * Functions, so anything the rules permit is permitted to any signed-in user on
 * the internet. "It compiled" is not the same as "it is correct", hence this.
 *
 * Run from the project root:
 *     firebase emulators:exec --only firestore --project demo-shtest \
 *       "node test/rules.test.js"
 * (or: cd test && npm test)
 * ==========================================================================*/

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc,
} = require("firebase/firestore");

let pass = 0, fail = 0;
async function check(label, promise) {
  try {
    await promise;
    console.log("  PASS  " + label);
    pass++;
  } catch (e) {
    console.log("  FAIL  " + label + "\n          → " + (e.message || e).split("\n")[0]);
    fail++;
  }
}

const GROUP = {
  name: "Thursday Night",
  ownerUid: "bob",
  inviteCode: "ABC123",
  memberUids: ["bob"],
};
const GAME = {
  createdBy: "bob",
  playedAt: "2026-07-23T00:00:00.000Z",
  playerCount: 5,
  seats: ["m1", "m2", "m3", "m4", "m5"],
  events: [{ type: "gov", presidentIdx: 0, chancellorIdx: 1, claimLibs: 2, enacted: "L" }],
  roundMods: { 0: 0 },
  result: { winner: "Liberal", hitlerIdx: 2, fascistIdxs: [3] },
};

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-shtest",
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });

  // ---- seed: one group owned by bob, containing one game ----
  async function seed() {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "groups/g1"), GROUP);
      await setDoc(doc(db, "groups/g1/games/game1"), GAME);
      await setDoc(doc(db, "groups/g1/members/m1"), { displayName: "Bob", uid: "bob" });
      await setDoc(doc(db, "profiles/bob"), { displayName: "Bob" });
    });
  }

  const bob = () => testEnv.authenticatedContext("bob").firestore();     // member + owner
  const alice = () => testEnv.authenticatedContext("alice").firestore(); // signed in, NOT a member
  const anon = () => testEnv.unauthenticatedContext().firestore();

  console.log("\n1. A stranger cannot reach a group's games");
  await seed();
  await check("non-member CANNOT read a game", assertFails(getDoc(doc(alice(), "groups/g1/games/game1"))));
  await check("non-member CANNOT list games", assertFails(getDocs(collection(alice(), "groups/g1/games"))));
  await check("non-member CANNOT write a game", assertFails(setDoc(doc(alice(), "groups/g1/games/evil"), { ...GAME, createdBy: "alice" })));
  await check("non-member CANNOT read the members roster", assertFails(getDocs(collection(alice(), "groups/g1/members"))));
  await check("signed-out user CANNOT read the group", assertFails(getDoc(doc(anon(), "groups/g1"))));
  await check("signed-out user CANNOT read a game", assertFails(getDoc(doc(anon(), "groups/g1/games/game1"))));

  console.log("\n2. Groups cannot be enumerated (invite links are the only way in)");
  await check("nobody can LIST groups", assertFails(getDocs(collection(alice(), "groups"))));
  await check("but a signed-in user CAN get a group by id", assertSucceeds(getDoc(doc(alice(), "groups/g1"))));

  console.log("\n3. A member has normal access");
  await check("member CAN read a game", assertSucceeds(getDoc(doc(bob(), "groups/g1/games/game1"))));
  await check("member CAN list games", assertSucceeds(getDocs(collection(bob(), "groups/g1/games"))));
  await check("member CAN record a game as themselves", assertSucceeds(addDoc(collection(bob(), "groups/g1/games"), GAME)));
  await check("member CAN read the roster", assertSucceeds(getDocs(collection(bob(), "groups/g1/members"))));

  console.log("\n4. Recorded history is append-only");
  await check("member CANNOT edit a recorded game", assertFails(updateDoc(doc(bob(), "groups/g1/games/game1"), { result: { winner: "Fascist" } })));
  await check("member CANNOT delete a recorded game", assertFails(deleteDoc(doc(bob(), "groups/g1/games/game1"))));
  await check("member CANNOT record a game as someone else", assertFails(addDoc(collection(bob(), "groups/g1/games"), { ...GAME, createdBy: "alice" })));

  console.log("\n5. Invite-join: a stranger may add ONLY themselves, and change nothing else");
  await seed();
  await check("stranger CAN join by appending their own uid",
    assertSucceeds(updateDoc(doc(alice(), "groups/g1"), { memberUids: ["bob", "alice"] })));

  await seed();
  await check("CANNOT join AND rename the group",
    assertFails(updateDoc(doc(alice(), "groups/g1"), { memberUids: ["bob", "alice"], name: "Hijacked" })));
  await seed();
  await check("CANNOT join AND seize ownership",
    assertFails(updateDoc(doc(alice(), "groups/g1"), { memberUids: ["bob", "alice"], ownerUid: "alice" })));
  await seed();
  await check("CANNOT join AND rotate the invite code",
    assertFails(updateDoc(doc(alice(), "groups/g1"), { memberUids: ["bob", "alice"], inviteCode: "STOLEN" })));
  await seed();
  await check("CANNOT evict existing members while joining",
    assertFails(updateDoc(doc(alice(), "groups/g1"), { memberUids: ["alice"] })));
  await seed();
  await check("CANNOT add somebody ELSE to the group",
    assertFails(updateDoc(doc(alice(), "groups/g1"), { memberUids: ["bob", "mallory"] })));
  await seed();
  await check("CANNOT smuggle an extra uid alongside their own",
    assertFails(updateDoc(doc(alice(), "groups/g1"), { memberUids: ["bob", "alice", "mallory"] })));
  await seed();
  await check("CANNOT rename the group without joining",
    assertFails(updateDoc(doc(alice(), "groups/g1"), { name: "Hijacked" })));
  await seed();
  await check("CANNOT delete somebody else's group",
    assertFails(deleteDoc(doc(alice(), "groups/g1"))));

  console.log("\n6. Joining actually grants access (the invite flow works end to end)");
  await seed();
  await updateDoc(doc(alice(), "groups/g1"), { memberUids: ["bob", "alice"] });
  await check("after joining, they CAN read games", assertSucceeds(getDoc(doc(alice(), "groups/g1/games/game1"))));
  await check("after joining, they CAN record a game", assertSucceeds(addDoc(collection(alice(), "groups/g1/games"), { ...GAME, createdBy: "alice" })));

  console.log("\n7. Group creation must be honest");
  await check("CANNOT create a group owned by someone else",
    assertFails(setDoc(doc(alice(), "groups/g2"), { ...GROUP, ownerUid: "bob", memberUids: ["alice"] })));
  await check("CANNOT create a group pre-stuffed with other members",
    assertFails(setDoc(doc(alice(), "groups/g3"), { ...GROUP, ownerUid: "alice", memberUids: ["alice", "bob"] })));
  await check("CAN create a group owned by themselves",
    assertSucceeds(setDoc(doc(alice(), "groups/g4"), { name: "Alice's game", ownerUid: "alice", inviteCode: "XYZ789", memberUids: ["alice"] })));

  console.log("\n8. Profiles");
  await check("CAN write their own profile", assertSucceeds(setDoc(doc(alice(), "profiles/alice"), { displayName: "Alice" })));
  await check("CANNOT write someone else's profile", assertFails(setDoc(doc(alice(), "profiles/bob"), { displayName: "Not Bob" })));
  await check("CANNOT delete a profile (would orphan history)", assertFails(deleteDoc(doc(bob(), "profiles/bob"))));
  await check("signed-out user CANNOT read profiles", assertFails(getDoc(doc(anon(), "profiles/bob"))));
  await check("signed-in user CAN read profiles", assertSucceeds(getDoc(doc(alice(), "profiles/bob"))));

  console.log("\n9. Nothing outside the modelled collections is writable");
  await check("random top-level collection is denied", assertFails(setDoc(doc(alice(), "whatever/x"), { a: 1 })));

  await testEnv.cleanup();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("harness error:", e);
  process.exit(1);
});
