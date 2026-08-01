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

---

## Session 21 — honesty posterior: theory only

**User's brief:** start on "how likely was this claim to be honest", but **planning and theory
only** — no design, no integration, no code. Use hard logic rather than hand-waving, and look at
how other people have approached it.

**Output: `HONESTY_MODEL.md`** (new). Nothing was implemented.

**The core diagnosis.** The current headline number is a *likelihood* — "if this president were
honest, how surprising was the hand?" — being read as a *posterior* — "how likely is this a lie?".
The gap isn't cosmetic: without `P(claim | lying)` and a prior, rarity alone can point the wrong
way, because a competent liar never picks an implausible story.

**The structural insight the whole plan rests on.** Because the round pool `(N, L)` is known and
`Σ h_j + r = L` with `r ≤ R ≤ 2`, the *total net lying in a round is pinned to within two cards*.
So this is not a detection problem, it's an **attribution problem** — a known mass of lying to
distribute across seats. It also explains what the round-modifier stepper always was: a hand-set
point estimate of exactly that aggregate. Marginalising over it *is* the honesty posterior, which
is why this retires the stepper rather than sitting beside it.

**Structure of the model:** hard logic first (enacted-card constraints, a minimum-lie DP, the
Policy-Peek-vs-next-hand cross-check the app already has the data for, and the free deduction that
a chancellor elected after 3F who didn't end the game is *certainly not Hitler*), then an explicit
generative story (deal → president's pass → chancellor's enact → each one's public claim) with
*acting* fascist and *talking* fascist parameterised separately. Inference is **exact** — role
assignments enumerate to ≤360, hands are a forward–backward DP over the running liberal count, so
a whole game is ~600k flops with no sampling. It provably reduces to the current §4 retrospective
formula when nobody lies, which is the first test to write.

**Calibration is the part nobody else can do.** Published analyses guess their lie rates; GRAIL
learned theirs from ~104k logged Avalon games. The archive already stores every claim *and* the
recorded true roles, so EM with closed-form M-steps fits `ε, λ, β, γ, s` from the user's own group,
with Beta shrinkage giving genuine per-player lie tendencies.

**Sources consulted:** Aslaksen (UiO) for the canonical 2F ⇒ 3/4 result — which the model
reproduces as a special case; a LessWrong scenario analysis for the bold/timid fascist split (and
as a cautionary example of hand-Bayes going wrong); TartanLlama's stats chapter; the Cornell
INFO 2040 testing-the-chancellor argument; GRAIL (arXiv 2506.17788) and Strategema.

**Flagged for a product decision before any build:** the app sits on a shared table, and a
calibrated public "72% fascist" readout is a different game from Secret Hitler.

---

## Session 21b — reviewing the plan, then building v1

**User's brief:** review the honesty plan for major flaws, fix the gaps, then start implementing —
with a **settings switch** that gates every addition (off ⇒ nothing new is shown).

**The review found eight problems; three mattered.** Written up as `HONESTY_MODEL.md` §11.

1. **A live bug in the shipped engine (F2).** `retrospectiveProb()` and `derive()` both compute the
   round's unseen remainder as `N − 3G`, never subtracting **chaos top-decks**. A chaos removes a
   card without being a government, so `R` was too big; worse, the chaos card's colour is *public*
   and was being thrown away as if unseen; worst, `bottomLibs` ignored `chaosLib` while `drawLibs`
   subtracted it — the two were inconsistent with each other. This corrupted the existing
   headline % in any round containing a chaos, and it happens to break exactly the conservation
   identity the whole honesty model rests on. Fixed first, independently of the feature.
2. **§1 overstated the conservation law (F1).** "Total lying is pinned to within 2 cards" is true
   at a *round boundary* only; mid-round the draw pile absorbs the slack. The model's power
   arrives in bursts at reshuffles. `R` is now surfaced as an explicit evidence-strength measure
   rather than pretending an early-round number is worth as much as a late-round one.
3. **The plan was over-parameterised (F4) and over-reaching (F6).** Fitting nine parameters by EM
   over a few hundred latent-hand observations would produce confident nonsense, and per-player
   "% fascist" on a shared table is the worst version of this feature. **v1 fits nothing** and
   stops at pricing *claims*, not indicting people.

Also: D4/D5 turned out to be near-vacuous because `enacted` is *derived* from the claim (F3) — but
the review found a **stronger constraint that is reachable**: a claimed **1F2L + Conflict** asserts
"I passed LL" while a fascist policy was enacted, which no chancellor can produce. Implemented that
instead.

**Shipped:** `js/honesty.js` — the min-lie DP and the honesty posterior on **one recursion**, run
as min-plus for certainties and sum-product for probabilities, so the two layers can't disagree
about feasibility. A new **⚙ Settings** panel with the **Lie detection** switch, off by default;
every added element carries `.lie-col` and is CSS-gated on `body.lie-on`.

**Verified:** `node test/honesty.test.js` → **39 assertions, all passing**, including a
**brute-force cross-check** of the DP marginals against an independently written enumeration
across five rounds and six parameter settings (max diff < 1e-9) — so a recursion bug can't hide
behind a plausible-looking number. Then a **21-assertion headless-Chrome run** driving the real UI:
build a 5-player game, record three governments (the third arming Conflict on a 1F2L claim), and
assert the column/summary are invisible with the switch off, appear with it on, show `95.9% |
88.8% | story impossible`, persist to localStorage, and vanish again when switched back off.
One test expectation was wrong on the first run (I predicted `minLies = 2` where the maths forces
3) — the engine was right.

**Wording rule adopted as load-bearing:** findings are about *claims*, never people, and always
offer the recording-error alternative. The maths is certain; the data entry isn't.

---

## Session 22 — make lie detection visible: in-game gear + on by default

Two small follow-ups from the user:
- **The gear vanished mid-game.** The global `#topbar` (which holds ⚙) is deliberately hidden on
  the game screen, which has its own tab bar — so Settings was unreachable once a game started.
  Added a second gear, `#btnSettingsGame`, into the in-game tab bar (right side, before Quit);
  both gears call `openSettings()`.
- **Lie detection now defaults ON.** `settings.lieDetection` starts `true`, and `loadSettings()`
  only overrides it when a boolean is actually stored — so a user who turned it off keeps it off,
  but a fresh visitor sees it working with no setup. Updated the panel copy accordingly.

**Verified:** 10-assertion headless-Chrome run — confirms the default is on with no stored choice,
the global gear is hidden in-game while `#btnSettingsGame` is visible and opens Settings, verdicts
(`95.9% | 88.8% | story impossible`) render immediately with no setup, and turning it off from
inside a game hides everything and persists `{"lieDetection":false}`.

---

## Session 22b — make the verdict actually visible (inline badge, not a hidden column)

User still couldn't see anything with the feature on. A headless screenshot showed why: the
verdict was the LAST column of the History table, and that table scrolls horizontally on a phone —
so the Claim column (like the pre-existing Odds column) was off the right edge. On desktop it was
fine; on a narrow screen only the top summary bar showed.

**Fix:** moved the per-claim verdict out of the trailing column and into an inline **badge in the
Event cell** (`lieBadge()`), beside the ratio name where the conflict/veto badges already live —
always on screen, no side-scroll. Dropped the standalone `.lie-col` table column and its header.
Verdicts now read "95.9% honest" / "must be true" / "can't be true" / "story impossible".

**Verified:** phone (390px) and desktop (1100px) screenshots both show the badges clearly; a
9-assertion headless run confirms three badges render and are on-screen, toggle off removes them
and toggle on restores them; 39 Node unit tests still green.

---

## Session 23 — role posterior: P(each player is fascist), stored in stats

**User's brief:** turn the lie-detection math into odds of each player being liberal or fascist;
theory first, then build; **store the odds in game statistics for now**.

This is the role posterior deferred as "v2" in the HONESTY_MODEL §11 review (F6). Built it in the
safe shape that review argued for: compute + store + show post-game, but NOT live on the table.

**Theory:** same generative model, read the other way. Enumerate every assignment of
`f = ceil(n/2)−1` fascists to `n` players (≤120 for 10p — small enough to enumerate exactly, no
belief propagation needed). Score each assignment by how well it explains the whole game, using
team-conditioned weights on the SAME round-conservation DP the honesty engine already runs: a
fascist president buries a liberal (rate β), a fascist chancellor enacts fascist from a mixed pass
(rate γ), fascists lie about their hand more (facLie ≫ libLie), and a conflict splits blame between
president (false accusation) and chancellor (buried the liberal) exactly per §5. Pin the certain
fascists (Hitler elected Chancellor / Hitler executed). Marginalise → per-seat P(fascist).

**Built:** `Honesty.analyzeGame()` in `honesty.js`. In `app.js`, `analyzeRoles()` builds its input
from the derived rounds and runs it live (gated by the switch, on `derive().roleOdds`);
`computeRoleOdds()` snapshots it onto every saved game **unconditionally** (so the record always
carries it). Shown in the read-only review via `roleOddsHtml()` — a ranked bar list scored ✓/✗
against the recorded roles (prediction beside ground truth = the calibration substrate for §7).
**Not** shown live on the shared table; the public per-player readout stays the open §10.4 question.

**Verified:**
- 52 Node assertions (was 39): role invariants (marginals sum to the fascist count; no-evidence →
  base rate f/n; a revealed fascist pins to 1; a fascist-enacting president rises above base while
  a clean one drops; a conflict lifts BOTH participants), and a **fully independent brute-force
  cross-check** of the role marginals (nested enumeration over assignments × hand-vectors, max diff
  < 1e-9) on two multi-round games incl. chaos and conflict.
- A 10-assertion headless-Chrome run playing a real game to a Liberal win, recording roles,
  and confirming: `roleOdds` is stored on the record, sums to the fascist count (2 for 5p, incl.
  Hitler — a test assertion I first got wrong by forgetting Hitler counts), the conflict president
  reads ~100%, and the review renders the ranked read scored against the truth. Screenshot
  confirmed: the model put both actual fascists (Cid 100%, Eve/Hitler 61%) on top with ✓, the
  three liberals below with ✗ — a correct read from play alone.

**Note for later:** cloud upload is unaffected — the Firestore rules require certain fields to
exist but don't whitelist, so the extra `roleOdds` field is accepted. Whether cloud.js forwards it
upward wasn't changed; local storage (the ask) carries it regardless.

---

## Session 24 — fascist odds on the table (opt-in) + improvement brainstorm

**User's brief:** add a setting to show fascist odds next to each player's circle; and brainstorm
how the fascist/liberal odds math could be improved.

**Built:** a second, independent setting **"Fascist odds on the table"** (`settings.boardOdds`,
off by default) that renders a live fascist-% chip beside every circle during play (`.seat-odds`,
coloured hi/mid/lo). It's separate from lie detection on purpose — this is the shared-table readout
§10.4 warns changes the game — and `rolesOn()` now computes `roleOdds` when EITHER setting is on,
so board odds work even with lie detection off. The chip hides once roles are recorded (the circle
colours instead).

**Verified:** 11-assertion headless run — off by default, no chips; both toggles present; turning
board odds on puts a % chip on all five circles; persists; and still shows with lie detection off.
Screenshot confirmed clean chips (Cid 89% red as the conflict president, others low/blue). 52 unit
tests unchanged/green.

**Brainstorm** written up as `HONESTY_MODEL.md` §12 (durable). Headline: the model currently uses
only claim + enacted + conflict; the biggest cheap wins are signals already in the event log —
**nominations (who picks whom as chancellor)**, **investigation results**, **policy-peek vs next
hand**. Then model-fidelity fixes: **state-dependent β/γ** (stop over-penalising forced early
fascist policies) and **modelling Hitler as a cautious distinct role** (a well-played Hitler is
currently under-detected). Higher-ceiling but costs data entry: **chancellor's claim**, **votes**.
And the meta-move: **a calibration harness** — every saved game now stores the prediction beside
the truth, so Brier/log-loss + a reliability diagram would tell us, from the user's own games,
whether the model beats guessing. **Recommendation: nominations + calibration harness next.**

---

## Session 25 — all the fascist-odds improvements (Tiers 1–2 + calibration)

**User's brief:** make all the improvements I think we should make, in order.

Did every improvement that uses signals **already recorded** (no new table burden), plus the
calibration harness. Deliberately deferred the two that need new in-game data capture — **votes**
and the **chancellor's claim** — since those change the recording flow and are a product call; and
EM parameter-fitting, which needs data volume the calibration harness now measures.

**`honesty.js` — `analyzeGame` rewritten.** The assignment space is now every **(fascist-set,
Hitler)** pair (≤360), and it outputs both `P(fascist)` and `P(Hitler)` per seat. New per-assignment
likelihood factors, all from the existing event log:
- **Nominations** — a fascist who knows allies (ordinary fascists always; Hitler only in 5–6p)
  nominates one preferentially.
- **Investigations** — a liberal investigator reports truth (μ slip), a fascist may lie; a liberal
  investigator's report is therefore a near-hard constraint that collapses the assignment space.
- **Executions** — a fascist rarely kills an ally.
- **Special elections** — a fascist elevates an ally.
- **Policy-peek vs. next hand** — the peek names the top 3, which the next government draws; a
  disagreement between the peek and that government's claim implicates both seats.
- **State-dependent β/γ** — push rates rise with fascist progress / liberal threat, so a forced
  early fascist policy no longer implicates as hard as a late pushed one.
- **Cautious Hitler (7+)** — blind to the fascists, plays liberal-safe; fixes the under-detection
  of a well-played Hitler. Hard "not Hitler" deductions (chancellor past 3F, executed non-Hitler)
  and exact reveals (Hitler elected/executed) feed in.

**`app.js`** — `derive()` now records `facBefore/libBefore` per government; `analyzeRoles()` builds
all the new inputs (powers → investigations/kills/specials, peek cross-checks, forced/not-Hitler)
and returns the full result; games store both `roleOdds` and `roleHitler`.

**Calibration harness** — a **Model calibration** panel on the Statistics screen (gated by lie
detection): Brier skill vs the base rate, top-f suspect accuracy, and a reliability breakdown,
computed from the stored predictions vs the recorded roles. Needs ≥3 games.

**Verified:**
- **64 Node assertions** (was 52), including a **from-scratch brute-force mirror** of the new
  engine — both pFascist and pHitler, with every factor (nominations, investigations, kills,
  specials, peeks) on multi-round games incl. chaos/conflict/veto, max diff < 1e-9 — plus
  directional sanity for each new signal, and the invariants (marginals sum to f; pHitler sums to
  1; a proven not-Hitler reads 0). Caught and fixed one real bug mid-build (a liberal chancellor's
  γ was inverted).
- Headless: an 8-assertion run (3 games → `roleHitler` stored, pHitler sums to 1, calibration panel
  renders) and a 7-assertion run triggering a real **investigation** power in a 7-player game
  (board odds + history render, no NaN/crash). Screenshot of the calibration panel confirmed.

**Still deferred (with reason):** correlated fascist behaviour (costs the DP's clean factorisation);
chancellor-claim capture + vote tracking (new data entry, product call); EM fitting + per-player
tendencies (needs data — the calibration harness is the prerequisite); uncertainty ranges.

---

## Session 26 — History badge now shows fascist %, not honesty %

**User's brief:** the percentage in History should be percent fascist, not percent honest/liberal.

Changed the History "Event"-cell badge (`lieBadge`) from the per-claim "X% honest" to the
**President's fascist odds** ("82% fascist", coloured hi/mid/lo like the board chips). The hard
claim-certainties still surface as a red flag ("claim can't be true" / "story impossible") since
those are prior-free facts worth keeping; dropped "must be true" and the "% honest" number. The
per-claim honesty engine still drives those flags and the round summary bar — only the badge's
number changed to the role model's P(fascist) for that government's president.

Note the fascist % is game-level, so a President reads the same number on each of their rows.

Verified: 4-assertion headless run (every gov row shows "% fascist", none say "honest"/"liberal",
the impossible-claim flag is preserved) + screenshot (Bob 82% / Dee 2% / Cid 96%, two flagged
"story impossible"). 64 unit tests unchanged.

---

## Session 27 — powers as claims: investigation & policy-peek lie math

**User's brief:** treat Policy Peek and Investigation as claims — do the lie math on them, and let
that inform the fascist/liberal odds.

Both powers are the president privately seeing something and publicly announcing it, so each is a
claim that can be a lie:

- **Investigation** — the president sees a target's party card and announces a party. Under any role
  assignment the target's true party is fixed, so `P(claim is a lie) = P(target's true party ≠
  announced)` = the target's fascist odds read the right way (announced Fascist ⇒ lie iff the target
  is Liberal). Surfaced in History as "NN% likely a lie". The role model already consumed it
  (`investigationFactor`): a liberal investigator's report is near-truth, so it both moves the
  target's odds and — if the call looks false — the president's.
- **Policy Peek** — the peeked top-3 cards are exactly the next government's hand, so I upgraded it
  from the old agreement-only `peekChecks` to a proper **in-DP report**: the peek is scored as the
  peeker *reporting that hand* with their own lie model, inside the round conservation DP. A peek
  contradicted by the drawn hand pushes the peeker's fascist odds up. History shows `1 − P(next hand
  had the claimed liberal count)`, an independent check against the cards actually drawn
  ("unverified" if reshuffled first).

**Verified:** 64 Node assertions still green — the from-scratch brute-force mirror now includes the
in-DP peek report (max diff < 1e-9), and a rewritten peek sanity test (a peeker whose peek is
contradicted reads more fascist than a bystander). Headless E2E (6 assertions): a real 7-player
investigation shows "🔍 …, Fascist · 29% likely a lie · 46% fascist", and a real 5-player peek that
claimed all-fascist top cards then saw the next government draw 3 liberals shows
"👁 F·F·F · 100% likely a lie · 89% fascist" — the peeker correctly outed as a near-certain liar.

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
