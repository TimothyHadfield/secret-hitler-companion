# Secret Hitler — Companion

A web companion & analyzer for the board game **Secret Hitler**. Use it alongside a real
table game for **randomization**, live **probability** analysis, and **statistics**.
Online play is planned for a later phase.

🔗 **Live site:** https://timothyhadfield.github.io/secret-hitler-companion/
📦 **Repo:** https://github.com/TimothyHadfield/secret-hitler-companion

## Features
- **Randomization** — shuffles seating and picks the first President.
- **Bird's-eye table** — players seated around a rectangular table (top/bottom only on phones,
  all four sides on a laptop, never on a corner). Each President's hands, the retrospective
  odds of each, and any power outcomes are listed by their seat.
- **Boards & piles** — Fascist (6) and Liberal (5) tracks with the power markers for your
  player count, plus live draw/discard pile composition.
- **Probability** — a *retrospective* hypergeometric model: each government's odds update as
  more of the round is revealed, with the draw odds for each option shown on the buttons.
- **Lie modeling** — a per-round "liberal modifier" to explore what the numbers look like if
  Presidents lied about their discards. It is bounded to physically possible values and
  auto-adjusts if a recorded claim would otherwise be impossible.
- **Reshuffle handling** — automatically detects the round boundary (draw pile < 3), reveals
  the inferred bottom cards, and starts a fresh, independent probability round.
- **Presidential powers** — Investigation, Policy Peek, Execution and Special Election pause
  play with a prompt and are recorded against the President who used them.
- **Rules it enforces** — term limits (including the 5-players-alive exception and the chaos
  reset), veto after 5 Fascist policies, no investigating the same player twice, and correct
  presidential rotation through (even nested) Special Elections.
- **Undo & resume** — full-state undo of any action, and the in-progress game is saved locally
  so a refresh, a closed tab or a redeploy picks up exactly where you left off.
- **Statistics** — in-depth per-player and cross-game stats saved in your browser, plus a
  read-only review of every finished game.

## How to use
1. Add 5–10 players and press **Randomize seating & start**.
2. Each round: the President is fixed (gold **P**). **Tap a player** to set the Chancellor
   (blue **C**), then **tap the hand the President claims they drew** — that submits the
   government. The enacted policy is inferred, so you're never asked for it.
   - Use **⚔ Conflict** if the Chancellor enacted a Fascist despite a claimed Liberal.
   - Use **⊘ Veto** (from 5 Fascist policies) if the government was vetoed.
   - Use **Failed presidency** for a rejected election; three in a row triggers Chaos.
3. Adjust a round's **modifier** if you suspect lies — every probability in that round updates.
4. The game ends automatically on 5 Liberal / 6 Fascist policies or an executed Hitler; press
   **⚑ Chancellor was Hitler** to declare that win yourself. Then record Hitler and the
   Fascists to save the game to your statistics.

The **←** arrow at the top-left is always the way back (labelled *undo* during play).

## Documentation
- [`SECRET_HITLER_RULES.md`](SECRET_HITLER_RULES.md) — the rules the app encodes.
- [`PROBABILITY_MODEL.md`](PROBABILITY_MODEL.md) — the math behind the probability display.
- [`PROGRESS.md`](PROGRESS.md) — current status, decisions, and roadmap.
- [`CHAT.md`](CHAT.md) — session-by-session log of changes.

## Tech
Plain static site — HTML + CSS + vanilla JavaScript, no build step, no dependencies.
Deployed via GitHub Pages. All data stays in your browser (`localStorage`).

## Local development
Serve the folder over HTTP (needed for `localStorage`):
```bash
# any static server works, e.g.
python -m http.server 8000
# then open http://localhost:8000
```
