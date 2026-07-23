# Backend Plan — accounts, groups, shared statistics

> Status: **infrastructure is LIVE; phase 1 is the next build.** Phase 0 (export/import) is
> shipped. **Hard constraints:** permanently free, sustainable long-term, no credit card, no
> server to operate. Real-time/online play is explicitly **out of scope**.

## The live project (facts, not plans)

| | |
|---|---|
| **Project ID** | `secret-hitler-companion-th` (the unsuffixed id was already taken globally) |
| **Project number** | `650157163497` |
| **Web app ID** | `1:650157163497:web:eb8c5b5a79b28bf65dc178` |
| **Firestore location** | **`nam5`** (multi-region US — the user is in Utah). ⚠️ **Permanent.** |
| **Plan** | Spark (free). **No billing account attached — keep it that way.** |
| **Signed in as** | `timhadfield7@gmail.com` (CLI token cached in `%APPDATA%/configstore`) |
| **Console** | https://console.firebase.google.com/project/secret-hitler-companion-th/overview |

Committed alongside: `.firebaserc` (default project), `firebase.json`, `firestore.rules`
(deployed), `firestore.indexes.json`, `js/firebase-config.js`.

**Gotcha for next time:** a fresh Google Cloud project has most APIs disabled, and
`firestore:databases:create` fails with a 403 until `firestore.googleapis.com` is enabled. The
Firebase CLI can't enable it (that's a `gcloud` operation, and gcloud needs its own interactive
login), so it takes one click in the console — then a minute or two to propagate before the
create call succeeds.

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

# SETUP — who does what

The Firebase CLI is installed (`firebase-tools`, global npm) and `firestore.rules`,
`firebase.json` and `firestore.indexes.json` are committed and ready to deploy. That reduces
the user's job to **one command plus two console toggles**; I do everything else.

**Never enter a credit card — the Spark plan never requires one.** If any screen asks for
billing or to "upgrade to Blaze", stop; nothing here needs it.

| # | Who | Task |
|---|-----|------|
| A | **User** | Run `firebase login` — interactive browser OAuth, cannot be delegated. |
| B | **Claude** | `projects:create`, `firestore:databases:create`, `apps:create WEB`, `apps:sdkconfig` (fetches the config itself), wire it in, `deploy --only firestore:rules`. |
| C | **User** | Two console toggles that no CLI or API exposes: enable the sign-in providers, add the authorised domain. Claude supplies the exact deep links once the project id exists. |
| D | **Claude** | Build phase 1. |

### Task A — the one command (user)

```bash
npm install -g firebase-tools    # already done on this machine
firebase login
```

A browser opens → choose your Google account → **Allow**. Then say "done".
Verify any time with `firebase login:list`.

> Why this can't be delegated: it is a first-time OAuth consent. A human must click Allow in a
> real browser. Everything after it reuses the cached refresh token, so this is a **one-time**
> cost — not once per task.

### Task C — the two console-only toggles (user)

Both need the project to exist, so they come after task B. Neither is exposed by the CLI:
enabling Google sign-in provisions an OAuth client and needs a support email chosen by a human.

1. **Sign-in providers** — `https://console.firebase.google.com/project/<ID>/authentication/providers`
   - **Get started** → **Email/Password** → enable the *first* toggle only → **Save**
   - **Add new provider** → **Google** → toggle on → pick your email as support email → **Save**
2. **Authorised domain** — `https://console.firebase.google.com/project/<ID>/authentication/settings`
   - **Authorised domains** → **Add domain** → `timothyhadfield.github.io`
     (no `https://`, no trailing slash). Without it, login works locally but fails on the live site.

---

## Fallback: doing it all by hand in the console

Only needed if the CLI route fails. Otherwise ignore this section.

> Firebase's console changes its wording from time to time. If a button isn't named exactly as
> written below, look for the closest match — and if something looks genuinely different, say
> what you see rather than guessing.

---

### STEP 1 — Create the project

**Go to:** https://console.firebase.google.com/

