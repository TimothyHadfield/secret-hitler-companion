# Secret Hitler — Rules Reference

This is the canonical rules reference the app encodes. If gameplay logic in the code
ever disagrees with this file, this file is the source of truth (update code to match).

## 1. Overview & win conditions

Secret Hitler is a social deduction game for **5–10 players**. Players are secretly
divided into two teams:

- **Liberals** — the majority. They win by:
  - Enacting **5 Liberal policies**, OR
  - **Assassinating Hitler** (via the Execution power).
- **Fascists** — the minority, including one player who is **Hitler**. They win by:
  - Enacting **6 Fascist policies**, OR
  - Getting **Hitler elected Chancellor** *after 3 Fascist policies have been enacted*.

Only the Fascists (except in some counts, see below) know who each other are and who
Hitler is. Hitler does **not** know who the other Fascists are (in most counts). Liberals
know nothing for certain.

### Team composition by player count

| Players | Liberals | Fascists (incl. Hitler) | Hitler knows fascists? |
|--------:|:--------:|:-----------------------:|:----------------------:|
| 5       | 3        | 1 + Hitler              | Yes (Hitler knows)     |
| 6       | 4        | 1 + Hitler              | Yes                    |
| 7       | 4        | 2 + Hitler              | No                     |
| 8       | 5        | 2 + Hitler              | No                     |
| 9       | 5        | 3 + Hitler              | No                     |
| 10      | 6        | 3 + Hitler              | No                     |

Rule of thumb: **Fascists (including Hitler) = ceil(players/2) − 1**; the rest are Liberal.
In **5–6 player** games, Hitler knows who the Fascist is (they reveal to each other). In
**7+**, Hitler is blind like a Liberal, only knowing they are Hitler.

## 2. The policy deck

- **17 policy cards total: 11 Fascist, 6 Liberal.**
- Cards are drawn from the **draw pile**. Discarded/unused cards go to the **discard pile**.
- Enacted policies are placed permanently on the **tracks** (boards) and never return.
- **Reshuffle:** whenever the draw pile has **fewer than 3 cards**, shuffle the discard
  pile together with the remaining draw-pile cards to form a new draw pile. (In this app,
  a reshuffle is the hard boundary between "rounds" — probability cannot be tracked across
  it, because the card order is fully re-randomized.)

Because enacted policies are public, the composition of the (draw + discard) pool is always
known exactly: `pool = 17 − enacted`, i.e. `(11 − fascistsEnacted)` Fascist and
`(6 − liberalsEnacted)` Liberal.

## 3. Setup

1. Seat players **around a table** (this app randomizes seating).
2. Deal secret **Role** and **Party** cards per the table above; night phase: Fascists (and
   Hitler in 5–6) learn their team.
3. Randomly choose the **first Presidential candidate** (this app randomizes this).
4. Place the draw pile (shuffled 17), Liberal and Fascist tracks, and the Election Tracker.

## 4. Order of play (a single round / "government")

Each round has an **Election** then a **Legislative Session**.

### 4a. Election
1. The current **Presidential candidate** nominates a **Chancellor candidate**.
   - **Term limits:** the *last elected* President and Chancellor are ineligible to be the
     new Chancellor candidate. (With ≤5 players remaining, only the last elected Chancellor
     is termed-out.)
2. All players **vote Ja/Nein** on the President+Chancellor pair.
3. If **majority Ja**, they are elected → proceed to Legislative Session.
   - **Hitler check:** if **3+ Fascist policies** are enacted and the elected Chancellor is
     **Hitler**, Fascists win immediately.
4. If the vote **fails** (tie or majority Nein), the **Election Tracker advances by 1**, and
   the Presidential candidacy passes to the next player clockwise.
   - **Chaos:** if the Election Tracker reaches **3 failed elections in a row**, the top
     policy of the draw pile is **enacted automatically** (no powers trigger), term limits
     reset, and the tracker resets to 0.

### 4b. Legislative Session
1. The **President draws the top 3 policies** from the draw pile.
2. The President **discards 1** (face-down to discard) and passes **2** to the Chancellor.
3. The Chancellor **enacts 1** (face-up on the track) and **discards 1** (face-down).
   - Communication about the cards is forbidden during this exchange (in-game).
   - **Veto power** (after 5 Fascist policies enacted): the Chancellor may propose to veto;
     if the President agrees, both cards are discarded, no policy is enacted, and the
     Election Tracker advances by 1.
4. If a **Fascist policy** was enacted and that track slot grants a **Presidential Power**,
   the President uses it now (see below).
5. The Presidential candidacy passes to the next player clockwise; the just-elected
   President and Chancellor become the new term-limited pair.

