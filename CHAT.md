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
