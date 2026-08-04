# PROGRESS — Secret Hitler Companion

> **This file is the complete brief — you need no other context to work on this project.**
> The user will only say "catch up on PROGRESS.md". Read it top to bottom, then start.
> `CHAT.md` = session-by-session history; `PROBABILITY_MODEL.md` + `SECRET_HITLER_RULES.md` =
> reference. **After any meaningful change you MUST update this file + `CHAT.md`** (the user
> periodically deletes the chat and relies entirely on these docs).

_Last updated: 2026-08-01 (session 47: Rules joined the same editable handbook model as Game theory; House rules moved to the bottom of Rules)._

## ⚙️ Working on this project (operational brief — read once)
- **Project dir (absolute):** `c:\Users\timha\OneDrive\Desktop\my-website\Code Projects\Secret_Hitler`
  — its own git repo (separate from the surrounding `Estimator_Quiz` tree). Branch: `main`.
- **Environment:** Windows. The Bash tool is **Git Bash**; PowerShell is also available. Notes:
  - `gh api` calls with a leading-slash path get mangled by MSYS path conversion — prefix with
    `export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`.
  - Git prints benign `LF will be replaced by CRLF` warnings — ignore them.
  - `gh` CLI is authenticated as **TimothyHadfield** (repo scope). Chrome is at
    `/c/Program Files/Google/Chrome/Application/chrome.exe`.
- **Tech:** plain static site — HTML + CSS + vanilla JS, **no build step, no dependencies, no
  framework**. Just edit the files. All data lives in the browser (`localStorage`).
- **Deploy:** commit → `git push origin main` → GitHub Pages rebuilds (~1 min). If no build is
  triggered within a few minutes (it happened in session 16 — the push landed but Pages never
  queued a run), force one:
  `gh api -X POST /repos/TimothyHadfield/secret-hitler-companion/pages/builds`. End commit
  messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
  **⚠️ USER PREFERENCE (session 37, standing): commit + push to GitHub IMMEDIATELY after every
  change — don't wait to be asked.** So the flow is: finish a coherent change → test → commit + push
  right away. (Still: land a change only once it's done/tested, and don't force-push. Never push
  anything that risks recorded game data — see `DATA_SAFETY.md`.)
- **The loop for every change:** implement → `node --check js/*.js` → **smoke-test in headless
  Chrome** (recipe below) → commit + push → poll the Pages build until `built` and `curl` the
  live URL for `200` → **update PROGRESS.md + CHAT.md**.
