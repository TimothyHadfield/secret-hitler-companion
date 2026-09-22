# CHAT LOG — Secret Hitler Companion

_Older entries (Sessions 1–27, 2026-07-21 → 2026-07-27) moved unchanged to `docs/archive/chat-archive.md` on 2026-09-21. Cap 60 KB; current state is in `PROGRESS.md`._

A running, human-readable log of what the user asked for and what I changed, session by
session. Newest at the bottom. Kept short on purpose — for reflecting on how the project
and our collaboration evolved.

---

## Session 28 — fix: policy peek wasn't scored until the next hand was drawn

**User bug report:** set up a round with only 2 liberals in the pool (known, post-reshuffle), then
the peeking president claimed the top 3 were all liberal — a provable lie — but their fascist odds
didn't move at all, and "the recording of the power decision got removed."

**Root cause.** The peek was only scored by tying it to the NEXT government's hand (the cards it
describes). Until that government was played — the live case, and the reshuffled case — the peek was
"unverified" and contributed nothing. So a peek claiming more liberals than the pool can hold, a
certain lie by conservation, moved nothing. (The "removed" was the same thing surfacing as the
board's "(reshuffled)" strike-through on an unscored peek.)

**Fix.** A peek that no government has drawn is now added to its round as a **phantom hand** — a
vetoed pseudo-government reported by the peeker that consumes 3 real cards — so the round
conservation law prices it right away. `analyzeRoles` classifies each peek: a next government in the
same round ⇒ attach as a second report of that hand (unchanged); otherwise ⇒ phantom. The History
lie chip matches: checked against the drawn hand when available, else against the round pool by
conservation (so an impossible claim reads ~100% immediately). Phantom "governments" are excluded
from the nomination signal.

**Verified:** engine — an impossible phantom peek (claim 3L from a 2-liberal pool) lifts the peeker
0.34 → **0.84**; a plausible one moves far less; the from-scratch brute-force mirror + all invariants
still hold (**66 assertions**, up from 64). App — after recording the peek, the History row now shows
a real lie estimate ("64% likely a lie") immediately instead of "unverified", with the 👁 recording
intact.

## Session 29 — chronological game replay in the review (with live role odds)

**User ask:** step through a saved game in the Stats section with back/forth arrows to "follow what
happened throughout the game" — showing the President + Chancellor + what they enacted + any power
plays, and watching **P(liberal)/P(fascist)** for each player evolve as the game goes on.

**Design — reuse the derive-from-events architecture.** The whole board is a pure function of
`state.events`, so a replay is just "truncate the event log to step *k* and re-render." No new engine
code: `reviewGoto(k)` sets `state.events = _reviewEvents.slice(0, k)` and calls the normal
`renderGame()`, so the table, policy tracks, piles, History and the role posterior all recompute for
that moment. The saved game is never touched (review never persists).

**What's new:**
- `openReview()` seeds `_reviewEvents`, `reviewStep` (opens at the end = the existing reveal), and a
  `playback` flag (true whenever short of the end). `rolesOn()` now also fires during a playback, so
  the role model runs regardless of the two settings switches — the user explicitly asked to watch it.
- **Stepper** in the review panel: `⏮ ◀ k / N ▶ ⏭` + **← / → arrow keys** (a first for the app — it
  had no key handlers). A one-line **caption** per step (round, `Pres P → Chan C`, ratio claimed,
  policy enacted, and any power via the existing `powerAnnotation`; fail/chaos/Hitler variants).
- **`renderTable` playback mode:** while short of the end it **hides the true roles** (the reveal is
  the final step) and instead badges the P/C of the step just revealed and shows every seat's live
  fascist-% chip. The final step is the unchanged reveal (role colours + who won + stored odds ✓/✗).
- **`livePlayerOdds()`** — the panel's per-player read at the current step: `NN%F` + its complement
  `NN%L`, sorted most-suspect first, with a `♛` Hitler-suspicion flag. Reuses the `.ro-*` styling.

**Verified** with the headless-Chrome recipe (seed a completed 7-player Fascist-win game into
localStorage, drive the *real* Stats → review UI): all 13 assertions pass — captions carry the right
actors/policy/powers (🔍 invest, ⚡→ special, 💀 kill), P/C badges track the revealed step, the odds
list moves from ~base-rate at step 1 to a sharp read by step 7 and re-sorts, round advances across the
reshuffle, back-stepping + arrow keys work, and the final step still reveals roles. Desktop + phone
screenshots confirm the stepper fits the right control column and the below-table strip respectively.
Files touched: `js/app.js`, `styles.css` only (no engine/test changes; the site stays dependency-free).

## Session 30 — main-menu hub + back-anywhere navigation

**User ask:** after finishing a game it dumped them back on the players list. Redesign the flow so
movement through the app is clearer. Specifically: a **main menu** with the title big up top, settings
in one corner and profile in the other, a **group box** (tap to switch), and **option boxes** —
initially **Statistics** and **Start game** (→ players). Every page you click into should have a
**top-left back arrow** to the previous page, like everywhere else. **Hard constraint (mid-turn):
don't delete any recorded game history from any account while doing this.**

**What shipped:**
- **New `#menuScreen` home hub** (replaces the global `#topbar`): big **Secret Hitler** title +
  `companion` tagline; **profile/sign-in** chip top-left, **⚙ settings** top-right (both reuse the old
  `#btnAccount` / `#btnSettings` ids); a **group box** ("This device" or the group name → opens the
  group switcher); and two **option cards**, Start game (red) and Statistics.
- **Nav stack for back-anywhere.** `navTo(id)` pushes the current top-level screen; `navBack()` pops
  (default → menu). The **Players** screen gained a `screen-head` back arrow; **Statistics**' existing
  back arrow now routes through the stack. Game screen keeps its own undo/Quit/New exits.
- **Cleaner flow.** Finish (save roles) → **`goHome()` = main menu** (the actual fix). **Quit → menu.**
  **New game → players** (quick replay). **Closing a review → the Statistics page** it came from.
- **History-safe.** `goHome()` / `resetToSetup()` only `clearActive()` (the in-progress autosave) —
  the same call the old `resetToSetup` already made. No recorded-game store or cloud data is touched.
- **Menu ⇄ group label sync:** folded a `menuGroupName` refresh into `renderAcctChip()` so switching /
  renaming / leaving a group behind the account modal updates the box underneath.

**Verified** with the headless-Chrome recipe, driving the *real* UI end-to-end — **25/25 assertions**:
boots on the menu; Statistics and Start-game round-trips return to the menu via the back arrows; open
a review then close it back to Stats; and a **full game played from the menu** (add 5 players →
randomize → enact 5 Liberal policies → record roles) **lands on the main menu**, with the games store
going **1 → 2** (the finished game appended, the pre-seeded game **preserved** — the no-deletion
guarantee, checked in code). Desktop screenshot confirms the layout; a DOM measurement at the headless
512-px viewport confirms no horizontal overflow and both corner buttons in-bounds (the phone
screenshot's cropped gear was just the image crop, not a layout bug). Files: `index.html`, `js/app.js`,
`styles.css`.

## Session 31 — delete a recorded game

**User ask:** allow deleting recorded games. **Hard constraint (repeated):** don't delete any current
game history from any account while building this.

**Design.** A **Delete game** button (outlined danger) sits at the bottom of the review panel, so you
open a game and remove it from there, with a confirm. The subtle part is a synced game: deleting only
locally would just re-download on the next sync. So `deleteReviewedGame()` removes the **cloud copy
first, then the local copy** — and if the cloud delete fails (offline, or not permitted) it **aborts**,
leaving the game intact everywhere rather than half-deleted.
- **`Stats.deleteGame(id)`** splices the game out of the FULL array (never a scoped view — a filtered
  write would drop other groups' games) and writes the rest back.
- **`Cloud.deleteGame(id, gid)`** `deleteDoc`s `groups/{gid}/games/{id}` **only when the id is in the
  synced set** (a purely-local game just clears its synced bookkeeping; offline returns an error and
  aborts). Then it drops the id from the synced set.
- **Rules change (deployed):** games were `update, delete: if false` (append-only). Now **`update`
  stays false** (history is never rewritten) but **`delete`** is allowed for the game's **author
  (`createdBy`) or the group owner** — a member can delete their own mis-record, an owner can moderate,
  and nobody can wipe another member's games. Deployed with `firebase deploy --only firestore:rules`
  (compiles + releases rules only — **touches no data**).

**On the constraint / testing.** `test/rules.prod.test.js` was updated to match the new rule (§3 is now
edit-only; new **§7b**: author ✓, owner ✓, other member ✗, non-member ✗) but **deliberately NOT run** —
its teardown does `firestore:delete --all-collections`, which would wipe the user's real games. Instead
the whole feature was verified **offline** with the headless-Chrome recipe (cloud module dropped from
the test build, so deletion takes the local path): **14/14 assertions** — two seeded games; open a
review; **Cancel** keeps the game (count stays 2, still in the review); **Delete → confirm** drops it
(count 2→1, back on Stats, the *other* game survives by id); delete the last one → the empty-state
renders; back arrow still returns to the menu. The confirm copy switches to "removes it for everyone in
the group" when signed in with a synced game. Screenshot confirms the button placement. Files:
`js/stats.js`, `js/cloud.js`, `js/app.js`, `styles.css`, `firestore.rules`, `test/rules.prod.test.js`.

## Session 32 — lock the review playback box so it doesn't jump while scrubbing

**User report:** clicking the review's back/forward arrows fast is annoying because going back far
enough removes the Round 2/3 boxes, which (on desktop) shrinks the rounds strip and slides the
`◀ ▶` box up under the cursor. Wants the box **locked in place** — the round boxes may still
disappear, but the arrow box must not move — and the **varying-length step caption** must not cause
the same jump.

**Cause.** Desktop puts the rounds strip in the right control column *above* the playback panel; its
height is content-driven (`max-height:116px`, scrolls). Fewer rounds ⇒ shorter strip ⇒ everything
below shifts up. (Phones are unaffected — the strip is a horizontal row there, constant height.)

**Fix — `lockReviewRoundsBar()`** (in `app.js`, called from `placeRoundsBar`): during a review it pins
the strip to the **full game's height**, measured once at the full step (`bar.clientHeight`, which
already honours the CSS cap) and stored on `state._roundsReserve`, then re-applied as a `min-height`
on every step. Blocks still disappear as you step back, but the reserved space keeps the box fixed.
The step caption renders *below* the box, so its changing length can't move the box. Cleared when not
reviewing (normal play untouched) and on phones.

**Verified** with the headless recipe driven at desktop width (`--window-size=1200`, innerWidth 1178):
the `.pb-controls` top was **156px at every one of the 9 steps (spread 0)** while the round-block count
went 1↔2 and the caption length ranged 41→76 chars — so neither the disappearing round boxes nor the
varying presidency description moves the box. Screenshot confirms the reserved gap looks clean. One
file: `js/app.js`.

## Session 33 — "in the night" fascist-reveal narration

**User ask:** a start-of-game audio that reads the fascist-reveal aloud so nobody at the table has to.
A 🌙 button at the top of the game; choose a voice and play when ready. **Two scripts** — a 5–6 player
one (Hitler opens their eyes with the fascists) and a 7+ one (Hitler stays hidden, raises a thumb);
the game auto-plays the right one by player count. Users can **record or upload their own** clip for
each script (both under one name). Default **female + male** voices, "as human as possible."

**Two decisions asked up front:** default voices → **device speech engine** (user picked). Storage →
user pushed back that Firebase Storage *is* set up; I **probed** it — the `/v0/b/<bucket>/o` endpoint
**404s** under both the new `.firebasestorage.app` and legacy `.appspot.com` names (403 would mean
"exists but denied"), so **no bucket is provisioned**; enabling needs a console step and, on the new
bucket naming, likely the Blaze plan `BACKEND_PLAN.md` forbids. So **custom audio is device-local**
(IndexedDB), with the storage abstracted so sync can be added later.

**Built:**
- **`js/night.js`** (`window.Night`): the two scripts as `SEGMENTS[key]` (speakable line + trailing
  pause; 5s, one 2.5s); `scriptKeyFor(n)` (5–6 ⇒ small, 7+ ⇒ large); `displayScript` (human version
  with "( pause about 5 seconds )" cues, derived from the same data); `speak()` via Web Speech API
  preferring natural/neural voices (`pickVoice`/`guessGender` pick Microsoft *Aria*/*Guy* Natural on
  modern Chrome/Edge); IndexedDB blob store (`createSet`/`putClip`/`getClip`/`listSets`/`deleteSet`);
  `playBlob` for custom clips; selected-voice pref in `localStorage`.
- **UI in `app.js`:** a `#nightModal` opened by a **🌙 Night** tabbar button (hidden in review/role
  recording). Main view = player-count + which script, a Female/Male/custom voice chooser, ▶ Play (with
  a live "line k of N" indicator) / ■ Stop, and "＋ Record or upload your own voice". Record view =
  name + a card per script showing the script text and Record (MediaRecorder) / Upload; Save writes
  both clips under one name and selects it. Deleting a voice confirms first.
- **HTML/CSS:** `#btnNight` in the tabbar, `#nightModal`, and the night styles.

**Verified.** `node test/night.test.js` = **34 assertions** (script selection, pacing = real 5s pauses,
voice picking prefers the natural voices, and the full IndexedDB roundtrip via `fake-indexeddb`).
Headless UI test (mocked `speechSynthesis`, since Web Speech + IndexedDB don't run under Chrome's
virtual-time clock) = **18/18**: a 7-player game opens the modal, shows the 7+ note, and pressing Play
speaks **all 5 large-script lines in order**; the record view shows both scripts with their pause cues.
Screenshots of both views confirm the layout. Real voice quality + mic recording need a real device.
Files: `js/night.js` (new), `index.html`, `js/app.js`, `styles.css`, `test/night.test.js` (new),
`test/package.json` (dev-dep `fake-indexeddb`).

## Session 34 — share custom night voices with the group (Firestore base64)

**User asked** (after session 33 shipped custom voices as device-local): why do games/players sync but
not audio — type or size? **Clarified:** it's storage *type* — games are JSON in **Firestore** (set
up); audio normally lives in **Firebase Storage** (a file bucket), which is **not provisioned** (the
bucket 404s; enabling needs a console step + likely Blaze). **But** we don't need Storage: audio can
ride in **Firestore as base64**, free, no new setup — the only real limit is Firestore's **1 MiB/doc**,
so each clip must be < ~700 KB. User said **build it**.

**Built (opt-in sharing, ownership mirrors games):**
- **`night.js`:** `blobToBase64`/`base64ToBlob` (cross-env, unit-tested), `markShared`, and
  `saveRemoteVoice` (caches a downloaded group voice's base64 clips back into IndexedDB). Set metadata
  gained `shared`/`groupId`/`createdBy`. Recording now uses **32 kbps** so clips stay tiny.
- **`cloud.js`:** `uploadVoice` (encodes both clips, **rejects > ~990 K base64 chars** with a friendly
  message), `deleteVoice` (clips first, then metadata — the clip delete rule reads the parent),
  `listRemoteVoices`, `downloadVoiceClips`. One clip = one Firestore doc, so each gets the full ~1 MiB.
- **`firestore.rules` (deployed):** a `voices` subcollection + `clips` subcollection. Read = member;
  create voice = member as self; **clip create = the voice's author only** (via a `get()` on the parent)
  **and < 990 000 chars**; delete = author or group owner; update = never. Rules compiled + released
  (no data touched).
- **`app.js` glue:** a **Share** button on a local voice and a **"Share with your group"** checkbox in
  the record view (both gated on being signed in with a group); a **"shared"** badge; delete removes the
  remote copy too (and is only offered for your own voices — a voice someone else shared has no delete,
  since it'd just re-download). `syncNightVoices()` pulls the group's voices on sign-in / sync /
  group-switch / modal-open and reconciles remote deletions.

**Verified.** `node test/night.test.js` now **39 assertions** (adds base64 round-trip + `markShared` +
`saveRemoteVoice` caching). The signed-in share/sync glue needs real IndexedDB (dead under Chrome's
virtual clock), so it's tested with a **real-time CDP driver + a mock `window.Cloud`** (in-memory
"remote"): **12/12** — Share calls `uploadVoice` and flips the badge, a group voice on the remote gets
downloaded + cached (size-checked), someone-else's shared voice shows no delete while mine stays
deletable. The virtual-time UI test is **19/19** (adds: no share UI when signed out). Rules also covered
by new §7c assertions in `rules.prod.test.js` — **not run** (its teardown wipes the live DB). The real
Firestore round-trip itself is only covered by the deployed rules + review; try sharing between two
accounts to confirm end-to-end. Files: `js/night.js`, `js/cloud.js`, `js/app.js`, `styles.css`,
`firestore.rules`, `test/night.test.js`, `test/rules.prod.test.js`.

## Session 35 — narration script/pacing tweaks

**User:** drop the "if you're Hitler, you now know who the other fascist is" line from the small (5–6)
script + audio, and shorten the pauses from 5s to 3s. Data-only change in `js/night.js` `SEGMENTS`:
the small script's second line is now just "Fascists, open your eyes. See who the other fascist is.",
and every `wait: 5000` → `3000` (the 2.5s Hitler-thumb beat in the large script is unchanged). The
display cues ("( pause about 3 seconds )") and the TTS pacing both follow automatically. A follow-up
also dropped the "if anyone had any problems in the night, bring them up now" tail, so the small script
now ends simply "Everyone, open your eyes." (same as the large one). `night.test.js` updated (now **42
assertions**). One code file: `js/night.js`.

## Session 36 — data-safety hardening (recorded games must never be lost)

**User:** "There should be no one command that deletes history… users should always trust their game
data won't be harmed or deleted, even while the site is being updated. Never do anything risky, and fix
this vulnerability so it's really challenging — and impossible to accidentally — to delete user game
data while we update the site."

**What I found (the real surface, narrower than PROGRESS claimed):**
- **From the app / any client, bulk deletion is already impossible.** The Firestore client SDK has no
  "delete a collection" call; every delete is one document, and `firestore.rules` only lets a
  game/voice be deleted by its author or the group owner (and `update: if false`, so history is never
  rewritten). `Stats.clearAll()` is the one client bulk-delete — but it's **local-only** and a
  deliberate button.
- **The only true mass-delete vector is admin/CLI tooling** (`firebase firestore:delete …`), which
  **bypasses the rules entirely** — no rule can police the project owner's terminal.
- **Correction:** the old warning that `rules.prod.test.js`'s teardown "empties ALL collections and
  DESTROYS real games" was **overstated** — every committed version scoped itself to a `__test_<runId>`
  group and only *printed* a scoped recursive-delete command. Still a footgun; now designed out.

**What I shipped (all five):**
1. **`DATA_SAFETY.md`** — new top-of-repo rule zero: the one real mass-delete vector, the forbidden
   commands (`--all-collections`, `--recursive`), why app+rules can't bulk-delete, the gated prod test,
   and back-up-first discipline.
2. **Hard-gated `test/rules.prod.test.js`** — refuses to run unless `SH_PROD_RULES_TEST=i-understand`;
   a plain run prints why and exits 0 **before any Firebase connection**. Verified.
3. **Self-scoped test cleanup** — replaced the printed `firebase firestore:delete … --recursive` with
   in-test, per-document deletion of ONLY the `__test_<runId>` docs it created, through the rules. No
   wholesale/CLI wipe exists anywhere in the file now.
4. **Export-first "Clear all statistics"** (`js/app.js`) — the button now auto-downloads a full JSON
   backup FIRST, then asks a **second** time before erasing, and only clears the local device
   (signed-in games survive in the account and sync back). New `downloadArchive()` helper shared with
   Export. **Headless-Chrome smoke test SMOKE_OK:** empty archive → no modal (toast only); seeded →
   "Download backup & continue" → exactly 1 backup produced, games still present → "Erase this device"
   → cleared.
5. **DATA-SAFETY INVARIANT comment in `firestore.rules`** — documents that client mass-delete is
   structurally impossible and delete is per-doc author/owner only, so a future edit can't quietly
   loosen it.

**Behavioral commitment recorded:** never run wholesale/recursive Firestore deletes; verify cloud/rules
changes with a mock `window.Cloud` over CDP; the normal update loop (edit → push → Pages →
`firebase deploy --only firestore:rules`) never touches stored data. Files: `DATA_SAFETY.md`,
`js/app.js`, `test/rules.prod.test.js`, `firestore.rules`, `PROGRESS.md`, `CHAT.md`. No deploy needed
(rules text unchanged — only a comment added; deploy is a harmless no-op if desired).

## Session 37 — editable display name (propagates to your whole account + groups)

**User:** account creation shows "Display name" but signing in with Google never asked, so they can't
see a display name anywhere. Always let the user change their display name in settings, and update it
automatically throughout the site — and through other members' views if they share a group.

**Shipped.** New `Cloud.setDisplayName(name)` (`js/cloud.js`) writes the name to all three places it
lives: (1) the Firebase Auth profile (`updateProfile`), (2) `profiles/{uid}.displayName`, and (3)
**every roster seat that is you (`uid===me`) in every group you belong to** — best-effort per seat, so
a slow/denied group can't fail the whole thing. Roster docs are shared group data, so other members
see the new name on their next read/sync. It emits `cloud:auth` + `cloud:groups`; the app already
re-renders the chip, menu, account view, and setup roster on those, so it updates live everywhere.
No rules change needed — the members rule already allows editing `displayName` with `uid` unchanged.
Historical games keep the free-typed table name (a snapshot, not identity) on purpose.

**UI (`js/app.js` + `styles.css`):** the signed-in account view now shows the display name prominently
(18px, `--ink`) with the email as a subtitle and a **Change name** button; no name yet → "No display
name yet". `promptText()` gained an optional `prefill` arg (and selects the text) so editing starts
from the current name. Clicking Change name → prompt → `setDisplayName` → refresh chip/account/setup/
stats.

**Verified** with a headless-Chrome **mock `window.Cloud`** (in-memory remote, no live project — the
safe pattern): SMOKE_OK. Before: chip falls back to the email prefix ("me"), account shows "No display
name yet". After changing to "Tim": `setDisplayName("Tim")` called, my seat rewritten
(`g1/s1=Tim`), and the chip, account header, and roster all read "Tim". Files: `js/cloud.js`,
`js/app.js`, `styles.css`, `PROGRESS.md`, `CHAT.md`.

## Session 38 — Rules & Game Theory handbook with community notes

**User:** add two new main-menu sections — a **Rules** reference where you can find any rule fast, and a
**Game theory** section — both split into categories so you can drill down (Rules → category → category →
the specific bullet). Let users add notes/strategies. On the notes: "a fundamental part of the website,
like Wikipedia — anyone can share comments or ideas, shown with who commented (a name on the side)."
Also let Rules items carry user notes too.

**Shipped.**
- **Two new menu boxes → two screens** (`#rulesScreen` / `#theoryScreen`) sharing one markup template
  and one renderer (`renderReference("rule"|"theory")`). Added to `show()`, `NAV_SCREENS`, and the
  back-stack; wired `btnMenuRules`/`btnMenuTheory` + back buttons.
- **Bundled content in `js/reference.js`** (`window.Reference`): two trees, category → subcategory →
  item ("bullet"). Each item has a **stable id** used as the comment target. Rules authored from
  `SECRET_HITLER_RULES.md` (41 items incl. the user's exact example — "election restrictions reset
  after a chaos top-deck" — under Elections → The Election Tracker & chaos, plus a cross-ref in
  Tricky situations). Curated strategy tree (26 items) across Liberal/Fascist/Hitler/President/
  Chancellor/Reading-the-table/Endgame.
- **Browse + search UI:** a sticky search box (multi-word AND across title+body+breadcrumb) that takes
  precedence over drill-down; otherwise categories → subcategories → items with a breadcrumb. Tapping
  an item expands its full text + a Community notes panel. The shell renders once and results
  re-render per keystroke without rebuilding the input (focus/caret preserved).
- **Community notes = wiki layer.** New top-level Firestore **`comments`** collection (separate from
  games/voices — cannot touch recorded history). `Cloud.addComment/listComments/deleteComment`
  (single `where target==` equality, no index; client-side sort). Any signed-in user reads all notes
  and posts their own, shown with their **display name** + relative time; notes aren't edited (delete
  + repost); author-only delete with a confirm. Signed-out → "Sign in to read and add notes" CTA.
- **Rules deployed** (`comments` block: read=signedIn, create pins authorUid + size caps,
  update=false, delete=author-only) — per-doc + author-scoped, so no bulk-delete path (respects the
  DATA-SAFETY invariant). `firebase deploy --only firestore:rules` compiled + released (config-only).
- **Verified:** Node content check (ids unique, example search hits the right rule) + a headless
  mock-Cloud smoke test **SMOKE_OK** (open, search, expand, post note shows author, delete, drill-down,
  Game theory opens). Files: `index.html`, `js/reference.js` (new), `js/app.js`, `js/cloud.js`,
  `styles.css`, `firestore.rules`, `PROGRESS.md`, `CHAT.md`.

## Session 39 — label & favorite recorded games

**User:** let the user label games with a specific name, and favorite games so they always appear at the
top of the games list.

**Shipped.**
- **Star + label on every game box** in the All games list. A ★/☆ star (top-left of the box) toggles
  favorite; **favorites float to the top** (`Stats.orderForDisplay()`, a stable partition). A label
  (name) shows on the box and in the review. Also settable from the **review panel** (☆ Favorite /
  Add a label / Rename, beside Delete game).
- **stats.js:** `setFavorite(id,bool)` / `setLabel(id,str≤60)` mutate the FULL array
  (loadAllGames+saveGames, like deleteGame) storing `favorite`/`label` on the local game record —
  mutable annotations, NOT part of the append-only history. `orderForDisplay(games)` = favorites first.
- **Personal + cross-device without touching the immutable game doc.** Games are `update:if false`, and
  favorites are per-user anyway, so metadata mirrors to `profiles/{uid}/gameMeta/{gameId}` = {label,
  favorite} — fully private (owner read/write only, sizes capped), separate from games. `app.setGameMeta`
  writes local + `Cloud.setGameMeta`; `sync()` pulls all gameMeta and applies onto local games (remote
  wins). Fully works offline/signed-out (local only). Limitation: an offline change may not reach the
  cloud until changed again online (best-effort push). Rules deployed (config-only).
- **List is now id-based, not index-based:** `openReview(id)` finds the game by id (was an array index),
  so floating favorites to the top can't misroute a click. Box is a `div[role=button]` (nested `<button>`
  star would be invalid HTML); the star stopPropagations so it never opens the review.
- **Verified:** Node unit test of stats (fav floats to top, keys removed on clear, label cap 60) +
  headless mock-Cloud smoke test SMOKE_OK (star floats + calls setGameMeta without opening review;
  review Fav/Label work; label + favorite render on the box and persist to localStorage). Files:
  `js/stats.js`, `js/app.js`, `js/cloud.js`, `styles.css`, `firestore.rules`, `PROGRESS.md`, `CHAT.md`.

## Session 40 — ONLINE PLAY, Phase 1 (lobby + secret roles + night) 🌐

**User:** start building full online play — host a game online, record it to a group, same look/detail as
the current game (table, names, board, past presidencies, lying + fascist-odds options), guide players
through every step, make the site able to do everything the physical board/cards/roles do. Make a plan,
ask questions, start.

**Decisions (asked + answered):** host-authoritative (free, no server — host's browser is dealer/referee;
a host could technically cheat like a dishonest dealer; must stay connected); signed-in group members
only (guest links later); discussion outside the app (no in-app chat).

**Plan:** phased build. (1) lobby + roles + night [THIS], (2) election loop, (3) legislative session with
a real deck, (4) powers, (5) win detection → record to group + polish. The live game emits the SAME event
log the analyzer uses, so a finished online game records as a normal reviewable game (replay/stats/odds
reuse for free).

**Shipped Phase 1.**
- `js/engine.js` — pure authoritative logic (no net/DOM/rng of its own; caller passes rng → deterministic).
  `setupGame(uids,rng)` deals seat order, first President, roles, and each player's exact night knowledge.
  Node-tested: `test/engine.test.js`, **126 assertions** (team sizes, one Hitler, per-role knowledge,
  determinism). NB: fascist TEAM incl Hitler = ceil(n/2)−1 → 2/2/3/3/4/4 for 5–10 (my first test had the
  wrong expected table; engine was right).
- `js/online.js` — ES module (`window.Online` + `online:*`), loaded after cloud.js and **reuses its
  Firebase app** (`getApps().length?getApp():initializeApp`). Data under `groups/{gid}/tables/{tid}`:
  table doc (host-write/member-read), `players/{uid}` (own lobby seat), `private/{uid}` (host writes,
  owner-only read — this is what hides roles), `actions/` (Phase 2+). Phase 1 methods: hostGame,
  listTables, joinTable, leaveTable, abortTable, startGame (deal → write private docs → status night),
  beginPlay.
- `firestore.rules` — new `tables` block: table host-only write; private read-owner-only + write-host-only
  (via a `tableHost()` get()); players own-write; actions own-create/host-read. Per-doc + host-scoped, no
  bulk-delete path. Deployed (config-only).
- `js/app.js` + `index.html` + `styles.css` — Play online menu box → `#onlineScreen` (in show()/
  NAV_SCREENS/back-stack). renderOnline: browse (host/join) → lobby (5–10, host-gated Start) → night
  (per-device secret role reveal + seating + first President). `wireOnline()` re-renders on `online:*`.
  Phase 1 ends at the night reveal (turn-by-turn play is next; the screen says so).

**Verified:** engine 126/126; a headless **mock-`window.Online`** smoke test (real Engine + app UI):
browse→host→lobby(gate at 5)→deal→night with all four reveals correct + first-Pres badge = SMOKE_OK;
real module init against live Firebase SDK = Online/Cloud/Engine present, **no double-init**. NOT yet
automated: the live multi-client Firestore round-trip (rules-enforced but wants a 2-account play test).
Test-harness gotcha logged: don't `sed '/online\.js/d'` the HTML — it nukes a comment line and orphans a
`<script>` inside an unclosed comment; delete the exact `<script … src="js/online.js">` tag instead.
Files: `js/engine.js` (new), `js/online.js` (new), `test/engine.test.js` (new), `index.html`, `js/app.js`,
`styles.css`, `firestore.rules`, `PROGRESS.md`, `CHAT.md`.

## Session 41 — ONLINE PLAY complete (all 5 phases in one go) 🌐

**User:** continue full online play — do all 5 "what's next" steps (election loop, legislative session,
powers, win detection → record to group, polish) with no pauses.

**Shipped the whole game.** `js/engine.js` grew from the Phase-1 role-dealer into a full authoritative
state machine; `js/online.js` gained the host action-pump; `js/app.js` got the live game UI.

- **engine.js (pure reducer):** `initGame` (roles + shuffled 11F/6L deck) → `applyAction(state,action,rng)`
  handling nominate / vote / president_play (discard + a bluffable claim) / chancellor_play (enact or
  veto) / veto / powers (investigate, special-election, peek, execute); win detection (5L, 6F, Hitler
  elected Chancellor after 3F, Hitler executed); `publicView` (no secrets), `privateView` (one player's
  role + current hand + learned power results), `toRecordedGame` (analyzer-compatible). Deterministic
  given rng. **Node test = 1653 assertions**: 60 full simulated games across all counts checking 17-card
  conservation every step, tracker bounds, term limits, veto, both Hitler wins, and that `publicView`
  never leaks roles/deck/hands mid-game (but does at game over for the reveal + recording). (First run
  failed only because my EXPECT table had regular-fascist counts, not team-incl-Hitler; engine was right.)
- **online.js (host loop):** authoritative full state persisted as a JSON blob in `host/state`
  (host-only). `processActions` drains the `actions/` queue in timestamp order, applies each via the
  engine (dropping illegal ones), then `pushState` writes the secret blob + the public table doc +
  EVERY player's private doc, and deletes the action. `submitAction` lets any player (incl. host) post a
  move (`by` pinned for the rules). Host reload resumes via `loadHostState`. On game over `finishGame`
  sets status finished + emits `online:finished`.
- **firestore.rules:** added `host/{k}` (host-only read/write — the one place the whole secret game
  lives). Deployed (config-only). Per-doc, host-scoped; tables are ephemeral scratch, a finished game is
  a normal `games` doc, so nothing here touches recorded history (DATA_SAFETY invariant holds).
- **app.js live UI (`renderOnlinePlaying`):** board (tracks + tracker dots + pile counts), players (P/C/
  nominee/termed/dead badges, per-seat Ja/Nein from the last election, and a live fascist-% chip when the
  Fascist-odds setting is on — computed by briefly swapping in an online-derived review state so the
  analyzer runs on PUBLIC events only), History, the player's secret panel, and a phase-driven action
  panel (nominate choices / Ja-Nein / draw-discard-claim / enact-or-veto / veto agree / power targets),
  showing "waiting for X" to non-actors. Night screen now has a host **Begin game**. `online:finished` →
  `Stats.recordGame` + upload; non-hosts pull it on sync. "View in Statistics" from the over screen.
- **Verified:** engine 1653/1653; a headless **mock-host smoke test played a whole game through the real
  UI** (nominate→vote→draw→discard+claim→enact→board/history update→bot-driven to a Fascist win→over
  screen→recorded to Statistics) = SMOKE_OK; modules init cleanly against live Firebase. NOT automated:
  the true multi-client round-trip (wants a real multi-account game). Files: `js/engine.js`, `js/online.js`,
  `js/app.js`, `styles.css`, `firestore.rules`, `test/engine.test.js`, `PROGRESS.md`, `CHAT.md`.

## Session 42 — edit a recorded game's roles (author-only)

**User:** accidentally recorded a role wrong in a game; make recorded games' roles editable after
submission, but only by the person who recorded the game.

**Shipped.** A review-panel **Edit roles** button (author-only) reopens the role picker (Hitler +
count-appropriate Fascists + winner) prefilled from the stored result, recolouring the table live as you
pick. Save writes locally (`Stats.setResult`) and, for a synced game, to the cloud
(`Cloud.updateGameResult`, cloud-first so a failure aborts). **Only `result` changes — the event LOG is
never rewritten.**

- **stats.js:** `setResult(id, result)` (full-array write, like setLabel/setFavorite).
- **firestore.rules:** games `update` was `if false`; now the author (`createdBy==uid`) may update with
  `diff(...).affectedKeys().hasOnly(['result'])` — a tightly-scoped, bounded exception to append-only
  (the log stays immutable; only the author's role annotation is correctable). Deployed (config-only).
- **cloud.js:** `fromCloud` carries `createdBy`; sync **backfills createdBy** onto local copies + stamps
  it on my games at upload, and **propagates a corrected `result`** onto already-downloaded copies (so
  other members get the fix on their next sync). New `updateGameResult(id,gid,result)` (only network for
  a synced game; author-only enforced by rules).
- **app.js:** `canEditReviewedGame(g)` (signed-out → mine; else `createdBy===myUid`, or unsynced-local).
  `Edit roles` → `enterEditRoles` (jumps to reveal, drafts from result) → `renderRoleEditor` (winner
  toggle + Hitler/Fascist pickers, live table preview) → `saveEditRoles`. Cancel restores.
- **Verified** headless (mock cloud): signed-out shows Edit; editor prefilled (Cy=Hitler); change
  Hitler→Di, Fascist→Cy, save → result updated, **events unchanged**; author gating — hidden for another
  member's game, shown + `updateGameResult` called for my own = SMOKE_OK. Modules init clean against live
  Firebase. Files: `js/stats.js`, `js/cloud.js`, `js/app.js`, `firestore.rules`, `PROGRESS.md`, `CHAT.md`.

**Follow-up fix (same session, commit `b886cea`):** user couldn't see the Edit button on a game they'd
recorded. Cause: games recorded **before** the feature (and freshly recorded ones until they sync) had no
local `createdBy`, so for a signed-in user `canEditReviewedGame` returned false. Fixes: (1) stamp
`createdBy` at RECORD time — companion `saveRoles` + the `online:finished` handler now set it to the
signed-in uid, so a new game is editable by its recorder immediately; (2) when the author is UNKNOWN
(older/pre-sync game) `canEditReviewedGame` now returns **true** — safe because the rules still reject a
non-author's cloud write (save is cloud-first) and sync backfills `createdBy`. Also reminded the user to
hard-refresh (GitHub Pages had the code; browser cache was serving the old app.js). `js/app.js` only.

---

## Session 43 — Undo-stack perf fix + `derive()` extracted to a Node-tested rules module

Two non-online-play quick wins off the backlog (user asked "what could we improve that isn't online
play", then "start with 1 and 2").

**1. Undo-stack O(n²)-per-render perf fix.** `saveActive()` did `JSON.stringify(state)` on every render,
and `state.undoStack` holds up to `UNDO_LIMIT` (25) full-state snapshots — so each render re-serialised
the whole stack (O(snapshots × state size) = O(n²) in a long game). Fix: the undo stack moved out of the
active-game blob into its **own** localStorage key `secretHitler.activeGame.undo.v1`.
- `saveActive()` now strips `undoStack` (`const {undoStack, ...rest} = state`) and saves only the live
  state. New `saveUndo()` writes the stack, called **only when it changes** — from `pushUndo()` and
  `undoLast()`. `clearActive()` clears both keys.
- `loadActive()` reads the new key, but still accepts an older stack **embedded** in the blob (migration:
  an in-progress game saved by the old code keeps its undo history). Undo still survives a refresh.

**2. `derive()` extracted to `js/derive.js` (Node-testable) + a 47-assertion regression test.** The app's
core rules engine was trapped in the `app.js` IIFE with zero coverage. Moved it out verbatim into a pure
`Derive.derive(state, deps)` (classic `Derive` global + `module.exports`, matching `probability.js`). The
in-app `derive()` is now a thin wrapper injecting the collaborators: `clamp`, `Prob.retrospectiveProb`,
`lieOn`/`rolesOn`, and the honesty/role analyzers (`analyzeRound` deferred via a wrapper so `Honesty` is
only touched when the switch is on). `index.html` loads `derive.js` before `app.js`.
- **`test/derive.test.js` = 47 assertions** (`node test/derive.test.js`, no deps): empty game, pile
  counting, rotation (+wrap, +fail), election tracker, veto bookkeeping, chaos (resets tracker + term
  limits + removes one card), term limits (7-player Pres+Chan vs 5-player Chan-only), deaths (dead set,
  aliveCount, `players[i].dead` mutation, rotation-skip, `wasHitler` not marked dead), **nested special
  election keeps the first resume seat**, reshuffle into round 1, investigations, Hitler-elected terminal,
  state mutation (roundMods written back), determinism, and the honesty/role **dependency wiring** (hooks
  fire when the switches are on and their output is surfaced).

**Verification:** `node --check` on both files; `node test/derive.test.js` → 47/0; existing
`test/engine.test.js` → 1653/0 and `test/honesty.test.js` → 66/0 still green (proves the extraction is
behaviour-identical). Full **headless-Chrome smoke test** through the real UI (menu → setup → randomize →
set chancellor → enact a Liberal): `Derive` global present, no init error, one Liberal policy on the
track, draw pile 14, president advanced → **SMOKE_OK**.

Files: `js/derive.js` (new), `js/app.js`, `index.html`, `test/derive.test.js` (new), `PROGRESS.md`,
`CHAT.md`.

---

## Session 44 — Accessibility first pass (#3), then EM fitting (#5) + correlated fascists (#6)

User picked improvements **3, 5, 6** off the session-43 backlog and explicitly ruled out vote/chancellor
data capture ("keep the site as simple as possible") — so all three are internal/opt-in, no new in-game
data entry.

### Part 1 — Accessibility (#3)

The app was mostly mouse/touch-only: player seats were informational `div`s with `onclick`, dialogs had
no focus management, and several controls set `outline:none`. (Role-recording + the ratio/menu controls
were already real `<button>`s, and settings toggles already had `role=switch` — so the gaps were seats,
dialogs, focus rings, and live regions.)

- **Seats keyboard-operable** (`renderTable`): a seat becomes `role="button"` + `tabindex="0"` with an
  Enter/Space handler that calls `setChancellor(i)` **only when a tap would act** (`!busy() && !dead &&
  i!==presIdx`); otherwise it's `role="img"`. Every seat gets an **`aria-label`** listing its state
  (seat #, name, President/Chancellor/term-limited/executed, and the live fascist-% when the board-odds
  setting or a review playback is showing it) — the screen-reader equivalent of the visual badges.
- **Dialogs** (`initA11y()`, called at boot): every `.overlay` is marked `role="dialog"` + `aria-modal`,
  and a per-overlay `MutationObserver` on the `hidden` class drives focus: on open, store the trigger,
  move focus to the first real control (skip the back arrow), **trap Tab**; global keydown **Esc** clicks
  the box's `.backbtn`; on close, **restore focus** to the trigger. Centralised, so none of the ~7
  `classList.remove("hidden")` call sites needed changing.
- **Live regions:** `#toast` → `role=status aria-live=polite aria-atomic`; `#hint` → `aria-live=polite`.
- **CSS:** restored a visible **`:focus-visible`** ring (gold) globally + overrides for the controls that
  had opted out (`.ratio-btn`, `.ref-search`, `.note-input`) and for keyboard-operable seats.
- **Verified** headless (real UI): toast/hint are live regions; opening Settings gives role=dialog +
  aria-modal, focus moves to the first toggle, **Esc closes it and focus returns to the gear**; all 5
  seats have aria-labels, actionable seats are `role=button`+tabindex 0 with a "Chancellor" hint, and
  **pressing Enter on a focused seat sets it as Chancellor** → SMOKE_OK. Files: `js/app.js`, `index.html`,
  `styles.css`, `PROGRESS.md`, `CHAT.md`.

### Part 2 — Correlated fascist behaviour (#6, HONESTY_MODEL §12.7)

The role posterior treated governments as conditionally independent *given the assignment*. The key
insight that makes a correlation term cheap: **inside a fixed assignment we already know every seat's
role**, so a pairwise interaction is just one more per-government multiplicative factor — the round DP
sums it exactly, no factorisation lost. Two effects, each gated on the acting seat KNOWING its ally (a
cautious/blind Hitler in 7+ triggers neither):

- **Coordinated push** (`coordBump` = 0.08): a fascist chancellor enacting fascist from a mixed pass
  pushes harder when the president is a known ally. Added to γ and clamped (`pushMin/pushMax`), so it can
  only ever *raise* the enact-fascist rate — a co-governing fascist pair reads as more suspicious together.
- **Ally-framing reduction** (`falseAccuseAlly` = 0.05 vs `falseAccuseFasc` 0.30): a fascist president
  almost never fabricates a conflict against a fascist ally, so a real conflict is gentle evidence the
  pair are NOT coordinating fascists — mass shifts toward "exactly one of the pair is fascist".

Implementation (`js/honesty.js`): `enactProb(e,p,bhv,coord,prm)` and `conflictFactor(p,bhv,framingAlly,
prm)` gained the ally flags; `govLikelihoodTeam(...,rel)` threads a `rel = {chanKnowsPresAlly,
presKnowsChanAlly}` computed per government from the assignment (omitting `rel` reproduces the old
independent behaviour exactly). `analyzeGame`'s weightFn builds `rel`. Only the ROLE posterior changed —
the per-claim honesty layer (`analyzeRound`) is untouched.

Tests: the brute-force role mirror in `honesty.test.js` shares `_govLikelihoodTeam`, so it now passes the
same `rel` (still validates DP-vs-explicit-enumeration). All 66 prior assertions still pass (no qualitative
flip; the defaults are gentle), plus a new **§9** (7 assertions): coordination lifts the co-governing
pair's odds, ally-reduction gentles a conflict while still implicating the pair over a bystander, the
fascist count still conserves. **73 passed, 0 failed.** derive 47/0 + engine 1653/0 unaffected. Files:
`js/honesty.js`, `test/honesty.test.js`, `HONESTY_MODEL.md`, `PROGRESS.md`, `CHAT.md`.

### Part 3 — Fit lie rates to your games (#5, HONESTY_MODEL §7 / §12 #11)

Scoped deliberately. The design review (§7c, F4) says β (bury) and γ (enact-fascist) are **confounded**
with the lie rate unless you capture chancellor-claims or votes — data the user explicitly declined — so
fitting them from presidential claims alone is the "confident nonsense" the review warns against. The
**identifiable** quantity is the per-team **report lie rate** (how often each team misreports its hand),
which is also the "lie tendency" wishlist stat. So v1 fits `facLie`/`libLie` only; β/γ stay at defaults.

- **`js/fit.js`** — `Fit.fit(samples)`: roles-known EM. E-step runs the §4b forward–backward DP with the
  true roles fixed (reusing Honesty's kernels — newly exported `_forwardTable/_backwardTable/_SUMPROD/
  _binom/_drawDistribution` — so the fitter scores hands with the EXACT model it feeds). M-step is a
  Beta-posterior mean `(κ·default + Σ E[misreport])/(κ + Σ 1)`, κ=24 pseudo-obs → a small archive stays
  near the prior. A knowing Hitler (5–6p) buckets as fascist; a cautious Hitler (7+) is excluded (its rate
  isn't fitted).
- **`test/fit.test.js`** (18 assertions) — the gold-standard **simulation-recovery** check (§8): generate
  single-gov R=0 games (hand pinned) with KNOWN lie rates, confirm EM recovers them within ±0.03; plus
  shrinkage (few games ≈ default), Hitler bucketing, responsiveness, determinism, and an R>0 (uncertain
  hands) convergence case that exercises the forward-backward beyond point masses.
- **App wiring:** extracted `buildHonestyRounds(rounds, gi)` (shared by `analyzeRoles` and the fitter);
  `analyzeRoles(...nOverride, paramsOverride)` now takes an optional player-count + lie-rate override, so
  archived games can be re-scored under any params. `activeHonestyParams()` returns the fitted rates when
  the user has opted in (persisted in `settings.useFit`/`settings.fitParams`), feeding the live board odds,
  the review role odds, and every newly-recorded game's `roleOdds`. Games are reconstructed purely via
  `Derive.derive(gameState, …)` — no global state touched.
- **UI** (Statistics screen, `lie-col`, only when lie detection is on): a "Fit lie rates to your games"
  panel with a **Fit** button → shows fitted vs default rates AND a **fitted-vs-default Brier A/B on the
  user's own games** (so you see whether it actually helps before applying) → **Use these rates** persists
  the opt-in; **Use defaults** reverts. Fully reversible, off by default.
- **Verified:** all Node suites green (fit 18, honesty 73, derive 47, engine 1653). Headless end-to-end
  with 4 seeded recorded games: the panel fits (fascist 53% vs 50%, liberal 4% vs 5%), shows the A/B, and
  **Apply persists `useFit`+`fitParams`** and flips the panel to offer "Use defaults" → SMOKE_OK. Files:
  `js/fit.js` (new), `test/fit.test.js` (new), `js/honesty.js` (kernel exports), `js/app.js`, `index.html`,
  `styles.css`, `HONESTY_MODEL.md`, `PROGRESS.md`, `CHAT.md`.

---

## Session 45 — Game theory rebuilt from the user's own strategy doc

The user supplied their own Secret Hitler game-theory write-up (a 6-page doc) and asked to **replace the
placeholder Game Theory content entirely** with it, keep the bullet/sub-bullet levels but **not
over-nest** (flat main categories → a page of bullets), and make comments **way simpler** — a chat icon
that opens a mini chat instead of the per-item notes panel. **Rules were left untouched.**

- **`js/reference.js`:** replaced the old `THEORY` tree with **`STRATEGY`** — a flat list of 8 main
  categories (Summary, Vocabulary, General notes, Liberal optimization, Fascist lying & manipulation,
  Using human emotion, Unique scenarios, House rules) each with recursive `bullets` (`{t, subs?, wip?}`),
  faithful to the doc. `wip:true` marks the doc's "red" (debated / work-in-progress) items. Removed the
  old THEORY array; `TREES` is now `{rule: RULES}` and `flatten/search/findItem` cover RULES only;
  exported `window.Reference.strategy`.
- **`js/app.js`:** `openTheory()` now calls a dedicated **`renderTheory()`** (theory no longer shares the
  rules renderer). Category list → category page (`← All sections` back, title, blurb, recursive
  `bulletsHtml`, `debated` tags). Comments are a **per-category chat** behind a 💬 toggle
  (`loadTheoryChat`/`paintTheoryChat`), reusing the same Firestore backend (`Cloud.addComment/
  listComments/deleteComment`) with target `theory:<catId>` — signed-out shows a sign-in prompt. The
  rules machinery (`renderReference`, `refBrowser`, per-item notes) is unchanged.
- **`styles.css`:** `.thy-cats/.thy-cat`, `.thy-page-head/.thy-title/.thy-chat-toggle`, `.thy-list/
  .thy-bullet/.thy-sublist` (left-bordered nested list), `.thy-wip` (debated pill), `.thy-chat` mini-chat.
- **Verified** headless: 8 categories; a category page shows the title, 11 top-level bullets, nested
  sub-bullets, and a `debated` tag; the 💬 toggle opens the chat (signed-out → sign-in prompt); `← All
  sections` returns to the list → SMOKE_OK. Screenshot confirmed the layout. Note: old per-item theory
  comments (targets like `theory:liberal.fund.trust`) are orphaned by the content swap — expected.
  Files: `js/reference.js`, `js/app.js`, `styles.css`, `PROGRESS.md`, `CHAT.md`.

---

## Session 46 — Admin account can edit Game theory live (rules-enforced)

The user made an account on `timhadfield7@gmail.com` and asked for it to have special privileges no other
account has — for now, the ability to **add/edit any aspect of Game theory, permanently, for everyone**.

**Key point made to the user:** the real privilege boundary is Firestore rules, not the client — hiding a
button in JS stops nobody. So the content moved from bundled-only into Firestore, gated by a rule.

- **Data + rules:** new `content/gameTheory` doc = `{strategy, updatedAt, updatedBy}`.
  `firestore.rules`: added `isAdmin()` = `request.auth.token.email == 'timhadfield7@gmail.com'` (signed
  Auth token, unspoofable; the email is uniquely claimed so no one else can present it) and
  `match /content/{docId} { read: if true; write: if isAdmin() }`. **Public read** so signed-out visitors
  also get edits; admin-only write. Deployed (config-only, safe). Rule left email-only (not
  `email_verified`) to avoid locking the user out regardless of sign-in method; noted as tightenable.
  `isAdmin()` is written as a reusable hook for future admin-only privileges.
- **cloud.js:** `Cloud.isAdmin` (getter), `Cloud.getGameTheory()` (public read → `{strategy}|null`),
  `Cloud.saveGameTheory(strategy)` (admin-guarded; setDoc, not merge, so deletions stick).
- **app.js:** `strategy()` now returns `remoteStrategy || bundled STRATEGY`; `remoteStrategy` is cached in
  `localStorage["secretHitler.gameTheory.v1"]` and refreshed via `refreshGameTheory()` on openTheory + on
  `cloud:auth`. Admin editor: "＋ Add section" + ↑/↓ reorder on the list, "✎ Edit" on a section page →
  editor (title / blurb / bullets-textarea). `commitStrategy(next)` saves cloud-first and only updates the
  local view on success (no divergence). Editing uses `Reference.serializeBullets`/`parseBullets`.
- **reference.js:** added pure `serializeBullets`/`parseBullets` (nested bullets ⇄ indented text; 2-space
  or tab indent, trailing ` [debated]` = wip) + `blankCategory`; made the module Node-loadable (guarded
  `window`, added `module.exports`). `test/reference.test.js` = 19 assertions (round-trips every bundled
  category, nesting, tabs, [debated], blank/whitespace, blankCategory).
- **Verified:** all Node suites green (reference 19, honesty 73, derive 47, fit 18, engine 1653). Headless
  with a mock `Cloud`: admin adds a section (bullets parsed with nesting + debated), edits one (prefilled +
  persisted), list grows → SMOKE_OK; **non-admin: no Add/Edit/reorder, content still renders** → SMOKE_OK.
  Files: `firestore.rules`, `js/cloud.js`, `js/app.js`, `js/reference.js`, `styles.css`,
  `test/reference.test.js` (new), `PROGRESS.md`, `CHAT.md`.

---

## Session 47 — Rules joined the editable handbook model; House rules moved to the bottom of Rules

Two asks: (1) move "House rules for a better game" from Game theory to the bottom of the Rules section;
(2) let `timhadfield7@gmail.com` edit the Rules section too. Since Rules used a different (search +
category→subcategory→item drill-down) renderer than the now-editable Game theory, the clean way to do both
was to **put Rules on the same flat, editable category→bullets model** — then House rules drops in naturally
and Rules becomes admin-editable with zero new machinery.

- **Unified renderer (app.js):** the session-45/46 theory code was generalized to `renderHandbook(kind)`
  (`kind` = "theory" | "rules") + `renderHandbookEditor` + `loadHandbookChat`/`paintHandbookChat`, driven by
  a `HB[kind]` config (mount, screen, Firestore doc, comment-target prefix, bundled fallback) and per-kind
  `hbState`. `openRules()`/`openTheory()` → `openHandbook(kind)`. Element lookups are now **box-scoped
  (querySelector on classes)** instead of fixed ids, so the two handbook screens can't collide. The old
  `renderReference`/`refBrowser`/per-item-notes code is now dead but left in place (never called).
- **Rules content (reference.js):** `Reference.rules` is DERIVED from the authoritative `RULES` tree at
  load (subcategory → heading bullet, item → "Title — body" sub-bullet), so `RULES`/`SECRET_HITLER_RULES.md`
  stays the source of truth; the flat shape is just the render/edit form + offline fallback. `content/rules`
  in Firestore is the live source once edited. **House rules moved out of `STRATEGY` into a `HOUSE_RULES`
  const appended to `RULES_CONTENT`** — Game theory now 7 categories, Rules 8 (House rules last).
- **cloud.js:** generalized to `Cloud.getContent(name)` / `saveContent(name, strategy)` (admin-gated);
  `getGameTheory`/`saveGameTheory` kept as aliases. **No firestore.rules change** — `match /content/{docId}`
  already covers `content/rules` (public read, admin write).
- **Tests:** `reference.test.js` now round-trips BOTH handbooks' bundled content through the editor parser
  + asserts House rules moved (19 → 28 assertions). All suites green (reference 28, honesty 73, derive 47,
  fit 18, engine 1653). Headless mock-Cloud: admin Add/Edit on **Rules** saves to the `rules` doc, House
  rules is the last Rules section, Game theory has 7 sections with no House rules, **non-admin sees no edit
  controls on either** → SMOKE_OK (×3).
- Note: search over Rules was dropped with the drill-down model. Files: `js/reference.js`, `js/app.js`,
  `js/cloud.js`, `test/reference.test.js`, `PROGRESS.md`, `CHAT.md` (no rules/CSS change needed).

## 2026-09-21 · Migrated handoff files to the /checkpoint format (Claude, no code changes)
- **Asked:** (Claude-run migration, no session with Tim) bring PROGRESS.md + CHAT.md under their caps in the new compact format.
- **Decided:** kept the filenames `PROGRESS.md` / `CHAT.md`; moved Sessions 1–27 whole to `docs/archive/chat-archive.md`; snapshot of the old PROGRESS at `docs/archive/progress-2026-09-21.md`.
- **Built:** PROGRESS.md rewritten to the template (standing instructions, 40 decisions, traps, NOT verified, rejected/parked as one-liners). No code touched.
- **Verified how:** archive copy hash-identical to the old PROGRESS.md; moved chat text byte-compared equal to the original; all six Node suites run 2026-09-21: honesty 73/0, night 42/0, engine 1653/0, derive 47/0, fit 18/0, reference 28/0.
- **Open:** nothing authorized; see PROGRESS "Rejected / parked" for the idea list.
