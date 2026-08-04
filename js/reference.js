/* ============================================================================
 * reference.js — the bundled content for the Rules and Game Theory sections.
 *
 * This is a companion "handbook": an authoritative, searchable rules reference
 * (kept in step with SECRET_HITLER_RULES.md) and a curated strategy guide. Both
 * are organised the same way — category → subcategory → item (a "bullet" whose
 * body states the specific rule or idea). Each item has a STABLE `id`; that id
 * is what community comments attach to (target = `${kind}:${id}`), so ids must
 * never change once shipped or existing comments would be orphaned.
 *
 * Classic script exposing `window.Reference`. No network, no build step — the
 * handbook works fully offline and signed out; only the community comments need
 * an account (they live in Firestore via cloud.js).
 * ==========================================================================*/
(function () {
  // Rules — the source of truth is SECRET_HITLER_RULES.md; keep them in sync.
  const RULES = [
    {
      id: "setup", title: "Setup & roles", subcats: [
        {
          id: "teams", title: "Teams & goals", items: [
            { id: "setup.teams.win", title: "How each side wins",
              body: "Liberals win by enacting 5 Liberal policies OR executing Hitler. Fascists win by enacting 6 Fascist policies OR getting Hitler elected Chancellor once 3+ Fascist policies are on the board." },
            { id: "setup.teams.counts", title: "How many Fascists, by player count",
              body: "Fascists including Hitler = ceil(players/2) − 1. So: 5–6 players → 1 Fascist + Hitler; 7–8 → 2 + Hitler; 9–10 → 3 + Hitler. Everyone else is Liberal." },
            { id: "setup.teams.knowledge", title: "Who knows whom",
              body: "In 5–6 player games Hitler and the Fascist know each other. In 7+ player games Hitler does NOT know the other Fascists (and they don't reveal to Hitler) — Hitler plays blind, knowing only that they are Hitler. Liberals never know anything for certain." },
          ],
        },
        {
          id: "night", title: "The night phase", items: [
            { id: "setup.night.reveal", title: "The night reveal",
              body: "Eyes closed: the Fascists open their eyes and see each other. In 5–6 player games Hitler also opens their eyes (so the team is fully known to itself). In 7+ Hitler keeps eyes closed and instead gives a thumbs-up so the Fascists can find Hitler, while Hitler stays blind. The app's 🌙 'in the night' button narrates this for you." },
          ],
        },
      ],
    },
    {
      id: "deck", title: "The policy deck", subcats: [
        {
          id: "comp", title: "Composition", items: [
            { id: "deck.comp.17", title: "17 cards: 11 Fascist, 6 Liberal",
              body: "The deck is always 11 Fascist and 6 Liberal policies. Enacted policies stay on the tracks permanently; discards go to a face-down discard pile." },
            { id: "deck.comp.pool", title: "The unseen pool is always known",
              body: "Because enacted policies are public, the composition of everything still in play (draw + discard) is known exactly: pool = 17 − enacted, i.e. (11 − Fascist enacted) Fascist and (6 − Liberal enacted) Liberal. This is what the app's probabilities are built on." },
          ],
        },
        {
          id: "reshuffle", title: "Reshuffle", items: [
            { id: "deck.reshuffle.when", title: "Reshuffle when fewer than 3 cards remain",
              body: "The moment the draw pile has fewer than 3 cards, shuffle the discard pile back in to form a new draw pile. A reshuffle fully re-randomises card order, so the app treats it as a hard boundary between 'rounds' — probability and Policy Peeks cannot carry across it." },
          ],
        },
      ],
    },
    {
      id: "elections", title: "Elections & government", subcats: [
        {
          id: "nominate", title: "Nominating a Chancellor", items: [
            { id: "elections.nominate.basic", title: "The President nominates a Chancellor",
              body: "Each round the current Presidential candidate picks a Chancellor candidate; the table then votes on the pair together." },
            { id: "elections.nominate.termlimits", title: "Term limits: who is ineligible",
              body: "The LAST ELECTED President and the LAST ELECTED Chancellor cannot be nominated as the new Chancellor. This only counts governments that actually passed a vote — a failed election doesn't set a term limit." },
            { id: "elections.nominate.termlimits5", title: "Term limits with 5 or fewer players alive",
              body: "When only 5 players remain alive, ONLY the last elected Chancellor is term-limited (the last President becomes eligible again). This covers a 5-player game or a bigger game reduced to 5 by executions." },
          ],
        },
        {
          id: "voting", title: "Voting", items: [
            { id: "elections.voting.majority", title: "Ja/Nein — a majority elects",
              body: "Everyone still alive votes Ja or Nein on the President+Chancellor pair. A strict majority of Ja elects them; then play moves to the legislative session." },
            { id: "elections.voting.tie", title: "A tie fails the vote",
              body: "A tie is NOT a pass — it fails, exactly like a majority Nein. The election tracker advances and the presidency passes to the next player." },
            { id: "elections.voting.dead", title: "Dead players do not vote",
              body: "Executed players take no further part: they don't vote, and the 'majority' is of living players only." },
            { id: "elections.voting.hitlercheck", title: "Electing Hitler Chancellor after 3 Fascist policies = instant Fascist win",
              body: "If 3 or more Fascist policies are enacted and the elected Chancellor is Hitler, the Fascists win the instant the vote passes — before any cards are drawn. This is why Liberals must stop voting yes on unknown Chancellors once the Fascist track is dangerous." },
          ],
        },
        {
          id: "tracker", title: "The Election Tracker & chaos", items: [
            { id: "elections.tracker.advance", title: "The tracker advances by 1 on every failed election",
              body: "Start at 0. Each failed vote (Nein majority or tie) moves the tracker up by one and passes the presidency clockwise." },
            { id: "elections.tracker.veto", title: "A successful veto also advances the tracker",
              body: "When the President and Chancellor agree to veto (5+ Fascist policies), no policy is enacted and the tracker advances by 1 — a veto counts like a failed government for chaos purposes." },
            { id: "elections.tracker.chaos", title: "3 failed elections → the top policy auto-enacts (chaos)",
              body: "If the tracker reaches 3, the top card of the draw pile is enacted automatically, face-up, with no President or Chancellor choosing it. The tracker then resets to 0." },
            { id: "elections.tracker.chaos-resets-limits", title: "A chaos top-deck RESETS term limits",
              body: "When chaos enacts the top policy, all term-limit restrictions are forgotten — the previously term-limited President and Chancellor are eligible again for the next election. (So yes: election restrictions reset after a policy is top-decked due to failed presidencies.)" },
            { id: "elections.tracker.chaos-nopower", title: "A chaos policy triggers NO presidential power",
              body: "Even if the auto-enacted chaos policy lands on a slot that normally grants a power (Investigation, Execution, etc.), the power does NOT fire — there is no President who enacted it." },
            { id: "elections.tracker.reset", title: "Any enacted policy resets the tracker to 0",
              body: "The moment any policy is enacted through a successful government, the election tracker drops back to 0. Only failed governments (and vetoes) push it toward chaos." },
          ],
        },
      ],
    },
    {
      id: "legislative", title: "Legislative session", subcats: [
        {
          id: "draw", title: "Drawing & passing policies", items: [
            { id: "legislative.draw.three", title: "The President draws 3 and discards 1",
              body: "The elected President draws the top 3 policies, secretly discards 1 face-down, and passes the other 2 to the Chancellor." },
            { id: "legislative.draw.enact", title: "The Chancellor enacts 1 of the 2",
              body: "The Chancellor enacts 1 policy face-up on its track and discards the other face-down. Every government therefore removes exactly 3 cards from the draw pile — 1 enacted, 2 discarded — which is the backbone of the app's pile bookkeeping." },
            { id: "legislative.draw.notalk", title: "No table talk during the exchange",
              body: "Players may not show or truthfully prove the cards passed. Presidents and Chancellors can CLAIM what they drew/passed, but those claims can be lies — which is the whole game (and what the app's lie-detection models)." },
          ],
        },
        {
          id: "veto", title: "Veto power", items: [
            { id: "legislative.veto.unlock", title: "Veto unlocks at 5 Fascist policies",
              body: "Once 5 Fascist policies are enacted, a veto becomes available for the rest of the game." },
            { id: "legislative.veto.how", title: "How a veto works",
              body: "The Chancellor may propose to veto the two cards; if the President agrees, BOTH are discarded, no policy is enacted, and the election tracker advances by 1. If the President refuses, the Chancellor must enact one as normal." },
          ],
        },
      ],
    },
    {
      id: "powers", title: "Presidential powers", subcats: [
        {
          id: "slots", title: "Which power, which slot", items: [
            { id: "powers.slots.bycount", title: "Powers by player count",
              body: "Powers are printed on the Fascist track and fire when a Fascist policy lands on that slot. 5–6 players: slot 3 = Policy Peek, slots 4 & 5 = Execution. 7–8: slot 2 = Investigate, slot 3 = Special Election, slots 4 & 5 = Execution. 9–10: slots 1 & 2 = Investigate, slot 3 = Special Election, slots 4 & 5 = Execution. Slot 6 is the Fascist win in every count." },
            { id: "powers.slots.forced", title: "A granted power must be used",
              body: "If an enacted Fascist policy grants a power, the President must use it before play continues — you can't decline. (The app pauses with a full-screen prompt to record the outcome.)" },
          ],
        },
        {
          id: "each", title: "The powers", items: [
            { id: "powers.each.investigate", title: "Investigate Loyalty",
              body: "The President secretly looks at one player's PARTY card (Liberal/Fascist), not their role — so an investigation never reveals Hitler directly. A player may NOT be investigated twice in one game (the limit is on the target). This can only bind at 9–10 players, the only counts with two Investigate slots." },
            { id: "powers.each.special", title: "Special Election",
              body: "The President chooses ANY living player to be the next Presidential candidate — a one-off jump. After that special turn, the normal clockwise order resumes from the seat to the President's left (the seat that would have gone next), so it doesn't permanently reorder the table." },
            { id: "powers.each.peek", title: "Policy Peek",
              body: "The President secretly views the top 3 cards of the draw pile (order intact) without changing them. Valuable information — and a lie about the peek is exactly the kind of claim the app scores." },
            { id: "powers.each.execution", title: "Execution",
              body: "The President kills a player, who is out for the rest of the game (no vote, can't be Chancellor, and never reveals their card). If the executed player was Hitler, the Liberals win immediately — the main reason Liberals gain executions late." },
          ],
        },
      ],
    },
    {
      id: "winning", title: "Winning the game", subcats: [
        {
          id: "lib", title: "Liberal victory", items: [
            { id: "winning.lib.five", title: "Enact 5 Liberal policies",
              body: "Five Liberal policies on the Liberal track wins the game for the Liberals outright." },
            { id: "winning.lib.kill", title: "Execute Hitler",
              body: "If a President's Execution power kills Hitler, the Liberals win instantly, no matter the policy count." },
          ],
        },
        {
          id: "fac", title: "Fascist victory", items: [
            { id: "winning.fac.six", title: "Enact 6 Fascist policies",
              body: "Six Fascist policies on the Fascist track wins for the Fascists outright." },
            { id: "winning.fac.hitler", title: "Elect Hitler Chancellor after 3 Fascist policies",
              body: "Once 3+ Fascist policies are enacted, electing Hitler as Chancellor is an instant Fascist win. Before the 3rd Fascist policy, electing Hitler as Chancellor does nothing special." },
          ],
        },
      ],
    },
    {
      id: "edge", title: "Tricky situations & clarifications", subcats: [
        {
          id: "qa", title: "Common questions", items: [
            { id: "edge.qa.chaos-termlimits", title: "Do election restrictions reset after a chaos top-deck?",
              body: "Yes. When 3 failed elections force the top policy to auto-enact, term limits reset — the last President and Chancellor become eligible again next round. See also Elections → The Election Tracker & chaos." },
            { id: "edge.qa.nested-special", title: "What if a Special Election happens during a Special Election?",
              body: "The presidency resumes after the President who FIRST broke the normal order, so a nested special election doesn't overwrite that resume point. The app handles this automatically." },
            { id: "edge.qa.investigate-twice", title: "Can the same player be investigated twice?",
              body: "No — a player may only be investigated once per game. Already-investigated players are removed from the app's Investigation prompt." },
            { id: "edge.qa.peek-reshuffle", title: "Is a Policy Peek still valid after a reshuffle?",
              body: "No. A peek only describes the pile until the next reshuffle re-randomises it. The app strikes through a stale peek and marks it '(reshuffled)'." },
            { id: "edge.qa.executed-reveal", title: "Does an executed player reveal their card?",
              body: "No. Executed players are removed without revealing their party or role, so a kill is information only if the game ends (Hitler) — otherwise it stays a guess." },
            { id: "edge.qa.veto-before-5", title: "Can you veto before 5 Fascist policies?",
              body: "No. Veto power only exists once 5 Fascist policies are enacted. Before that, the Chancellor must enact one of the two cards." },
          ],
        },
      ],
    },
  ];

  // Game theory — the user's own strategy write-up (session 45). A flat list of
  // main categories; each opens a page of bullet / sub-bullet notes (recursive
  // `subs`). `wip:true` marks the "red" (debated / work-in-progress) items from the
  // source doc. The community can leave comments per CATEGORY (a chat, not per-item
  // notes). This is deliberately NOT the RULES shape — it renders with renderTheory,
  // not the drill-down/search renderer the rules use.
  const STRATEGY = [
    {
      id: "summary", title: "Summary",
      blurb: "Where the theory starts, and whose job is what.",
      bullets: [
        { t: "Game theory should always start from the “optimal” liberal strategy for every situation — even the fascists should (at least publicly) support it. The other side is analysing how and when the fascists should lie." },
        { t: "Liberals build systems that restrict the fascists’ opportunities to lie and manipulate. It is the liberals’ job to logically work through the possibilities (past and future), draw conclusions, and make the best decision." },
        { t: "The fascists try to break through those systems however they can — loopholes, tricks, or behaviour." },
        { t: "Items marked “debated” were highlighted in the source as a work in progress and/or something reasonable players may disagree on.", wip: true },
      ],
    },
    {
      id: "vocab", title: "Vocabulary",
      blurb: "The shorthand this guide uses.",
      bullets: [
        { t: "Golden — 2 Fascist, 1 Liberal." },
        { t: "Silver — 1 Fascist, 2 Liberal." },
        { t: "Bronze — 0 Fascist, 3 Liberal." },
        { t: "Coal — 3 Fascist, 0 Liberal." },
        { t: "Lying up — claiming you received more liberals than you did." },
        { t: "Lying down — claiming you received more fascists than you did." },
        { t: "Testing — receiving Silver, discarding a liberal, and letting the chancellor choose which policy to enact." },
        { t: "Conflict — when one person’s claim directly contradicts another person’s claim." },
        { t: "Hitler Territory — once the third fascist policy is played (fascists now win by electing Hitler chancellor)." },
        { t: "Round — when the draw pile has fewer than 3 policies, the discard pile reshuffles in, beginning a new round. A game has at most 3 rounds." },
        { t: "Round Modifier — each presidency contributes: lying up (+1), lying down (−1), truth (0). They add to a per-round modifier; each round is separate, since presidencies can’t affect another round’s odds." },
        { t: "Frozen — players involved in a conflict are often “frozen” by not being allowed into the presidency." },
        { t: "Forcing — giving the chancellor 2 liberals or 2 fascists." },
      ],
    },
    {
      id: "general", title: "General notes",
      blurb: "Factual, not speculative — what is actually possible.",
      bullets: [
        { t: "Lying Down", subs: [
          { t: "A fascist president can lie down 1: receive Golden and claim Coal, receive Silver and claim Golden, or receive Bronze and claim Silver." },
          { t: "A fascist president and chancellor together can lie down 2: receive Silver and claim Coal, or receive Bronze and claim Golden." },
          { t: "Lying down is useful to enact fascist policies, or to make the perceived odds of drawing a liberal higher." },
        ] },
        { t: "Lying Up", subs: [
          { t: "A fascist president can lie up 1: receive Silver and claim Bronze." },
          { t: "A fascist president and chancellor can lie up 1: receive Golden and claim Silver." },
          { t: "A fascist president and chancellor can lie up 2: receive Golden and claim Bronze." },
          { t: "If testing is normalized, a fascist president can also lie up 1 by receiving Golden and claiming Silver (by testing the chancellor)." },
        ] },
        { t: "Minimum / Maximum Round Modifier", subs: [
          { t: "If the total fascists or liberals claimed is more than the number that started in the draw pile (which is known), the round modifier must be positive / negative — it cannot be zero." },
        ] },
        { t: "Conflicts", subs: [
          { t: "As Chancellor: a fascist chancellor who receives one of each can play the fascist and claim they received 2 of each." },
          { t: "As President: a fascist president who forces 2 fascists onto a liberal chancellor can claim they gave the chancellor one of each (and received Golden)." },
          { t: "President investigates a fascist." },
          { t: "A policy peek was different than claimed." },
        ] },
      ],
    },
    {
      id: "liberal", title: "Liberal optimization",
      blurb: "Systems that limit what the fascists can get away with.",
      bullets: [
        { t: "Always tell the truth to the table." },
        { t: "When Silver is drawn, always discard the fascist and force the 2 liberals.", subs: [
          { t: "Some people “test” the chancellor by giving one of each, but the chancellor will nearly always discard the fascist — so the test doesn’t really do anything." },
          { t: "If testing is normalized, fascists gain a new way to lie up with Golden (previously only Silver→Bronze, or a coordinated pres+chan Golden→Silver), letting them manipulate the perceived odds even more." },
        ] },
        { t: "When in Hitler Territory", subs: [
          { t: "Occasionally (maybe 5–10% of the time) electing the most fascist-looking player as chancellor is a calculated risk — Hitler often tries hard not to look fascist. Don’t make it a pattern, or Hitler will start intentionally acting fascist to get elected.", wip: true },
          { t: "Once a player is revealed non-Hitler (elected chancellor in Hitler territory), elect them every time they’re eligible to avoid risking Hitler. Alternating two such players back and forth can avoid electing Hitler entirely." },
        ] },
        { t: "Forced chancellor position until the second–third fascist is played", wip: true, subs: [
          { t: "Because fascists can lie up or down twice when they hold both seats, they try to be in power together. Counter it with a system where the president always elects a specific person, and hope the fascists don’t get lucky with positioning." },
          { t: "This doesn’t work in Hitler territory (liberals want to be intentional about the chancellor); since the prior presidency restricts the next chancellor, stopping the system once the second fascist is played can be best." },
        ] },
        { t: "Skipping the last 2 presidencies", wip: true, subs: [
          { t: "In a 7-player game at 4 liberals / 1 fascist, the fascists may never have had a chance to lie (no Golden) or were never president (6th/7th seat). Skipping the last two can avoid risking more fascist policies." },
        ] },
        { t: "Minimum / Maximum Round Modifier", wip: true, subs: [
          { t: "If a forced positive / negative round modifier narrows down who could have lied that round, you can draw valuable conclusions from it." },
        ] },
        { t: "Top decking / Policy Peek", subs: [
          { t: "If the fascists are 1 away from winning, only top deck as a very last resort." },
          { t: "L, (L/F), (L/F): top deck until either a fascist is played or claimed. E.g. if the president claims LLF, top deck the first 2 liberals and then vote. This is worse the fewer liberals are on the board, since a fascist going 5–3 or 5–2 is increasingly worth sacrificing a player." },
          { t: "FLL: do not top deck." },
        ] },
        { t: "Available players", wip: true, subs: [
          { t: "If many players collectively decide a player should or should not be selected for something, the president should obey as long as the reason is relatively justified (a conflict, a voting scenario, lying probability, etc.)." },
        ] },
        { t: "Investigation", wip: true, subs: [
          { t: "To restrict fascists controlling the game, liberals should agree a system for who the president always investigates. The next president in line is a good choice — it gives information the table can use to approve that election or not." },
        ] },
        { t: "Next 3 potential presidents", subs: [
          { t: "Because there can never be 3 players in a row who don’t get the presidency, view it as: “of the next three players, who is the best option?”" },
        ] },
        { t: "Kill power", subs: [
          { t: "The president should not kill anyone until all players have had a chance to speak." },
        ] },
      ],
    },
    {
      id: "fascist", title: "Fascist lying & manipulation",
      blurb: "When and how to break the liberal systems.",
      bullets: [
        { t: "Drifting from optimal play", subs: [
          { t: "Generally, fascists should argue for and support liberal game theory so they don’t reveal themselves and instead gain trust." },
          { t: "Only shift slightly away from optimal play, to give the fascists an advantage when it counts." },
        ] },
        { t: "Consistent behaviour", subs: [
          { t: "In a group that knows each other, keep the same habits you have in your other games." },
        ] },
        { t: "Reverse psychology", subs: [
          { t: "If you’re confident you can predict what a liberal (or the liberals) will think, act a certain way to manipulate them." },
          { t: "Example: a fascist tests someone. A liberal knows that fascist is against testing and concludes they’re intentionally looking fascist to hide Hitler — but the fascist predicted exactly that and is actually Hitler all along." },
        ] },
        { t: "Lying down", subs: [
          { t: "If the other 1–2 liberals and 0 fascists have already claimed Golden or Coal, lying down can raise everyone’s (and your own) apparent odds of lying — especially useful as a non-Hitler fascist." },
        ] },
        { t: "Lying up", subs: [
          { t: "If a fascist (especially Hitler) previously claimed Coal, lying up makes that scenario much more plausible and makes that fascist look more liberal." },
        ] },
        { t: "Special election", subs: [
          { t: "A non-Hitler fascist should often choose a president who trusts Hitler, or choose Hitler if Hitler is on term limits — assuming those players are genuine options." },
        ] },
        { t: "Silver as Hitler", subs: [
          { t: "If Hitler receives Silver as president with a liberal chancellor, they should force the two liberals to reduce their odds of lying. There’s also no reason to lie." },
        ] },
      ],
    },
    {
      id: "emotion", title: "Using human emotion",
      blurb: "The table is people, not just cards.",
      bullets: [
        { t: "Self advocacy", subs: [
          { t: "People often distrust anyone who advocates for themselves at all, regardless of the evidence. If you really want the chancellorship, sometimes the best move is not to mention yourself." },
        ] },
        { t: "Voting alignment", subs: [
          { t: "People who vote together on certain elections often trust each other — you can vote with someone to make them trust you." },
        ] },
        { t: "Intense emotions", subs: [
          { t: "Visibly getting upset, confused, annoyed, or conflicted reads as a liberal emotion. Faking it — or genuinely feeling it — as a fascist is a great way to fool the liberals. Really try not to actually hurt anyone; the whole point is to have a good time." },
        ] },
      ],
    },
    {
      id: "scenarios", title: "Unique scenarios",
      blurb: "Edge cases worth thinking through ahead of time.",
      bullets: [
        { t: "Fascist–fascist conflict.", wip: true },
        { t: "Fascist (Hitler) killing a fascist.", wip: true },
        { t: "Liberal lying.", wip: true },
        { t: "Liberal discarding a liberal policy", subs: [
          { t: "If a liberal president gets kill power by enacting a fascist policy, receives Golden, and doesn’t trust the other liberals to decide correctly, they can discard the liberal, force a fascist to be played, and try to kill a fascist / Hitler. This only makes sense if they had a conflict with someone and weren’t about to win outright by enacting a liberal." },
        ] },
        { t: "Top-decking twice", subs: [
          { t: "If the bottom 5 cards of the draw pile are all liberal (~0.1% at modifier 0), the group can top deck the first 2 and then position accordingly." },
        ] },
        { t: "Double conflict in a single presidency", subs: [
          { t: "A Policy Peek conflict and a President–Chancellor conflict in the same presidency. This can make the president look bad — a fascist might be most likely to do it to freeze 2 liberals and themselves (potentially worth it)." },
        ] },
        { t: "Hitler acting fascist", subs: [
          { t: "A rare case, virtually only involving reverse psychology." },
        ] },
      ],
    },
  ];

  // Moved to the BOTTOM OF THE RULES section (session 46). Optional table
  // conventions rather than strategy, so they live with the rules, not the theory.
  const HOUSE_RULES = {
    id: "houserules", title: "House rules for a better game",
    blurb: "Optional table conventions that keep games clean and fun.",
    bullets: [
      { t: "The president and chancellor should always shuffle the cards they receive, so they can discard any one without it looking fascist." },
      { t: "In the night, everyone should open their eyes, see the other players’ eyes, put a thumb up, and return to position without any movement or adjusting whatsoever.", subs: [
        { t: "Any slight hint that someone moved during the night can ruin an entire game. Always ask whether there were problems in the night, or whether anyone suspects another player because of it." },
        { t: "A consistent narrator who follows the same script and turns their head side to side while speaking (in case they’re a fascist) reduces hints. A recorded / played “in the night” audio that’s always identical removes the risk entirely." },
      ] },
      { t: "During a Policy Peek, require the president to go into a private room for 1 minute to think before returning.", subs: [
        { t: "Optimal liberal play makes the best fascist claim incredibly hard to calculate, and nearly impossible to do on the spot." },
      ] },
      { t: "Randomize the seats and the first president at the start — it makes for more diverse games and prevents set-ups or repeated games." },
      { t: "Dead players cannot speak at all, from the moment the president says “I’m killing ___” and they respond “I am not Hitler.”" },
      { t: "No human (playing or spectating) may ever look at a player’s role (dead or alive) outside of an investigation." },
    ],
  };

  // The RULES section now uses the SAME editable category→bullets model as game
  // theory (session 46), so the admin can edit it too. This derives that flat
  // shape from the authoritative RULES tree above (subcategory → a heading bullet,
  // item → a "Title — body" sub-bullet), then appends the House rules section at
  // the end. It is only the OFFLINE FALLBACK — `content/rules` in Firestore is the
  // live source once the admin edits anything.
  const RULES_CONTENT = RULES.map((cat) => ({
    id: cat.id, title: cat.title, blurb: "",
    bullets: (cat.subcats || []).map((sc) => ({
      t: sc.title,
      subs: (sc.items || []).map((it) => ({ t: it.title + " — " + it.body })),
    })),
  })).concat([HOUSE_RULES]);


  // Only RULES uses the drill-down/search tree now; game theory is STRATEGY, a flat
  // category list rendered by the app's renderTheory().
  const TREES = { rule: RULES };

  function tree(kind) { return TREES[kind] || []; }

  // Flatten to a searchable list, each entry carrying its breadcrumb + target.
  function flatten(kind) {
    const out = [];
    for (const cat of tree(kind)) {
      for (const sub of cat.subcats || []) {
        for (const it of sub.items || []) {
          out.push({
            kind, item: it, target: kind + ":" + it.id,
            catId: cat.id, subId: sub.id,
            catTitle: cat.title, subTitle: sub.title,
            crumb: cat.title + " › " + sub.title,
            hay: (it.title + " " + it.body + " " + cat.title + " " + sub.title).toLowerCase(),
          });
        }
      }
    }
    return out;
  }

  function search(kind, q) {
    const needle = String(q || "").trim().toLowerCase();
    if (!needle) return [];
    const words = needle.split(/\s+/);
    return flatten(kind).filter((e) => words.every((w) => e.hay.includes(w)));
  }

  function findItem(kind, itemId) {
    return flatten(kind).find((e) => e.item.id === itemId) || null;
  }

  // ---- admin editor: nested bullets ⇄ indented plain text -------------------
  // The game-theory editor lets the admin edit a section's bullets as indented
  // lines (2 spaces per level, a trailing " [debated]" marks a work-in-progress
  // item). These pure functions convert between that text and the nested `bullets`
  // shape, so the editor never has to build the tree by hand. Round-trip safe.
  function serializeBullets(bullets, depth) {
    depth = depth || 0;
    let out = "";
    for (const b of bullets || []) {
      out += "  ".repeat(depth) + b.t + (b.wip ? " [debated]" : "") + "\n";
      if (b.subs && b.subs.length) out += serializeBullets(b.subs, depth + 1);
    }
    return out;
  }
  function parseBullets(text) {
    const root = { subs: [] };
    // stack[i] = the node whose children live at indent level i
    const stack = [{ indent: -1, node: root }];
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    for (const raw of lines) {
      if (!raw.trim()) continue;
      // tabs count as one level; otherwise every 2 leading spaces is a level
      const lead = raw.match(/^[ \t]*/)[0];
      const indent = lead.replace(/\t/g, "  ").length;
      let t = raw.trim();
      let wip = false;
      const m = t.match(/\s*\[debated\]\s*$/i);
      if (m) { wip = true; t = t.slice(0, m.index).trim(); }
      if (!t) continue;
      // find the parent: the deepest stack entry with a smaller indent
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack[stack.length - 1].node;
      const node = wip ? { t, wip: true, subs: [] } : { t, subs: [] };
      (parent.subs = parent.subs || []).push(node);
      stack.push({ indent, node });
    }
    // strip empty subs arrays so the stored shape matches the authored one
    const clean = (bs) => bs.map((b) => {
      const o = b.wip ? { t: b.t, wip: true } : { t: b.t };
      if (b.subs && b.subs.length) o.subs = clean(b.subs);
      return o;
    });
    return clean(root.subs);
  }
  // A blank category the admin can start from.
  function blankCategory(id) {
    return { id: id || ("section-" + Math.random().toString(36).slice(2, 8)), title: "New section", blurb: "", bullets: [] };
  }

  const API = {
    tree, flatten, search, findItem,
    strategy: STRATEGY,   // game-theory content (bundled fallback)
    rules: RULES_CONTENT, // rules content in the same editable shape (bundled fallback)
    serializeBullets, parseBullets, blankCategory,
    targetOf: (kind, id) => kind + ":" + id,
  };
  if (typeof window !== "undefined") window.Reference = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
