# Probability Model & Game-Theory Notes

This documents the math behind the probability display. It's kept separate from the rules so
the modeling assumptions (which involve some game theory / interpretation) are on the record
and easy to revisit.

## 1. What we know for certain

- The deck is **11 Fascist + 6 Liberal = 17** cards.
- Enacted policies are **public**. So at any moment the combined (draw + discard) pool is
  known exactly: `(11 − F_enacted)` Fascist and `(6 − L_enacted)` Liberal.
- A **round** is the span between reshuffles. At the **start of a round**, the discard pile
  has just been merged back, so the *entire* non-enacted pool sits in the draw pile with a
  **known composition** `(N, L)` where `N` = pool size and `L` = liberals in it. This known
  starting composition is what makes the round analyzable.
- Each government (legislative session) removes **exactly 3 cards** from the draw pile: 1
  enacted (public) + 2 discarded (hidden). A round ends when the draw pile has `< 3` cards;
  the `R = N − 3·G` leftover cards (R ∈ {0,1,2}, G = number of governments in the round) are
  never seen and get reshuffled into the next round.

## 2. What is hidden, and the "liberal modifier"

The only hidden information *within* a round is the **identity of the 2 discarded cards per
government** (the President's discard and the Chancellor's discard). We reconstruct them from
what the President **claims** they drew.

- If we assume the President told the truth, the claimed 3-card hand + the (public) enacted
  card fully determine the 2 discards.
- Players lie. The **liberal modifier** encodes the net lie about liberals for a government:
  - **0** — told the truth.
  - **−1 ("lying down")** — discarded a **Liberal** but claimed a Fascist. A liberal secretly
    left the pool that the claim doesn't account for.
  - **+1 ("lying up")** — discarded a **Fascist** but claimed a Liberal (rarer).
  - The modifier for a government adjusts the **liberal count assumed to have been drawn/
    removed** for that government, which changes the reconstructed pool available to every
    other government in the round — and therefore everyone's probabilities.
- The **total liberal modifier** for a round is the sum of per-government modifiers. There is
  also a global/round-level modifier the user can set when speculating about the reshuffle
  boundary and the bottom cards (see §6).

Because the modifier changes the assumed `L` that flows through the round, **changing it
re-computes every probability in that round** — exactly the intended "what if they lied" lever.

## 3. The core distribution — a single hand (hypergeometric)

If the pile a President draws from has `n` cards with `ℓ` liberal (and `n − ℓ` fascist), the
probability of drawing a hand with exactly `k` liberals (and `3 − k` fascist) in 3 cards is
**hypergeometric**:

```
P(k liberals) = C(ℓ, k) · C(n − ℓ, 3 − k) / C(n, 3)
```

`C` = binomial coefficient. This is the exact "what were the odds of that hand?" for a hand
drawn from a known pile.

## 4. Forward vs. retrospective probability

Model a round as a uniformly shuffled pile of `N` cards (`L` liberal), dealt off the top in
consecutive groups of 3 (one group per government), with `R` leftover cards at the bottom.
Group `j` has `l_j` liberals; the leftover has `r` liberals; `∑_j l_j + r = L`.

The joint probability of a full composition profile is:

```
P(l_1, …, l_G, r) = [ ∏_j C(3, l_j) ] · C(R, r) / C(N, L)
```

(Count the ways to place `L` identical liberals into the grouped slots.)

- **Forward probability** of government `k`'s hand = condition on the governments *before* `k`
  only. Equivalent to sequential hypergeometric: remove the (assumed) hands of govs `1..k−1`
  from the pile, then apply §3 to what remains. Depends only on earlier govs.

- **Retrospective probability** of government `k`'s hand = condition on **all other observed
  governments in the round so far** (before *and* after `k`). Later draws are informative:
  seeing liberals come out later implies the early pile was fascist-heavy, which raises the
  odds of an early fascist-heavy hand. This is the model the app uses for the headline %.

### The retrospective formula
Given all other governments' liberal counts are observed, let `S = L − ∑_{j≠k} l_j` (the
liberals that must be split between government `k`'s hand and the unseen `R` leftovers). Then:

```
                   C(3, l_k) · C(R, S − l_k)
P(l_k | others) = ───────────────────────────────
                   ∑_{m=0..3} C(3, m) · C(R, S − m)
```

The `R` leftover cards are what keep this from collapsing to 0/1: if `R = 0` and every other
government is observed, `l_k` is fully determined (probability 1). As a round progresses, more
`l_j` become observed and the effective remainder shrinks, so the estimate sharpens live —
this is the "my 25% goes up as the round unfolds" behavior.

**Worked check (the user's example).** Round pool `N = 6`, `L = 3`, `R = 0`, two governments.
Marginally `P(gov1 = 3 fascist) = C(3,3)C(3,0)/C(6,3) = 1/20 = 5%`. Observe `gov2 = 3
liberal`: now `S = 3 − 3 = 0`, so `l_1 = 0` liberals ⇒ 3 fascist, and the formula gives
`C(3,0)·C(0,0) / [C(3,0)·C(0,0)] = 1`. So **5% → 100%** once the only other government reveals
3 liberals. ✔

## 5. Displayed percentage

For each government's history cards, the app shows the **retrospective** probability of the
hand the President is credited with (claim adjusted by that government's modifier), conditioned
on all other governments observed **so far** in the same round, using the §4 formula. It
recomputes for every government in the round whenever:
- a new government is added,
- any modifier (per-government or round-level) changes,
- the round pool `(N, L)` changes.

## 6. Round boundary & the bottom cards

When a round ends (draw pile `< 3`), the `R ∈ {0,1,2}` leftover cards are revealed to the
analysis as "bottom cards." Their composition is inferred from the round-level modifier: the
user sets what they believe those bottom cards were (e.g. modifier 0 ⇒ the naive inference;
a nonzero modifier flips liberal↔fascist among the bottom cards to match a speculated lie
history). The app displays these bottom cards next to the round modifier box, because they
constrain `∑ l_j` and therefore tighten every retrospective estimate in the just-finished
round. After reshuffle, a new round starts with a fresh known `(N, L)` and no probabilistic
link to the previous round.

## 7. Assumptions, limitations & open questions

- **Independence of lies:** modifiers are user-supplied speculation; the app computes the
  conditional probabilities *given* those assumed lies. It does not (yet) infer the most
  likely lie history or assign a prior over modifiers.
- **Honest enacted cards:** the enacted policy is assumed correctly recorded (it's public at
  the table).
- **Chaos policies** (auto-enacted from the top of the pile on 3 failed elections) remove 1
  card with no discards; the bookkeeping treats that as a 1-card removal, not a 3-card
  government. (Handled as a special event.)
- **Open question — priors:** a future version could put a prior on each President lying and
  produce a posterior "how likely is this claim honest?" rather than only "how likely was this
  hand given assumed honesty." Noted for later; current scope is the conditional model above.