**Every legislative session removes exactly 3 cards from the draw pile:** 1 enacted (public)
and 2 discarded (hidden). This 3-cards-per-government fact is the backbone of the app's
pile bookkeeping.

## 5. Presidential Powers (by Fascist track slot & player count)

Powers are printed on the **Fascist track** and trigger when a Fascist policy is enacted on
that slot. Which slots have which power depends on player count.

| Fascist slot →       | 1 | 2 | 3 | 4 | 5 | 6 (win) |
|----------------------|---|---|---|---|---|---------|
| **5–6 players**      | — | — | Examine top 3 (Policy Peek) | Execution | Execution | Fascists win |
| **7–8 players**      | — | Investigate Loyalty | Special Election | Execution | Execution | Fascists win |
| **9–10 players**     | Investigate Loyalty | Investigate Loyalty | Special Election | Execution | Execution | Fascists win |

Power definitions:
- **Investigate Loyalty:** President secretly views one player's **Party** card (not role).
- **Special Election:** President picks *any* player to be the next Presidential candidate
  (a one-off; afterward the order resumes to the left of the President who used the power).
- **Policy Peek:** President secretly views the **top 3** cards of the draw pile.
- **Execution:** President **kills** a player (removed from the game). If that player was
  **Hitler**, Liberals win immediately. Executed players do not reveal their card.
- **Veto Power** (unlocked once 5 Fascist policies are enacted): see Legislative Session.

The **4th and 5th** Fascist slots are **Execution** in every count; the **6th** is the
Fascist win. Slots 1–3 vary as above. (The physical board also prints the veto-unlock at
slot 5.)

## 6. The Election Tracker (chaos)

- Starts at 0. **+1 on each failed election** (rejected or, in some rulings, when a term ends
  in veto).
- At **3**: the top policy auto-enacts (Chaos), tracker resets to 0, **term limits reset**
  (everyone is eligible again for the next round). No power triggers from a chaos policy.
- The tracker **resets to 0** whenever *any* policy is enacted (through a successful
  government).

## 7. What this app tracks vs. the physical game

The app is a **companion/analyzer**, not an enforcer — it assumes honest human play at the
table and focuses on:

- **Randomization:** seating order + first President.
- **Bookkeeping:** enacted Liberal/Fascist counts, draw & discard pile composition, reshuffle
  boundaries, current President/Chancellor, the election tracker, and chaos top-decks.
- **Probability:** for each government, the likelihood the President truly received the hand
  they claim, given the known pile and later observed governments — see `PROBABILITY_MODEL.md`.
- **Powers:** when a Fascist policy triggers a power, the app pauses and records the outcome —
  Investigation (target + party), Policy Peek (top-3 order), Kill (target; Hitler ⇒ Liberal win,
  else the player is marked dead and skipped), Special Election (chosen next President, with the
  normal order resuming afterward). Turn order and deaths are derived from these events.
- **End game:** auto-detects policy-track wins and Hitler-execution, then records roles (Hitler
  + the count-appropriate Fascists) in place on the table, colouring each player's circle.
- **Statistics:** per-player + cross-game data, plus a reviewable per-game archive (browser).

- **Term limits (enforced):** the last *elected* Chancellor can never be tapped as the next
  Chancellor; the last *elected* President is also blocked **unless only 5 players are alive**
  (a 5-player game, or a larger game reduced to 5 by executions). A **chaos** top-deck clears
  both. Ineligible seats are drawn dashed/dimmed and tapping one explains why.
- **Veto (recordable):** a **⊘ Veto** toggle appears once **5 Fascist policies** are enacted.
  Arm it, then tap the hand the President claimed: the government is recorded as vetoed —
  **no policy is enacted, all 3 drawn cards go to the discard, and the Election Tracker
  advances by 1** (reaching 3 triggers chaos as usual). The claim still prices normally, because
  the President really did draw 3 cards. Veto and Conflict are mutually exclusive.
- **"Hitler elected Chancellor" (recordable):** from **3 Fascist policies** on, a
  **⚑ Chancellor was Hitler** button appears. It ends the game immediately as a Fascist win and
  pre-fills that player as Hitler for role recording. No cards are drawn — the game ends at the
  election — so it touches neither the piles nor the tracker.
- **Investigate Loyalty (enforced):** a player may **not be investigated twice in one game** —
  previously investigated seats are removed from the Investigation prompt.
- **Special Election (fixed):** the presidency resumes after the President who **first** broke the
  normal order, so a *nested* special election no longer overwrites that seat.
- **Policy Peek staleness:** a peek only describes the pile until the next reshuffle, so a peek
  recorded in an earlier round is struck through and marked "(reshuffled)".

The app still does not track the **vote itself** (Ja/Nein counts, ties failing, dead players not
voting) — the table votes and then tells the app the outcome. That assumes honest table play.
