# DATA SAFETY — read before touching anything that talks to Firebase

> **The prime directive: a user's recorded games must never be lost or harmed —
> not by a bug, not by a test, not while the site is being updated.** If a change
> could conceivably destroy stored game data, it does not ship. When in doubt,
> back up first and prefer the option that cannot lose data.

The live Firebase project holds the user's **real** recorded games, groups, and
shared night voices. This file is the standing rule for keeping them safe.

## The one real way data can be mass-deleted

Security rules protect the app completely, but they govern **client** access
only. They **do not** apply to admin / CLI tooling run by the project owner. So:

- **From the app / any client:** bulk deletion is *structurally impossible*. The
  Firestore client SDK has no "delete a collection" call; every delete is a
  single document, and `firestore.rules` only lets a game/voice be deleted by its
  own author or the group owner (never rewritten). See the DATA-SAFETY INVARIANT
  comment in `firestore.rules`.
- **From the terminal (the only real danger):** `firebase firestore:delete …`
  bypasses the rules and can wipe anything.

## ⛔ Never run these — no exceptions

```
firebase firestore:delete --all-collections …     # wipes EVERYONE's data
firebase firestore:delete <path> --recursive …     # deletes a whole subtree
```

There is **no task on this project that requires either command.** They are not a
cleanup shortcut; they are how history gets destroyed. Do not run them, do not put
them in a script, and do not paste them into docs "for reference".

## ✅ Safe operations (these never touch stored games)

- The normal update loop: **edit files → `git push` → GitHub Pages rebuild.**
  Nothing here reaches Firestore.
- Deploying rules: `firebase deploy --only firestore:rules` — **config only**, no
  data is read or written.
- Everything the deployed app does — record, sync, delete-one-game, share a voice.

## The destructive test is hard-gated

`test/rules.prod.test.js` writes to the **live** project. It now **refuses to run**
unless you deliberately opt in:

```
SH_PROD_RULES_TEST=i-understand  node test/rules.prod.test.js
```

A plain `node test/rules.prod.test.js` prints why it stopped and exits without
connecting to anything. Its cleanup deletes **only the exact `__test_<runId>`
documents it created**, one at a time, through the security rules — there is no
recursive or wholesale delete anywhere in the file, and there must never be one.

Prefer testing rules/cloud changes with a **mock `window.Cloud`** over CDP (an
in-memory "remote", no auth, no live writes) — see PROGRESS.md's operational
brief. Only run the gated prod test when you truly must, and never while you are
unsure whether the live DB holds games you can't afford to lose.

## Before anything risky: back up

- **In the app:** Statistics → **Export data** downloads the whole archive as
  JSON. **Import data** merges it back idempotently (same-id games are skipped),
  so a restore can never create duplicates.
- The app's **"Clear all statistics"** button (the only bulk-delete a user can
  trigger) now **downloads a backup automatically first** and asks twice before
  erasing — and it only ever clears the local device; signed-in games survive in
  the account and sync back.

## The checklist

1. Will this change delete or overwrite stored data? If yes, stop and reconsider.
2. Am I about to run a `firestore:delete`? **Don't.**
3. Running the prod rules test? Only with the explicit opt-in, only when safe.
4. Doing something genuinely unavoidable to live data? Export a backup first, act
   only on the exact ids you created, and confirm nothing else changed.
