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
