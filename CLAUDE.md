# Secret Hitler Companion — notes for Claude

A table companion for the board game Secret Hitler. It seats the players, records every government, and shows live odds of whether each President's claim could be true. It also has statistics, game review/replay, accounts and groups, night narration, editable Rules and Game theory handbooks, and full online play. Tim plays in person with a phone or laptop on the table.

- Live: https://timothyhadfield.github.io/secret-hitler-companion/ (GitHub Pages, deploys on push to `main`)
- Repo: https://github.com/TimothyHadfield/secret-hitler-companion (public)
- State and history: `PROGRESS.md` (read first), `CHAT.md`. Before anything Firebase, read `DATA_SAFETY.md`.

## File map
- `index.html`: app shell (menu, setup, game, stats, rules, theory, online screens and overlays). `styles.css`: all styling.
- `js/app.js`: one IIFE with state, persistence, rendering, powers, review/replay, account and online UI.
- `js/derive.js`: pure rules engine for companion games. All turn state is derived from the event log.
- `js/engine.js`: pure host-authoritative engine for online play. `js/online.js` (ES module): host loop and tables.
- `js/cloud.js` (ES module): Firebase auth, sync, groups, voices, comments, handbook content. `js/firebase-config.js`: public ids.
- `js/probability.js`, `js/honesty.js`, `js/fit.js`: odds, lie detection and role posterior, lie-rate fitting.
- `js/stats.js`: localStorage games store. `js/night.js`: night narration. `js/reference.js`: rules and strategy text.
- `firestore.rules`, `firebase.json`, `firestore.indexes.json`: Firestore config (Spark free plan).
- `SECRET_HITLER_RULES.md`: the real game rules that the code must follow.

## Run, test, deploy
- No build step and no dependencies. To serve locally, run `python -m http.server <port>` in the repo folder and open `http://localhost:<port>/`.
- Tests are plain Node scripts: `node test/honesty.test.js`, `night`, `engine`, `derive`, `fit` and `reference`. Night's IndexedDB part needs `test/node_modules` (`cd test && npm install`).
- Results on 2026-10-16: honesty 73/0, night 42/0, engine 3001/0, derive 49/0, fit 18/0, reference 28/0.
- Deploy means pushing `main`; Pages rebuilds. To check the build: `python ~/.claude/hooks/live-check.py <repo folder>`.

## Traps
- The app has live users and real Firestore data (groups, games, comments). Never write to the live project while testing.
  - To test cloud or online code, route the gstatic Firebase modules to in-memory fakes (Playwright `context.route`).
- Never run `test/rules.prod.test.js` (it hits the live project). Never run `firebase firestore:delete`.
- Changing or deploying `firestore.rules` is Tim's decision.
- Every write to the games list must go through `Stats.loadAllGames()` (raw). Never use the group-scoped view, or other groups' games get deleted.
- Cloud sync sits behind localStorage, and the app works fully offline. `cloud.js` sync merges into a fresh read of localStorage, so a game recorded mid-sync is not lost.
- Online play keeps its own group (`online.js` `gid`) while at a table. Switching the menu group must not move a live table.
- Recorded online games use the companion power shapes:
  - `invest` with `targetIdx` and `party`
  - `special` with `chosenIdx`
  - `peek` with `order`
  - `kill` with `killedIdx` and `wasHitler`
  - `engine.toRecordedGame` converts them, and `derive.js` reads them.
- `askConfirm` escapes its body text, so pass it plain text.
- Overlays are `position: fixed`, so test visibility by the `hidden` class, not by `offsetParent`.
- Reference item ids are comment targets. Never renumber them.
- "Missing on my phone" is usually the browser cache. Tell Tim to hard-refresh.

## Tim's standing instructions (quoted)
- "commit + push to GitHub IMMEDIATELY after every change — don't wait to be asked."
- "There should be no one command that deletes history… users should always trust their game data won't be harmed or deleted, even while the site is being updated."
- "don't delete any recorded game history from any account while doing this."
- "keep the site as simple as possible": no new in-game data entry.
- Always follow the real rules (6 Liberal / 11 Fascist policies). Never show the browser's "site says…" bar; confirmations are designed in the app.
- Original stylised CSS only, never the real game's printed artwork. Match the existing style: vanilla JS, one IIFE in `app.js`, full-redraw rendering.
- "After any meaningful change you MUST update this file + `CHAT.md`" (this applies to `PROGRESS.md`).
