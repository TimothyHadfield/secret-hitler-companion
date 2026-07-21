# Secret Hitler — Companion

A web companion & analyzer for the board game **Secret Hitler**. Use it alongside a real
table game for **randomization**, live **probability** analysis, and **statistics**.
Online play is planned for a later phase.

🔗 **Live site:** https://timothyhadfield.github.io/secret-hitler-companion/
📦 **Repo:** https://github.com/TimothyHadfield/secret-hitler-companion

## Features
- **Randomization** — shuffles seating and picks the first President.
- **Bird's-eye table** — players around a round table, President/Chancellor highlighted,
  each President's history hand + the retrospective odds of that hand shown under their seat.
- **Boards & piles** — Fascist (6) and Liberal (5) tracks with power markers by player count;
  live draw/discard pile composition.
- **Probability** — a *retrospective* hypergeometric model: each government's odds update as
  more of the round is revealed. Plus a "next hand odds" panel for the upcoming draw.
- **Lie modeling** — per-government and per-round "liberal modifiers" to explore what the
  numbers look like if Presidents lied about their discards.
- **Reshuffle handling** — automatically detects the round boundary (draw pile < 3) and
  starts a fresh, independent probability round.
- **Statistics** — per-player and cross-game stats saved in your browser.

## How to use
1. Add 5–10 players and click **Randomize seating & start**.
2. For each government: pick the President & Chancellor, the hand the President **claims**
   they drew, and the policy **enacted**. Set a lie **modifier** if you suspect a lie.
3. Watch the odds and board update. The app reshuffles automatically between rounds.
4. When the game ends, click **End game**, record the winner / Hitler / Fascists, and save
   it to your statistics.

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
