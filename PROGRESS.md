# PROGRESS — Secret Hitler Companion

> **This file is the complete brief — you need no other context to work on this project.**
> The user will only say "catch up on PROGRESS.md". Read it top to bottom, then start.
> `CHAT.md` = session-by-session history; `PROBABILITY_MODEL.md` + `SECRET_HITLER_RULES.md` =
> reference. **After any meaningful change you MUST update this file + `CHAT.md`** (the user
> periodically deletes the chat and relies entirely on these docs).

_Last updated: 2026-07-23 (after session 20)._

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
  messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit
  only when work is done/tested; don't force-push.
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
  `<div>`/`document.title`. The reusable driver is `cdp.js` in the session scratchpad. Use a
  **fresh `--user-data-dir` per run** (a stale one throws "Device or resource busy" and IndexedDB
  keeps the previous session). The test writes real accounts (`claude-*@example.com`) and docs
  into the **live** Firebase project.
- **ALWAYS clean up after a cloud test — it mutates production.** Delete every test account and
  empty the database, then confirm only `timhadfield7@gmail.com` remains:
  `firebase auth:export <tmp>.json --format=json` to enumerate, delete each `claude-*@example.com`
  by signing in (its password is derived from the email — see `purge-users.js` in the scratchpad)
  and calling `accounts:delete`, then
  `firebase firestore:delete --all-collections --force --project secret-hitler-companion-th`
  (run twice; the second must list nothing). Also `Stop-Process` any leftover `--headless` Chrome.
- **Live backend facts + the ~5-min one-time setup a user must do are in `BACKEND_PLAN.md`.**
  Firebase CLI is logged in as `timhadfield7@gmail.com`; deploy rules with
  `firebase deploy --only firestore:rules`. The Firestore emulator will NOT start on this machine,
  so `rules.prod.test.js` tests the **deployed** rules against the live project (49 assertions).
