# PROGRESS — Secret Hitler Companion

> **Read this file first when resuming.** It is the single source of truth for where the
> project stands. Update it whenever something meaningful changes.

_Last updated: 2026-07-21 (initial build)_

## What this project is
A website companion/analyzer for the board game **Secret Hitler**. Not the game engine —
a tool used alongside a real table game. Three feature pillars for now (online play comes
later):
1. **Randomization** — seat order + first President.
2. **Probability** — for each government, the likelihood the President truly got the hand
   they claim, using a *retrospective* hypergeometric model (updates as the round unfolds).
3. **Game statistics** — per-player and cross-game data (stored in the browser).

## Current status: ✅ v1 built, tested, deployed
- Static site (HTML/CSS/vanilla JS), hosted on **GitHub Pages**.
- Passed a headless-Chrome end-to-end smoke test (add players → randomize → record
  governments → end game → save → stats) with **no runtime errors**.

## Repository / hosting
- GitHub repo: **https://github.com/TimothyHadfield/secret-hitler-companion** — public.
- Live site: **https://timothyhadfield.github.io/secret-hitler-companion/** (may take 1–2 min to go live on first deploy).
- Deploy model: push to `main` → GitHub Pages serves the root. No build step (plain static).

## File map
| File | Purpose |
|------|---------|
| `index.html` | App shell + all screens (setup / game / end / stats). |
| `styles.css` | Theme + layout (round table, boards, forms). |
| `js/probability.js` | Pure probability engine (hypergeometric + retrospective conditional). Tested. |
| `js/stats.js` | localStorage persistence + per-player / cross-game aggregation. |
| `js/app.js` | State, randomization, pile bookkeeping, rendering, event wiring. |
| `SECRET_HITLER_RULES.md` | Canonical rules reference the app encodes. |
| `PROBABILITY_MODEL.md` | Full math/game-theory derivation of the probability model. |
| `CHAT.md` | Running log of user instructions + what changed each session. |
| `PROGRESS.md` | This file. |

## Key design decisions (locked)
- **Retrospective probability is the headline %** (user's choice): each government's odds are
  conditioned on all *other* observed governments in the same round, so they update live.
  Formula + worked example in `PROBABILITY_MODEL.md`.
- **Modifier is ROUND-LEVEL only** (per-presidency modifier removed, per user). Each
  government's hand is taken at its *claimed* value; the single round modifier `m` shifts the
  round pool's effective liberal count `effL = startL + m`, which reprices every hand in the
  round and sets the inferred bottom cards. `m < 0` ⇒ liberals were hidden (fewer liberals
  remain); `m > 0` ⇒ the rarer "lied up".
- **Modifier is bounded to physically-possible values** and auto-clamped: feasible window is
  `effL ∈ [claimSum, claimSum+R]` intersected with `[0,startN]` and the ±(#presidents) cap.
  If a recorded claim is impossible at the current modifier (e.g. 3 fascists drawn when the
  pool held ≤2), the modifier **auto-adjusts** into the feasible window (may exceed the
  ±#presidents cap → shown as "auto-adjusted"). The physical window is provably non-empty.
- **Enacted policy is inferred, not asked:** Coal(3F)→Fascist, Bronze(3L)→Liberal,
  Golden/Silver default→Liberal. A **Conflict** toggle (Golden/Silver only) forces Fascist and
  labels it "conflict (chancellor)".
- **Event model:** `state.events` is ordered and mixed: `gov` / `fail` / `chaos`. Failed
  elections advance the tracker; the 3rd triggers a chaos top-deck (1 card removed, board
  updated, tracker reset).
- **Round boundary = reshuffle** (draw pile < 3). Probability never crosses it. Each round
  starts from a known pool `17 − enacted`.
- **Stats:** browser `localStorage` only for now (key `secretHitler.games.v1`).
- **Repo:** public (needed for free GitHub Pages).

## Implemented features
- Player entry (5–10), remove, validation.
- Randomized seating + random first President (marked with ①).
- Round-table view: players around an ellipse, President (🔨)/Chancellor (🎖) highlight,
  per-player mini history hand + retrospective odds + conflict tag + failed-election ✕ marks.
- **Redesigned Secret-Hitler-style boards** (original stylized CSS, not the printed art):
  red Fascist board with power icons by player count, blue Liberal board, policy cards, and
  the **election tracker** (3 dots). Live draw & discard pile composition.
- **Policy-card animation:** the enacted card flies from the acting President's seat to the
  track slot (chaos cards fly from the draw pile).
- "Next hand odds" panel (hypergeometric distribution for the upcoming draw).
- Record-government form: President/Chancellor selects, **Golden/Silver/Bronze/Coal** ratio
  buttons on a red→blue colour scale, and a **Conflict** toggle. Enacted policy is inferred.
- **Chancellor auto-rotates** to the next seat after the first is assigned manually.
- **Failed presidency** button → election tracker +1; at 3 an automatic **chaos top-deck**
  (asks only for the revealed policy). ✕ marks recorded by the player.
- **Undo last** button reverses the most recent event and restores the turn state.
- Round-level liberal modifier, bounded to feasible values with auto-adjust; inferred bottom
  cards on round completion.
- Automatic reshuffle detection and round advancement.
- End-game: pick winner, Hitler, and other Fascists → saved to stats.
- Statistics screen: cross-game summary + per-player table (incl. conflicts).

## Known limitations / not yet done
- No online/multiplayer play (planned pillar; needs a backend).
- No enforcement of term limits, votes, veto, or power *usage* (companion assumes honest
  table play). Powers are shown on the board but not triggered/tracked as actions.
- Chaos policy (auto-enact on 3 failed elections) is not yet a distinct recordable event
  (currently everything is modeled as 3-card governments).
- Round-level modifier is a coarse speculative lever; per-government modifiers are the
  precise ones. Overlap is intentional but could be unified later.
- No prior/posterior on *whether* a President lied — the model computes P(hand | assumed
  lies), not the likelihood the claim is honest. (Noted as a future enhancement.)

## Next candidate steps (not started)
- Persist an in-progress game to localStorage (resume after refresh).
- Editable/deletable history rows (fix a misrecorded government).
- Record chaos policies and power actions (investigations, executions → mark players dead).
- Probability calculations pillar expansion: posterior "honesty" estimate.
- Begin online-play architecture (backend, rooms).
- Richer statistics (per-player liberal/fascist win rates, favorite chancellor pairings).