- **Headless-Chrome verification recipe** (this is how everything here was validated — reproduce
  it, don't ask the user to test): copy `index.html`/`styles.css`/`js/*` to the scratchpad dir,
  inject a `<script src="driver.js">` before `</body>`, where `driver.js` drives the *real* UI
  (`document.getElementById(...).click()`, dispatch `change` events) and writes results into a
  `#__smoke` div + the page `<title>`. Serve the folder with a tiny Node `http` server (localhost,
  so `localStorage` works — `file://` breaks on the space in "Code Projects"). Then run
  `chrome --headless --disable-gpu --no-sandbox --virtual-time-budget=9000 --dump-dom <url>` and
  grep the title/results. For visuals use `--screenshot=out.png --window-size=W,H`
  (`--hide-scrollbars`); note headless uses a ~512px CSS viewport, so measure widths rather than
  trusting the image size. To test persistence across "reloads", run two Chrome processes sharing
  `--user-data-dir`. Working examples live in the session scratchpad but the pattern above is
  enough to rebuild them.
- **Testing cloud/account/group features is DIFFERENT — `--virtual-time-budget` does not work
  for them.** Firebase Auth's IndexedDB init never completes under virtual time, so
  `onAuthStateChanged` never fires and the page hangs. Instead drive the page over **real time
  via CDP**: launch `chrome --headless --remote-debugging-port=<port> --user-data-dir=<fresh>`,
  connect with Node 24's built-in `WebSocket` (no dependency), navigate, and poll a result
  `<div>`/`document.title`. Rebuild the ~40-line `cdp.js` driver from this pattern (a copy lives in
  the session scratchpad, which does **not** persist to a new chat). Use a **fresh `--user-data-dir`
  per run** (a stale one throws "Device or resource busy" and IndexedDB keeps the previous session).
  **Preferred approach: inject a mock `window.Cloud`** (an in-memory "remote") so the test drives the
  real app glue but never authenticates or writes to the live project — this is how session 34's
  night-voice sharing was verified. Only sign in / write to the live project as an absolute last
  resort, and then heed the ⚠️ warning below.
- **⚠️ DATA SAFETY IS RULE ZERO — read `DATA_SAFETY.md` first.** The live Firebase project holds
  the user's **real** recorded games; they must never be lost or harmed, not even while the site is
  being updated. The full standing policy is in **`DATA_SAFETY.md`** (session 36). The essentials:
  - **The app / any client CANNOT bulk-delete.** The Firestore client SDK has no "delete a
    collection" call, and `firestore.rules` only lets a game/voice be deleted by its author or the
    group owner, one document at a time (never rewritten). This is a documented invariant in
    `firestore.rules` — don't weaken it.
  - **The only real mass-delete vector is admin/CLI tooling, which bypasses the rules.** So NEVER
    run `firebase firestore:delete --all-collections …` or `… <path> --recursive …`. No task here
    needs them. Don't put them in a script or paste them into docs.
  - **`test/rules.prod.test.js` is HARD-GATED** (session 36): it refuses to run unless
    `SH_PROD_RULES_TEST=i-understand` is set, and its cleanup deletes **only the exact
    `__test_<runId>` docs it created**, per-document, through the rules — no wholesale wipe exists in
    the file (correcting the old note: it never actually wiped all collections, but the risk is now
    designed out). Prefer not running it at all.
- **Verify cloud / rules changes WITHOUT touching the live project.** Drive the real UI with a
  **mock `window.Cloud`** over CDP (see the session-34 night-voice test: an in-memory "remote", no
  auth, no Firestore writes). That exercises all the app-side glue safely. Deploying rules
  (`firebase deploy --only firestore:rules`) is safe — it's config only, no data touched. If you
  ever genuinely must write to the live project, delete ONLY the exact artifacts you created (each
  `claude-*@example.com` account via `purge-users.js` in the scratchpad + the specific doc/group ids
  from that run) and confirm only `timhadfield7@gmail.com` remains — **never a collection-wide
  delete.** Also `Stop-Process` any leftover `--headless` Chrome.
- **Live backend facts + the ~5-min one-time setup a user must do are in `BACKEND_PLAN.md`.**
  Firebase CLI is logged in as `timhadfield7@gmail.com`; deploy rules with
  `firebase deploy --only firestore:rules` (safe — config only). The Firestore emulator will NOT
  start on this machine, which is why `rules.prod.test.js` was written against the live project —
  but it's hard-gated now (see the DATA SAFETY point above and `DATA_SAFETY.md`); prefer the mock-
  Cloud CDP approach and don't run the prod test unless you truly must.
- **Style:** match the existing code (vanilla JS in one IIFE in `app.js`, full-redraw rendering,
  original stylised CSS for the board — never reproduce the real game's printed artwork/logo).

## What this project is
A website for the board game Secret Hitler that started as a **companion/analyzer** (used alongside a
real table game) and is now **also a full online game engine**. Feature pillars:
1. **Randomization** — seat order + first President.
2. **Probability** — for each government, the likelihood the President truly got the hand they
   claim, using a *retrospective* hypergeometric model (updates as the round unfolds).
3. **Game statistics** — per-player + cross-game data, plus a reviewable per-game archive.
4. **Accounts + groups** — live: sign in, sync across devices, share an archive with a group.
5. **Online play** (sessions 40–41) — host a live game for your group; the app deals roles, runs every
   step, and records the finished game. The companion mode (record a physical game) still exists too.

## Current status: ✅ live and working (as of session 42)
- Static site (HTML/CSS/vanilla JS), auto-deployed via **GitHub Pages** on push to `main`.
- All features below verified with headless-Chrome smoke tests + screenshots (no build step).
- **All four pillars are shipped, PLUS full online play.** The backend plan (accounts → cross-device
  sync → groups → guest-linking/invitations) is done and live; nothing there needs the user.
- **🌐 ONLINE PLAY is COMPLETE and live (sessions 40–41)** — the app is now also a real game engine, not
  just a companion. Host a game in a group, players join on their own devices, get secret roles
  privately, and play a full guided game (nominate → vote → legislate → powers → win); the finished
  game records to the group as a normal reviewable game. **Host-authoritative, serverless** (the host's
  browser is the dealer/referee). See the dedicated **ONLINE PLAY** section. The one unproven bit is a
  live multi-account round-trip (rules-enforced; wants a real multi-device game). A **brainstorm of
  online-play improvements** was given in session 41's chat (not yet saved to a doc) — presence/waiting
  indicators, diff'd private writes, guest links, spectators, visual parity with the companion table,
  auto night-narration, and an automated multi-client test were the headline ideas.
- **Data safety is RULE ZERO (session 36) — see `DATA_SAFETY.md`.** Recorded games must never be lost;
  no wholesale Firestore deletes; the destructive prod test is hard-gated; "Clear all statistics" now
  backs up first. Read it before touching anything Firebase.
- **Shipped since session 35 (see the dedicated sections + `CHAT.md`):**
  - **Editable display name** (session 37): change it in the account view; propagates to your profile +
    every group roster seat that is you, so others see the new name.
  - **Rules & Game Theory handbook** (session 38): two searchable, categorized main-menu sections
    (`js/reference.js`) with a **wiki-style community-comments** layer (a global `comments` collection)
    — anyone signed in can attach attributed notes to any rule/strategy item.
  - **Label & favorite recorded games** (session 39): a ★ on each game box floats favorites to the top;
    games can be named; both are per-user, synced via `profiles/{uid}/gameMeta`.
  - **Edit a recorded game's roles** (session 42): author-only correction of a mis-recorded role in the
    review; only `result` changes (the event log stays append-only).
- **Shipped in sessions 28–35 (see the dedicated sections + `CHAT.md` for each):**
  - **Main-menu hub + back-anywhere navigation** (session 30): the app opens on a home menu (title,
    profile, settings, group box, Start game / Statistics cards); Players & Stats have a top-left ←
    that returns to where you came from; finishing/quitting a game returns to the menu.
  - **Chronological game replay** in the Statistics review (session 29): a `⏮ ◀ k/N ▶ ⏭` + arrow-key
    stepper that walks a saved game turn by turn, showing each government + power and the model's live
    P(fascist)/P(liberal) per player; the box stays locked in place while scrubbing (session 32).
  - **Delete a recorded game** (session 31): a Delete button in the review; removes the cloud copy
    first (author/owner only), then the local one.
  - **"In the night" narration** (sessions 33–35): a start-of-game 🌙 button that reads the fascist
    reveal aloud — two scripts auto-picked by player count, device-speech default voices, and
    record/upload your own; custom voices can be **shared with the group** (base64 in Firestore).
- **The honesty + role model is now BUILT and live** (sessions 21–28), behind two settings:
  - **Lie detection** (⚙ Settings, **on by default**): per-claim honesty (hard-logic "can't be
    true" flags + a per-government **fascist %** badge in History), a **role posterior** that infers
    `P(each player is fascist)` and `P(Hitler)` from every signal in the log (claims, enactments,
    conflicts, nominations, investigations, executions, special elections, policy peeks), the
    powers-as-claims lie estimates, and a **Model calibration** panel scoring stored predictions
    against recorded roles. Engine: `js/honesty.js` (+`test/honesty.test.js`, 66 assertions). Theory
    + design review + improvement brainstorm in `HONESTY_MODEL.md`.
  - **Fascist odds on the table** (⚙ Settings, **off by default**): live fascist-% chip on each
    player's circle. Deliberately opt-in — it changes how the table plays.
- **Still open (deliberately):** vote tracking and chancellor-claim capture (both need new in-game
  data entry — a product call), EM parameter fitting (needs game volume; the calibration panel is
  the prerequisite), correlated-fascist modelling. See `HONESTY_MODEL.md` §12 (⏳-tagged).
- **The user periodically wipes the chat and relies entirely on this file + `CHAT.md`.** Keep
  both current after every meaningful change.

## Repository / hosting
- Repo: **https://github.com/TimothyHadfield/secret-hitler-companion** (public).
- Live: **https://timothyhadfield.github.io/secret-hitler-companion/**.
- (Deploy / verification / commit conventions are in the operational brief above.)

## File map
| File | Purpose |
|------|---------|
| `index.html` | App shell. Screens: **main menu** (home hub), **setup**, **game** (Play/History/Stats tabs), **stats**, **rules**, **theory**, **online** (rules+theory share one renderer). Full-screen overlays: chaos, power, game-over, **confirm dialog**, account, settings, **night narration**; plus a **toast**. Loads `engine.js` (classic) + `online.js` (module, after cloud.js). (No separate end screen — role recording is in-place.) |
| `styles.css` | Theme + responsive no-scroll layout, **rectangular table + per-edge seat flow**, boards, role/review panels, games list. |
| `js/probability.js` | Pure probability engine (binomial, hypergeometric, retrospective conditional). Node-tested. |
| `js/stats.js` | localStorage read/write (record / **delete** / clear / **label / favorite**) + **in-depth** per-player / cross-game aggregation (roles, claims, powers, conflicts, things done to a player, game endings). Reads the event model. **`clearAll()` is the only bulk delete; the app wraps it in a backup-first, two-confirm flow (session 36) and it only ever clears the local device.** `setLabel`/`setFavorite` write per-game annotations onto the local record; `orderForDisplay()` floats favorites to the top (session 39). |
| `js/app.js` | Everything else: state, persistence, the `derive()` binding, rendering, powers, role recording, review, wiring, **account UI**. (The rules engine itself now lives in `js/derive.js` — `derive()` here is a thin wrapper that hands it the live `state` + collaborators; session 43.) |
| `js/derive.js` | **The pure rules engine** (session 43, extracted from `app.js`). `Derive.derive(state, deps)` walks `state.events` once and returns all bookkeeping — enacted counts, draw/discard pile, per-round retrospective probs + modifier bounds, presidential rotation (incl. nested special-election detours), deaths, term limits, investigations, veto, chaos, and the opt-in honesty/role reads. NO DOM/global deps — collaborators (`clamp`, `retrospectiveProb`, the two settings predicates, the honesty/role analyzers) are injected via `deps`, so the rules logic is Node-testable. Mutates the passed `state` (writes back auto-adjusted round modifiers + reflects deaths onto `players[i].dead`), exactly as before. Classic script (`window`-scoped `Derive`) + `module.exports`. Node-tested (`test/derive.test.js`, **47 assertions**). |
| `js/cloud.js` | **ES module** (the only one): Firebase auth, cross-device sync, groups, game delete, and **shared night voices** (base64 audio in Firestore). Loads the SDK from a CDN, so still no build step. Talks to the app only via `window.Cloud` + `cloud:*` events. |
| `js/firebase-config.js` | Public Firebase project identifiers. Safe to commit — `firestore.rules` is the security boundary. |
| `firestore.rules` / `firebase.json` / `.firebaserc` / `firestore.indexes.json` | Deployed security rules + Firebase CLI config. |
| `test/` | Dev-only. `honesty.test.js` = 39 assertions, runnable with bare `node test/honesty.test.js` (no deps); it cross-checks the DP against an independently written brute-force enumeration. `night.test.js` = 39 assertions for the narration (script selection, pacing, voice picking, base64↔Blob round-trip, shared-voice caching; the IndexedDB parts run when `fake-indexeddb` — a dev dependency — is present, and are skipped, not failed, otherwise). `rules.prod.test.js` = adversarial assertions against the **deployed** rules (real accounts on the live project). ⚠️ **HARD-GATED (session 36): it refuses to run without `SH_PROD_RULES_TEST=i-understand`, and cleans up ONLY the exact `__test_<runId>` docs it created, per-document, through the rules — no wholesale wipe exists in the file.** (The older warning that its teardown "empties ALL collections" was overstated — every committed version scoped itself to a test group; the gate + per-doc cleanup now design the risk out. See `DATA_SAFETY.md`.) It covers game-delete permissions (§7b: author/owner may delete, other members / non-members may not) and voice permissions (§7c); still, prefer the mock-Cloud CDP approach and don't run it unless you truly must. `rules.test.js` = the emulator variant, kept but unused (the emulator won't start on this machine). `engine.test.js` = **1653 assertions** for the online-play engine (`node test/engine.test.js`, no deps): role deal (team sizes 5–10, per-role night knowledge, determinism) + 60 full simulated games (17-card conservation, term limits, veto, both Hitler wins, public-view privacy). Has its own `package.json`; the site stays dependency-free. `derive.test.js` = **47 assertions** for the pure rules engine `js/derive.js` (`node test/derive.test.js`, no deps): pile counting + reshuffles, presidential rotation (incl. nested special-election resume points), deaths + rotation-skip, term limits (5 vs 7 players), the election tracker, veto, chaos (resets tracker + term limits), investigations, Hitler-elected, state mutation, determinism, and the honesty/role dependency wiring. `fit.test.js` = **18 assertions** for the lie-rate fitter `js/fit.js` (`node test/fit.test.js`, no deps): a **simulation-recovery** check (generate games with known lie rates, EM recovers them within ±0.03), Beta shrinkage, knowing-vs-cautious-Hitler bucketing, responsiveness, determinism, and uncertain-hand (R>0) EM convergence. `reference.test.js` = **28 assertions** for the Game-theory editor's bullet parser (`node test/reference.test.js`): round-trips every bundled category, plus indentation nesting, tabs, `[debated]`, blank/whitespace, and `blankCategory`. |
| `.hintrc` | webhint config — pins the two advisory rules we deliberately don't follow, so warnings stay meaningful. |
| `icon.svg`, `apple-touch-icon.png`, `icon-512.png` | Original logo (round table + gold keyhole + red/blue player dots). Favicon + iOS home-screen icon. |
| `SECRET_HITLER_RULES.md` | Rules the app encodes. |
| `PROBABILITY_MODEL.md` | Math/game-theory derivation of the probability model. |
| `js/engine.js` | **Pure authoritative game engine for online play** (sessions 40–41). NO network/DOM/randomness of its own (callers pass an rng → deterministic/replayable). Full state machine: `initGame` (roles + shuffled 11F/6L deck), `applyAction(state,action,rng)` (nominate/vote/president_play/chancellor_play/veto/powers — pure reducer returning a fresh state or an error), win detection (5L / 6F / Hitler-chancellor / Hitler-executed), `publicView` (leaks no secrets), `privateView` (one player's role + current hand + learned power results), `toRecordedGame` (analyzer-compatible record). Classic script (`window.Engine`) + `module.exports`; Node-tested (`test/engine.test.js`, **1653 assertions** incl. 60 full simulated games). |
| `js/online.js` | **Real-time ONLINE PLAY** (sessions 40–41). ES module (`window.Online` + `online:*` events), loaded AFTER cloud.js and **reuses the same Firebase app**. Host-authoritative: the host's browser runs `engine.js` as dealer/referee. Data under `groups/{gid}/tables/{tid}`: table doc (public projection, host-write), `players/{uid}` (lobby seat, own-write), `private/{uid}` (secrets — only that player reads, host writes), `host/state` (the FULL secret state as a JSON blob — host-only, for reload/resume), `actions/` (each player submits their own move; the host processes them). Host loop: `processActions` drains the queue → `applyAction` → `pushState` (secret + public + every private) → deletes the action; `submitAction` for players; on game over `finishGame` emits `online:finished` → app records it to the group. |
| `js/reference.js` | **Rules + Game Theory content.** `RULES` (session 38) = a category → subcategory → item tree, each item with a **stable `id`** used as the community-comment target (`${kind}:${id}` — never renumber). `STRATEGY` (session 45) = the **user's own game-theory write-up**: a FLAT list of main categories, each with recursive `bullets` (`{t, subs?, wip?}`) — `wip:true` marks the source doc's "red" (debated) items. Rules use the drill-down/search renderer; Game theory uses the simpler `renderTheory()` (categories → a page of bullet/sub-bullet notes + a per-category chat). `flatten`/`search`/`findItem` now cover RULES only. **Pure `serializeBullets`/`parseBullets`** (session 46, nested bullets ⇄ indented text) power the admin editor; **`content/gameTheory` in Firestore is the live source when present**, this bundled `STRATEGY` the fallback. Node-loadable (`module.exports`); tested in `test/reference.test.js`. `RULES` (the drill-down tree) still lives, but only to DERIVE the flat editable `rules` content — the app renders both handbooks from the flat shape now. |
| `js/night.js` | **"In the night" narration** (session 33–34). The two fascist-reveal scripts (5–6 vs 7+) as speakable segments with timed pauses; script selection by player count; device-speech (Web Speech API) playback with natural-voice preference; IndexedDB blob storage for a user's own recorded/uploaded clips; **base64↔Blob helpers + shared-voice caching** for group sync. Classic script exposing `window.Night`; pure parts Node-tested (`test/night.test.js`). |
| `js/honesty.js` | **Lie detection engine** (opt-in). Min-lie hard logic + the per-claim honesty posterior, both on one DP over the round's conservation law; plus `analyzeGame()`, the **role posterior** — P(each player is fascist) AND P(each is Hitler) by exact enumeration of the ≤360 (fascist-set, Hitler) assignments. Consumes claims, enactments, conflicts, **nominations, investigations, executions, special elections, and policy-peek cross-checks**, with **state-dependent push rates**, a **distinct cautious-Hitler** role, and **correlated-fascist card-play** (session 44: coordinated pres/chan push + ally-framing reduction, gated on knowing the ally — factorisation-preserving). Pure functions, Node-tested (73 assertions incl. a from-scratch brute-force mirror). |
| `js/fit.js` | **Lie-rate fitter** (session 44, opt-in). `Fit.fit(samples)` fits the **per-team report lie rates** (`facLie`/`libLie`) from the user's own recorded games by roles-known EM — E-step = the honesty forward–backward DP with roles fixed (reuses Honesty's exported kernels so it can't drift from the model it feeds), M-step = a **Beta-posterior mean** shrunk to the documented defaults (κ pseudo-obs). Deliberately does NOT fit β/γ (confounded without chancellor-claims/votes — §7c). Classic `Fit` global + `module.exports`. Node-tested (`test/fit.test.js`, 18 assertions incl. a **simulation-recovery** check). Surfaced as an opt-in Statistics panel with a fitted-vs-default calibration A/B. |
| `HONESTY_MODEL.md` | Derivation of the honesty posterior ("how likely is this claim a lie?") — hard-logic layer, generative model, exact inference, calibration plan, cited prior art, and **§11: the design review that decided what v1 ships**. |
| `BACKEND_PLAN.md` | **Phases 0–3 shipped:** accounts/groups/shared stats on **Firebase (free Spark plan)** — data model, security rules, sync strategy, free-tier budget, phases, **and the exact console setup steps the user must do**. |
| `DATA_SAFETY.md` | **Rule zero (session 36): keep the user's recorded games safe.** The one real mass-delete vector (admin CLI), the forbidden commands, why the app/rules can't bulk-delete, the hard-gated prod test, and the back-up-first discipline. Read before touching anything Firebase. |
| `CHAT.md` | Session-by-session log (sessions 1–21). |
| `PROGRESS.md` | This file. |

## Architecture notes (how app.js is organised)
- **`state`** is the whole live game. **`derive()`** walks `state.events` once and returns
  all bookkeeping: enacted counts, draw pile, rounds (+ per-round modifier bounds &
  retrospective probs), current President (`presIdx`), suggested Chancellor, `deadSet`,
  `eventsByPlayer`, draw/discard composition. President, deaths, and the special-election detour
  are **derived from the event log** — nothing turn-related is stored, which is why Undo/resume
  "just work". **The engine itself lives in `js/derive.js`** (session 43) as a pure
  `Derive.derive(state, deps)`; the in-app `derive()` is a thin wrapper that injects the
  collaborators (`clamp`, `Prob.retrospectiveProb`, `lieOn`/`rolesOn`, the honesty/role
  analyzers). This is what makes the rules logic Node-testable (`test/derive.test.js`).
- **Event model:** `state.events` is ordered, mixed: `{type:'gov', presidentIdx, chancellorIdx,
  claimLibs, conflict, enacted, vetoed, power?}`, `{type:'fail', presidentIdx}`,
  `{type:'chaos', enacted}`, `{type:'hitler', presidentIdx, chancellorIdx}` (Hitler elected
  Chancellor — terminal, draws no cards). A **vetoed** gov has `enacted:null`, discards all 3
  cards and advances the tracker.
- **`state.form`** only holds transient UI: `{chanIdxOverride, conflictArmed, vetoArmed}`.
- **`renderGame()`** calls the sub-renderers and then `saveActive()`. Rendering is full-redraw.

## Key design decisions (locked)
- **Retrospective probability is the headline %**: each government's odds are conditioned on all
  *other* observed governments in the same round, so they update live. Formula + worked example
  in `PROBABILITY_MODEL.md`.
- **Modifier is ROUND-LEVEL only.** Each hand is taken at its *claimed* value; the round modifier
  `m` shifts the round pool's effective liberal count `effL = startL + m`, repricing every hand
  and setting the inferred bottom cards. `m < 0` = liberals hidden; `m > 0` = rarer "lied up".
- **Modifier bounded + auto-clamped.** Feasible window `effL ∈ [claimSum, claimSum+R]` ∩
  `[0,startN]` ∩ ±(#presidents) cap. If a recorded claim is impossible at the current modifier,
  it **auto-adjusts** into feasibility (may exceed the ±#presidents cap → "auto-adjusted"). The
  physical window is provably non-empty.
- **Deck = 11 Fascist / 6 Liberal (17).** Always follow the real rules; user examples are
  principle, not literal numbers.
- **Term limits are ENFORCED** (the app's first real rule validation). `derive()` returns
  `termLimited`: the last *elected* Chancellor always, plus the last *elected* President **unless
  only 5 players are alive** (`aliveCount > 5` guard — covers a 5-player game and a bigger game
  cut to 5 by executions). A **chaos** top-deck clears both. Termed seats render dashed/dimmed
  (never the sitting President) and tapping one explains why instead of selecting them.
- **Veto is modelled as a gov that enacts nothing.** Armed via the **⊘ Veto** toggle (visible only
  at 5+ fascist policies), it still consumes 3 cards and still prices the President's claim, but
  increments the tracker instead of resetting it and discards 3 instead of 2 (`discardTotal` in
  `derive()` accounts for this). Chaos still fires if the tracker reaches 3.
- **Other enforced rules:** nobody may be **investigated twice** in a game (`derive().investigated`
  filters the prompt); a **nested special election** keeps the *first* resume seat so the rotation
  returns to the original break point; a **Policy Peek from an earlier round** is struck through as
  "(reshuffled)" since a reshuffle invalidates it.
- **No native browser dialogs, ever.** `alert`/`confirm` are replaced by `askConfirm()`
  (in-app `#confirmModal`) and `showToast()`; the ugly "site says…" bar must never appear.
- **Enacted policy is inferred, not asked:** Coal(3F)→Fascist, Bronze(3L)→Liberal,
  Golden/Silver default→Liberal. **Conflict** toggle (Golden/Silver only) forces Fascist and
  labels it "conflict (chancellor)".
- **Round boundary = reshuffle**, done **immediately** when draw pile < 3 (new round + pool shown
  before the next presidency). Probability never crosses a reshuffle. Round pool = `17 − enacted`.
- **Persistence (localStorage):** completed games → `secretHitler.games.v1`; the in-progress game
  auto-saves to `secretHitler.activeGame.v1` and is **resumed on load** (survives refresh /
  close-reopen / redeploy); the setup roster → `secretHitler.setupPlayers.v1`. **The undo stack is a
  SEPARATE key `secretHitler.activeGame.undo.v1`** (session 43) so the frequent per-render save never
  re-serialises its ~25 full-state snapshots; it's written only when the stack changes and read back by
  `loadActive()` (which also still accepts an older stack embedded in the active-game blob). Active game
  cleared only on New Game / after saving (`clearActive()` clears both keys). `loadActive()` backfills
  fields missing from older saves.
- **Every saved game carries a stable `id` (UUID).** Assigned by `Stats.recordGame()` and
  backfilled onto older records by `loadGames()` (writes once, then a no-op). It is the dedupe
  key on import and — deliberately — the idempotency key for the future cloud sync, so a
  retried upload can never insert a game twice. Don't remove it.
- **Cloud sync sits BEHIND localStorage, never in front of it.** `js/cloud.js` is a background
  reconciler: it pushes local games up and pulls remote ones down, writing into the same
  `secretHitler.games.v1` array the app has always used. `app.js` and `stats.js` don't know the
  network exists — which is why the app works fully offline/signed-out and why a sync bug can
  never break a game in progress. **Don't invert this.**
- **Everything is a group.** A solo user gets an auto-created group of one ("My Games"), so there
  is one data model and personal stats *are* group stats. Groups are found via
  `profiles/{uid}.groupIds`, because the rules deny listing `/groups` (ids can't be enumerated).
- **Uploading asks once per account** (`secretHitler.cloud.upload.<uid>` = yes/no). Signing in must
  never silently absorb a shared device's history into whichever account logged in. Downloading
  is always allowed. `askConfirm()` takes an optional `onNo` so dismissing with the back arrow
  leaves the question unanswered rather than recording a choice the user didn't make.
- **Every game's UUID is its Firestore document id**, which makes uploads idempotent — a retried
  or interrupted sync can never insert a game twice.
- **Export / import** (Stats screen, `Stats.exportData()` / `Stats.importData()`): downloads a
  dated `{app, schema, exportedAt, games[]}` envelope, and merges one back **additively and
  idempotently** — games already present (same id) are skipped, so re-importing the same file
  or overlapping archives from two devices is harmless. Import refuses a foreign `app`, a
  `schema` newer than it understands, and any record missing `result`/`events`. This is the
  backup, the device-transfer path, and the payload that seeds a cloud account later.

## Navigation & the main menu (session 30)
- **The app opens on a MAIN MENU (home hub)**, `#menuScreen` — not the players list. It has the big
  **Secret Hitler** title, a **profile/sign-in** chip in the top-left corner and a **⚙ settings** gear
  in the top-right, a **group box** ("This device" / the group name — tap to open the group switcher),
  and five **option boxes**: **Start game** (→ players/setup), **Play online** (→ `#onlineScreen`,
  session 40), **Statistics**, **Rules**, and **Game theory**. The two corner buttons reuse the old top-bar
  `#btnAccount` / `#btnSettings` (the global `#topbar` was removed).
- **Back-anywhere via a nav stack.** `navTo(id)` pushes the current top-level screen and shows the
  new one; the top-left **← on Players/Statistics/Rules/Game theory** calls `navBack()` to return to
  wherever you came from (default: the menu). `NAV_SCREENS = [menu, setup, stats, rules, theory]`; the
  game screen has its own exit so it isn't on the stack. `goHome()` clears the stack and shows the menu.
- **Flow after a game:** recording roles → **`goHome()` (main menu)**, *not* the players list (the
  session-29-era complaint). **Quit game → menu**; **New game (in-game) → players** (quick replay,
  `resetToSetup()` seeds the stack with the menu so its back arrow returns home). Closing a review
  returns to the **Statistics** page it was opened from.
- **Nothing here deletes recorded games.** `goHome()`/`resetToSetup()` only `clearActive()` — the
  in-progress *autosave* — exactly as before. `secretHitler.games.v1` and any synced history are
  untouched. (Verified: a full game recorded from the menu appended one game and preserved the rest.)
- **Menu ⇄ group sync:** `renderAcctChip()` also refreshes the menu's group label, so switching /
  renaming / leaving a group in the account modal updates the box sitting behind it.

## Rules & Game Theory handbook + community notes (session 38; rebuilt s45, admin-editable s46, unified s47)
- **⚙️ BOTH handbooks now share ONE editable implementation (session 47).** Rules used to have its own
  search + category→subcategory→item drill-down renderer (`renderReference`); it now uses the **same flat
  category→bullets model as Game theory**, so the admin can edit it too and it reads consistently. One
  generalized renderer `renderHandbook(kind)` (`kind` = `"theory"` | `"rules"`) + `renderHandbookEditor`
  + `loadHandbookChat`/`paintHandbookChat`, driven by a `HB[kind]` config (mount, screen, Firestore doc
  name, comment-target prefix, bundled fallback) and per-kind `hbState`. `openRules()`/`openTheory()` both
  call `openHandbook(kind)`.
  - **Rules content** (`Reference.rules`) is DERIVED from the authoritative `RULES` tree at load
    (subcategory → a heading bullet, item → a "Title — body" sub-bullet), so `SECRET_HITLER_RULES.md` /
    `RULES` stays the single source; the flat shape is just the render/edit form + offline fallback.
    `content/rules` in Firestore is the live source once the admin edits it (same as `content/gameTheory`).
    The **`content/{docId}` rule already covers it** — no rules redeploy was needed.
  - **"House rules for a better game" MOVED from Game theory to the BOTTOM of Rules** (the user's request):
    it's table conventions, not strategy. Game theory now has 7 categories; Rules has 8 (House rules last).
  - The old `renderReference`/`refBrowser`/per-item-notes code is now **dead but left in place** (never
    called); `RULES` itself is still live (it generates `Reference.rules`). Search over rules was dropped
    with the drill-down model — offer a simple filter back if the user wants it.
  - Verified headless (mock Cloud): admin can Add/Edit/reorder **Rules** sections (edit saved to the
    `rules` content doc); House rules is the last Rules section; Game theory has 7 sections and no House
    rules; **non-admin sees no edit controls on either** but content renders → SMOKE_OK. `reference.test.js`
    round-trips BOTH handbooks' content through the editor parser (28 assertions).
- **🔑 ADMIN-EDITABLE handbooks (session 46).** A single privileged account —
  **`timhadfield7@gmail.com`** — can add / edit / reorder / delete Game-theory sections **live**, and the
  changes are **shared with every visitor**. Content moved from bundled-only into Firestore:
  - **Storage:** `content/gameTheory` = `{strategy:[…], updatedAt, updatedBy}` (the whole `STRATEGY`
    array). `Cloud.getGameTheory()` (public read — works signed-out) / `Cloud.saveGameTheory(strategy)`
    (admin only). The app caches the last content in `localStorage["secretHitler.gameTheory.v1"]` and uses
    **remote-if-present, else the bundled `STRATEGY`** fallback (so it still works offline / before the
    fetch resolves). `refreshGameTheory()` pulls on open + on `cloud:auth`.
  - **The privilege boundary is `firestore.rules`, NOT the client.** `match /content/{docId}`:
    `read: if true`, `write: if isAdmin()` where `isAdmin()` = `request.auth.token.email ==
    'timhadfield7@gmail.com'` (the signed Auth token — unspoofable, and the email is uniquely claimed).
    The app's `isAdmin()`/`Cloud.isAdmin` only decides whether to SHOW the editor; a non-admin who hacks
    the JS still can't write. Rules deployed (config-only, safe). **`isAdmin()` is a reusable admin hook
    for future privileges** — extend it, don't re-invent.
  - **Editor UI** (admin only, on the Game-theory screen): "＋ Add section" on the list + ↑/↓ reorder per
    section; "✎ Edit" on a section page opens an editor (title, blurb, and a **bullets textarea** — one
    bullet per line, 2-space/tab indent = sub-bullet, trailing ` [debated]` = wip). Save persists the
    whole content cloud-first (`commitStrategy` — only commits locally on a successful write, so a rejected
    save can't diverge). `Reference.serializeBullets`/`parseBullets` (pure, round-trip Node-tested in
    `test/reference.test.js`, 19 assertions) convert the nested `bullets` ⇄ the indented text.
  - **Verified** headless with a mock `Cloud`: admin adds a section (nested + `[debated]` bullets parsed
    correctly) → `saveGameTheory` called, list grows, edit prefills + persists; **non-admin sees no
    Add/Edit/reorder** yet content still renders → both SMOKE_OK.
- **⚠️ Game theory was REBUILT in session 45** — it no longer shares the rules renderer. It now shows the
  **user's own strategy write-up** (`STRATEGY` in `reference.js`): a flat list of **main categories**
  (Summary, Vocabulary, General notes, Liberal optimization, Fascist lying & manipulation, Using human
  emotion, Unique scenarios, House rules), each opening a **page of bullet / sub-bullet notes** (recursive
  `bullets`, `wip:true` = the doc's "red"/debated items shown with a `debated` tag). Its own renderer
  `renderTheory()` (categories → page + "← All sections"); **comments are a simpler per-CATEGORY chat**
  behind a 💬 toggle (`loadTheoryChat`/`paintTheoryChat`, target `theory:<catId>`, same Firestore comment
  backend). **Rules are unchanged** (still `renderReference("rule")` with search + drill-down + per-item
  notes). The rest of this section describes the session-38 Rules side.
- **Two main-menu sections**, each its own screen (`#rulesScreen` / `#theoryScreen`). RULES uses
  `renderReference("rule")` (search + category → subcategory → item drill-down); theory uses `renderTheory()`:
  - **Rules** — an authoritative, searchable rules reference ("find any rule, fast").
  - **Game theory** — a curated strategy guide ("strategy & community notes").
- **Content is bundled offline in `js/reference.js`** (`window.Reference`): two trees organised
  **category → subcategory → item ("bullet")**. Each item has a **stable `id`** (e.g.
  `elections.tracker.chaos-resets-limits`); it is the comment target (`${kind}:${id}`) — **never
  renumber an id or existing comments orphan.** Rules mirror `SECRET_HITLER_RULES.md`; keep them in
  sync. Helpers: `flatten`, `search` (multi-word AND over title+body+breadcrumb), `findItem`.
- **Navigation:** a search box at top (filters across everything, precedence over drill-down), else
  drill-down **categories → subcategories → items** with a breadcrumb. Tapping an item expands it to
  its full text + a **Community notes** panel. State per kind in `refBrowser` (`query/catId/subId/
  openItem/notes`); the shell renders once and `renderRefResults(kind)` re-renders on every
  keystroke/click **without rebuilding the search input** (so focus/caret are preserved).
- **Community notes = a wiki layer (the user asked for "like Wikipedia").** Any **signed-in** user can
  read all notes on an item and post their own, shown with the **author's display name** + relative
  time. Stored in a NEW top-level Firestore collection **`comments`** — completely separate from
  games/voices, so it can never touch recorded history. `Cloud.addComment(target,text)` /
  `listComments(target)` (single `where target==` equality, no composite index; sorted client-side) /
  `deleteComment(id)`. Notes are **never edited in place** (delete + repost); **only the author can
  delete their own** (a quick confirm). Signed-out users see a "Sign in to read and add notes" CTA.
- **Rules deployed** (`firestore.rules`, `comments` block): `read: signedIn`, `create` pins
  `authorUid==uid` + caps (`text` ≤1000, `target` ≤200, `authorName` ≤60), `update:false`,
  `delete:` author-only. Per-doc + author-scoped, so **no bulk-delete path** — consistent with the
  DATA-SAFETY invariant. Deploy was config-only (safe).
- **Verified** headless with a mock `window.Cloud` (in-memory comment store — no live project):
  SMOKE_OK. Menu boxes open; searching "term limit top-deck" surfaces the chaos-reset rule with the
  right breadcrumb; expanding shows the body; posting a note shows the author name; deleting removes
  it; drill-down (Elections → 3 subcats → 6 items + breadcrumb) works; Game theory opens with its 7
  categories. Content sanity-checked in Node: 41 rule items, 26 theory items, all ids unique.

## ONLINE PLAY (sessions 40–41 — COMPLETE, fully playable) 🌐
**This reversed the long-standing "online/real-time play is descoped" decision** — the user asked to
build full online play that "makes the site capable of doing anything the real board, cards, and roles
would," recording finished games to a group. Built over two sessions (Phase 1 = lobby/roles/night in
s40; the full game in s41) and now **live end-to-end**.
- **Decisions locked with the user (session 40):** **host-authoritative** (the host's browser is the
  dealer/referee — free, no server, no build step; a host *could* technically cheat like a dishonest
  physical dealer, and must stay connected); **signed-in group members only** (each player needs an
  account so they get their secret role privately; guest links deferred); **discussion happens outside
  the app** (voice/in person — no in-app chat).
- **Why host-authoritative + how secrets stay secret:** there's no server (Spark plan), so one player
  hosts and their client runs `js/engine.js`. The **table doc is PUBLIC** (board, seats, phase — the
  same `events` vocabulary the analyzer uses); each player's **secrets live in `private/{uid}` that
  ONLY they can read and ONLY the host can write** (firestore.rules). That's what hides roles + drawn
  cards without a trusted backend.
- **The payoff:** the live game emits the SAME event log the analyzer consumes, so when a game finishes
  it will **record to the group as a normal reviewable game** — replay, stats, fascist-odds, and
  lie-detection all reuse (later phase). The fascist-odds/lie overlays will use only PUBLIC claims, so
  turning them on can never leak the real cards the engine holds.
- **Data model** (`groups/{gid}/tables/{tid}`): the table doc (host-write, member-read) + subcollections
  `players/{uid}` (each writes own lobby seat), `private/{uid}` (host writes, owner-only read),
  `actions/` (player-submitted move queue — used from Phase 2). Rules deployed; per-doc + host-scoped
  deletes only, so **no bulk-delete path** (respects the DATA-SAFETY invariant — and a finished game is
  a normal `games` doc, so tearing down a table never touches recorded history).
- **ALL FIVE PHASES SHIPPED (session 41) — the game is fully playable online.** **Play online** menu box
  → `#onlineScreen`. Host a game (creates a table in the active group) or join an open one → **lobby**
  (5–10, host-gated Start) → host **deals roles** → **night** (each device privately shows its role +
  owed knowledge) → host **Begins game** → live play, then the finished game **records to the group**.
- **The live game screen** (`renderOnlinePlaying` in app.js) shows, like the companion: the **board**
  (Fascist/Liberal tracks, election-tracker dots, draw/discard counts), the **players** (P/C/nominee/
  termed/dead badges, the last election's Ja/Nein per seat, and — when the **Fascist-odds** setting is
  on — a live fascist-% chip per seat, reusing the analyzer via a briefly-swapped review state so no
  secret leaks), a **History** of past governments, and the player's own **secret panel** (role +
  learned investigations/peeks). The **action panel** shows the current step's controls to whoever must
  act and "waiting for X" to everyone else:
  - **nominate** (President picks a Chancellor, term-limits filtered) → **vote** (each living player Ja/
    Nein on their own device; the tally reveals when all are in; ties fail; tracker/chaos; Hitler-as-
    Chancellor after 3F = instant Fascist win) → **president_play** (President sees the real 3 cards,
    discards 1, and **announces a claimed hand — they may bluff**, which is what feeds the odds/lie
    model) → **chancellor_play** (enact 1 of the 2, or **propose a veto** at 5F) → **veto** (President
    agrees/refuses) → **powers** (investigate / special election / policy peek / execution, each with
    the right private reveal to the President) → repeat until a **win**.
  - On game over the roles are revealed on the table and the host records the game to the group
    (`online:finished` → `Stats.recordGame` + upload); other players pull it on their next sync. Because
    the engine emits the analyzer's event log, the recorded game **replays and scores exactly like a
    companion game** — one shared pipeline.
- **Host resilience:** the full secret state is persisted to `host/state`, so a host page-reload
  reloads it and resumes processing the action queue (`runHostLoop`/`loadHostState`).
- **Verification (session 41):** `test/engine.test.js` = **1653 assertions** — 60 full simulated games
  across all counts (17-card conservation every step, tracker bounds, term limits, veto, both Hitler
  win paths, public-view privacy) + targeted rule checks. A headless **mock-host smoke test** played a
  **complete game through the real app UI** (nominate→vote→draw→discard+claim→enact→board+history update
  →bot-driven to a win→over screen→**recorded to Statistics**): SMOKE_OK. Modules init cleanly against
  live Firebase (Online/submitAction/applyAction present, no errors). **Still NOT automated-tested: the
  real multi-client Firestore round-trip** (several real accounts at once, each reading only its own
  private doc, the host processing remote actions). It's enforced by the deployed rules + the host loop,
  but the gold-standard check is a real multi-device game — best done with friends.
- **Deliberately deferred (polish, not blockers):** in-app chat (chose external voice), host-migration
  if the host leaves mid-game (currently the host must stay; leaving the lobby cancels, and there's an
  End-game teardown), reconnection niceties, spectators, and guest (no-account) joins.

## "In the night" narration (session 33)
- **What it is:** a start-of-game helper that reads the classic fascist-reveal narration aloud so
  nobody at the table has to. Opened from a **🌙 Night button in the in-game tabbar** (next to the ⚙
  gear). It shows only **before the first presidency** (empty event log) — the night phase is a
  start-of-game thing — and is hidden once anything is recorded, and during a review or role-recording
  (session 35). It's a `#nightModal` overlay — the game underneath is untouched.
- **Two scripts, auto-chosen by player count** (`Night.scriptKeyFor`): **5–6 ⇒ "small"** (Hitler opens
  their eyes with the fascists), **7+ ⇒ "large"** (Hitler stays hidden and signals with a raised
  thumb). Scripts live as `Night.SEGMENTS[key]` — speakable lines each with a trailing pause (3s, one
  2.5s for the Hitler thumb; session 35 shortened these from 5s and dropped the "if you're Hitler…" line
  from the small script); the human-readable version with "( pause about 3 seconds )" cues is from the same data
  (`Night.displayScript`) and shown while recording, so a user's pauses match the timed defaults.
- **Default voices = device speech (Web Speech API).** Two built-ins, **Female** and **Male**; the
  engine prefers natural/neural (and networked) voices — on modern Chrome/Edge it picks Microsoft
  *Aria*/*Guy* (Natural), which sound human; on older/offline setups it falls back to whatever local
  voices exist (more robotic). `Night.speak(key, gender, handlers)` speaks each line then waits the
  scripted pause; a `resume()` heartbeat keeps long queues from stalling. No audio files are shipped.
  **(User chose device-speech for the defaults; realistic files can't be generated in this no-build
  setup.)**
- **Bring your own voice:** from the modal, **Record** (MediaRecorder + mic permission, at a modest
  32 kbps so clips stay small) **or Upload** a clip for **each** script, saved under **one name**
  (`Night.createSet` + `putClip`). The game plays the right clip for the player count. Multiple named
  voice sets are supported; each can be deleted.
- **Custom audio: local by default, optionally SHARED with the group (session 34).** Clips live as
  blobs in **IndexedDB** (`secretHitlerNight` DB), metadata in a sibling store, the selected-voice
  preference in `localStorage`. A voice can be **shared with the active group**: since **Firebase
  Storage isn't provisioned** (the session-33 probe 404s the bucket, and provisioning needs a console
  step + likely the Blaze plan `BACKEND_PLAN.md` forbids), the clips are stored **base64 in Firestore**
  instead — `groups/{gid}/voices/{id}` (metadata) + `…/clips/{small|large}` (one doc each, so each gets
  the full ~1 MiB Firestore budget). The app **caps a clip at ~700 KB** raw (≈990 K base64 chars) to
  stay under that limit and rejects/​explains anything larger. `Cloud.uploadVoice/deleteVoice/
  listRemoteVoices/downloadVoiceClips` (in `cloud.js`) move the bytes; `Night.blobToBase64/base64ToBlob`
  (unit-tested) do the encoding. `syncNightVoices()` (app.js) pulls the group's shared voices onto the
  device on sign-in / sync / group-switch / modal-open and caches them in IndexedDB for instant offline
  playback, and drops local caches of group voices deleted remotely. **Ownership mirrors games:** only a
  voice's author (or the group owner) may delete the shared copy; a member can't wipe another's, and a
  voice someone else shared shows no delete button (it would just re-download). Rules deployed with the
  `voices`/`clips` blocks (author-scoped clip writes, size guard).
- **Testing note:** IndexedDB and the Web Speech engine don't work under Chrome's `--virtual-time`
  clock (same class of issue as Firebase's IndexedDB init). The UI + narration sequencing were tested
  headless with a **mocked `speechSynthesis`** (asserting the 7-player game speaks all 5 large-script
  lines in order, and the record view shows both scripts) after shrinking the pauses; the **IndexedDB
  layer** is tested in Node with `fake-indexeddb`. Real voice quality and mic recording need a real
  device — they can't be headless-tested.

## Interaction model (mobile-first, no-scroll)
- **In-game top row:** a **back arrow (←)** at the far upper-left, then Play / History / Stats tabs;
  a **🌙 Night** button + the **⚙** gear + **Quit + New game** on the right (short labels/icons on
  phones). No page title. Footer removed. (The global top bar is gone — its account/settings buttons
  moved to the main menu; the game screen keeps its own `#btnSettingsGame` gear.)
- **Table dominates.** Wide screens: policy controls stacked **vertically on the right**; phones:
  controls **below** the table.
- **Table is a rounded rectangle** (not a circle). Seats sit around its **edges**, placed by
  `computeSeats(n)` in `app.js` (returns `{x,y,edge}` per seat; clockwise order top L→R, right
  T→B, bottom R→L, left B→T so the ring order is preserved). A window `resize` listener re-lays
  the seats when the phone/desktop breakpoint is crossed.
  - **Phones (≤640px):** everyone on the **top & bottom edges only** (`ceil(n/2)` on top, rest on
    bottom) — no side seats. The felt runs nearly full width so the **draw pile hugs the left
    edge and the discard pile hugs the right** (`.center-boards` width 98%, full-size piles).
  - **Wider screens:** `floor(n/4)` seats per edge with leftovers to top then bottom, spread so a
    seat **never lands on a corner** (top/bottom x∈[26,74], side seats y∈[36,64]).
  - **Top-edge seats grow their presidency rows UPWARD** (`edge-top` → `column-reverse` +
    `translate(-50%,-100%)`), so a top player with 2+ presidencies never covers the board;
    bottom/side seats grow downward. Avatar+name are in `.seat-head`, presidency rows in
    `.seat-pres`.
  - **Every seat reserves room for 3 presidencies.** `.seat-pres` has `max-height: var(--pres-slot)`
    (82px desktop / 78px phone) wrapping a `.pres-stack`; `fitPresStacks()` measures each stack
    after render and applies a `scale()` when it is taller **or wider** than the slot — so a 3rd
    presidency (or long detail text on a narrow phone seat) shrinks to fit rather than clipping.
    The board is shifted up and seats pulled clear (desktop TOPY 24% / BOTY 74%; phone bottom
    seats at BOTY 72%, **straddling the felt's bottom edge**) so a full slot always fits.
  - **Consecutive failed presidencies** for a seat share one row of side-by-side ✕✕ (a passed
    presidency between them splits the run onto separate rows above/below the cards). Built in
    `renderTable` by coalescing runs of `fail` in `eventsByPlayer[i]`.
- **Rounds bar placement is breakpoint-dependent** (`placeRoundsBar()` moves the single
  `#roundsBar` node): above the table on phones (short blocks → headroom for the top seats),
  and inside `#roundsSlot` in the **right control column above the ratio buttons** on desktop.
  Each round block is one compact row — `Round N` · inline finished-round bottom cards (no
  "bottom" label) · `− mod +`. The strip auto-scrolls to the current round.
- **Desktop right column is height-budgeted:** the control overrides are `.controls`-scoped (so
  they beat the base `.ratio-*` rules that appear later in the CSS), the rounds strip is capped
  (~116px, scrolls), and the ratio buttons are trimmed so **all four policy options + the round
  boxes + the action buttons fit without scrolling** at common laptop heights. Conflict and Veto
  share one row (`.btn-pair`) so the conditional toggles cost no extra height.
- **President is fixed** each turn (gold **P** badge on the avatar). **Tap a player** to set/move
  the Chancellor (blue **C** badge). No dropdowns.
- **Clicking a ratio auto-submits** the presidency; each ratio button shows the **draw
  probability above it**. Ratios: **Coal (3F) / Golden (2F1L) / Silver (1F2L) / Bronze (3L)** on a
  red→blue scale. Button highlight is blurred after submit so it doesn't carry over.
- **Action buttons** under the ratios: **⚔ Conflict** and **⊘ Veto** (arm toggles, side by side;
  mutually exclusive, Veto only from 5 fascist policies), **Failed presidency**, and
  **⚑ Chancellor was Hitler** (only from 3 fascist policies). Undo is the top-left back arrow.
- **Per-round blocks** (see rounds-bar placement above): "Round N" + its modifier stepper, with a
  finished round's bottom cards shown inline to the right of the title; the next round's block
  appears once a round ends.
- **One back affordance:** a left arrow **`←` in the upper-left, no words**, everywhere — game
  screen (top row), overlay boxes (pinned to the box's top-left), stats screen, and review.
  **Only during play** it also shows the word "undo" (`.backbtn.labeled`) and undoes; in a review
  it closes the review. Managed by `renderBackTop()`; there is no separate Undo/Back button.
- **"Quit game"** (was "End game") asks for confirmation in-app ("All data for this game will be
  erased") and abandons the game — it no longer opens the role questions. Role recording is
  reached **only** from an auto-detected game-over.
- **Page scroll/drag is locked** (`html,body{overflow:hidden}` + `body{position:fixed;inset:0}` +
  `overscroll-behavior:none`); double-tap-zoom disabled. Non-game screens scroll internally.

## Board visuals (original stylised CSS — not the game's printed art)
- **Draw pile (left)** / **Discard pile (right)** = grey face-down card rectangles with F/L counts
  beside them, labels above.
- Enacted policies = **light-grey tiles with a red (fascist) / blue (liberal) border**.
- Empty fascist slots in **Hitler territory (4th+)** are dark red.
- Power **names** ("Investigation / Policy Peek / Kill / Special Election") label the fascist slots,
  in **black** (as are the policy-option button labels) to read against the light fills.
- The centre boards are clamped by `fitCenterBoards()` so they never overlap the felt's top/bottom
  edges on desktop; **phones are exempt** (the board deliberately runs edge-to-edge there).
- **"Veto"** (horizontal, dark pill) on the 5th fascist slot — legible on light or dark.
- Enacted policy **animates** from the acting President's seat to the slot (chaos from the pile).
- Election tracker = 3 dots.

## Presidential powers (fascist track, by player count — see SECRET_HITLER_RULES.md)
When a Fascist policy lands on a powered slot the game **pauses with a full-screen overlay**:
- **Investigation** — pick who + party → recorded beside that president ("🔍 name, Fascist/Liberal").
- **Policy Peek** — 3 tap-to-toggle cards (Top/Middle/Bottom) set to the claimed order.
- **Kill** — pick who + whether Hitler. Hitler ⇒ **Liberals win** (game-over). Else the player gets
  a 💀, is skipped in all future elections, and can't be Chancellor.
- **Special Election** — pick the next President; normal rotation resumes after their turn.
Every overlay (power / chaos / game-over) has the **← back arrow** pinned to its top-left, which
reverts the presidency that triggered it. Powers block play until resolved.
**Rule details:** a player may **not be investigated twice** in a game (already-investigated seats
are removed from the prompt); a **nested Special Election** keeps the *first* resume seat; a
**Policy Peek** from an earlier round is struck through as "(reshuffled)".

## Game end + role recording (in-place)
- **Auto-detected wins:** 5 Liberal policies → Liberal; 6 Fascist policies → Fascist; Hitler
  executed → Liberal. Plus one **declared** win: **⚑ Chancellor was Hitler** (available from 3
  fascist policies) → Fascist, which also pre-fills that seat as Hitler for role recording.
  Each pops a **full-screen game-over box** (who won + how) that blocks play.
- **"Record roles →"** (from the game-over box, however the game ended) switches the
  controls area into a **role panel while the table stays visible**: pick **Hitler + the exact #
  Fascists** (1 in 5–6, 2 in 7–8, 3 in 9–10); a player can't be both; **no "who won" question**
  (the winner is always known, since role recording is only ever reached from a game-over).
  Selecting recolors the circles live: **black = Hitler, red = Fascist, blue = Liberal**. Save →
  records the game to statistics, then returns to the **main menu** (session 30; was the players list).

## Statistics + game review
- **One renderer, two mounts:** `renderStatsInto(container)` builds the whole section into
  `#statsBody` (standalone screen) or `#statsBodyInline` (in-game Stats tab). Both scroll.
  Sections, in order: **Overview** tiles → **Claimed hands** → **Game totals** → **How games
  ended** → **Players** → **All games**.
- **Depth lives in `js/stats.js`.** `summary()` returns cross-game totals (governments, fails,
  policies L/F, claim distribution, conflicts, **vetoes**, chaos top-decks, investigations, peeks,
  executions, special elections, Hitler executed, averages) plus `endings` — inferred per game by
  `endingOf()` (Hitler elected Chancellor / Hitler executed / 6 Fascist / 5 Liberal / other).
  `playerStats()` returns, per player: role counts (**Liberal / Fascist / Hitler are mutually
  exclusive and sum to games**) + win rate by team, claimed hands as President, powers wielded
  (investigations/peeks/executions/special elections), conflicts **and vetoes** split by seat,
  policies enacted as Chancellor, presidencies/chancellorships/failed elections, and things done
  *to* them (times executed / investigated / special-elected).
- **Footer buttons on the standalone stats screen:** **Export data** / **Import data** /
  **Clear all statistics** (a `.row`, which wraps on narrow phones). Import goes through a
  hidden `#importFile` input; both report via `showToast()`, never a native dialog.
- **Kept compact:** players are **collapsed rows** (name · games · win% · role split) that expand
  to the full breakdown, and numbers use a capped label→value grid (single full-width column on
  phones). Scrolling within the section is expected and fine.
- **Charting rule:** the claim distribution uses **single-series magnitude bars** in one accent
  (`#b3852f`, validated in-band/chroma/contrast on the dark surface) with every row directly
  labelled — identity never comes from colour. A 4-colour stacked bar was rejected: the app's
  red→blue claim ramp fails the normal-vision separation floor (ΔE 10 < 15) and its middle steps
  read as gray (chroma 0.04–0.07).
- **All-games list:** each game is a **winner-coloured box** (Hitler on top, Fascists beside).
  Clicking opens a **read-only review**: that game's coloured table + every presidency's
  cards/odds/details, with a **stats panel** (policies, governments, fails, Hitler/Fascists) where
  the policy options normally sit. Leave via the shared **top-left ← arrow** (the review has no
  button of its own). Reviewing stashes the live game and restores it on the way out; review state
  never overwrites the saved active game.
- **Chronological replay inside the review (session 29).** The review panel carries a **stepper**
  (`⏮ ◀ k / N ▶ ⏭`, plus **← / → arrow keys**) that walks the game turn by turn. It works by
  truncating `state.events` to step *k* and re-rendering — everything is derived, so the whole board
  rewinds for free (`reviewGoto()` / `_reviewEvents` / `reviewStep` / `playback` in `app.js`). Each
  step shows a **caption** (round, `Pres P → Chan C`, ratio claimed, policy enacted, any power) and,
  while short of the end, **hides the true roles** and shows the model's **live P(fascist)/P(liberal)
  per player** (sorted, with a `♛` Hitler flag) both as a panel list and as seat chips + P/C badges.
  The **final step is the unchanged reveal** (role colours + who won + stored odds scored ✓/✗). The
  live odds run **regardless of the two settings switches** during a playback (`rolesOn()` honours it),
  since the whole point is to watch them evolve. Opens at the end so the plain "who won" review is
  unchanged; step back to replay.
- **Stepper stays put while scrubbing (session 32).** On desktop the rounds strip is a vertical
  column directly above the playback controls, so stepping back — which removes later rounds' blocks —
  used to shrink the strip and slide the `◀ ▶` box under the cursor (miserable when clicking fast).
  `lockReviewRoundsBar()` (called from `placeRoundsBar`) now **pins the strip to the full game's
  height during a review** — measured once at the full step via `clientHeight` (which already respects
  the CSS `max-height:116px`) and stored on `state._roundsReserve`, then applied as a `min-height` on
  every step. Round blocks still disappear as you step back, but the box beneath never moves; the
  varying-length step caption sits *below* the box so it can't shift it either. Cleared outside a
  review (normal play unchanged) and on phones (the strip is horizontal there, so its height is already
  constant). Verified: box top constant to <1px across all 9 steps while block count went 1↔2 and
  caption length ranged 41–76 chars.
- **Labels & favorites on recorded games (session 39).** Each game in the **All games** list carries a
  **★ star** (top-left of its box) that toggles a **favorite**, and **favorites float to the top** of the
  list (`Stats.orderForDisplay()` — a stable partition, favorites first, everything else in its prior
  order). A game can also be given a **label** (name), shown on its box and in the review. Both are set
  from the star (favorite) and from the **review panel** (☆ Favorite / Add a label / Rename, next to
  Delete game). `Stats.setFavorite(id,bool)` / `Stats.setLabel(id,str≤60)` mutate the **full** array
  (`loadAllGames`+`saveGames`, like `deleteGame`) and store `favorite`/`label` **on the local game
  record** — they are mutable annotations, NOT part of the append-only history.
  - **Personal + cross-device, without touching the immutable game doc.** Because the games rule is
    `update:if false`, labels/favorites can't live on the game doc (and favorites are inherently
    per-user anyway). They mirror to **`profiles/{uid}/gameMeta/{gameId}`** = `{label, favorite}` —
    fully private (rules: read/write only by the owner, sizes capped), separate from games, so history
    is never rewritten and there's no bulk-delete path. `app.setGameMeta(id,patch)` writes locally +
    calls `Cloud.setGameMeta`; `sync()` pulls all gameMeta and applies it onto local games (remote
    wins). Works fully offline/signed-out (local only). **Limitation:** a label/favorite changed while
    offline may not reach the cloud until changed again online (metadata push is best-effort).
  - **The games list is now id-based, not index-based.** `openReview(id)` finds the game by `id` (was
    an array index), so reordering favorites to the top can't misroute a click. The list box is a
    `div[role=button]` (a nested `<button>` star would be invalid HTML); the star `stopPropagation`s so
    it never opens the review. Verified headless (mock Cloud): star floats a game to top + calls
    setGameMeta without opening the review; review Fav/Label buttons work; label + favorite render on
    the box and persist.
- **Editing a recorded game's roles (session 42).** A review-panel **Edit roles** button (shown only to
  the game's author) reopens the end-of-game role picker (Hitler + the count-appropriate Fascists + who
  won) prefilled from the stored `result`, recolouring the table live as you pick. Save writes the new
  `result` **locally** (`Stats.setResult`) and, for a synced game, **to the cloud** (`Cloud.updateGameResult`,
  cloud-first so a failure aborts rather than diverges). **Only the recorded ROLES/winner change — the
  event LOG is never rewritten** (that's what everyone saw).
  - **Rules relaxed, tightly (deployed):** the games rule was `update: if false`; now the **author**
    (`createdBy == uid()`) may update, but `request.resource.data.diff(resource.data).affectedKeys().
    hasOnly(['result'])` pins everything except `result`. This is a deliberate, bounded exception to the
    append-only invariant — the game log stays immutable, only the author's own role annotation is
    correctable. (Consistent with the author/owner delete added in s31.)
  - **Author is known via `game.createdBy`:** stamped **at record time** (companion `saveRoles` + the
    `online:finished` handler set it to the signed-in uid, so a new game is editable by its recorder
    immediately); `fromCloud` also carries it; sync backfills it onto existing local copies + stamps it
    on my games at upload; a corrected `result` **propagates on sync** (the remote result is applied onto
    already-downloaded copies, so group members see the fix). `canEditReviewedGame`: signed-out → mine;
    known author → only them; **author UNKNOWN (older/pre-sync game) → allowed** (safe — the rules still
    reject a non-author's cloud write, and save is cloud-first). Verified headless: edit persists +
    recolours, events unchanged, button hidden for another member's game / shown + cloud-writing for mine.
  - **Gotcha for a fresh chat:** if a user says the Edit button is missing, it's almost always **browser
    cache** (GitHub Pages already has it) — tell them to hard-refresh — or an old game with no local
    `createdBy` yet (resolves after the sign-in sync backfills it). The permissive fallback above means
    it should show regardless now.
- **Deleting a recorded game (session 31).** The review panel has a **Delete game** button (outlined
  danger, bottom of the panel, step-independent). It confirms first (`deleteReviewedGame()`), then —
  crucially in this order — removes the **cloud copy first** so a later sync can't resurrect it, and
  only then the **local copy**, before returning to the Statistics list. A failed cloud delete aborts
  the whole thing (the game stays intact everywhere rather than half-removed).
  - `Stats.deleteGame(id)` splices the game out of the **full** array (never a scoped view) and writes
    the rest back. `Cloud.deleteGame(id, gid)` `deleteDoc`s `groups/{gid}/games/{id}` **only when the
    id is in the synced set** (a purely-local game just clears its synced bookkeeping; offline aborts).
  - **Rules changed + deployed:** the games rule was `update, delete: if false` (append-only). Now
    `update: if false` still (history is never rewritten) but **`delete`** is allowed for the game's
    **author (`createdBy`) or the group owner** — so a member can remove their own mis-record and an
    owner can moderate, but nobody can wipe another member's games. `firestore.rules` deployed to the
    live project; `test/rules.prod.test.js` updated to match (§3 now edit-only, new **§7b** covers
    author/owner/other-member/non-member delete) — **NOT run**, because its teardown wipes the whole
    live DB, which would destroy real recorded history. Deleting a synced game removes it for the whole
    group; the confirm dialog says so when signed in.

## Lie detection (session 21 — ON by default, one switch to disable)
- **A ⚙ Settings panel holds one switch: **Lie detection**, **on by default**. A stored choice
  either way is respected, so turning it off sticks across reloads. With it off the analysis is
  never run and nothing new renders — every added element carries `.lie-col`, which CSS shows only
  under `body.lie-on`. Stored in `secretHitler.settings.v1` (`{lieDetection:bool}`; absent ⇒ on).
- **The gear is in TWO places** because the global top bar is hidden during a game: `#btnSettings`
  in `#topbar` (setup/stats screens) and `#btnSettingsGame` in the in-game tab bar. Both call
  `openSettings()`.
- **The History "Event" cell carries an inline badge** (`lieBadge()`), NOT a trailing column — the
  History table scrolls horizontally on phones, so a far-right column (like the pre-existing Odds
  one) sits off-screen. The badge shows the **President's fascist odds** ("82% fascist", coloured
  hi/mid/lo), plus a red **"claim can't be true" / "story impossible"** flag when the round's cards
  make that government's claim provably false. (It used to show "% honest"; the user asked for
  fascist odds instead — the per-claim honesty still drives the hard flags and the summary bar.)
  A full-width **summary bar** (`#lieSummary`) above the table carries the round-level notes
  (min-lies, the early-round "too many cards unseen" caveat). Note the fascist % is game-level, so
  the same President reads the same number on each of their rows.
- **Powers are claims too (session 27).** Investigation and Policy Peek are the president privately
  seeing something and announcing it, so each has a lie estimate shown in History (`powerLieChip`):
  - **Investigation** — the president announces a target's party. `P(claim is a lie) = P(target's
    true party ≠ announced)`, which is just the target's fascist odds read the right way round
    (announced Fascist ⇒ lie iff target is Liberal). Already feeds the role model via
    `investigationFactor` (a liberal investigator's report is near-truth).
  - **Policy Peek** — the peeked top-3 cards are exactly what the NEXT government draws, so the peek
    is modelled *inside the role DP* as the peeker **reporting that hand** (same lie model as a
    normal claim, using the peeker's rate) — a peek contradicted by the drawn hand pushes the
    peeker's fascist odds up. This replaced the older agreement-only `peekChecks` factor.
  - **Peek scored even before/without a next hand (session 28 fix).** If no government has drawn the
    peeked cards yet — the live case, and the reshuffled case — the peek is added to its round as a
    **phantom "hand"** (`phantom:true`, a vetoed pseudo-government reported by the peeker that
    consumes 3 cards), so the round's **conservation law catches an impossible claim immediately**:
    peeking "3 liberals" from a pool that holds only 2 jumps the peeker to ~0.84 fascist the moment
    it's recorded, instead of doing nothing until the next hand. `analyzeRoles` classifies each
    peek: next-gov-in-same-round ⇒ attach; otherwise ⇒ phantom. The History lie chip mirrors this —
    checked against the drawn hand when available, else against the round pool by conservation
    (`retrospectiveProb` with the peek appended). Phantom govs are skipped by the nomination factor.
- **Two layers on one dynamic program.** The round's conservation law
  (`Σ hands + chaosLibs + leftovers = pool liberals`) is walked once as a **min-plus** semiring to
  get the *fewest claims that must be false*, and once as **sum-product** to get
  `P(this claim was true)`. Sharing the recursion is why the "proven" and "probable" layers can
  never disagree about what's feasible.
- **`R` (the unseen remainder) is the honest measure of how much any of it is worth.** `R = 0`
  pins every hand exactly; early in a round `R` is large and the numbers mean little — the History
  panel says so rather than showing a confident percentage.
- **Wording rule (load-bearing):** findings are about **claims**, never people — "can't be true",
  not "X lied" — and always allow for a recording error. A forgotten Conflict tap manufactures a
  contradiction, and the app must not accuse someone at a real table on the strength of a mis-tap.
- **The one contradiction the current data model can express:** a claimed **1F2L hand + Conflict**
  says "I passed two liberals" while a fascist policy was enacted — impossible, since a chancellor
  can't enact a card they were never handed. (2F1L + Conflict is perfectly possible: pass = LF.)
- **Fixed a real bug on the way in:** chaos top-decks were never subtracted from the round's unseen
  remainder, so `R` was too big, the known colour of the chaos card was discarded, and
  `bottomLibs` disagreed with `drawLibs`. This corrupted the existing retrospective % in any round
  containing a chaos — fixed in `probability.js` + `derive()` regardless of the switch.
- **Role posterior — P(each player is fascist), session 23.** `Honesty.analyzeGame()` enumerates
  every assignment of `f = ceil(n/2)−1` fascists to the `n` players (≤120), scores each by how
  well it explains all claims/enactments/conflicts (team-conditioned weights on the same
  round-conservation DP: fascist president buries a liberal at rate `β`, fascist chancellor enacts
  fascist from a mixed pass at rate `γ`, fascists lie more), pins certain fascists (Hitler elected
  or executed), and marginalises to per-seat `P(fascist)`. Exact, no sampling.
  - **Stored on every recorded game** as `game.roleOdds` (via `computeRoleOdds()`, computed
    unconditionally so the snapshot is permanent even if the switch is off). It sits beside the
    recorded true roles — prediction next to ground truth, which is the calibration substrate.
  - **Displayed in the read-only game review** (`roleOddsHtml()`), as a ranked bar list scored
    ✓/✗ against who was actually fascist.
  - **A second, separate setting "Fascist odds on the table"** (`settings.boardOdds`, off by
    default) shows a live fascist-% chip beside every player's circle during play (`.seat-odds`,
    coloured hi/mid/lo). This is the shared-table readout that §10.4 flags as game-changing, so it
    is strictly opt-in and independent of lie detection — `rolesOn()` computes `roleOdds` when
    EITHER setting is on. The chip is hidden once roles are recorded (the circle is coloured then).
  - Parameters are fixed defaults, not fitted — EM calibration still deferred (too few games).
    See §11 update + the brainstorm in `HONESTY_MODEL.md` §12 for how to improve the odds.
- **Role model improvements (session 25) — Tiers 1–2 of the §12 brainstorm, all shipped.** The
  role posterior now consumes every signal already in the event log, not just claim+enact+conflict:
  - **Nominations** (a fascist who knows allies nominates one preferentially), **investigations**
    (a liberal investigator's report is near-truth → a strong constraint), **executions** (fascists
    avoid killing allies), **special elections** (fascists elevate allies), and **policy-peek vs.
    next-hand** cross-checks (disagreement implicates the peeker + next president).
  - **State-dependent push rates:** β/γ rise as fascist policies pile up / liberals near a win, so
    a *forced* early fascist policy no longer implicates as hard as a late pushed one.
  - **Hitler is a distinct cautious role in 7+ games** (blind to the fascists, plays liberal-safe),
    fixing the systematic under-detection of a well-played Hitler; the engine now also outputs
    **`P(Hitler)` per seat**, stored as `game.roleHitler`.
  - **Hard Hitler deductions** feed in: a chancellor seated past 3F (game continued) and an
    executed non-Hitler are pinned as *not Hitler*; an elected/executed Hitler is pinned exactly.
  - Exact throughout (≤360 assignments × the round DP); the from-scratch brute-force test mirrors
    every factor (max diff < 1e-9).
- **Calibration harness (session 25) — §12.10, shipped.** A **Model calibration** panel on the
  Statistics screen (gated by lie detection) scores the stored `roleOdds` against the recorded true
  roles across every game: **Brier skill vs the base rate**, **top-f suspect accuracy**, and a
  **reliability breakdown** (of the seats it called each bin, how many were actually fascist).
  Needs ≥3 recorded games; tells you — from your own games — whether the model beats guessing.

## Undo
- **Full-state snapshots.** `pushUndo()` deep-copies the whole state before each gov / fail /
  chaos; `undoLast()` restores it exactly (events, round modifiers, powers, deaths, game-over,
  turn order). Fixes the old "modifier only reverts by 1" bug. Modifier stepper adjustments are
  not separate undo steps (freely reversible with −/+).

## Known limitations / not yet done
- **The night narration's default voices are only as good as the device** (Web Speech API) — great on
  modern Chrome/Edge, robotic on older/offline setups. **Custom voices can be shared with a group**
  (base64 in Firestore, session 34) but each clip must be **under ~700 KB** (Firestore's 1 MiB/doc
  limit) — recordings fit easily; long uploaded files are rejected with an explanation. Real voice
  quality + mic recording can't be headless-tested (the share/sync glue is CDP-tested with a mock
  Cloud; the Firestore calls themselves are covered only by the deployed rules + unrun rules test).
- **No way to evict a member who has an account** — you can remove guest seats and leave a group
  yourself, but not remove another account holder. Closing the group stops new joins.
- **A COMPANION-mode in-progress game doesn't sync** (only completed/recorded ones). Online play IS
  real-time and fully synced — this limitation is about the physical-companion recorder only. (Online
  play superseded the old "real-time is descoped" note.)
- **Online play — the live multi-client round-trip isn't automated-tested** (rules-enforced + host-loop
  tested; wants a real multi-account game). Host must stay connected; no host-migration/guest-joins/chat
  yet (all deliberately deferred — see the ONLINE PLAY section + the session-41 improvements brainstorm).
- Google sign-in is wired but **only verified manually** — it needs a browser OAuth round-trip, so
  the automated tests cover email/password only.
- **Votes aren't tracked in COMPANION mode** (Ja/Nein counts, ties, dead players not voting) — the table
  tells the app the outcome. (Online play DOES run real per-device voting.)
- The app records what the table *tells* it (claims, conflicts, vetoes, power outcomes); it can't
  *know* a lie, only estimate its probability (which the lie-detection model now does — see above).
- The role model's **behaviour** parameters (β/γ) are **fixed defaults, not fitted** (confounded without
  chancellor-claims/votes — §7c). The **report lie rates** ARE now fittable from the user's own games
  (session 44, `js/fit.js`, opt-in) — see the EM bullet under "Next candidate steps".

## Next candidate steps
- **The backend plan is COMPLETE** (phases 0–3 shipped and live): accounts, cross-device
  sync, groups, invite links, invitations by person, guest-seat linking and revocable invites.
- **ONLINE PLAY is COMPLETE (sessions 40–41).** The obvious next work is the session-41 **improvements
  brainstorm** (not yet saved to a doc — it's in that chat only): presence + "waiting on whom" +
  host-alive indicator; diff'd/batched private writes (perf); guest joins via link (anonymous auth);
  spectators + non-playing referee host; visual parity with the companion table; auto night-narration in
  the online night phase; chancellor-claim capture; and an **automated multi-client integration test**
  (the one real coverage gap). If asked to improve online play, offer to save that brainstorm as
  `ONLINE_PLAY.md` first.
- **Honesty + role model — SHIPPED and iterated (sessions 21–28).** The full picture (per-claim
  honesty, `P(fascist)`/`P(Hitler)` role posterior fed by every logged signal, powers-as-claims,
  calibration harness) is in the **"Current status"** section above and detailed in the lie-detection
  sections below + `HONESTY_MODEL.md`. What's still open is only the ⏳ items:
  - **Vote tracking** (asked, undecided): a Ja/Nein *count* per election is one extra tap-pair and
    gets most of the analytical value; per-player votes tax every election. Needs a product call.
  - **Chancellor-claim capture** — the highest-value *new* input (breaks the β/λ confound); one
    extra tap per government, so also a product call.
  - **EM parameter fitting — the identifiable half SHIPPED (session 44, `js/fit.js`).** The per-team
    **report lie rates** (`facLie`/`libLie`) are now fittable from the user's own games (roles-known EM,
    Beta-shrunk to the defaults), opt-in on the Statistics screen with a fitted-vs-default calibration
    A/B. β/γ are deliberately left at defaults (confounded without chancellor-claims/votes — §7c, data the
    user chose not to capture). ⏳ still open: **per-player** lie tendencies (§7b, same machinery keyed by
    seat) once the per-group archive is larger.
  - **Correlated-fascist modelling** (fascists coordinate stories/votes) — costs the DP's clean
    factorisation; deferred.
  - Long-noted goal: this eventually retires the round-modifier stepper (a hand-set point estimate
    of what the posterior integrates out).
- **Reliability:** `lsSet()` surfaces quota errors and the undo stack is capped (session 19).
  **FIXED (session 43): the undo stack no longer weighs down the per-render save.** It moved out of
  the active-game blob into its own key (`secretHitler.activeGame.undo.v1`) and is written only when
  it changes (`pushUndo`/`undoLast` call `saveUndo()`), so `saveActive()` re-serialises just the live
  state — no more re-serialising ~25 full snapshots on every render (was O(n²) in a long game). Undo
  still survives a refresh; `loadActive()` reads the new key and still accepts an older embedded stack.
- **Tests:** **DONE (session 43): `derive()` is extracted to `js/derive.js` and Node-tested**
  (`test/derive.test.js`, 47 assertions — term limits, veto, nested special elections, reshuffles,
  rotation, deaths, tracker/chaos, pile counts, plus the honesty/role dependency wiring).
  `js/stats.js` and `js/honesty.js`/`js/probability.js` were already Node-tested.
- **Accessibility — first pass DONE (session 44).** Player **seats are now keyboard-operable**: when a
  tap would act (live play, not the sitting President, not dead) a seat becomes `role="button"`,
  `tabindex="0"`, Enter/Space sets the Chancellor; every seat carries an **`aria-label`** narrating its
  state (President/Chancellor/term-limited/executed + the live fascist-% when that setting is on), so a
  screen-reader gets the same read as the badges/colours. **All overlays are proper modal dialogs**
  (`role="dialog"` + `aria-modal`), handled centrally by `initA11y()`: on open it moves focus inside,
  **traps Tab**, **Esc closes** (clicks the box's back arrow), and **restores focus** to the trigger on
  close — no per-call-site retrofit (a `MutationObserver` per `.overlay` drives it). Toast + the in-game
  hint are **`aria-live` regions**. Visible **`:focus-visible`** rings restored in CSS (several controls
  had `outline:none`). Still open: `aria-*` on the History table / stats bars, and a full audit.
- Further statistics ideas: favourite chancellor pairings, per-round trends.

## Groups (phase 2 — live)
- **A group is the unit of sharing.** Create one, invite people with a link, and every member
  reads and contributes to the same archive. A solo user still has an auto-created "My Games"
  group, so there is exactly one data model.
- **Display name is editable and self-propagating (session 37).** The signed-in account view shows
  your display name prominently (email as a subtitle) with a **Change name** button; Google/email
  sign-ups that never set one show "No display name yet". `Cloud.setDisplayName(name)` updates (1)
  the Firebase Auth profile, (2) `profiles/{uid}.displayName`, and (3) **every roster seat that is
  you (`uid===me`) in every group you're in** — so the new name reaches everyone sharing your groups
  on their next read/sync. Allowed by the existing members rule (changing `displayName` with `uid`
  unchanged is a permitted edit — no rules change). It emits `cloud:auth` + `cloud:groups`, so the
  chip, menu, account view, and setup roster all refresh live. Historical games keep the free-typed
  name played at the table (a snapshot, not identity), so they are deliberately not rewritten.
- **Invite links are `?join=<groupId>`.** `cloud.js` captures the id on load *before* sign-in
  (a visitor usually has no account yet), strips it from the URL so a refresh or a shared
  screenshot can't re-trigger, and joins once an account exists. The security rules let a
  non-member append **only their own uid** with every other field pinned — that is what
  replaces the Cloud Function this would otherwise need.
- **Seats are resolved at UPLOAD time, not when a game is recorded.** Free-typed names stay
  free-typed at the table (recording never needs the network); when the game syncs, each name is
  matched to a roster member case-insensitively, creating one if it's new. Names are stored
  alongside seat ids so a game still reads correctly if the roster is unavailable.
- **Guests are first-class.** A roster member has a nullable `uid`: someone who has never signed
  in is just a member without one. Phase 3 links them by setting that field.
- **Stats are scoped to the active group.** `Stats.setScope()` filters what statistics describe;
  **`Stats.loadAllGames()` is the raw list and every WRITE must use it** — saving a filtered view
  would delete other groups' games. Signed out, scope is null (everything on this device).
  Games with no `groupId` stay visible so a freshly recorded game never vanishes while it waits
  to upload.
- **`withRetry()` guards reads that follow a join.** Immediately after joining, the rules engine
  can still evaluate `isMember` against a pre-join view of the group and refuse a read that is
  about to be allowed (observed: games recovered in ~5s, the roster took longer). Reads retry on
  `permission-denied` with backoff, and seating a new member on the roster is best-effort —
  deferred to the next sync rather than failing the whole join.

## Correcting history (session 19)
- **Every history row has a ✎ button** opening an in-app editor: change a government's claimed
  hand, toggle Conflict/Veto, flip a chaos policy, or **delete the entry entirely**. Undo only
  ever stepped back from the end, so a mis-tap noticed three governments later used to mean
  unwinding the whole game.
- **It works because everything is derived.** Editing is "mutate the event, re-derive" — the
  board, piles, rotation, term limits and probabilities all recompute for free.
- **What is NOT derived must be rebuilt by hand**, and `afterHistoryEdit()` does it: pending
  power and pending chaos are cleared, `gameOver`/`autoResult` are recomputed (an executed
  Hitler or an elected Hitler still ends the game), and a power attached to a government that no
  longer enacts Fascist is stripped, since the policy that granted it is gone.
- Edits go through `pushUndo()`, so a bad correction is itself undoable.

## Reliability fixes (session 19)
- **`lsSet()` no longer swallows quota errors.** A full localStorage used to fail silently, so
  the game simply stopped persisting and the next refresh lost it. It now warns once, pointing
  at Export.
- **The undo stack is capped at 25** (`UNDO_LIMIT`). Each entry is a full-state snapshot and
  `saveActive()` re-serialises the whole stack on every render, so an uncapped stack grew O(n²)
  and could exhaust storage in a long game.

## Phase 3 + security hardening (session 20 — live)
- **Guest linking.** A roster seat has a nullable `uid`; in Members, a guest seat offers
  **"That's me"**. Claiming it makes every game that person played under that name theirs.
  This is the payoff of separating *user* from *seat* back in the data model.
- **Invitations by person, not a friend graph.** `profiles/{uid}/invites/{groupId}` is an inbox:
  anyone signed in may drop an invite in it, only the recipient can read or clear it, and the
  invite **carries no access by itself** — accepting is an ordinary invite-join, so a closed
  group still can't be entered. "People you've played with" is computed from members of your own
  groups who have accounts. **No requests, no accept/decline state, nothing to keep in sync** —
  this deliberately replaces the friend graph the plan originally sketched.
- **Invite links are revocable.** `joinOpen` on the group; the invite dialog toggles
  "Stop / Allow new members". Absent on older groups, so rules read it as
  `resource.data.get('joinOpen', true)`.
- **Roster removal** for guests (a seat with an account can't be silently deleted out from
  under its owner).

### Rules hardening (all adversarially tested — 49 assertions)
- **Profiles can no longer be listed.** `allow read` covered `list`, so any signed-in user could
  enumerate every account on the service and read their display names. Now `get` only.
- **The account link on a seat is protected.** Members may edit roster entries, but `uid` may
  only be set to *your own*, only on a seat nobody has claimed, and only released by its owner.
  Without this any member could hand another member's identity to themselves.
- **A joiner can't re-open a closed group** to let themselves in (`joinOpen` is pinned in the
  join branch, exactly like name/owner/inviteCode).