- **Style:** match the existing code (vanilla JS in one IIFE in `app.js`, full-redraw rendering,
  original stylised CSS for the board — never reproduce the real game's printed artwork/logo).

## What this project is
A website **companion/analyzer for the board game Secret Hitler** — used alongside a real
table game, not a game engine. Feature pillars:
1. **Randomization** — seat order + first President.
2. **Probability** — for each government, the likelihood the President truly got the hand they
   claim, using a *retrospective* hypergeometric model (updates as the round unfolds).
3. **Game statistics** — per-player + cross-game data, plus a reviewable per-game archive.
4. **Accounts + groups** — live: sign in, sync across devices, share an archive with a group.

## Current status: ✅ live and working (as of session 20)
- Static site (HTML/CSS/vanilla JS), auto-deployed via **GitHub Pages** on push to `main`.
- All features below verified with headless-Chrome smoke tests + screenshots (no build step).
- **All four pillars are shipped.** The full backend plan (accounts → cross-device sync →
  groups → guest-linking/invitations) is **done and live**; nothing there needs the user.
- **Biggest open idea:** the *honesty posterior* (P(claim honest) via a prior on lying) — the
  one change that would alter what the headline number means; see the last section. Everything
  else pending is refinement (vote tracking — undecided; accessibility — untouched).
- **The user periodically wipes the chat and relies entirely on this file + `CHAT.md`.** Keep
  both current after every meaningful change.

## Repository / hosting
- Repo: **https://github.com/TimothyHadfield/secret-hitler-companion** (public).
- Live: **https://timothyhadfield.github.io/secret-hitler-companion/**.
- (Deploy / verification / commit conventions are in the operational brief above.)

## File map
| File | Purpose |
|------|---------|
| `index.html` | App shell. Screens: **setup**, **game** (Play/History/Stats tabs), **stats**. Full-screen overlays: chaos, power, game-over, **confirm dialog**; plus a **toast**. (No separate end screen — role recording is in-place.) |
| `styles.css` | Theme + responsive no-scroll layout, **rectangular table + per-edge seat flow**, boards, role/review panels, games list. |
| `js/probability.js` | Pure probability engine (binomial, hypergeometric, retrospective conditional). Node-tested. |
| `js/stats.js` | localStorage read/write + **in-depth** per-player / cross-game aggregation (roles, claims, powers, conflicts, things done to a player, game endings). Reads the event model. |
| `js/app.js` | Everything else: state, persistence, derive() bookkeeping, rendering, powers, role recording, review, wiring, **account UI**. |
| `js/cloud.js` | **ES module** (the only one): Firebase auth, cross-device sync, and groups. Loads the SDK from a CDN, so still no build step. Talks to the app only via `window.Cloud` + `cloud:*` events. |
| `js/firebase-config.js` | Public Firebase project identifiers. Safe to commit — `firestore.rules` is the security boundary. |
| `firestore.rules` / `firebase.json` / `.firebaserc` / `firestore.indexes.json` | Deployed security rules + Firebase CLI config. |
| `test/` | Dev-only. `rules.prod.test.js` = 49 adversarial assertions against the **deployed** rules (real accounts on the live project, torn down at the end). `rules.test.js` = the emulator variant, kept but unused (the emulator won't start on this machine). Has its own `package.json`; the site stays dependency-free. |
| `.hintrc` | webhint config — pins the two advisory rules we deliberately don't follow, so warnings stay meaningful. |
| `icon.svg`, `apple-touch-icon.png`, `icon-512.png` | Original logo (round table + gold keyhole + red/blue player dots). Favicon + iOS home-screen icon. |
| `SECRET_HITLER_RULES.md` | Rules the app encodes. |
| `PROBABILITY_MODEL.md` | Math/game-theory derivation of the probability model. |
| `BACKEND_PLAN.md` | **Phases 0–3 shipped:** accounts/groups/shared stats on **Firebase (free Spark plan)** — data model, security rules, sync strategy, free-tier budget, phases, **and the exact console setup steps the user must do**. |
| `CHAT.md` | Session-by-session log (sessions 1–20). |
| `PROGRESS.md` | This file. |

## Architecture notes (how app.js is organised)
- **`state`** is the whole live game. **`derive(state)`** walks `state.events` once and returns
  all bookkeeping: enacted counts, draw pile, rounds (+ per-round modifier bounds &
  retrospective probs), current President (`presIdx`), suggested Chancellor, `deadSet`,
  `eventsByPlayer`, draw/discard composition. President, deaths, and the special-election detour
  are **derived from the event log** — nothing turn-related is stored, which is why Undo/resume
  "just work".
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
  close-reopen / redeploy); the setup roster → `secretHitler.setupPlayers.v1`. Active game cleared
  only on New Game / after saving. `loadActive()` backfills fields missing from older saves.
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

## Interaction model (mobile-first, no-scroll)
- **Top row:** a **back arrow (←)** at the far upper-left, then Play / History / Stats tabs;
  **Quit game + New game** on the right (short "Quit"/"New" labels on phones).
  No page title. Footer removed.
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
  stats, then back to setup.

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

## Undo
- **Full-state snapshots.** `pushUndo()` deep-copies the whole state before each gov / fail /
  chaos; `undoLast()` restores it exactly (events, round modifiers, powers, deaths, game-over,
  turn order). Fixes the old "modifier only reverts by 1" bug. Modifier stepper adjustments are
  not separate undo steps (freely reversible with −/+).

## Known limitations / not yet done
- **No way to evict a member who has an account** — you can remove guest seats and leave a group
  yourself, but not remove another account holder. Closing the group stops new joins.
- **The in-progress game doesn't sync**, only completed/recorded ones. Resuming a half-played game
  on another device is out of scope (that's real-time play, explicitly descoped).
- Google sign-in is wired but **only verified manually** — it needs a browser OAuth round-trip, so
  the automated tests cover email/password only.
- **Votes are not tracked** (Ja/Nein counts, ties failing, dead players not voting). The table
  votes and tells the app the outcome — the one election rule still left to honest play.
- The app records what the table *tells* it (claims, conflicts, vetoes, power outcomes); it can't
  detect a lie about those, only price the claim.
- No posterior on *whether* a claim was honest — the model computes P(hand | assumed lies).

## Next candidate steps
- **The backend plan is COMPLETE** (phases 0–3 shipped and live): accounts, cross-device
  sync, groups, invite links, invitations by person, guest-seat linking and revocable
  invites. **Real-time/online play stays descoped.**
- **Honesty posterior** — "how likely is this claim honest?" given a prior on lying, instead of
  only "how likely was this hand". `PROBABILITY_MODEL.md` §7 names it as the open question; it
  would also retire the manual round-modifier stepper, the last piece of fiddly data entry.
- Editable/deletable history entries (Undo only steps back from the end, so a mis-tap noticed
  three governments later means unwinding everything).
- **Reliability:** cap the undo stack — `pushUndo()` stores a full-state snapshot per action and
  `saveActive()` re-serialises all of them on every render (O(n²) growth); and `lsSet()`
  silently swallows `QuotaExceededError`, so a failed save is invisible.
- **Tests:** `derive()` is trapped inside the IIFE; exporting it for Node would give the rules
  logic (term limits, veto, nested special elections, reshuffles) real regression coverage.
  `js/stats.js` is already Node-testable and has been driven that way.
- Accessibility: no `aria-*`, `tabindex` or key handlers anywhere; seats are `div`s with `onclick`.
- **Vote tracking** (asked, undecided): a Ja/Nein *count* per election is one extra tap-pair and
  gets most of the analytical value; per-player votes tax every election. Needs a product call.
- Further statistics ideas: favourite chancellor pairings, lie tendency, per-round trends.

## Groups (phase 2 — live)
- **A group is the unit of sharing.** Create one, invite people with a link, and every member
  reads and contributes to the same archive. A solo user still has an auto-created "My Games"
  group, so there is exactly one data model.
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
