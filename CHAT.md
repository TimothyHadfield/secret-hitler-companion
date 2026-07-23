# CHAT LOG — Secret Hitler Companion

A running, human-readable log of what the user asked for and what I changed, session by
session. Newest at the bottom. Kept short on purpose — for reflecting on how the project
and our collaboration evolved.

---

## Session 1 — 2026-07-21 — Initial build

**User asked for:**
- A full Secret Hitler website; start with **randomization, game statistics, and
  probability calculations** (online play later).
- Create a GitHub repo on their account and auto-deploy (a real, working website).
- Maintain markdown docs, especially `PROGRESS.md` (to catch up after clearing chats) and
  `CHAT.md` (this file). Also a rules reference doc and a probability/game-theory doc.
- First learn the rules of Secret Hitler thoroughly and record them.
- Detailed product vision: input players → randomize seating + first President; a bird's-eye
  round-table UI; per-President history cards with the odds of their hand; center Liberal/
  Fascist boards + draw/discard counts; a liberal "modifier" system to model lies; automatic
  reshuffle boundary between rounds; bottom-card reveal; end-game role tagging; player stats.
- Explicitly wanted my questions and thoughts on the calculations/display.

**Decisions the user made (via my questions):**
- Headline probability = **retrospective only** (updates using later draws in the round).
- Repo = **public**.
- Stats storage = **this browser only** (localStorage) for now.

**What I built/changed:**
- `SECRET_HITLER_RULES.md` — full rules, order of play, powers-by-player-count table.
- `PROBABILITY_MODEL.md` — derived the hypergeometric core + the retrospective conditional
  formula; verified it reproduces the user's "25% → goes up" example (5% → 100%).
- `js/probability.js` — pure engine (binomial, hypergeometric, draw distribution,
  retrospective probability). Unit-checked in Node.
- `js/stats.js` — localStorage persistence + player/cross-game aggregation.
- `js/app.js` — full app: player entry, randomization, round-table render, boards, pile
  bookkeeping, record-government form, modifiers, reshuffle logic, end-game, stats.
- `index.html` + `styles.css` — themed UI (round felt table, tracks, forms).
- Ran a **headless-Chrome end-to-end smoke test** — passed with no runtime errors.
- Created the public GitHub repo and enabled GitHub Pages (auto-deploy on push to `main`).
- `PROGRESS.md` — status, file map, decisions, limitations, next steps.

**My notes/thoughts recorded for the user:**
- The retrospective model is fully computable because the draw-pile composition is always
  known (deck is 11F/6L and enacted policies are public).
- Flagged that per-government vs round-level modifiers overlap; kept both, documented it.
- Flagged a future enhancement: a posterior on *whether* a claim is honest (prior over lies),
  vs the current P(hand | assumed lies).

---

## Session 2 — 2026-07-21 — Gameplay upgrades

**User asked for (batch of changes):**
1. Chancellor auto-rotates to the next person after the first is assigned.
2. A **Failed presidency** button → election tracker +1; at 3, auto top-deck the top card
   (chaos), recorded by the player with an ✕.
3. Redesign the center boards/cards to look like the real game; **animate** the enacted policy
   card flying from the President who played it.
4. Don't let the user set an **impossible modifier** (bounded by #presidents in the round and
   by confirmed liberal/fascist totals). *(User example cited "7 liberals total" — see note.)*
5. Stop asking which policy was played — **infer** it (Coal→F, Bronze→L, Golden/Silver→L),
   and add a **Conflict** button (Golden/Silver only) that forces a Fascist and labels it
   "conflict (chancellor name)".
6. Rename the ratios to **Golden (2F/1L), Silver (1F/2L), Bronze (3L), Coal (3F)** with metal
   label colours, and a box background that scales full red → full blue by liberal ratio.
7. Remove the per-presidency lie modifier (round-level only).
- **Mid-batch additions:** (a) a **Back/Undo** button to reverse the last presidency; (b) if an
  event is impossible at the current modifier (0% — e.g. drew 3 fascists when ≤2 were left),
  **auto-adjust the modifier** to account for the discrepancy.

**What I built/changed:**
- Reworked state to an **event model** (`gov` / `fail` / `chaos`) in `js/app.js`.
- Chancellor auto-rotation; Failed-presidency + election tracker + automatic chaos top-deck.
- Redesigned boards (`styles.css`) in an original Secret-Hitler-inspired style + flying policy
  card animation from the acting President (chaos flies from the draw pile).
- Ratio buttons Golden/Silver/Bronze/Coal with metal colours + red→blue background scale;
  removed the enacted-policy question; added the Conflict toggle + history/seat labels.
