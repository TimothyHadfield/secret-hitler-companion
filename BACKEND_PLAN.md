# Backend Plan — accounts, groups, shared statistics

> Status: **decided, not started.** Phase 0 (export/import) is shipped; phases 1–3 are the build.
> **Hard constraints:** permanently free, sustainable long-term, no credit card, no server to
> operate. Real-time/online play is explicitly **out of scope**.

## The decision: Firebase (Spark plan)

**Why not Supabase** (the first choice, before the "free forever" constraint was set): its free
tier **pauses a project after roughly a week of inactivity** and needs a manual restore from the
dashboard. For an app used on sporadic game nights that is precisely the wrong failure mode —
you sit down to record a game and the database is asleep. Everything else about it was better;
this one behaviour rules it out.

**Firebase Spark** is free with no card, **does not pause**, and its quotas dwarf this app's
needs (see budget below). Firebase Auth handles login (email/password + Google) as a solved,
audited problem rather than something hand-rolled.

**Also considered:** Cloudflare Workers + D1 — genuinely free and never pauses, but it has no
auth, so sign-in would have to be written from scratch (password hashing, sessions, email
verification, reset flows). That is security-critical code with a bad failure mode, and it is
not worth owning to save nothing.

### The constraint Firebase imposes

**Cloud Functions require the paid Blaze plan, so we use none.** Everything must be achievable
with the client SDK plus Firestore security rules. This is not a limitation in practice, but it
does shape two things:

1. **Joining a group by invite** must be expressible as a rules-checked client write (solved
   below) rather than a server-side function.
2. **Rules are the entire security boundary.** There is no trusted server code. The Firebase
   config keys in the client are *meant* to be public; the rules are what actually protect data.

The site stays a static page on GitHub Pages — the SDK loads as an ES module from a CDN, so the
no-build-step rule survives.

## The modelling decision that actually matters

Today a "player" is a string in an array. The new model needs **two separate concepts**, and
conflating them is the mistake that is expensive to undo later:

| Concept | What it is |
|---|---|
| **user** | a real human with a login (a Firebase Auth uid) |
| **group member (seat)** | someone who plays in a group — *optionally* linked to a user |

Someone's cousin plays one game and never makes an account. Someone else plays as a guest for
six months, then signs up, and their whole history must follow them. Therefore:

- **Games reference member ids, never names.** Renaming a person must not rewrite history.
- **A member carries a nullable `uid`.** Linking a guest to a real account later is one write,
  not a migration.

## Data model

```
profiles/{uid}
    displayName, createdAt

groups/{groupId}
    name, ownerUid, inviteCode, memberUids: [uid, …], createdAt
    └── members/{memberId}      # the SEAT identity
            displayName, uid (nullable = guest), createdAt
    └── games/{gameId}          # gameId is the CLIENT-generated UUID — see Sync
            playedAt, createdBy, playerCount,
            seats:     [memberId, …]   # seat index → person
            events:    [ … ]           # the event log, verbatim
            roundMods: { … }
            result:    { winner, hitlerIdx, fascistIdxs }
```

`memberUids` on the group doc is **deliberately denormalised** — security rules need a
membership check that costs at most one document read, and an array on the parent gives exactly
that.

**Games are stored as one document each, with `events` kept verbatim.** `derive()` already
rebuilds an entire game from its event log, so a game document is the same object
`saveRoles()` writes today. This is why the change is smaller than it looks: `js/stats.js`
keeps aggregating over an array of game records — the array just arrives from Firestore instead
of `localStorage`. **Group statistics therefore come free, with no new statistics code.**

