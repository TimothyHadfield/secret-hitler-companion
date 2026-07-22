# PROGRESS — Secret Hitler Companion

> **This file is the complete brief — you need no other context to work on this project.**
> The user will only say "catch up on PROGRESS.md". Read it top to bottom, then start.
> `CHAT.md` = session-by-session history; `PROBABILITY_MODEL.md` + `SECRET_HITLER_RULES.md` =
> reference. **After any meaningful change you MUST update this file + `CHAT.md`** (the user
> periodically deletes the chat and relies entirely on these docs).

_Last updated: 2026-07-22 (after session 10)._

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
| `index.html` | App shell. Screens: **setup**, **game** (Play/History/Stats tabs), **stats**. Full-screen overlays: chaos, power, game-over. (No separate end screen — role recording is in-place.) |
| `styles.css` | Theme + responsive no-scroll layout, **rectangular table + per-edge seat flow**, boards, role/review panels, games list. |
| `js/probability.js` | Pure probability engine (binomial, hypergeometric, retrospective conditional). Node-tested. |
| `js/stats.js` | localStorage read/write + per-player / cross-game aggregation. Reads the event model. |
| `js/app.js` | Everything else: state, persistence, derive() bookkeeping, rendering, powers, role recording, review, wiring. |
| `icon.svg`, `apple-touch-icon.png`, `icon-512.png` | Original logo (round table + gold keyhole + red/blue player dots). Favicon + iOS home-screen icon. |
| `SECRET_HITLER_RULES.md` | Rules the app encodes. |
| `PROBABILITY_MODEL.md` | Math/game-theory derivation of the probability model. |
| `CHAT.md` | Session-by-session log (sessions 1–9). |
| `PROGRESS.md` | This file. |

## Architecture notes (how app.js is organised)
- **`state`** is the whole live game. **`derive(state)`** walks `state.events` once and returns
  all bookkeeping: enacted counts, draw pile, rounds (+ per-round modifier bounds &
  retrospective probs), current President (`presIdx`), suggested Chancellor, `deadSet`,
  `eventsByPlayer`, draw/discard composition. President, deaths, and the special-election detour
  are **derived from the event log** — nothing turn-related is stored, which is why Undo/resume
  "just work".
- **Event model:** `state.events` is ordered, mixed: `{type:'gov', presidentIdx, chancellorIdx,
  claimLibs, conflict, enacted, power?}`, `{type:'fail', presidentIdx}`, `{type:'chaos', enacted}`.
- **`state.form`** only holds transient UI: `{chanIdxOverride, conflictArmed}`.
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
- **Top row:** Play / History / Stats tabs on the left, **End game + New game** on the right.
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
- **President is fixed** each turn (gold **P** badge on the avatar). **Tap a player** to set/move
  the Chancellor (blue **C** badge). No dropdowns.
- **Clicking a ratio auto-submits** the presidency; each ratio button shows the **draw
  probability above it**. Ratios: **Coal (3F) / Golden (2F1L) / Silver (1F2L) / Bronze (3L)** on a
  red→blue scale. Button highlight is blurred after submit so it doesn't carry over.
- **Conflict** is an arm toggle; **Failed presidency** and **Undo** sit with the controls.
- **Per-round blocks** across the top: "Round N" + its modifier stepper; once a round ends, its
  bottom cards show beneath it and the next round's block appears.
- **Page scroll/drag is locked** (`html,body{overflow:hidden}` + `body{position:fixed;inset:0}` +
  `overscroll-behavior:none`); double-tap-zoom disabled. Non-game screens scroll internally.

## Board visuals (original stylised CSS — not the game's printed art)
- **Draw pile (left)** / **Discard pile (right)** = grey face-down card rectangles with F/L counts
  beside them, labels above.
- Enacted policies = **light-grey tiles with a red (fascist) / blue (liberal) border**.
- Empty fascist slots in **Hitler territory (4th+)** are dark red.
- Power **names** ("Investigation / Policy Peek / Kill / Special Election") label the fascist slots.
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
Every overlay (power / chaos / game-over) has a **↶ Back** button. Powers block play until resolved.

## Game end + role recording (in-place)
- **Auto-detected wins:** 5 Liberal policies → Liberal; 6 Fascist policies → Fascist; Hitler
  executed → Liberal. Each pops a **full-screen game-over box** (who won + how) that blocks play.
- **"Record roles →"** (from the game-over box, or the manual **End game** button) switches the
  controls area into a **role panel while the table stays visible**: pick **Hitler + the exact #
  Fascists** (1 in 5–6, 2 in 7–8, 3 in 9–10); a player can't be both; **no "who won" question**
  (shown when known; a Liberal/Fascist toggle appears only for a manual end with no auto-winner).
  Selecting recolors the circles live: **black = Hitler, red = Fascist, blue = Liberal**. Save →
  stats, then back to setup.

## Statistics + game review
- **Stats** (in-game tab and standalone screen): cross-game summary tiles, per-player table
  (games/wins/win%/pres/chanc/as-Hitler/conflicts), and an **"All games" list**.
- **All-games list:** each game is a **winner-coloured box** (Hitler on top, Fascists beside).
  Clicking opens a **read-only review**: that game's coloured table + every presidency's
  cards/odds/details, with a **stats panel** (policies, governments, fails, Hitler/Fascists) where
  the policy options normally sit, and a Back button. Reviewing stashes the live game and restores
  it on Back; review state never overwrites the saved active game.

## Undo
- **Full-state snapshots.** `pushUndo()` deep-copies the whole state before each gov / fail /
  chaos; `undoLast()` restores it exactly (events, round modifiers, powers, deaths, game-over,
  turn order). Fixes the old "modifier only reverts by 1" bug. Modifier stepper adjustments are
  not separate undo steps (freely reversible with −/+).

## Known limitations / not yet done
- **No online/multiplayer.** Persistence is per-browser/device (localStorage); a game on the
  laptop won't appear on the phone. Private/incognito or cleared data loses saves.
- **"Hitler elected Chancellor" win is not auto-detected** (the app doesn't know who Hitler is
  mid-game). Use the manual **End game** button — the role panel then shows a winner toggle.
- No enforcement of term limits / votes / veto *usage* (companion assumes honest table play).
- No history-row editing/deleting (Undo is the only correction tool; it steps back from the end).
- No posterior on *whether* a claim was honest — the model computes P(hand | assumed lies).

## Next candidate steps (not started)
- Online-play backend (rooms, shared state) — the big remaining pillar.
- Optional "the elected Chancellor was Hitler" button once 3 fascist policies are down, so that
  win auto-detects too.
- Editable/deletable history entries.
- Richer statistics (per-player liberal/fascist win rates, favourite chancellor pairings, lie
  tendency).
- Probability: optional posterior "how likely is this claim honest?" given a prior on lying.