- Removed the per-presidency modifier; the round modifier now shifts the pool's effective
  liberal count. Bounded it to the physically-feasible window (never empty) intersected with a
  ±(#presidents) plausibility cap; **auto-adjusts** into feasibility when a recorded claim
  would otherwise be 0%.
- Added the **Undo last** button (reverses any last event, restores turn state, re-opens the
  chaos prompt if a chaos was undone).
- Updated `js/stats.js` to read the event model; added a per-player **conflicts** stat.
- Re-ran the headless-Chrome end-to-end smoke test (now covering conflict, auto-rotation,
  fails→chaos, undo, bounds) — **passed, no runtime errors**.

**Note / open question for the user:** the modifier-bounds example mentioned "7 liberals
total," but the standard deck is **6 Liberal / 11 Fascist** (what the app uses). I implemented
bounds against the 6-liberal deck. If a different count was intended, flag it and I'll adjust.

---

## Session 3 — 2026-07-22 — Mobile-first simplification

**User confirmed:** always follow the real rules (6 Liberal / 11 Fascist); treat examples as
principle, not literal numbers.

**User asked for:**
1. **Immediate reshuffle** when the draw pile drops below 3 (show the new pool before the next
   presidency is entered).
2. **Top area = per-round blocks**: just "Round N" + its modifier; when a round ends, show its
   bottom cards below it (adjusted by the modifier) and start the next round's block. Remove
   stray text.
3. **Condense for phones**: move the next-presidency controls *below* the table; merge the
   "chance next president draws" odds into the ratio buttons (percent above each box); make
   the President fixed/highlighted (no dropdown); **tap a player to set the Chancellor**;
   keep Conflict + Failed-presidency; **clicking the claimed ratio auto-submits**.
4. Resize the center boards so they don't overlap the table edges.
5. **Veto signs** on the 5th fascist slot: "Veto begins" when uncovered, "Veto allowed" when a
   policy covers it.
6. **President/Chancellor tiles** resting on the table by each player; the chancellor tile +
   highlight move as the user taps different players.

**What I changed:**
- `derive()` now reshuffles eagerly (the instant draw < 3), so the new round + odds show
  immediately.
- Rebuilt the top area as per-round blocks (`renderRounds`) with per-round modifier steppers
  and bottom cards on round end.
- Reworked the game screen for mobile: controls moved below the table; removed the
  president/chancellor dropdowns, the separate next-hand panel, and the record button; draw %
  now sits above each Golden/Silver/Bronze/Coal button; ratio click auto-submits; Conflict is
  an arm toggle; tap-a-seat sets the Chancellor.
- Added on-table **President/Chancellor role tiles** that follow the current roles.
- Shrank the center boards; added **veto signs** on the 5th fascist slot.
- Re-ran the headless-Chrome smoke test (new tap/click model, eager reshuffle, veto, tiles,
  chaos, undo) — **passed, no runtime errors**.

Board visuals remain original stylized CSS (colours/emoji/shapes), not the game's printed art.

---

## Session 4 — 2026-07-22 — Board visuals + presidential powers + responsive/no-scroll

**User asked for (batch):**
- Draw pile on the left / Discard on the right as grey face-down **card rectangles** with F/L
  counts beside them and labels above.
- Enacted policy positions **light grey with red/blue borders**; empty fascist **Hitler-
  territory** slots dark red so it's clear when Hitler can win.
- Label the powers ("Investigation", "Policy Peek", "Kill", "Special Election") on the slots.
- **Automatically pause to fulfil each power** with a question box:
  Kill (who + Hitler? → Liberal win or 💀 + skip), Investigation (who + party, recorded by the
  presidency), Policy Peek (3 tap-toggle cards Top/Middle/Bottom), Special Election (pick next
  president, then order resumes).
- **Then, second batch:** fit the layout to laptop AND iPhone with **no scrolling**; add a
  **tab** format for History/Stats; prevent iPhone **double-tap zoom**; make the 3-failed-
  elections box **cover the screen** and block submitting; ensure **no label covers another**
  (abbreviate to P/C or use a crown).

**What I built:**
- Restructured the centre area: grey draw/discard card piles (left/right) with counts + labels.
- Restyled slots (light-grey + coloured border; dark-red Hitler territory) and put power
  **names** above the fascist slots.
- **Refactored turn state to be fully derived from the event log** — president, suggested
  chancellor, deaths, and the special-election detour — so powers/undo stay consistent.
- Added the four **power overlays** with full effects (kill → death/skip/skull or Liberal win;
  investigation recorded by presidency; policy peek order; special election next-president).
- Responsive **flex/vh no-scroll layout** with **Play/History/Stats tabs**; disabled double-tap
  zoom; chaos + powers are **full-screen blocking overlays**; role indicators are **P/C avatar
  badges** (no overlapping tiles).
- Verified in headless Chrome: all powers/tabs/overlay flows pass; measured **no vertical or
  horizontal overflow**; captured phone + laptop screenshots to confirm the layout.

---

## Session 5 — 2026-07-22 — Layout polish (space efficiency)

**User feedback:** the first responsive pass over-shrank the table (90% covered on laptop) and
the 4 policy boxes were huge. Wanted: on wide screens put the policy options on the **right,
vertically stacked**; make the **table dominate**; strip chrome — remove the "President… tap a
player" text, the footer tagline, and the "Secret Hitler" title; move **End game up beside New
game**; put the **Play/History/Stats tabs to the left of those buttons**; and **remove the boxes**
around the table and the policy options so everything blends and nothing gets clipped.

**What I changed:**
- New `#playMain` splits the table (fills all remaining space) from the controls; on wide
  screens the controls sit on the **right as a vertical stack** (ratio buttons + Conflict/
  Failed/Undo), on phones they drop **below** the table.
- Single compact top row: **tabs on the left, End game + New game on the right**; removed the
  page title, the turn-info sentence, and the footer. Global topbar hidden on the game screen.
- Removed the panel boxes around the table and controls (borderless, blended).
- Fixed a specificity bug where the base `.table-area { aspect-ratio:16/10 }` was shrinking the
  table inside its panel (left a big gap on mobile) — the table now fills its container.
- Re-verified: headless smoke test passes; phone + laptop screenshots confirm the table
  dominates and nothing scrolls or clips.

---

## Session 6 — 2026-07-22 — Reset, game-over box, all-presidencies display

**User asked for:**
- The clicked policy outcome stayed highlighted into the next presidency — **reset it** fully.
- A **game-over box** on a terminal outcome: says who won and how, blocks further play, and
  records the game to stats.
- Show **all** of a player's presidencies under them (3 cards + probability each), with the
  **probability and any details (conflict/power) to the SIDE** of the cards; an **X** instead of
  cards for a failed presidency.

**What I changed:**
- Blur the active button after auto-submit + focus reset CSS, so no outcome stays highlighted.
- Auto-detect terminal outcomes (**5 Liberal → Liberal win**, **6 Fascist → Fascist win**,
  **Hitler executed → Liberal win**) → full-screen **game-over overlay** that blocks play; its
  "Record roles & save" button opens the end screen (winner preset) to capture Hitler/Fascists
  and save to stats. (The "Hitler elected Chancellor" win still needs the manual End-game
  button, since the app doesn't know who Hitler is mid-game.)
- `derive()` now returns `eventsByPlayer`; each seat renders **one row per presidency**
  (`[3 cards | odds + detail chips]`), with an X row for failed elections. Removed the old
  single-hand + separate tag/fail-count display.
- Verified in headless Chrome (fail-X, 2-presidency rows, game-over blocking + save) and via a
  screenshot of the multi-presidency layout.

---

## Session 7 — 2026-07-22 — True undo, scroll-lock, logo

**User asked for:**
- Going **back** should revert ALL game data to exactly before that action (they hit a bug where
  a round modifier bumped by 3 only reverted by 1 on undo; likely more such cases with powers,
  kills, game-enders, conflicts, fails).
- On iPhone, kill the **overscroll drag** (white borders above/below when dragging).
- Create a **logo** (esp. for the iOS home-screen icon instead of a grey "S" box).

**What I changed:**
- **Snapshot-based Undo**: `pushUndo()` deep-copies the whole game state before each
  government / failed election / chaos resolution; `undoLast()` restores that snapshot exactly.
  This fixes the modifier-by-1 bug and reverts everything (powers, deaths, game-over, conflicts,
  turn order, modifiers) in one step. Added **↶ Back** buttons to the power, chaos, and
  game-over overlays so you can revert even while one is up. (Verified: +3 → undo → 0.)
- **Scroll-lock**: `html,body { overflow:hidden }` + `body { position:fixed; inset:0 }` +
  `overscroll-behavior:none` — the page never drags/bounces. Non-game screens scroll internally
  if needed. (Verified: page scrollWidth/Height == client.)
- **Logo**: original `icon.svg` (round table + gold keyhole + red/blue player dots on dark) →
  rendered `apple-touch-icon.png` (180) and `icon-512.png` via headless Chrome. Wired favicon,
  apple-touch-icon, theme-color, and apple-mobile-web-app meta tags. (Original art — not the
  board game's logo.)

---

## Session 8 — 2026-07-22 — Local persistence (resume games)

**User asked for:** stop losing the in-progress game and re-typing names on every update —
save data locally so an active game (players, events, everything) and past stats survive
refreshes, closing/reopening, and redeploys.

**What I changed:**
- The active game auto-saves to `localStorage` (`secretHitler.activeGame.v1`) after every change
  and is **restored on load** — the app boots straight back into the in-progress game.
- The setup **roster** persists (`secretHitler.setupPlayers.v1`), so the player list is
  remembered across games and sessions. Cleared on New Game / after saving a finished game.
- Backfills missing fields when loading a game saved by an older app version (forward-compatible
  across redeploys). Wrapped all `localStorage` access in try/catch.
- Verified with a two-session headless test (start a game in session 1 → a fresh page load in
  session 2 resumes it with all players/events intact and the roster saved).

---

## Session 9 — 2026-07-22 — Veto, top-seat clip, in-place role recording, games list

**User asked for:**
- Make the **veto sign horizontal** ("Veto") — vertical small letters were unreadable — and
  legible on both the light card and the dark slot.
- The **top player's circle** was clipped by the table's box — fix it.
- Redesign **end-of-game role recording**: keep the table + all data up and only replace the
  policy-options area with the role questions. Ask **Hitler + the exact number of Fascists**
  (1 in 5–6, 2 in 7–8, 3 in 9–10); a player can't be both; drop the "who won" question (the game
  knows); then **color each circle** red (Fascist) / black (Hitler) / blue (Liberal).
- Add an **"all games" list** in Stats: a box colored by the winning team with Hitler on top and
  the Fascists side-by-side; clicking it **reviews that game** (its table + key stats where the
  policy options normally sit).

**What I changed:**
- Veto label is now horizontal "Veto" on a dark pill (readable on any slot). Pulled the seat
  ellipse in vertically so the top seat is never clipped.
- **In-place role recording**: the game-over box's button (and manual End game) now switch the
  controls area to a role panel while the table stays visible. Winner shown (or asked only if
  unknown for a manual end); tap-to-pick Hitler and N Fascists with mutual exclusion; circles
  recolor live by role; Save writes to stats.
- **All-games list** in both the in-game Stats tab and the Stats screen; each entry is a
  winner-colored box (Hitler above, Fascists beside). Clicking opens a **read-only review** of
  that game — colored table + presidency details + a stats panel (policies, governments,
  fails, Hitler/Fascists) — with a Back button. Removed the old separate end screen.
- Verified in headless Chrome (role panel shows over the live table, circles 1 H / 1 F / 3 L,
  save → stats, games list → review → back) and via mobile + laptop screenshots.

---

## Session 10 — 2026-07-22 — Rectangular table + edge-based seating

**User asked for:**
- Make the board a **square/rectangle** instead of a circle/oval (space + visuals).
- **On a phone**: put all players **above or below** the board, and make the board **much
  bigger** — draw pile almost touching the left edge, discard pile almost touching the right.
- **On computer/laptop**: balance players around **all 4 sides**, but **never on a corner**.
- If the **top player has 2+ presidencies**, their recorded presidencies must **not cover the
  board**.

**What I changed:**
- `.felt` is now a **rounded rectangle** (was `border-radius:50%`), with per-breakpoint insets.
- New `computeSeats(n)` in `js/app.js` replaces the old polar/ellipse placement. It assigns
  seats to the table's **4 edges** and returns `{x, y, edge}` per seat, walking clockwise
  (top L→R, right T→B, bottom R→L, left B→T) so seat order still reads as a ring:
  - **Phones (≤640px):** everyone on **top & bottom only** (`ceil(n/2)` top, rest bottom); no
    side seats. Felt runs nearly full width (`inset: 24% 1.5% 22% 1.5%`), `.center-boards`
    width 98% + full-size piles → **draw hugs left, discard hugs right** (measured: at the
    512px CSS viewport the piles sit 11px from each edge, no overflow).
  - **Wider screens:** `floor(n/4)` per edge, leftovers to top then bottom; top/bottom seats
    spread within x∈[26,74] and side seats within y∈[36,64] so **none land on a corner**.
- Each seat gets an `edge-*` class. **Top-edge seats** use `flex-direction: column-reverse` +
  `translate(-50%,-100%)` so their **presidency rows grow upward, away from the board** (the
  requested fix); bottom/side seats grow downward as before. Wrapped the avatar+name in
  `.seat-head` and the presidency rows in `.seat-pres` to control the growth direction.
- Added a **window `resize` listener** that re-lays the seats when crossing the phone/desktop
  breakpoint (re-renders the table live).
- Verified in headless Chrome with screenshots at **n=5, 9, 10** on both desktop (1280) and the
  512px mobile viewport, plus a **geometry probe** confirming the piles hug both edges with no
  overflow, and a seeded game where the top seat has **2 presidencies** — they grow up and never
  cover the board.

---

## Session 11 — 2026-07-22 — Presidency spacing (room for 3 per seat)

**User asked for:**
- Desktop: **bottom-row players had no room** for presidency info; a single player's multiple
  presidencies sometimes got covered/lost. Fix by moving/reshaping the round data + board.
- iPhone: the finished-round **bottom cards** should lose the "bottom" label and sit **to the
  right of the "Round #"** label (shorter blocks → more room above the top players). Also **shift
  the bottom players up** so their circle cuts halfway through the felt's bottom edge, freeing
  space below for their presidencies.
- Laptop: move the **3 round boxes to the right column above the policy options**, and shift the
  **board up** so bottom players have room.
- **Every seat should always have space for 3 presidencies.** With 1–2 they use the space at full
  size; a **3rd shrinks all of them to fit** the reserved slot (nothing lost).

**What I changed:**
- **Rounds bar relocated by breakpoint** (`placeRoundsBar()` moves the one `#roundsBar` node):
  phones keep it above the table (shorter blocks = more headroom); desktop moves it into a new
  `#roundsSlot` in the right control column, above the ratio buttons.
- **Round blocks are now one compact row:** `Round N` · inline bottom cards (no "bottom" label) ·
  `− mod +`. On desktop they stack full-width in the column (capped at 34vh, scrolls if a game
  has many rounds); the control column can scroll on very short laptops so no button is clipped.
- **Reserved 3-presidency slot per seat:** `.seat-pres` has `max-height: var(--pres-slot)` (82px
  desktop / 78px phone) with the rows in a `.pres-stack`. New `fitPresStacks()` measures each
  stack and applies a `scale()` when it's taller **or wider** than the slot, so a 3rd presidency
  (or long detail text on a narrow phone seat) shrinks to fit instead of clipping.
- **Board shifted up + seats pulled clear:** desktop felt inset `25% 15% 27% 15%`, seats at
  TOPY 24% / BOTY 74% so top seats (grow up) and bottom seats (grow down) each get a full slot.
  Phone felt inset `26% 1.5% 24% 1.5%` with bottom seats at BOTY 72% so they **straddle the felt's
  bottom edge** with the slot below them.
- Verified with headless screenshots at **n=5/9/10**, desktop **1280×760** and short **1366×640**,
  and phone **512×900**, plus a seeded game where the top seat holds **3 presidencies** (they
  grow up, scaled to fit) and a bottom seat holds 2 — nothing clipped, DOM + no-JS-error checks
  pass.

---

## Session 12 — 2026-07-22 — Grouped fail marks + fix the missing Bronze option

**User asked for:**
- Consecutive **failed presidencies** (no passed presidency between them) should render **✕✕
  side by side** to save vertical space; a passed presidency between two fails splits them so the
  ✕s sit **above/below** that presidency.
- On the laptop the **Bronze policy option wasn't showing** (pushed off-screen). Make sure all
  four options show and don't interfere with the round info / other options — resizing expected.

**What I changed:**
- **Fail-run grouping** in `renderTable`: instead of one row per fail, walk each seat's events and
  coalesce a run of consecutive `fail`s into a single `.pres-row.fail-row` of side-by-side ✕s; a
  `gov` breaks the run (so its ✕s land on separate rows above/below the cards).
- **Fixed the clipped Bronze option.** Root cause: my desktop control-column overrides sat in a
  media block *above* the base `.ratio-*` rules, so the base (same specificity, later in the file)
  won — buttons stayed full-height (63px) and the 4th option overflowed. Re-scoped every override
  with a `.controls` prefix (higher specificity) and trimmed heights: ratio buttons 63→42px, the
  control row tighter, and the rounds strip capped at 116px with a natural (non-reversed) order.
  Now all four ratios + the round boxes + Conflict/Failed/Undo fit without scrolling on common
  laptop heights (measured: control content 508px vs a 561px column at ~800px window).
- The rounds strip **auto-scrolls to the current round** (desktop: `scrollTop`; phone top strip:
  `scrollLeft`) so the active round's modifier is always in view.
- Verified with headless height-probes at windows 800/720/660 (Bronze + Undo in view) and
  screenshots on desktop (**1280×800**) and phone (**512×900**) showing the grouped ✕✕ (Ben) and
  the ✕ / cards / ✕ split (Gil).

---

## Session 13 — 2026-07-22 — Term limits + design pass (back arrow, quit, in-app dialogs)

**User asked for:**
- **Term limits:** the last President *or* Chancellor can't be the next Chancellor — but in a
  **5-player game (or 5 left alive after a kill)** the last President *is* eligible.
- An in-depth rules audit of anything else the app might be missing (report only, to confirm).
- Design: the board **overlaps the table's top/bottom edges on laptop** — shrink it.
- **Never** show the browser's "site says…" bar; confirmations must be designed in-app.
- Replace **"End game"** with **"Quit game"** + an "all data will be erased" confirm, and drop the
  end-of-game questions that used to follow it.
- **One back affordance:** a left arrow, upper-left, no words — plus "undo" beside it during play.
- **Power labels and policy-option labels in black.**

**What I changed:**
- **Term limits enforced.** `derive()` now tracks the last *elected* government and returns a
  `termLimited` set: the last Chancellor always, the last President only when `aliveCount > 5`.
  A **chaos** top-deck clears both (official rule). `setChancellor()` refuses a termed seat with
  an explanation, `effChan()` ignores a stale pick, the suggested Chancellor skips termed seats,
  and termed seats render dashed/dimmed (never the sitting President).
- **In-app dialogs.** Added `askConfirm()` (`#confirmModal`, styled like the other overlays) and
  `showToast()`; removed every `alert`/`confirm` (new game, quit, clear statistics, game saved).
- **Quit game** replaces End game: confirms, then erases the game. Role recording is now reachable
  **only** from an auto-detected game-over. *Consequence flagged to the user:* a "Hitler elected
  Chancellor" win can no longer be recorded to statistics.
- **Unified back arrow** (`.backbtn`, `renderBackTop()`): upper-left everywhere — game top row,
  overlay boxes (absolutely pinned), stats screen, review. Labelled "undo" only during play;
  closes a review otherwise. Removed the old Undo button and the review's own back button.
- **Board no longer overlaps the felt:** base size trimmed (55% / max 418px) plus
  `fitCenterBoards()`, which scales the boards to the felt's inner **height**. Phones are exempt
  so the piles keep hugging the screen edges.
- **Black labels** on `.sh-power` and the ratio buttons (metal-coloured names → black, shadows off).
- Verified in headless Chrome: term limits at 5p (`termed=[1]`), 6p (`[0,1]`), post-chaos (`[]`),
  and 6p→5-alive-by-execution (`[3]` only); tapping a termed seat is blocked with a hint; board
  inside the felt at 1280×800 and 1366×640 while the phone keeps piles at 11/501px; quit opens the
  app modal with `nativeDialogUsed=false`; review opens and the top-left arrow returns to stats.

---

## Session 14 — 2026-07-23 — In-depth statistics

**User asked for:** much deeper statistics — per player: times Fascist / Liberal / Hitler, how
many times they claimed each policy option, conflicts, how many times they were President for
each power, times killed, etc. — plus **general game statistics** in the same categories. Keep
the section clean and compact; scrolling within it is fine.

**What I changed:**
- **Rewrote `js/stats.js`.** `playerStats()` now returns, per player: mutually-exclusive role
  counts (Liberal / Fascist / Hitler, summing to games) with win rate by team; claimed hands as
  President (Coal/Golden/Silver/Bronze); powers wielded (investigations, peeks, executions,
  special elections); conflicts split by seat (as Chancellor vs as President); policies enacted
  as Chancellor; presidencies / chancellorships / failed elections; and things done *to* them
  (times executed, investigated, special-elected). `summary()` adds cross-game totals and
  averages, the claim distribution, chaos top-decks, and `endings` via a new `endingOf()` that
  infers how each game finished (Hitler executed / 6 Fascist / 5 Liberal / other).
- **Rebuilt the stats UI** as one `renderStatsInto(container)` feeding both the standalone screen
  (`#statsBody`) and the in-game tab (`#statsBodyInline`) — replacing the old summary grid + wide
  player table. Sections: Overview tiles → Claimed hands → Game totals → How games ended →
  Players → All games. Players are **collapsed rows that expand** to the full breakdown, so the
  depth doesn't cost space; numbers use a capped label→value grid (one full-width column on
  phones).
- **Visualisation decision (dataviz skill).** Ran the palette validator on the app's red→blue
  claim ramp: it **fails** — middle steps read as gray (chroma 0.04–0.07) and the normal-vision
  separation floor is ΔE 10 (< 15, a hard gate). So a 4-colour stacked bar was rejected in favour
  of **single-series magnitude bars** in one validated accent (`#b3852f`: in dark lightness band,
  chroma ≥ 0.1, contrast ≥ 3:1), with every row directly labelled — identity never rides on colour.
- Verified the aggregation in Node against a 4-game fixture covering every stat (totals, kills,
  Hitler executed, investigations, peeks, special elections, chaos, conflicts all matched
  hand-computed values; claims summed to governments; role buckets summed to games for every
  player), then rendered and eyeballed it at 1280px and 512px, and confirmed the in-game tab
  builds all 6 panels and scrolls. No stale element references, no JS errors.

---

## Session 15 — 2026-07-23 — Apply the remaining rules from the audit

**User asked for:** implement every rule the session-13 audit flagged as missing, in the same
style as the rest of the app.

**What I implemented:**
- **Veto power** (the big one). A **⊘ Veto** toggle appears once 5 Fascist policies are down; arm
  it, then tap the claimed hand. The government is recorded with `vetoed:true` / `enacted:null`:
  no policy is enacted, **all 3 drawn cards go to the discard** (`discardTotal` in `derive()` now
  counts 3 for a vetoed gov instead of 2), and the **election tracker advances** instead of
  resetting — hitting 3 triggers chaos. The claim still prices normally because the President
  really did draw 3 cards. Veto and Conflict are mutually exclusive; a veto triggers no power.
- **"Hitler elected Chancellor" win.** From 3 Fascist policies on, a **⚑ Chancellor was Hitler**
  button ends the game as a Fascist win and pre-fills that seat as Hitler for role recording. It
  writes a terminal `{type:'hitler'}` event that draws no cards and moves nothing — restoring the
  ability (lost in session 13) to record such a game to statistics.
- **No double investigations.** `derive()` returns an `investigated` set and the Investigation
  prompt removes those seats (with a fallback so it can never dead-end).
- **Nested special elections fixed.** `advanceAfter()` no longer overwrites `pendingResume`, so the
  rotation resumes after the President who *first* broke the order.
- **Stale Policy Peeks** from an earlier round are struck through and marked "(reshuffled)".
- Stats/history follow: vetoes counted per player (as President / as Chancellor) and in Game
  totals, vetoed policies excluded from enacted counts, and `endingOf()` reports
  "Hitler elected Chancellor".
- **Verified in headless Chrome:** veto took exactly 3 cards from the draw (6F6L→4F5L), put all 3
  in the discard (2F1L matching the claim), advanced the tracker to 1 and left the track at 5F/0L;
  nested special election resumed at seat 1 (not the detour); the Investigation prompt excluded
  both the President and the already-investigated seat; the Hitler button produced the Fascist
  game-over; the earlier-round peek rendered struck through. Node-checked the stats layer
  (ending, veto attribution, vetoed policy not counted). Control column still fits at 720px.

**Left open (asked the user):** tracking the **vote itself** (Ja/Nein counts, ties failing, dead
players not voting) — that adds a data-entry step to every election and changes the streamlined
"tap a ratio to submit" flow, so it needs a product decision rather than a rule fix.

**Follow-up:** the user hadn't heard of the "no double investigation" rule and asked me to check.
Verified against the official rules — *"The President investigates another player **who has not
yet been investigated**."* The restriction is on the **target**, not the investigator (a different
President still can't re-investigate the same player), which is how it's implemented. It can only
ever bind in a **9–10 player** game, the only count with two Investigate Loyalty slots (5–6 has
none, 7–8 has one) — which is why it so rarely comes up.

---

## Session 16 — export/import, and the backend decision

**User asked for:** first, an opinion on what to improve besides online play; then how best to
add **user accounts, per-account data, friends and groups** where any member can record a game
into a group and any other member can see that group's stats. Partway through they **descoped
online/real-time play** — accounts and sharing only.

**What I recommended (and why):**
- **Supabase.** The data is relational (users, groups, memberships, games), and the entire
  feature set reduces to "who may read which rows" — which is Postgres **Row-Level Security**,
  so there is **no server to write or host** and the site stays static on GitHub Pages.
  Firebase was the second choice; a hand-rolled Node service was rejected as more work for less.
- **The load-bearing modelling call:** a *user* (login) and a *group member/seat* are two
  different things. Games must reference **member ids, never names**, and a member carries a
  **nullable `user_id`** — so guests can play without accounts and be linked to a real account
  later with one UPDATE instead of a history rewrite.
- **Keep `events` as jsonb.** `derive()` already rebuilds a game from its event log, so the DB
  hands back the same object `saveRoles()` writes today and `js/stats.js` is untouched —
  **group stats come free**.
- **Skip the friend graph initially** (groups + invite codes do the real job), and **stay
  local-first** so a basement hotspot is never on the critical path of recording a game.
- Full design — schema, RLS policies, the `security definer` recursion gotcha, sync strategy,
  phases — is committed as **`BACKEND_PLAN.md`**.

**What I implemented (phase 0 of that plan): data export / import.**
- Every saved game now carries a stable **UUID** (`Stats.uuid()`), assigned on record and
  **backfilled** onto older records by `loadGames()` (writes once, then a no-op). It is the
  dedupe key on import and the **idempotency key for the future sync** — a retried upload can
  never insert a game twice.
- **Export data** downloads a dated `{app, schema, exportedAt, games[]}` envelope.
- **Import data** merges one back **additively and idempotently**: same-id games are skipped, so
  re-importing a file, or merging two devices' overlapping archives, is harmless. It refuses a
  foreign `app`, a newer `schema`, and records missing `result`/`events` — each with a readable
  reason via `showToast()` (no native dialogs).
- This is simultaneously the **backup** against cleared site data, the **device-transfer** path,
  and the **payload that will seed a cloud account** on first login — which is exactly why it
  was built before the backend.

**Verified:** 24 assertions in Node against `js/stats.js` with a stubbed `localStorage` (id
assignment, legacy backfill persisting, round-trip, idempotent re-import, overlapping-archive
merge, four rejected payloads, partial records skipped); then **20 assertions in headless
Chrome driving the real UI** — real button clicks, the real `onchange` handler, real `File`
objects and the real toast (export blob + dated filename, restore onto a wiped device,
re-import creating no duplicates, garbage file, foreign app, future schema, no stray overlay).
One initial failure was a **test** race (a fixed 120ms wait read a stale toast before
`FileReader` resolved) — fixed by polling for the toast to change, not by touching the product.
Layout measured at three viewports: the 3-button row never overflows and `.row` already wraps
on a real 360px phone.

**Also flagged for later** (now in PROGRESS.md): the undo stack grows O(n²) and is
re-serialised on every render, `lsSet()` silently swallows quota errors, `derive()` can't be
unit-tested from Node because it's inside the IIFE, and there is no `aria`/keyboard support
anywhere.

**Blocked on the user:** creating the Supabase project and handing over the project URL + anon
key (both safe to commit — RLS is the security boundary). Everything up to that point is done.

**Mid-session correction — the free/sustainable constraint.** The user then set a hard
requirement: the backend must be **permanently free, sustainable long-term**, with me doing all
the work and them getting exact instructions. That **changed the choice from Supabase to
Firebase (Spark plan)**: Supabase's free tier **pauses a project after ~1 week idle** and needs a
manual restore, which is exactly the wrong failure mode for sporadic game nights. Firebase
doesn't pause, needs no card, and its daily quotas (50k reads / 20k writes / 1 GiB ≈ 200,000
games) dwarf this app's usage. Cloudflare Workers+D1 was considered and rejected: free and
never-sleeping, but it has no auth, and hand-rolling sign-in is security-critical code not worth
owning. The binding new constraint is **no Cloud Functions** (paid plan only), so *everything*
must work from the client SDK + security rules — including joining a group by invite, which is
done as a rules-checked self-add (`memberUids.concat([uid])` with every other field pinned),
with `get` open on a group but `list` closed so ids can't be enumerated. `BACKEND_PLAN.md` was
rewritten accordingly and now ends with **exact click-by-click console setup instructions** —
the only part the user has to do.

