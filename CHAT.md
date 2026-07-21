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