1. Sign in with your Google account.
2. Click **Create a project** (or **Add project** if you already have others).
3. **Project name:** type `secret-hitler-companion`
   - Below the box it shows a **Project ID** like `secret-hitler-companion-a1b2c`.
     **Write that ID down** — it goes in the URLs in later steps.
   - Tick the terms checkbox if it appears. Click **Continue**.
4. **Google Analytics:** switch the toggle **OFF**. (Not needed, and it adds a consent surface.)
   Click **Create project**.
5. Wait ~30 seconds → click **Continue**.

✅ *Done when: you land on the project's dashboard page.*

---

### STEP 2 — Turn on login

**Go to:** `https://console.firebase.google.com/project/YOUR-PROJECT-ID/authentication/providers`
*(replace `YOUR-PROJECT-ID`; or click **Build → Authentication** in the left sidebar)*

1. Click **Get started**.
2. You are on the **Sign-in method** tab. In the providers list, click **Email/Password**.
   - Turn on the **first** toggle (**Enable**).
   - Leave "Email link (passwordless sign-in)" **off**.
   - Click **Save**.
3. Click **Add new provider** → click **Google**.
   - Turn the toggle **on**.
   - **Project support email:** choose your own email from the dropdown.
   - Click **Save**.

✅ *Done when: the list shows **Email/Password** and **Google**, both "Enabled".*

---

### STEP 3 — Create the database

**Go to:** `https://console.firebase.google.com/project/YOUR-PROJECT-ID/firestore`
*(or **Build → Firestore Database** in the left sidebar)*

1. Click **Create database**.
2. **Location** — pick the one closest to you (e.g. `eur3 (europe-west)` for the UK/Europe,
   `nam5 (us-central)` for the US).
   ⚠️ **This is permanent and can never be changed.**
3. **Security rules / mode** — choose **Start in production mode** (locked down).
   *Don't worry that it blocks everything — I supply the real rules; they're in this file.*
4. Click **Create** / **Enable**.

> The two screens sometimes appear in the opposite order. Either way: **production mode**,
> **nearest location**.

✅ *Done when: you see an empty "Data" tab with a Start collection button. Do NOT create any
collections — I do that from code.*

---

### STEP 4 — Let the live site sign people in

**Go to:** `https://console.firebase.google.com/project/YOUR-PROJECT-ID/authentication/settings`
*(or **Authentication → Settings** tab)*

1. Find **Authorised domains** (may be spelled "Authorized domains").
2. Click **Add domain**.
3. Type exactly: `timothyhadfield.github.io`
   - No `https://`, no trailing slash, no `/secret-hitler-companion`.
4. Click **Add**.

✅ *Done when: the list contains `localhost` and `timothyhadfield.github.io`.*
*(Without this, login works in my tests but fails on the real site.)*

---

### STEP 5 — Send me the config

**Go to:** `https://console.firebase.google.com/project/YOUR-PROJECT-ID/settings/general`
*(or click the **⚙️ gear** next to "Project Overview" → **Project settings**)*

1. Scroll to **Your apps** at the bottom.
2. Click the **`</>`** icon (Web). *Not iOS, not Android.*
3. **App nickname:** `web`
4. **Leave "Also set up Firebase Hosting" UNTICKED** — the site stays on GitHub Pages.
5. Click **Register app**.
6. A code block appears containing:

   ```js
   const firebaseConfig = {
     apiKey: "…",
     authDomain: "…",
     projectId: "…",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "…"
   };
   ```

7. **Copy that whole block and paste it to me.**

> Lost it? It's always at **Project settings → General → Your apps → SDK setup and
> configuration → Config**.

✅ *Done when: you've pasted the block to me. Nothing further is needed from you.*

**On safety:** those config values are *designed* to be public and are safe in a public repo —
they identify the project, they don't grant access. The security rules above are what actually
protect the data, and I write and test those. The one thing you should never paste anywhere is
a **service account key** (a JSON file with a `private_key` field) — this setup never needs one,
so if something asks you for one, stop and tell me.

Once you send the config block, phase 1 needs nothing further from you.