---

## Session 17 — phase 1: accounts and cross-device sync

**User decisions that shaped it:** duplicates are a non-issue ("the players will be in the room
recording it"), guests without accounts are permanent, and free-typed player names stay allowed.
Then: build it.

**The load-bearing architectural choice: sync sits BEHIND localStorage.** `js/cloud.js` is a
background reconciler — it pushes local games up and pulls remote ones down, writing into the
same `secretHitler.games.v1` array the app has always read. `app.js` and `stats.js` were not
taught about the network at all; **`stats.js` needed zero changes**. That is what keeps the app
fully working offline and signed-out, and means a sync bug can never break a game in progress.

**Second choice: everything is a group.** A solo user gets an auto-created group of one ("My
Games"), so there is one data model and personal stats *are* group stats — and inviting someone
into an existing archive will be free in phase 2 instead of a migration. It also meant **the
already-deployed security rules needed no changes**. Groups are discovered via
`profiles/{uid}.groupIds`, since the rules deny listing `/groups`.

**Built:**
- `js/cloud.js` — the app's only ES module, loading Firebase from a CDN so there is still **no
  build step**. It exposes `window.Cloud` and fires `cloud:*` DOM events; `app.js` stays a
  classic script. If the module never loads, the app degrades to exactly its old behaviour.
- Account UI: a top-bar chip with a colour-coded sync dot (synced / pending / syncing / error)
  and an overlay for Google or email+password sign-in, sync status, manual sync, and sign-out.
- **Upload consent, asked once per account.** Signing in must never silently absorb a shared
  device's history into whichever account logged in, so the app asks before the first upload;
  downloading is always allowed. `askConfirm()` gained an optional `onNo`, deliberately *not*
  fired by the back arrow — dismissing leaves the question unanswered instead of recording a
  choice the user never made.
- Auto-sync on recording a game, on reconnect, and manually.

**Testing was the hard part.** The old headless recipe (`--virtual-time-budget --dump-dom`) does
not work here: Firebase Auth's IndexedDB initialisation never completes under virtual time, so
`onAuthStateChanged` never fires and the page hangs. Replaced with a **CDP driver over real
time** (`cdp.js`) using Node 24's built-in `WebSocket` — no dependency added. Worth keeping for
any future async/network work.

**Verified end to end against the real project — 27 assertions, all passing:** account creation,
solo-group auto-creation, the consent dialog actually appearing and being *clicked*, uploading 2
games, auto-upload on recording a third, then **simulating a second device** by wiping local
storage and syncing to pull all 3 back — checking the full event log, nested Policy Peek data and
player names all survive the round trip — plus idempotent re-sync (0/0, no duplicates) and
sign-out leaving local games intact. The 24-assertion export/import suite still passes. Both test
accounts deleted and the database purged back to empty.

**Left for phase 2:** groups, invite links, member rosters, and seat→member mapping.

---

## Session 18 — phase 2: groups

**Shipped:** create/name groups, invite links, a shared member roster (guests included), a group
switcher, and stats scoped to the active group. Two accounts can now read and contribute to the
same archive.

**Design points worth keeping:**
- **Seats are resolved at UPLOAD time, not when a game is recorded.** Free typing stays free at
  the table (recording never touches the network); when the game syncs, each name is matched
  case-insensitively to a roster member, creating one if new. Names are stored *alongside* seat
  ids so a game still reads correctly if the roster is unavailable.
- **Invite ids are captured before sign-in.** A visitor following a link usually has no account,
  so `?join=` is stashed, stripped from the URL (a refresh or shared screenshot must not
  re-trigger it), and applied once an account exists.
- **`Stats.loadAllGames()` vs `Stats.loadGames()`.** Scoping statistics to a group meant reads
  had to be filtered while **writes must never be** — saving a filtered list would delete other
  groups' games. Every write path was moved to `loadAllGames()`.

**The bug that ate the session, and how it was actually found.** B could join a group but then
got `permission-denied` reading anything in it. Rather than guess, I bisected with two focused
Node repros: (1) the same join through the SDK — **passed**, proving the security rules were
correct; (2) the same thing through a *single* Firebase instance with a sign-out/sign-in between
— also **passed**, killing the "stale credentials" theory. A browser probe then showed the real
shape: right after joining, `inArray=true` and the token was correct, yet subcollection reads
were refused — and 5 seconds later **games had recovered while the roster had not**. So the
rules engine can still be evaluating `isMember` against a pre-join view of the group document.
Fixed with `withRetry()` on `permission-denied` plus making the roster seat **best-effort** —
deferred to the next sync rather than failing the whole join. The lesson: three cheap
experiments beat any amount of reasoning about which layer was lying.

**Verified:** 30 group assertions against the real project with two real accounts — isolation
before joining, a real invite link, two-way contribution, roster reuse without duplicates, and
group-switching hiding the other group's games. Phase-1 sync (27) and export/import (24) both
still pass; W3C clean. All test accounts deleted and the database purged.

---

## Session 19 — correcting history, plus reliability

**User asked for:** "make the improvements you think would be good", with an invitation to ask
about direction.

**Chosen on the merits, in priority order:**

1. **Editable / deletable history entries** — the biggest real-world gap. Undo only ever stepped
   back from the *end*, so a mis-tap noticed three governments later meant unwinding the whole
   game. Every history row now has a ✎ button opening an in-app editor: change the claimed hand,
   toggle Conflict/Veto, flip a chaos policy, or delete the entry.
   - It's cheap because everything is derived: "mutate the event, re-derive" recomputes the
     board, piles, rotation, term limits and probabilities for free.
   - The subtle part is what is **not** derived. `afterHistoryEdit()` clears pending power and
     pending chaos, recomputes `gameOver`/`autoResult` (an executed or elected Hitler still ends
     the game), and **strips a presidential power from a government that no longer enacts
     Fascist**, since the policy that granted it no longer exists.
   - Edits go through `pushUndo()`, so a bad correction is itself undoable.

2. **Two reliability bugs flagged back in session 16 and never fixed.**
   - `lsSet()` swallowed `QuotaExceededError`, so a full localStorage silently stopped persisting
     the game and the next refresh lost it. It now warns once and points at Export.
   - The undo stack was uncapped; each entry is a full-state snapshot and `saveActive()`
     re-serialises the whole stack on **every render**, so it grew O(n²). Capped at 25.

3. **Group rename + leave** — holes opened by shipping phase 2. Leaving is refused when you are
   the only member, so a group can't be orphaned with no one able to administer it.

**Verified:** a new 22-assertion editing suite drives the *real* UI — plays three governments,
edits a Bronze into a Coal and checks the board flips 2L/1F → 1L/2F, checks the draw pile
recomposes, deletes an entry and confirms recalculation, **undoes the delete and confirms both
the entry and the board come back**, then deletes a failed election and confirms the tracker
resets. Group suite now 36 assertions (rename/leave added), phase-1 sync 27, export/import 24 —
all passing, W3C clean, test accounts deleted and the database purged.

**Open question put to the user:** what the app should become next — an honesty posterior
(changing the headline number), vote tracking, phase 3 (friends/guest-linking), or polish.

---

## Session 20 — phase 3, and hardening the security rules

**User's brief:** "do whatever you think we'll eventually do in the long run." So: finish the
backend plan, and fix the things that get harder to change the longer they're live — the rules.

**Security hardening first (the part that actually mattered).** Reviewing what was exposed found
three real weaknesses, all now closed and adversarially tested:
- **Any signed-in user could enumerate every account on the service.** `allow read` on
  `/profiles/{userId}` covers `list` as well as `get`, so the whole user table — including
  display names — was readable. Now `get` only.
- **Any group member could steal another member's identity.** The roster's `uid` field decides
  whose history a seat belongs to, and members could edit it freely. Now `uid` may only be set to
  your own, only on an unclaimed seat, and only released by its owner.
- **Invite links could never be revoked.** Added `joinOpen`, pinned in the join branch so a
  would-be joiner can't re-open a closed group to let themselves in. Read via
  `resource.data.get('joinOpen', true)` so groups created before the field still work.

**Phase 3 shipped:**
- **Guest linking** — "That's me" on a guest seat. This is the payoff of separating *user* from
  *seat* in the original data model: one field, and a player's whole history becomes theirs.
- **Invitations by person instead of a friend graph.** `profiles/{uid}/invites/{groupId}` is an
  inbox; "people you've played with" is derived from members of your own groups who have
  accounts. No requests, no accept/decline state, nothing to keep in sync — and the invite
  carries no access by itself, so a closed group still can't be entered. This is deliberately
  *not* what the plan originally sketched: the friend graph was the low-value half, and this
  delivers the actual user-facing capability at a fraction of the surface area.
- **Roster removal** for guests, and the invite-revocation toggle.

**Verified:** rules suite now **49 adversarial assertions** (up from 32) and a new **29-assertion
phase-3 suite** driving two real accounts through closing a group, being refused, re-opening,
inviting by person, accepting from the inbox, claiming a guest seat, and appearing in the other
user's acquaintance list. Regressions all pass: groups 36, phase-1 sync 27, history editing 22,
export/import 24. **All 15 leftover test accounts purged** (enumerated with `firebase auth:export`
and deleted by deriving each password from its email — the real account was explicitly skipped)
and the database emptied.

**What's left:** the honesty posterior is now the biggest open idea; vote tracking remains
undecided; accessibility is untouched.
