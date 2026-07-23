# PROGRESS — Secret Hitler Companion

> **This file is the complete brief — you need no other context to work on this project.**
> The user will only say "catch up on PROGRESS.md". Read it top to bottom, then start.
> `CHAT.md` = session-by-session history; `PROBABILITY_MODEL.md` + `SECRET_HITLER_RULES.md` =
> reference. **After any meaningful change you MUST update this file + `CHAT.md`** (the user
> periodically deletes the chat and relies entirely on these docs).

_Last updated: 2026-07-23 (after session 15)._

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
- **Deploy:** commit → `git push origin main` → GitHub Pages rebuilds (~1 min). End commit
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
- **Style:** match the existing code (vanilla JS in one IIFE in `app.js`, full-redraw rendering,
  original stylised CSS for the board — never reproduce the real game's printed artwork/logo).

## What this project is
A website **companion/analyzer for the board game Secret Hitler** — used alongside a real
table game, not a game engine. Feature pillars:
1. **Randomization** — seat order + first President.
2. **Probability** — for each government, the likelihood the President truly got the hand they
   claim, using a *retrospective* hypergeometric model (updates as the round unfolds).
3. **Game statistics** — per-player + cross-game data, plus a reviewable per-game archive.
4. **Online play** — planned, not started (needs a backend).

## Current status: ✅ live and working
- Static site (HTML/CSS/vanilla JS), auto-deployed via **GitHub Pages** on push to `main`.
- All features below verified with headless-Chrome smoke tests + screenshots (no build step).

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
| `js/app.js` | Everything else: state, persistence, derive() bookkeeping, rendering, powers, role recording, review, wiring. |
| `icon.svg`, `apple-touch-icon.png`, `icon-512.png` | Original logo (round table + gold keyhole + red/blue player dots). Favicon + iOS home-screen icon. |
| `SECRET_HITLER_RULES.md` | Rules the app encodes. |
| `PROBABILITY_MODEL.md` | Math/game-theory derivation of the probability model. |
| `CHAT.md` | Session-by-session log (sessions 1–15). |
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
- **No online/multiplayer.** Persistence is per-browser/device (localStorage); a game on the
  laptop won't appear on the phone. Private/incognito or cleared data loses saves.
- **Votes are not tracked** (Ja/Nein counts, ties failing, dead players not voting). The table
  votes and tells the app the outcome — the one election rule still left to honest play.
- The app records what the table *tells* it (claims, conflicts, vetoes, power outcomes); it can't
  detect a lie about those, only price the claim.
- No history-row editing/deleting (Undo is the only correction tool; it steps back from the end).
- No posterior on *whether* a claim was honest — the model computes P(hand | assumed lies).

## Next candidate steps (not started)
- Online-play backend (rooms, shared state) — the big remaining pillar.
- **Vote tracking** (asked, undecided): either a Ja/Nein tally per election, or each player's
  individual vote. Adds a data-entry step to every election, so it needs a product decision.
- Editable/deletable history entries.
- Further statistics ideas: favourite chancellor pairings, lie tendency, per-round trends.
- Probability: optional posterior "how likely is this claim honest?" given a prior on lying.