## Security rules

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    function signedIn()  { return request.auth != null; }
    function uid()       { return request.auth.uid; }
    function group(gid)  { return get(/databases/$(db)/documents/groups/$(gid)).data; }
    function isMember(gid) { return signedIn() && uid() in group(gid).memberUids; }

    match /profiles/{u} {
      allow read:        if signedIn();
      allow write:       if uid() == u;
    }

    match /groups/{gid} {
      // 'get' is open to any signed-in user: the random group id in an invite link
      // IS the secret. 'list' is closed, so nobody can enumerate groups.
      allow get:    if signedIn();
      allow list:   if false;
      allow create: if signedIn()
                    && request.resource.data.ownerUid == uid()
                    && request.resource.data.memberUids == [uid()];

      // Joining by invite, without a server: a non-member may add ONLY themselves,
      // and may change nothing else about the group.
      allow update: if signedIn() && (
                      isMember(gid)
                      || (request.resource.data.memberUids == resource.data.memberUids.concat([uid()])
                          && request.resource.data.name       == resource.data.name
                          && request.resource.data.ownerUid   == resource.data.ownerUid
                          && request.resource.data.inviteCode == resource.data.inviteCode)
                    );
      allow delete: if signedIn() && resource.data.ownerUid == uid();

      match /members/{mid} {
        allow read, create, update: if isMember(gid);
        allow delete:               if isMember(gid);
      }

      match /games/{gameId} {
        allow read:   if isMember(gid);
        allow create: if isMember(gid) && request.resource.data.createdBy == uid();
        // games are append-only: recorded history is never rewritten
        allow update, delete: if false;
      }
    }
  }
}
```

Two things worth keeping in mind when editing these:

- **`get()` inside a rule costs a document read.** Membership checks are therefore one read per
  query, not per document returned — which is why `memberUids` lives on the parent.
- **`allow get` vs `allow list`.** Opening `get` lets an invite link work without a server;
  keeping `list` closed means group ids can't be enumerated. Don't loosen `list`.

## Sync strategy: local-first

This app is used at a table, on someone's phone, on a hotspot in a basement. **The network is
never on the critical path of recording a game.**

- `localStorage` stays the write path exactly as it works today. The app keeps working with no
  account and no connection — that behaviour is permanent, not transitional.
- Games sync in the background and on reconnect.
- **Every game already carries a client-generated UUID** (shipped in phase 0 — `Stats.uuid()`,
  backfilled onto legacy records). It is the Firestore document id, which makes writes
  **idempotent**: an interrupted sync can be retried and the same game can never be inserted
  twice.
- Games are append-only and never edited after recording, so there is no merge conflict to
  resolve — a write is either present or it isn't.

## Free-tier budget (why this is sustainable)

Spark plan gives, per day: **50,000 document reads, 20,000 writes, 1 GiB stored.**

| Usage | Cost against quota |
|---|---|
| Recording a game | ~1 write |
| Opening group stats (200 games cached client-side) | ~200 reads, once |
| A game document | ~5 KB → 1 GiB ≈ **200,000 games** |

A group playing weekly for a decade uses a rounding error of the daily quota. The realistic
failure mode is not cost, it's a bug looping a query — so stats reads are cached client-side
rather than re-fetched on every render.

## Phases

| # | Phase | Contents |
|---|---|---|
| 0 | **Export / import** ✅ shipped | JSON backup + merge-by-id; also the account-seeding payload. |
| 1 | **Auth + personal cloud sync** | Login, `profiles`, sync own games. No groups yet. Proves the pipe: rules, sync, offline. |
| 2 | **Groups** | `groups` + `members` + invite links; group stats reuse `renderStatsInto()` over a different game list. |
| 3 | **Link seats to accounts** | Attach a `uid` to an existing member; "my stats across all groups". Friends, if still wanted, are a two-person group. |

**On first login, offer to upload the local archive** — that is exactly what phase 0's export
payload is, which is why it was built first.

## Not doing

- **Online/real-time play.** Descoped by the user.
- **Cloud Functions.** They require the paid plan; everything is client SDK + rules.
- **A friend graph, initially.** Requests, pending/accepted states and blocking are real work,
  and groups do the actual job. Ship invite links first.

---

# EXACT SETUP INSTRUCTIONS (the only part that needs you)

Everything else I do. This takes about five minutes and needs a Google account. **Do not enter
a credit card at any point — you never need one for the Spark plan.**

### 1. Create the project
1. Go to **https://console.firebase.google.com** and sign in.
2. Click **Create a project**.
3. Name it `secret-hitler-companion`. Click **Continue**.
4. **Turn Google Analytics OFF** (we don't use it and it adds another consent surface).
   Click **Create project**, then **Continue** when it finishes.

### 2. Turn on login
1. Left sidebar → **Build** → **Authentication** → **Get started**.
2. On the **Sign-in method** tab, click **Email/Password** → toggle **Enable** → **Save**.
3. Click **Add new provider** → **Google** → toggle **Enable**, pick your email as the
   "project support email" → **Save**.

### 3. Create the database
1. Left sidebar → **Build** → **Firestore Database** → **Create database**.
2. Choose **Start in production mode** (locked down — I'll supply the rules). **Next**.
3. Pick the location closest to you (e.g. `eur3` or `nam5`). **Enable**.
   ⚠️ **The location is permanent** and cannot be changed later.

### 4. Authorise the live site for login
1. **Authentication** → **Settings** tab → **Authorised domains** → **Add domain**.
2. Add: `timothyhadfield.github.io`
   (`localhost` is already there, which is what I test against.)

### 5. Send me the config
1. Click the **⚙️ gear** (top left) → **Project settings**.
2. Scroll to **Your apps** → click the **`</>`** (Web) icon.
3. App nickname: `web`. **Do NOT tick "Firebase Hosting"** — the site stays on GitHub Pages.
   Click **Register app**.
4. It shows a `const firebaseConfig = { … }` block. **Copy that whole block and paste it to
   me.**

**On safety:** those config values are *designed* to be public and are safe in a public repo —
they identify the project, they don't grant access. The security rules above are what actually
protect the data, and I write and test those. The one thing you should never paste anywhere is
a **service account key** (a JSON file with a `private_key` field) — this setup never needs one,
so if something asks you for one, stop and tell me.

Once you send the config block, phase 1 needs nothing further from you.
