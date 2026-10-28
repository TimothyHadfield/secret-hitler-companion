# Secret Hitler Companion — progress (handoff for Claude)

## START HERE
_Last updated 2026-10-28 (wave 3: home menu fits one screen, vs-computers "Rebalanced start" option, Rules → Videos). Before that 2026-10-27 improve pass: computers, table look, sounds, install, My stats, rules + guided game, player-review fixes, computers in online seats. For Claude only; Tim doesn't read this. Catch-up authorizes nothing: only "Authorized next steps" below is approved work._
1. Read this file (it's short on purpose). There is no `direction.md`.
2. **Before touching anything Firebase, read `DATA_SAFETY.md`** (rule zero). Deep detail on any feature: the pre-migration snapshot `docs/archive/progress-2026-09-21.md` (95 KB, full feature-by-feature notes).
3. Skim the last 3 entries of `CHAT.md`. Sessions 1–27: `docs/archive/chat-archive.md`.

## Goal right now
Improve pass (manager's common brief, 2026-10-27): beat secrethitler.io. Done: play vs computers, table look, sounds, `_pwa` install, `_profile` My stats, `_coach` rules + guided game, player-review fixes, computers in online seats (Tim lifted the Firestore guard 10-27: "I think it'll be okay to enable it to all games for now and we can disable it later if it becomes too much"). Online cost per 7-player game (node simulation of the host loop): before ~930 writes / ~1,270 reads; now 412 / 765 with 7 people, 180 / 148 with 2 people + 5 computers. Further cut (one write per action, clients derive their views) would need a `firestore.rules` change; not done.

## Status
| Area | State | Notes |
|---|---|---|
| Companion game recorder (table, claims, powers, term limits, veto, chaos, undo, history edit) | live | derive-from-events engine in `js/derive.js` |
| Probability (retrospective hypergeometric) | live | `js/probability.js`, `PROBABILITY_MODEL.md` |
| Lie detection + role posterior (P(fascist), P(Hitler)) | live | lie detection ON by default; table fascist-odds chip OFF by default |
| Opt-in lie-rate fitting (`js/fit.js`) | live | per-team only; β/γ deliberately not fitted |
| Statistics, review, replay stepper, labels/favorites, delete, edit roles | live | |
| Accounts, sync, groups, invites, guest linking (Firebase Spark) | live | `BACKEND_PLAN.md` |
| Night narration (device speech + own/shared voices) | live | real voice quality untested (needs device) |
| Rules + Game theory handbooks, admin-editable | live | admin = `timhadfield7@gmail.com`, enforced in `firestore.rules` |
| Online play (host-authoritative) | live | computers fill empty seats (host lobby: count + level; run on the host's device). `test/online.e2e.mjs` = two WebKit phones on the local emulators, full game: `firebase emulators:exec --only firestore,auth --project demo-shtest "node test/online.e2e.mjs"` |
| Play vs computers (5–10 players, Easy/Normal/Hard) | live 10-27 | `js/bots.js` + `js/solo.js`; self-play `test/bots.test.js`, UI `test/solo.browser.test.mjs`; not recorded to Stats |
| Home-screen install + offline (`_pwa` 1.2.0) | live 10-27 | `sw.js`, `js/pwa.js`, manifest, `icons/`; `node test/pwa.check.mjs --engine chromium` (kit check, Firebase blocked) |
| Short rules + guided first game (`_coach` 1.0.0) | live 10-27 | "?" in the live-table header (online too); guided vs-computers game offered once on the setup, "How to play" / "Guided game" there; computers wait while a note or the rules are open (`Solo.hold`) |
| My stats (`_profile` 1.1.0) | live 10-27 | vs-computer games only (per level, Elo 1070/1200/1290, 8 awards); buttons in the vs-computers setup + game over |
| Live table look + sounds | live 10-27 | `_table` 1.0.2 (`css/table.css`, `js/table.js`) + `_fx` 1.0.3 (`js/fx.js`); kit copies unchanged, don't edit |
| Home menu fits one screen | live 10-28 | Stats/Rules/Game theory = one row of three boxes; `.menu-screen` is a size container (cqh/cqw scale title + spacing); landscape phones get two columns. app.browser F checks 393×659, 320×568, 1280×720, 1440×900 |
| Rebalanced start (vs computers only) | live 10-28 | off by default, switch on the vs-computers setup, remembered in `secretHitler.soloPick.v1`. `Engine.initGame(players, rng, {rebalance:true})`; `S.rules` + `publicView.deckFac/startFac` exist ONLY then, so online tables are unchanged. Bots read `pub.deckFac` |
| Rules → Videos | live 10-28 | `RULE_VIDEOS` in app.js, bottom of the Rules list (not admin-editable content) |
| Accessibility | half-built | first pass done; History table / stats bars aria + full audit open |
| Vote tracking, chancellor-claim capture | parked by Tim | "keep the site as simple as possible" |

## Authorized next steps
- None pending (as of 2026-08-04 every OK'd item shipped: s43 "start with 1 and 2", s44 items 3/5/6, s45–47 handbook asks). Ideas below are not authorized.

## Standing instructions (Tim's words)
- "After any meaningful change you MUST update this file + `CHAT.md`" (Tim periodically deletes the chat and relies entirely on these docs). (s1, carried in old PROGRESS header)
- "commit + push to GitHub IMMEDIATELY after every change — don't wait to be asked." (s37, standing) Still: only once done/tested, never force-push, never push anything that risks recorded game data.
- "There should be no one command that deletes history… users should always trust their game data won't be harmed or deleted, even while the site is being updated. Never do anything risky, and fix this vulnerability so it's really challenging — and impossible to accidentally — to delete user game data while we update the site." (s36 → `DATA_SAFETY.md`, rule zero)
- "don't delete any recorded game history from any account while doing this." (s30, repeated s31 — applies to every change)
- Always follow the real rules (6 Liberal / 11 Fascist); treat examples as principle, not literal numbers ("7 liberals" was an example). (s3)
- **Never** show the browser's "site says…" bar; confirmations must be designed in-app. (s13)
- "keep the site as simple as possible" / "keep the site simple" — no new in-game data entry (declined vote + chancellor-claim capture). (s44)
- Backend must be "permanently free, sustainable long-term", Claude does all the work, Tim gets exact instructions. (s16)
- Community notes: "a fundamental part of the website, like Wikipedia — anyone can share comments or ideas, shown with who commented (a name on the side)." (s38) Later: comments "way simpler" (a chat icon → mini chat) and don't over-nest the handbook. (s45)
- Duplicates are a non-issue: "the players will be in the room recording it"; guests without accounts are permanent; free-typed names stay allowed. (s17)
- Original stylised CSS only — never reproduce the real game's printed artwork/logo. Match existing code style (vanilla JS, one IIFE in `app.js`, full-redraw rendering). (s1/s3)
- Verify it yourself headless; don't ask Tim to test. (old PROGRESS operational brief)

## Traps / rules that bite
- **Kits 2026-10-28 (sweep, build 2026-10-28.4):** game-coach 1.2.0 (offer `place:"auto", avoid:["#soloGo"]`) + game-pwa 1.4.0; `select` styled dark in styles.css (appearance none + SVG arrow). Run the kit check only via `test/pwa.check.mjs` (blocks Firebase); `tools/pwa-check.mjs` alone looks for `tests/pwa-check.json`, which doesn't exist here.
- **Kits re-copied 2026-10-27 (kitfix, build 2026-10-27.8 via `node test/bump-build.js`):** game-coach 1.1.0 (rules tabs wrap; a note beside a tall target keeps title + 2 lines + buttons) and game-pwa 1.3.0 (`data-extra`). Copies stay byte-identical to `../_coach` / `../_pwa`. `js/online.js` here is this game's own file, not the `_online` kit copy, so the kit's content stamp doesn't apply: it keeps `?v=<build>` (new every deploy, enforced by `test/build.test.js`).
- Project moved: now `C:\Users\timha\OneDrive\Desktop\my-website\Code Projects\Board and Card Games\Secret_Hitler` (old notes say `Code Projects\Secret_Hitler`). Own git repo, branch `main`.
- **NEVER** run `firebase firestore:delete --all-collections` or `… --recursive`; never put them in a script or doc. Admin/CLI tooling is the only real mass-delete vector (it bypasses rules).
- `test/rules.prod.test.js` hits the LIVE project; hard-gated behind `SH_PROD_RULES_TEST=i-understand`. Don't run it. Cleanup is per-doc `__test_<runId>` only. `test/rules.test.js` (emulator) works now that Java 21 is installed (2026-10-16: 71 pass). From the project root: `firebase emulators:exec --only firestore --project demo-shtest "node test/rules.test.js"`; set env `RULES_FILE=<old.rules>` to prove a new test fails on old rules. Install with `cd test; npm install --no-package-lock` (lockfile out of sync with package.json, so `npm ci` fails).
- Rules since 2026-10-16: profiles are own-only; a member can't change `ownerUid`/`inviteCode` or remove anyone but themselves; another account's roster seat can't be created/renamed/deleted (owner may delete); a group can be deleted only by its owner when they're the last member. Leaving does NOT hand off `ownerUid`, so a group whose owner left has no owner powers.
- Verify cloud/rules changes with a **mock `window.Cloud`** over CDP, never the live project. If you ever must write live: delete only your own artifacts (`claude-*@example.com` accounts + exact doc ids), confirm only `timhadfield7@gmail.com` remains, `Stop-Process` leftover headless Chrome.
- `firebase deploy --only firestore:rules` is safe (config only). Firebase CLI logged in as `timhadfield7@gmail.com`; `gh` as TimothyHadfield.
- Firebase Auth / IndexedDB / Web Speech never init under Chrome `--virtual-time-budget` → page hangs. Use real-time CDP (`--remote-debugging-port`, Node 24 built-in `WebSocket`, ~40-line `cdp.js` you rebuild; scratchpad copies don't persist) with a **fresh `--user-data-dir` per run** (stale → "Device or resource busy").
- Plain headless recipe (non-cloud): copy site to scratchpad, inject `<script src="driver.js">` before `</body>`, serve via tiny Node http server on localhost (`file://` breaks on the space in "Code Projects"), `chrome --headless --disable-gpu --no-sandbox --virtual-time-budget=9000 --dump-dom`. Headless viewport is ~512 CSS px: measure widths, don't trust image size. Two Chrome runs sharing `--user-data-dir` = reload test.
- Test harness: don't `sed '/online\.js/d'` index.html (orphans a `<script>` in an unclosed comment); delete the exact `<script … src="js/online.js">` tag.
- `gh api` with a leading-slash path gets mangled by Git Bash → `export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`. `LF will be replaced by CRLF` warnings are benign.
- Pages sometimes never queues a build after a push (s16) → `gh api -X POST /repos/TimothyHadfield/secret-hitler-companion/pages/builds`.
- "Edit roles button missing" / "feature missing on my phone" = almost always browser cache → tell Tim to hard-refresh; or an old game with no local `createdBy` (resolves after sign-in sync).
- Every write to the games list must use `Stats.loadAllGames()` (raw), never the group-scoped view, or other groups' games get deleted.
- Right after a group join, rules can evaluate `isMember` against a pre-join view → `withRetry()` on `permission-denied`; roster seat is best-effort.
- Desktop control-column CSS overrides must be `.controls`-scoped or the later base `.ratio-*` rules win (s12 clipped Bronze).
- Reference item ids are comment targets (`${kind}:${id}`): never renumber. Old per-item theory comments were orphaned by the s45 rebuild (expected).
- Firestore doc cap 1 MiB → shared voice clips capped ~700 KB raw (~990 K base64 chars). Firebase Storage is NOT provisioned (bucket 404s).
- The Pages build hook (global CLAUDE.md) reports live status after push; by hand `python ~/.claude/hooks/live-check.py <repo>`.
- **Every shipped change: `node test/bump-build.js` first** (rewrites `js/build.js`, `version.json`, every `?v=` in index.html); `node test/build.test.js` fails if they disagree. A new local script/css in index.html needs `?v=<build>` too. Build id shows at the bottom of Settings.
- Worktrees: make them at `C:/Users/timha/AppData/Local/Temp/claude/wt/secret-hitler-companion-<name>` (outside OneDrive and any `.claude`); writes under `.claude` raise permission prompts for Tim.

## Decisions
- D1 · 2026-07-21 · Headline % is **retrospective only** (conditioned on other hands in the round); formula in `PROBABILITY_MODEL.md`.
- D2 · 2026-07-21 · Repo public; static site, no build step, no dependencies, no framework; GitHub Pages on push to `main`.
- D3 · 2026-07-21 · Deck 11F/6L; round boundary = reshuffle, done immediately when draw < 3; probability never crosses a reshuffle.
- D4 · 2026-07-21 · Modifier is round-level only (`effL = startL + m`), bounded to the physical window ∩ ±#presidents, auto-adjusts into feasibility.
- D5 · 2026-07-21 · Enacted policy inferred from the claim (Coal→F, Bronze→L, Golden/Silver→L); Conflict toggle forces F.
- D6 · 2026-07-22 · All turn state derived from the event log (`gov`/`fail`/`chaos`/`hitler`), so undo/resume/history-edit/replay "just work".
- D7 · 2026-07-22 · Undo = full-state snapshots, capped at 25; stored in its own key `secretHitler.activeGame.undo.v1` (s43, fixed O(n²) save).
- D8 · 2026-07-22 · Term limits enforced (last elected Chancellor always; last President unless ≤5 alive); chaos clears both.
- D9 · 2026-07-22 · Rectangular table, seats on edges (phone: top/bottom only; desktop: 4 sides, never corners); 3-presidency slot per seat, scaled to fit.
- D10 · 2026-07-22 · One back affordance (← upper-left, "undo" only during play); Quit game erases; role recording only from auto-detected game-over.
- D11 · 2026-07-23 · Veto = gov that enacts nothing (3 cards discarded, tracker advances); "⚑ Chancellor was Hitler" declared win from 3F; no double investigation; nested special election keeps first resume seat.
- D12 · 2026-07-23 · Claim chart = single-series magnitude bars in `#b3852f`, every row labelled (details: archive "Statistics").
- D13 · 2026-07-23 · Every game has a stable UUID = dedupe key on import = Firestore doc id (idempotent uploads). Don't remove it.
- D14 · 2026-07-23 · Backend = Firebase Spark (free, never pauses, no card), no Cloud Functions; everything via client SDK + rules.
- D15 · 2026-07-23 · Cloud sync sits BEHIND localStorage (background reconciler); app works fully offline. Don't invert.
- D16 · 2026-07-23 · Everything is a group (solo = "My Games"); groups found via `profiles/{uid}.groupIds` (listing `/groups` denied).
- D17 · 2026-07-23 · Upload consent asked once per account; download always allowed.
- D18 · 2026-07-23 · Seats resolved to roster members at upload time; guests = members with null `uid`; "That's me" links them.
- D19 · 2026-07-23 · Invitations by person (inbox) instead of a friend graph; invite links revocable via `joinOpen`; profiles `get` only.
- D20 · 2026-07-23 · Lie detection: min-lie + honesty posterior on one DP; findings are about **claims, never people** ("can't be true", allow a recording error).
- D21 · 2026-07-26 · Lie detection ON by default; verdict as an inline History Event-cell badge (a trailing column scrolls off-screen on phones).
- D22 · 2026-07-26 · Role posterior by exact enumeration (≤360 fascist-set × Hitler); stored on every game (`roleOdds`, `roleHitler`) for calibration.
- D23 · 2026-07-26 · Table fascist-% chip is a separate setting, OFF by default (changes how the table plays).
- D24 · 2026-07-27 · History badge shows the President's fascist %, not honesty % (Tim's ask).
- D25 · 2026-07-27 · Investigation + policy peek scored as claims; an undrawn peek is a phantom hand in its round.
- D26 · 2026-07-27 · Replay = truncate `state.events` to step k and re-render; role odds run during playback regardless of settings.
- D27 · 2026-07-28 · App opens on a main menu; nav stack for back-anywhere; after recording roles → menu.
- D28 · 2026-07-28 · Delete a game: cloud copy first, then local; failure aborts. Rules: delete by author or group owner only.
- D29 · 2026-07-29 · Night narration defaults = device speech (Tim chose); custom voices shared as base64 in Firestore (Storage not provisioned).
- D30 · 2026-07-29 · "Clear all statistics" downloads a backup first, asks twice, clears only this device.
- D31 · 2026-07-30 · Display name change propagates to Auth profile, profile doc, and your roster seats; past games keep the table name.
- D32 · 2026-07-31 · Labels/favorites are per-user annotations in `profiles/{uid}/gameMeta/{gameId}`; games list is id-based.
- D33 · 2026-07-31 · Online play: host-authoritative (host browser runs `js/engine.js`), signed-in group members only, discussion outside the app. Secrets in `private/{uid}` (owner read, host write); full state in `host/state`.
- D34 · 2026-07-31 · Edit recorded roles: author-only, only `result` may change (rules `affectedKeys().hasOnly(['result'])`); unknown author → button shown (rules still guard).
- D35 · 2026-08-01 · Accessibility centralised in `initA11y()` (MutationObserver per `.overlay`: focus in, Tab trap, Esc, focus return).
- D36 · 2026-08-01 · Correlated fascists: coordinated push (`coordBump` 0.08) + ally-framing reduction (0.05), role posterior only, factorisation preserved.
- D37 · 2026-08-01 · Fit only per-team report lie rates (`facLie`/`libLie`), roles-known EM, Beta shrinkage κ=24; opt-in with a Brier A/B.
- D38 · 2026-08-04 · Game theory = Tim's own strategy doc, flat categories → bullet pages + per-category 💬 chat.
- D39 · 2026-08-04 · Admin privileges via `isAdmin()` in `firestore.rules` (token email == `timhadfield7@gmail.com`); UI only hides the editor. Reusable hook — extend it.
- D40 · 2026-08-04 · Rules + Game theory share one renderer `renderHandbook(kind)`; Rules content derived from `RULES` tree; Firestore `content/rules` / `content/gameTheory` live when present, bundled fallback. House rules moved to the bottom of Rules.
- Sweep · 2026-10-16 · Bug sweep (no visual or wording changes). Engine fixes:
  - publishes the first President
  - one veto refusal per turn
  - a special election's return seat now skips executed players
  - recorded online games use the companion power shapes
  - derive.js skips a killed resume seat.

  Other fixes:
  - cloud sync no longer drops a game recorded mid-sync
  - a menu group switch no longer moves a live online table
  - review from the in-game Stats tab returns to the game
  - XSS escaping on the winner and peek text
  - double escaping removed in two confirms.

  Also: meta description, gstatic preconnect, icon-512 lossless recompression, and a new `CLAUDE.md`. Report: laptop-ops `coding-and-claude/reports/sweep-2026-10-16/secret-hitler-companion.md`.
- D42 · 2026-10-17 · Auto-update: `version.json` fetched no-store at startup + on return to visible; differs → `location.replace(?b=<new>)` keeping query/hash, only before the first tap or on the plain menu (no dialog, typing, online table, night draft); sessionStorage `secretHitler.reloadedFor` = one try per build, never loops.
- D43 · 2026-10-17 · Batch-1 fixes: fit "Use these rates"/"Use defaults" redraw their own stats mount; `Stats` writes return false on a full quota (handler shows the existing storage-full toast; saveRoles stays on screen); `ratioOf()` falls back to "?" for malformed `claimLibs`; night recorder mic request carries a ticket (re-entrant taps ignored, stream stopped if the user left).
- D45 · 2026-10-27 · Solo level = the OTHER team's strength; your teammates play Normal (same level for all barely moved your odds: 47/53/52%; opponent-only: 70/53/40%, test/bots.test.js §6). A reload drops you straight back into an unfinished vs-computers game. `PWA.safeToReload` = plain menu only. app.browser counts real navigations (the worker fetches the HTML too). WebKit pwa-check hangs after its weak-signal step (harness artifact, many files); Chromium passes.
- D47 · 2026-10-27 · Online computers live on the host's device (`js/online.js`: `bots`, `runBots`, saved with the host state as `b`); their moves skip the action queue, so no rules change. All computer votes land in one write. `pushState` writes the table and each private doc only when changed; computers have no private doc. Recorded games name them "Ada (computer)" so they never merge with a real friend. All computers share the host's chosen level. `cloud.js` connects to the emulators only when the test sets `window.__SH_EMU`; the e2e test serves a demo-project config from its own server (no request routing: WebKit breaks the emulator's streams when routed). Windows WebKit logs "rewinding of the data stream failed" a few times per run against the emulator; the SDK retries; the test counts it, doesn't fail on it.
- D46 · 2026-10-27 · Player-review fixes (shared by online + solo screens): Execute takes two taps on the same name (first tap marks "Execute X"); history names who a power hit ("investigation: Dev"); the Veto label hides under an enacted 5th Fascist card; dealing roles closes the guided-game offer; `.coach-btn:hover` overrides the site's dark `button:hover` (Back was dark-on-dark after a tap). Not done (Tim's calls): bigger laptop layout, end-of-game replay, an "Add to Home Screen" hint, a vote record per election. Reviewer's "tour note missing at the vote" did not reproduce (2 WebKit runs: the Vote note shows once your vote is due; it is hidden while the computers nominate, by design).
- D44 · 2026-10-27 · Computers see only `publicView` + their own `privateView` (fair). Levels by measured Liberal win rate vs Normal Fascists: Normal 66%, Hard Liberals 95%; Fascist strength Easy/Normal/Hard → Liberals win 73/66/58%. Solo reuses the online screens via `window.Solo` (same interface as `window.Online`); solo games are not written to Stats. Live table is the companion's own boards on a felt; phone ≤620 px tall and landscape phones get compact rules in styles.css.
- D48 · 2026-10-28 · Rebalanced start = secrethitler.io's rules page (github cozuya/secret-hitler `views/page-rules.pug`): 6p one Fascist policy pre-enacted (deck 10F/6L), 7p 10F, 9p 9F. Note: its `start-game.js` sets 10 for the 9p option while its rules page and `buildTurns.js` (15-card deck) say 9; we follow the rules page. Self-play (600 games/level, 6/7/9p, you Normal): rebalanced 69/54/44% vs standard 70/54/40% → ladder holds. Elo per level unchanged (rebalanced games count the same in My stats). Online play has no option (unchanged). "No veto" and Hitler-knowledge variants not built (not a sourced common variant).
- D49 · 2026-10-28 · Videos (oEmbed-verified 10-28): APiugylcAJw "How to Play Secret Hitler" (Max Temkin), mbGXIDYdtas "How to Play Secret Hitler in 4 Minutes" (The Rules Girl), zQZ5LWDqwNw "What Cards to Play | SECRET HITLER Strategy Episode 004" (Miketech), Q9Wb0sc5Ft8 "Let's Play SECRET HITLER | Overboard, Episode 3" (Polygon), Rml6osnzxB8 "Secret Hitler with Jason Levine" (The Dice Tower).
- D41 · 2026-09-27 · Phone rounds strip (≤640px) uses tighter block spacing so two round blocks fit whole at 375px; before, the strip scrolled to the current round and cut ~19–37px off Round 1. With 3+ rounds older blocks still scroll off (by design).

## NOT verified
- Home menu fit on a real iPhone (uses container units `cqh`/`cqw`, Safari 16+; WebKit headless only). Older iOS (<16) would ignore the cqh sizes and fall back to the clamp minimums or scroll inside the menu (reasoned).
- `online.e2e.mjs` (emulators) not rerun 10-28: engine default path unchanged and `engine.test` asserts a standard game has no `rules`/`deckFac` (reasoned safe).
- Play vs computers on a real iPhone (sounds, haptics, landscape notch) · WebKit headless only, 5 sizes. `test/rules.test.js` (emulator) not rerun 10-27 (rules unchanged).
- Real multi-client online game (several accounts, each reading only its private doc, host processing remote actions) · needs a real multi-device game. Headless: two WebKit pages on the emulators play a full 7-seat game (2 people + 5 computers). Not tested: a host reload mid-game with computers (code resumes them from the saved host state), the live Firebase project, Google sign-in, real phones on mobile data.
- History test "names who was executed" was not watched failing on the old build (the old run died earlier on the Execute assert); the old code printed "· execution" with no name, so it would fail (reasoned).
- Night narration real voice quality + mic recording · needs a real device. The 10-17 mic-left-on fix is proven with a mocked getUserMedia/MediaRecorder in WebKit only, not a real iPhone mic.
- Auto-update on a real iPhone (home-screen app, Safari back-forward cache, Pages CDN timing) · proven only in WebKit with a local server (old page → new build once; stale host → one try, no loop; no reload mid-game or with Settings open).
- Phones still running a pre-10-17 build have no update check; they pick it up on their next normal load (≤10 min cache) or a hard refresh.
- Shared night voices between two real accounts (Firestore round-trip) · needs 2 accounts; only mock-Cloud tested.
- Google sign-in · verified manually only (OAuth round-trip can't be automated).
- `rules.prod.test.js` §7b/§7c (game delete, voices) · never run (gated; live project).
- Label/favorite changed offline may not reach the cloud until changed again online (best-effort push).
- Model calibration on real data · needs more recorded games (harness needs ≥3).
- `js/probability.js` has no committed test file (old notes call it "Node-tested"; checks were ad hoc). `js/stats.js` writes are now covered by `test/stats.test.js` (aggregation still untested).

## Rejected / parked
- ~~Supabase~~ · 2026-07-23 · free tier pauses after ~1 week idle; Tim required permanently free.
- ~~Cloudflare Workers + D1~~ · 2026-07-23 · no auth; hand-rolled sign-in not worth owning.
- ~~Hand-rolled Node backend~~ · 2026-07-23 · more work for less.
- ~~Friend graph~~ · 2026-07-23 · replaced by invitations-by-person.
- ~~4-colour stacked claim bar~~ · 2026-07-23 · red→blue ramp fails separation (ΔE 10 < 15), mid steps read gray.
- ~~Per-government lie modifier~~ · 2026-07-21 · Tim asked for round-level only.
- ~~"% honest" History badge~~ · 2026-07-27 · Tim wanted fascist %.
- ~~Firebase Storage for audio~~ · 2026-07-29 · not provisioned, likely needs Blaze (paid).
- ~~Vote tracking (companion mode)~~ · 2026-08-01 · Tim: "keep the site as simple as possible". Online play does real voting.
- ~~Chancellor-claim capture~~ · 2026-08-01 · same reason; it's the input that would un-confound β/γ.
- ~~Fitting β/γ~~ · 2026-08-01 · confounded without chancellor claims/votes (`HONESTY_MODEL.md` §7c).
- ~~Online play descoped~~ · 2026-07-23 → reversed 2026-07-31 (Tim asked for full online play).
- ~~In-app chat for online play~~ · 2026-07-31 · discussion happens outside the app.
- ~~Rules search + drill-down + per-item notes~~ · 2026-08-04 · replaced by the flat editable model; code left dead in place. Offer a simple filter back if Tim wants search.
- ~~`email_verified` on the admin rule~~ · 2026-08-04 · could lock Tim out; noted as tightenable.
- Parked (ideas, not authorized): online-play brainstorm from s41 (presence/"waiting on whom"/host-alive, diff'd private writes, guest joins via anonymous auth, spectators/referee host, visual parity with companion table, auto night narration online, automated multi-client test); host migration, reconnection, evict an account member; per-player lie tendencies once the archive grows; aria on History table + stats bars; stats ideas (favourite chancellor pairings, per-round trends); retire the round-modifier stepper. If asked to improve online play, first save the brainstorm as `ONLINE_PLAY.md` (doesn't exist yet).
- Known limitation kept: companion-mode in-progress games don't sync (only recorded ones).

## Map
- `index.html` · app shell: menu, setup, game, stats, rules, theory, online screens + overlays.
- `styles.css` · theme, no-scroll responsive layout, table/seats, boards, panels.
- `js/app.js` · state, persistence, rendering, powers, review/replay, account + online UI (one IIFE).
- `js/derive.js` · pure rules engine `Derive.derive(state, deps)`.
- `js/probability.js` · binomial/hypergeometric/retrospective engine.
- `js/stats.js` · localStorage games store + aggregation; `clearAll()` is the only bulk delete (local).
- `js/honesty.js` · lie detection + role posterior. `js/fit.js` · lie-rate fitter.
- `js/cloud.js` · ES module: Firebase auth, sync, groups, voices, comments, content. `js/firebase-config.js` · public ids.
- `js/engine.js` · pure online-play game engine. `js/online.js` · ES module: host loop + tables.
- `js/reference.js` · RULES tree, STRATEGY, HOUSE_RULES, bullet parser. `js/night.js` · night narration.
- `firestore.rules`, `firebase.json`, `.firebaserc`, `firestore.indexes.json` · deployed rules + CLI config.
- `DATA_SAFETY.md` (rule zero) · `BACKEND_PLAN.md` (backend + console setup) · `HONESTY_MODEL.md` (lie/role model theory) · `PROBABILITY_MODEL.md` · `SECRET_HITLER_RULES.md` · `README.md`.
- `docs/archive/` · `progress-2026-09-21.md` (old PROGRESS, full detail) + `chat-archive.md` (sessions 1–27).
- Tests: `node test/<name>.test.js` for honesty, night, engine, derive, fit, reference, stats, build, bots (night's IndexedDB part needs `test/node_modules` fake-indexeddb) + `node test/app.browser.test.mjs` and `node test/solo.browser.test.mjs` (WebKit via Playwright from `~/.claude/tools`, local server, all non-localhost requests blocked, mocks only) · last run 2026-10-28 on w3-improve: honesty 73/0, night 28/0 (IDB skipped), engine 3026/0, derive 49/0, fit 18/0, reference 28/0, stats 15/0, build 35/0, bots 15/0, app.browser 42/0, solo.browser 45/0.
- Live: https://timothyhadfield.github.io/secret-hitler-companion/ · repo https://github.com/TimothyHadfield/secret-hitler-companion · hosting: GitHub Pages + Firebase (Spark).
