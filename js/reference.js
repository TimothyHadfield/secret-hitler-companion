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

  // Game theory — curated strategy. Opinionated but sound; the community can add
  // their own notes to any item. Not rules — ideas.
  const THEORY = [
    {
      id: "liberal", title: "Playing as a Liberal", subcats: [
        {
          id: "fund", title: "Fundamentals", items: [
            { id: "liberal.fund.trust", title: "Trust is earned by policy, not by talk",
              body: "You have no secret information, so lean on what's provable: who enacted what, whose claims are consistent with the known pile, and who benefits. Don't hand trust to a smooth talker before they've passed Liberal policies." },
            { id: "liberal.fund.track", title: "Track the odds, not the vibes",
              body: "Fascist policies far outnumber Liberal ones in the deck (11 vs 6), so an early Fascist policy is often just a bad draw, not proof of treachery. Use the app's per-government probability to tell a genuinely suspicious government from an unlucky one." },
            { id: "liberal.fund.vote", title: "Use votes as information",
              body: "Every vote is a signal. Note who is eager to elect an unproven pair and who blocks a Liberal-looking government — patterns across several elections expose Fascists better than any single round." },
          ],
        },
        {
          id: "powers", title: "Using powers well", items: [
            { id: "liberal.powers.investigate", title: "Investigate the influential, not the quiet",
              body: "An investigation is precious (once per target, ever). Spend it on someone whose loyalty actually changes decisions — a leading voice, or the player about to hold the Chancellorship — not on a random quiet seat." },
            { id: "liberal.powers.execute", title: "Executions are your Hitler answer",
              body: "Killing Hitler wins on the spot. As the Fascist track approaches 3, weigh executing your best-supported Hitler suspect — even a coin-flip kill can be worth it if a Fascist win is otherwise imminent." },
          ],
        },
      ],
    },
    {
      id: "fascist", title: "Playing as a Fascist", subcats: [
        {
          id: "blend", title: "Blending in", items: [
            { id: "fascist.blend.playliberal", title: "Play like a Liberal for as long as you can",
              body: "The strongest Fascists look exactly like helpful Liberals: pass the occasional Liberal policy, make correct-sounding accusations, and build credit you can spend on one decisive lie later." },
            { id: "fascist.blend.overreach", title: "Don't over-defend or over-accuse",
              body: "Loudly defending a fellow Fascist, or aggressively burying an innocent Liberal, is how you get caught. Let doubt fall naturally; a Fascist who talks too much becomes the story." },
          ],
        },
        {
          id: "agenda", title: "Advancing the agenda", items: [
            { id: "fascist.agenda.chaos", title: "Manufacture chaos when it favours you",
              body: "Three failed elections top-deck a policy with no power and no blame — and the deck is Fascist-heavy, so forced top-decks tend to help Fascists. Engineering deadlock can be safer than personally enacting a Fascist policy." },
            { id: "fascist.agenda.conflict", title: "Use the President's discard as cover",
              body: "A Fascist President can honestly claim a bad hand ('I was forced') because only they saw the third card. Blaming the draw is your safest lie: it's unfalsifiable and consistent with a Fascist-heavy deck." },
            { id: "fascist.agenda.protecthitler", title: "Protect Hitler's cover, not Hitler's votes",
              body: "In 7+ games you don't even know who Hitler is, so the job is to keep suspicion diffuse rather than to shield a specific seat. Steer investigations and executions toward Liberals and away from quiet, un-tested players." },
          ],
        },
      ],
    },
    {
      id: "hitler", title: "Playing as Hitler", subcats: [
        {
          id: "count", title: "By player count", items: [
            { id: "hitler.count.56", title: "5–6 players: you have a partner",
              body: "You know your Fascist and they know you, so you can coordinate — but the Chancellor path to victory is short here. Look moderate, avoid being the one to enact Fascist policies, and let your partner take risks." },
            { id: "hitler.count.7plus", title: "7+ players: play a genuine Liberal",
              body: "You're blind to your team, so the winning Hitler is often literally playing the best Liberal at the table — passing Liberal policies, making good reads — to become the trusted player everyone is happy to elect Chancellor later." },
          ],
        },
        {
          id: "win", title: "Winning as Hitler", items: [
            { id: "hitler.win.quiet", title: "Boring is safe",
              body: "Hitler almost never wants to be interesting. Avoid powers that force you to reveal a bias, don't push hard for the Chancellorship early, and don't get investigated by looking suspicious." },
            { id: "hitler.win.window", title: "Know your Chancellor window",
              body: "Electing Hitler Chancellor only wins after 3 Fascist policies. Before that it's harmless, so early Chancellorships can even build your trust; the danger begins the moment the 3rd Fascist policy lands — that's when Liberals should stop electing you, and when you should look maximally safe." },
          ],
        },
      ],
    },
    {
      id: "president", title: "As President", subcats: [
        {
          id: "draw", title: "The draw", items: [
            { id: "president.draw.discard", title: "Think about the story your discard tells",
              body: "You choose which card to bury and what to claim. As a Liberal, discard to give your Chancellor the best honest hand; as a Fascist, keep your claim consistent with what a Liberal would plausibly have drawn." },
            { id: "president.draw.claim", title: "Claim precisely and consistently",
              body: "State exactly what you drew (e.g. 'two Fascist, one Liberal'). Vague or shifting claims read as lies. The app prices your claim against the known pile — an impossible claim gets flagged immediately." },
          ],
        },
        {
          id: "info", title: "Powers as information", items: [
            { id: "president.info.power", title: "A power is a chance to gather or launder information",
              body: "As a Liberal, use Investigate/Peek to genuinely learn and then share truthfully. As a Fascist, a power is a stage to tell a convincing lie — but remember a later contradiction (a peek that doesn't match the next hand) is exactly what the app catches." },
          ],
        },
      ],
    },
    {
      id: "chancellor", title: "As Chancellor", subcats: [
        {
          id: "choices", title: "Choices at the table", items: [
            { id: "chancellor.choices.enact", title: "Your enact is a public commitment",
              body: "Unlike the President's hidden discard, what you enact is seen by everyone. Enacting Fascist when you could have claimed a forced hand is a strong tell — be ready to explain the two cards you say you were passed." },
            { id: "chancellor.choices.veto", title: "Veto is a negotiation, not just a button",
              body: "Once veto is unlocked, proposing it tests the President: a Liberal President often refuses to burn a Liberal policy, while agreement can quietly bury one. Watch who wants to veto what — it leaks alignment." },
          ],
        },
      ],
    },
    {
      id: "reading", title: "Reading the table", subcats: [
        {
          id: "signals", title: "Signals & tells", items: [
            { id: "reading.signals.votes", title: "Voting blocs",
              body: "Fascists tend to vote together on the governments that matter. Two players who repeatedly back the same risky elections — or who both go quiet on a key vote — are worth watching." },
            { id: "reading.signals.claims", title: "Claim vs. outcome",
              body: "Compare what Presidents claimed to what Chancellors enacted and to the known pile. A President who 'never sees Liberals' while the pile is still Liberal-rich is telling an increasingly expensive story." },
            { id: "reading.signals.conflict", title: "Who benefits from the chaos",
              body: "When a government goes bad, ask who gained: whose Chancellorship it enabled, whose investigation it dodged, who avoided a kill. Fascist plans usually leave a beneficiary." },
          ],
        },
        {
          id: "tools", title: "Using the app", items: [
            { id: "reading.tools.odds", title: "Let the model do the arithmetic",
              body: "Turn on lie detection to see each government's fascist odds and any impossible claims, and use the game review's step-by-step replay to watch the role probabilities evolve. It won't out a liar for you, but it tells you where to look." },
          ],
        },
      ],
    },
    {
      id: "endgame", title: "Endgame", subcats: [
        {
          id: "critical", title: "Critical moments", items: [
            { id: "endgame.critical.3f", title: "The Hitler zone (3 Fascist policies)",
              body: "Once 3 Fascist policies are down, ANY Chancellor could win the game if they're Hitler. Liberals should now only elect players they can effectively vouch for, and be willing to fail elections rather than gamble the game." },
            { id: "endgame.critical.4l", title: "Liberals at 4 policies",
              body: "One Liberal policy from victory, Fascists must block every Liberal enact — which forces them into the open. Expect Neins on safe-looking governments and Fascist enacts from 'forced' hands; that pressure is itself information." },
            { id: "endgame.critical.assassinate", title: "Timing the assassination",
              body: "If you hold an Execution as the Fascist track gets dangerous, don't sit on it hoping for certainty. A well-reasoned kill on your strongest Hitler read can win outright — and even a miss removes a player and buys information." },
          ],
        },
      ],
    },
  ];

  const TREES = { rule: RULES, theory: THEORY };

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

  window.Reference = { tree, flatten, search, findItem, targetOf: (kind, id) => kind + ":" + id };
})();
