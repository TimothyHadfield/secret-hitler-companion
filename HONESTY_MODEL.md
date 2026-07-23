# Honesty Model — theory & derivation

> **Status: theory only.** No code, no UI, no data-model decisions. This file works out *what*
> quantity we want, *why* the current model does not compute it, and *how* to compute it exactly.
> Companion to `PROBABILITY_MODEL.md` (which stays correct — this strictly generalises it).
>
> Written session 21. Nothing here is implemented.

---

## 0. The complaint, stated precisely

The app currently displays, for each government, a number `P(hand = claim | pool, other claims)`.
That is a **likelihood**, not a posterior. It answers:

> "If this president was telling the truth, how surprising was the hand?"

Players read it as if it answered:

> "How likely is it that this president is lying?"

These are different, and the gap between them is not a rounding error — it can invert the
conclusion. A 3% hand is not 97% evidence of a lie. Two reasons:

1. **Base rate.** Somebody has to draw the rare hands. If a claim is rare *a priori*, it is rare
   for honest players too, and rarity alone is not evidence against them.
2. **The liar's alternative.** Evidence is a *ratio*. `P(claim | lying)` matters as much as
   `P(claim | honest)`, and a competent liar does not pick implausible stories. If a liar would
   *never* claim 3L, then a 3L claim being rare makes the claimant **more** trustworthy, not less.

Formally, what we want is the posterior odds

```
P(lied | claim)     P(claim | lied)      P(lied)
─────────────── =  ────────────────  ×  ─────────
P(true | claim)     P(claim | true)      P(true)
```

The app has a good handle on the denominator of the likelihood ratio and nothing at all on the
numerator or the prior. **Everything below is about supplying those two.**

---

## 1. The central structural fact: the deck is a polygraph

Before any priors, there is a hard conservation law, and it is much stronger than it first looks.

A round starts with a pool of `N` cards containing `L` liberals (both known exactly, because
enacted policies are public). It contains `G` governments, each removing exactly 3 cards, plus
`R = N − 3G ∈ {0,1,2}` leftovers that are never seen. Let `h_j` be the true number of liberals in
government `j`'s hand and `r` the liberals among the leftovers:

```
h_1 + h_2 + … + h_G + r = L        with h_j ∈ {0,1,2,3},  r ∈ {0,…,R}
```

Now let `c_j` be what president `j` **claimed**. Subtract:

```
Σ_j (h_j − c_j)  =  L − r − Σ_j c_j
```

The right-hand side is **fully observable up to `r`**, and `r ≤ 2`. So:

> **At the end of every round, the total net quantity of lying is pinned down to within 2 cards.**
> Not estimated — *pinned*. If the claims account for 3 liberals and the round pool held 6, then
> 3±2 liberals were concealed by somebody. The only open question is **who**.

This reframes the entire problem. It is not a detection problem ("was there a lie?"), it is an
**attribution problem** ("here is a known mass of lying — distribute it across these players").
That is a much better-posed question, and it is why this is tractable at all.

It also explains, retroactively, what the app's round-modifier stepper has always been: the
modifier `m` *is* the aggregate net lie for the round. Its feasible window is narrow because the
conservation law is tight. The honesty posterior is what you get when, instead of asking the user
to pick `m` by hand, you **marginalise over every feasible lie-assignment weighted by how
plausible each one is**. That is the sense in which this retires the stepper: the stepper is a
point estimate of a quantity we should be integrating out.

**Corollary — the fascist's dilemma.** A fascist president who wants a fascist policy enacted from
a hand containing a liberal must either report honestly (and visibly pass FF from a hand that had
an L — a tell) or misreport (and spend from a lie budget that the conservation law caps at ~`R`
per round). There is no third option. Deception and policy progress trade off against each other,
and the exchange rate is set by the deck, not by table talk.

---

## 2. Layer 1 — hard logic (certainties, computed before any probability)

These are deterministic deductions. They produce answers of exactly 0 or 1 and must be kept
visually and semantically distinct from anything probabilistic ("**proven**" vs "**likely**").

### 2a. Per-government constraints

| # | Deduction | Why |
|---|-----------|-----|
| D1 | enacted = L ⇒ `h_j ≥ 1` | the enacted card came out of the president's 3 |
| D2 | enacted = F ⇒ `h_j ≤ 2` | same, in the other direction |
| D3 | `h_j ≤ min(3, liberals remaining in pool)` | can't draw what isn't there |
| D4 | claim = 3L **and** enacted = F ⇒ **certain false claim** | contrapositive of D2 |
| D5 | claim = 3F **and** enacted = L ⇒ **certain false claim** | contrapositive of D1 |
| D6 | conflict (president claims they passed LL, F enacted) ⇒ **at least one of {P, C} is lying** | a disjunctive certainty — see §5 |
| D7 | veto ⇒ no enacted-card constraint, but 3 cards still leave the pool | veto is behaviourally informative, not combinatorially |

### 2b. Round-level constraints — the minimum-lie count

Given the claim vector `c = (c_1…c_G)` and the conservation law of §1, ask: **what is the smallest
number of claims that must be false?**

```
minLies(round) = min over feasible (h, r) of  #{ j : h_j ≠ c_j }
```

subject to `Σ h_j + r = L`, `h_j ∈ [lo_j, hi_j]` (bounds from D1–D3), `r ∈ [0, R]`.

The recursion, walking governments in order and carrying the liberals consumed so far:

```
state:  (j, s) = after government j, s liberals consumed
value:  f(j, s) = fewest false claims among govs 1..j that reach s
init:   f(0, 0) = 0
step:   f(j+1, s+h) = min over h in [lo_{j+1}, hi_{j+1}] of [ f(j, s) + (h != c_{j+1}) ]
answer: min over r in [0, R] of f(G, L - r)          (+inf = claims jointly impossible)
```

`(G+1) × (L+1)` cells, ≤4 transitions each — about 30 cells in practice. Brute force over `4^G`
would also work; the reason to write it as a DP is that **swapping the min-plus semiring for
sum-product turns the identical recursion into the forward–backward pass of §4b**. Same graph,
same states, one implementation — which is what guarantees the hard-logic layer and the
probability layer are looking at the same constraint set and can never drift apart.

**Worked example.** Pool `N = 8`, `L = 2`, two governments, `R = 2`. Both enacted a **Liberal**
policy. President 1 claims 2L, president 2 claims 1L. Each claim is individually drawable. But
both enacted L ⇒ `h₁ ≥ 1` and `h₂ ≥ 1` ⇒ `h₁ + h₂ ≥ 2`, while conservation says
`h₁ + h₂ + r = 2`. So `r = 0` and `h₁ = h₂ = 1`, **forced**. President 1 claimed 2L holding 1L —
a proven false claim. President 2 is proven truthful. No priors were used.

This is exact and needs no priors at all. Two derived quantities are directly useful:

- **`minLies = k > 0`** ⇒ *at least* `k` people at this table lied this round. Certain.
- **Per-government honesty cost.** Recompute `minLies` with `h_j = c_j` forced. If the result is
  `+∞` (infeasible), government `j` is a **proven liar**. If it rises by `d`, then believing `j`
  requires `d` extra lies elsewhere — a hard, prior-free suspicion score.

This is the natural generalisation of the current auto-clamp behaviour. Today the app silently
adjusts the modifier into feasibility; the honest report is "these claims cannot all be true."

### 2c. Cross-checks against later public facts (the strongest evidence in the game, currently unused)

The app already records these events and never cross-references them:

- **Policy Peek.** The president claims the top 3 cards. If no reshuffle intervenes, *those are
  exactly the 3 cards the next government draws*. The peek claim and the next president's claim
  are two independent statements about **the same three cards**. Disagreement ⇒ one of them lied,
  certainly. This is a direct, deterministic contradiction test and it is very strong.
- **Chaos top-deck.** Auto-enacted from the top of the pile and public. It reveals the identity of
  a specific card, which tightens D3 and can retroactively falsify a peek claim.
- **Investigation.** The investigator reports a party. Under any role assignment where the
  investigator is liberal, the report is truth by construction — so an investigation claim is a
  hard constraint *conditional on the assignment*, which is exactly how §6 consumes it.

### 2d. Role-level hard deductions (free, from the existing event log)

- **D8 — the Hitler check.** Any player elected Chancellor while ≥3 fascist policies were on the
  board, where the game did **not** immediately end, is **certainly not Hitler**. The app already
  knows the track state and the election outcome; it just never draws the inference.
- **D9 — execution.** An executed player where the game continued is **certainly not Hitler**.
- **D10 — terminal reveals.** Hitler executed / Hitler elected reveals one role exactly.
- **D11 — counts.** Exactly `f = ceil(n/2) − 1` fascists including Hitler; the rest liberal.
- **D12 — the operator's own role.** The person holding the phone knows their own card, and in a
  5–6 player game a fascist knows the entire fascist team. Conditioning on this collapses a large
  part of the hypothesis space for free. (Whether we *ask* is a product question, not a maths one.)

D8 alone is worth a lot and costs nothing.

---

## 3. Layer 2 — the generative model

Everything probabilistic follows from one explicit generative story per government. Write it down
completely; every parameter below is a named, estimable quantity rather than a vibe.

```
1.  Nature deals the hand           h_j ~ multivariate hypergeometric over the round pool
2.  President sees h_j, discards 1  → passes a pair, p_j ∈ {0,1,2} liberals     [policy π_P]
3.  Chancellor sees p_j, enacts 1   → e_j ∈ {L, F}, or veto                     [policy π_C]
4.  President publicly claims       ĉ_j ∈ {0,1,2,3}                             [report model ρ_P]
5.  Chancellor publicly claims      ĉ^C_j ∈ {0,1,2} (what they say they got)    [report model ρ_C]

Observed: e_j (truth, public), ĉ_j, ĉ^C_j, conflict flag, powers used.
Hidden:   h_j, p_j, and every player's team.
```

Note the split at steps 2/3 versus 4/5: **acting** fascist and **talking** fascist are different
channels and must be parameterised separately. Conflating them is the main modelling error to
avoid — it is what makes naive analyses blame the wrong seat.

### 3a. Behaviour policies (steps 2–3)

Conditional on team, with everything smoothed by a small mistake rate `μ ≈ 0.01–0.03` so that no
observation ever has likelihood exactly zero (see §8).

**President's pass, `π_P(p | h, team)`:**

| hand `h` | liberal president | fascist president |
|---|---|---|
| 3F (h=0) | FF (forced) | FF (forced) |
| 2F1L (h=1) | LF w.p. `1−τ`, FF w.p. `τ` | FF w.p. `β`, LF w.p. `1−β` |
| 1F2L (h=2) | LL w.p. `1−τ`, LF w.p. `τ` | LF w.p. `β`, LL w.p. `1−β` |
| 3L (h=3) | LL (forced) | LL (forced) |

- `τ` = the liberal "testing" rate — deliberately handing a split to probe the chancellor. The
  [Cornell INFO 2040 analysis](https://blogs.cornell.edu/info2040/2018/09/18/secret-hitler-game-theory-testing-the-chancellor/)
  argues equilibrium `τ → 0` (testing leaks information to the fascist and proves nothing to the
  table). Keep it as a parameter and let the archive settle it empirically; expect `τ` small.
- `β` = the fascist **push rate** — how often they take the fascist option rather than blending.
  This should be **state-dependent**, not constant: `β = β(track state, players alive, tracker)`.
  Fascists push hard early (cheap, plausible), blend in the middle to build trust, and push
  unconditionally near 5F or when liberals are one policy from winning. Modelling `β` as constant
  is the second-biggest error available here.

**Chancellor's enactment, `π_C(e | p, team)`:** liberal enacts L whenever `p ≥ 1` (up to `μ`);
fascist enacts F whenever `p ≤ 1` with probability `γ` (same state-dependence as `β`).

Note that these two tables *already reproduce the classic result*. A chancellor receiving FF: a
liberal president passes FF only from `h=0` (165/680); a fascist passes FF from `h∈{0,1}`
(495/680); at a 50/50 prior the posterior is `495/660 = 3/4`, exactly
[Aslaksen's number](https://www.uio.no/studier/emner/matnat/math/MAT4010/data/forelesningsnotater/secret-hitler.pdf).
With a 5-player prior (`p_F = 2/5`) it drops to 2/3. Good sign: the framework contains the known
results as special cases.

### 3b. The report model (steps 4–5) — where the honesty question actually lives

`ρ_P(ĉ | h, p, team)`. Structure it as **truth rate → direction → magnitude → plausibility
shaping**:

1. **Truth rate.** Liberal tells the truth w.p. `1 − ε` (`ε ≈ 0.02–0.05`: liberals mostly have no
   reason to lie, but occasionally shade a story to protect a partner or cover a misplay).
   Fascist tells the truth w.p. `1 − λ`. Note carefully: **a fascist telling the truth is common
   and unremarkable** — `λ` is nowhere near 1, and treating "fascist" as synonymous with "liar" is
   the third classic error.
2. **Direction.** Lies are overwhelmingly **downward** (claim fewer liberals than held) because the
   purpose of the lie is to justify a fascist policy. Upward lies exist but are a specialised play
   (usually framing the chancellor via a manufactured conflict). Split `λ` into `λ↓` and `λ↑` with
   `λ↑ ≪ λ↓`.
3. **Magnitude.** `|ĉ − h| = 1` is far more common than 2; decay geometrically with rate `δ`.
4. **Plausibility shaping — the interesting term.** A competent liar prefers a story that is
   *plausible given public information*, i.e. weights candidate claims by their prior draw
   probability. Introduce a sophistication parameter `s ∈ [0,1]`:

   ```
   ρ(ĉ | h, lying)  ∝  direction(ĉ,h) · decay(|ĉ−h|) · [ P_prior(ĉ) ]^s
   ```

   `s = 0` is a naive liar (claims whatever helps, regardless of how absurd); `s = 1` is a liar who
   perfectly mimics the honest claim distribution. **This parameter controls the sign of the
   evidence from rarity**, which is precisely the failure mode in §0. It deserves to be explicit
   and it deserves a sensitivity analysis, not a hardcoded guess.
5. **Self-consistency.** `ρ = 0` for any claim that contradicts the public enacted card — nobody
   volunteers a self-refuting story (D4/D5 are, in practice, recording errors or conflict claims).

### 3c. The equilibrium ceiling on deception

Worth stating because it bounds what the model can ever achieve. If fascists could choose `ρ` to
exactly match the claim distribution honest players produce, claims would be information-free and
`P(fascist | claim) = prior` for every claim — a pooling equilibrium, the signalling-game analogue
of a perfect liar. They *cannot*, because of §1: a fascist who never lies detectably cannot
concealed-push fascist policies, and the conservation law caps concealment at ~`R` liberals per
round. So there is a strictly positive floor on detectability, and it is set by how hard the
fascists are pushing. **The model is most informative exactly when fascists are winning** — which
is when it is most needed. That is a genuinely nice property, not a coincidence.

---

## 4. Layer 3 — exact inference

The pleasant surprise: **no sampling, no approximation, no belief propagation is required.** The
state space is small enough to enumerate exactly.

### 4a. Role assignments are enumerable

An assignment `A` labels every player Liberal / Fascist / Hitler subject to D11. The count is
`C(n, f) · f` — at most `C(10,3) · 3 = 360` for a 10-player game, and far fewer after applying the
hard deductions of §2d (D8 and D9 typically eliminate most Hitler candidates by mid-game). This is
the crucial tractability fact and it is why GRAIL-style belief propagation is unnecessary here:
**we can just enumerate every hypothesis.**

### 4b. Hands are a dynamic program

For a **fixed** assignment `A`, within a round, the per-government likelihood

```
f_j(h) = P( ĉ_j, e_j, conflict_j | h_j = h, A )
       = Σ_p  π_P(p | h, team_P(j)) · π_C(e_j | p, team_C(j)) · ρ_P(ĉ_j | h, p, team_P(j)) · ρ_C(…)
```

depends only on `h` and the two seats involved. The prior over hand vectors factorises given the
sum (§4 of `PROBABILITY_MODEL.md`):

```
P(h_1…h_G, r) = [ ∏_j C(3, h_j) ] · C(R, r) / C(N, L)
```

so the round likelihood is a **forward–backward DP over the running liberal count**:

```
Λ_round(A) = Σ_{Σh + r = L}  [ ∏_j C(3,h_j) f_j(h_j) ] · C(R,r) / C(N,L)
```

State space `L+1 ≤ 7`, four hand values per government. Forward–backward on the same DP yields the
per-government marginals `P(h_j = v | A, observations)` in one pass.

### 4c. Putting it together

```
P(A | obs)  ∝  P(A) · ∏_rounds Λ_round(A) · ∏_other events P(event | A)
```

where "other events" are investigations (likelihood 1 if consistent with `A` and the investigator
is liberal, `ε` otherwise), peek claims (cross-checked per §2c), executions, and the Hitler-check
deductions (likelihood 0 for any `A` violating D8–D10 — hard logic enters as a zero, which is
correct and safe because these are deductions rather than judgements).

Then normalise over the ≤360 assignments. Total cost: order `360 × 20 governments × 7 states × 12`
≈ 600k floating-point operations for a whole game. Milliseconds. Recomputable from scratch on
every render, which fits the app's existing full-redraw architecture perfectly.

### 4d. The three output quantities

They are different and must never be conflated in presentation:

```
P(claim j was false)  = 1 − Σ_A P(A | obs) · P(h_j = c_j | A, obs)
P(player i is fascist) = Σ_{A : i fascist or Hitler} P(A | obs)
P(player i is Hitler)  = Σ_{A : i is Hitler} P(A | obs)
```

The first is the direct answer to "how likely is this claim honest." The second and third are the
actual payoff — they turn the app from a calculator into a deduction assistant.

### 4e. Backward-compatibility check (a real test, not a formality)

Set `ε = λ = 0` (nobody lies) and condition on every other claim being true. The DP collapses to

```
                   C(3, l_k) · C(R, S − l_k)
P(l_k | others) = ───────────────────────────────
                   Σ_m C(3, m) · C(R, S − m)
```

which is **exactly** the retrospective formula in `PROBABILITY_MODEL.md` §4. The new model must
reproduce the old one in that limit; if it doesn't, the implementation is wrong. This is the first
test to write.

---

## 5. Conflicts — two-sided attribution

The conflict flag is the single richest observation the app records, and it is currently used only
to force the enacted policy fascist.

A conflict is the public statement: *the president says they passed at least one liberal, and a
fascist policy came out.* By D6 at least one of the two is lying. Under the generative model this
is not a special case at all — it falls out of enumerating the four team pairs:

| president | chancellor | how a conflict arises | rough likelihood |
|---|---|---|---|
| L | L | only by mistake | `μ²`-ish — essentially never |
| L | F | chancellor buried the liberal | high (this is what fascist chancellors do) |
| F | L | president passed FF and lied about it, framing an innocent | moderate — a bold, high-variance play |
| F | F | either, and they may coordinate the story | high |

So a conflict is **strong evidence that at least one of the two seats is fascist**, and the split
between them is determined by three things the model already has:

1. **Their priors** (including everything learned from earlier governments).
2. **The card odds.** If the pool made `h ≥ 1` overwhelmingly likely, the president's story is
   *a priori* credible → blame shifts to the chancellor. If the pool was fascist-heavy, the
   president's claim of holding a liberal is itself suspicious → blame shifts back.
3. **Each player's estimated lie rate** (§7), which is where per-player history pays off.

This is exactly the structure the [LessWrong scenario](https://www.lesswrong.com/posts/C8geRCXF54FsyKydL/analysis-of-a-secret-hitler-scenario-1)
was reaching for with its "bold vs timid fascist" split — and its arithmetic slip (75% where the
odds form gives 2/3) is the standing argument for computing this in code rather than at the table.

**Data note:** attribution is much sharper if the *chancellor's* claim is recorded too, not just a
boolean conflict flag. Two claims about the same pair of cards is a far tighter constraint than one
claim plus a disagreement bit. Recording `ĉ^C` is the single highest-value input change.

---

## 6. Worked example (illustrative — president channel only)

First government of the game. Pool `N = 17`, `L = 6`. 7 players ⇒ prior `P(president fascist) = 3/7
≈ 0.429`. President claims **3F** and a fascist policy is enacted.

**Prior over the hand** (hypergeometric, `C(17,3) = 680`):

```
h=0 (3F):   C(11,3)/680        = 165/680 = 0.243
h=1 (2F1L): C(6,1)C(11,2)/680  = 330/680 = 0.485
h=2 (1F2L): C(6,2)C(11,1)/680  = 165/680 = 0.243
h=3 (3L):   C(6,3)/680         =  20/680 = 0.029
```

**Hard logic (D2):** enacted F ⇒ `h ≤ 2`. Renormalising over `{0,1,2}` (total 660) gives the tidy
`0.25 / 0.50 / 0.25`.

**Report model.** Take `λ↓(1 step) = 0.60`, `λ↓(2 steps) = 0.15`, `ε(1) = 0.02`, `ε(2) = 0.005`:

```
P(claim 3F | h=0) = 1.000                                   (truth)
P(claim 3F | h=1) = 0.429(0.60) + 0.571(0.02) = 0.269       (one-step down-lie)
P(claim 3F | h=2) = 0.429(0.15) + 0.571(0.005) = 0.067      (two-step down-lie)
```

**Posterior:**

```
honest : 0.25 × 1.000 = 0.2500
h=1    : 0.50 × 0.269 = 0.1343
h=2    : 0.25 × 0.067 = 0.0168
                        ───────
                 total   0.4011

P(claim was true) = 0.2500 / 0.4011 = 62%      →   P(claim was false) ≈ 38%
```

And the team posterior from the same numbers:

```
P(obs | fascist) = 0.25(1) + 0.50(0.60) + 0.25(0.15) = 0.588
P(obs | liberal) = 0.25(1) + 0.50(0.02) + 0.25(0.005) = 0.261

P(fascist | obs) = 0.429(0.588) / 0.4011 = 63%     (prior was 43%)
Evidence weight  = log(0.588 / 0.261) = 0.81 nats = 3.5 decibans
```

*(The two 6x% figures landing close together here is a coincidence of the chosen parameters — they
are entirely different quantities and will usually diverge.)*

**The punchline.** Today the app would display **24%** for this government. The honest answer to
"how likely is this a lie" is **38%**, and the answer to "is this player fascist" is **63%**, up
from a 43% prior. The current number is not a bad estimate of either — it is a different quantity
that happens to be shaped like a probability, which is why it misleads.

---

## 7. Calibrating the parameters from the archive (this is the part nobody else can do)

Every published analysis of this game guesses its lie rates. The 50/50 "bold vs timid" split in the
LessWrong post is a guess. GRAIL's answer was to **learn the likelihoods from ~104,000 logged
games** with a neural net, then temperature-scale for calibration. We can do something better
suited to our scale: the app's archive already stores, for every completed game, **the full claim
history and the recorded true roles**. That is labelled training data for exactly the parameters
this model needs — `θ = (ε, λ↓, λ↑, δ, s, β(·), γ(·), τ, μ)`.

### 7a. EM, with closed-form M-steps

With roles known, there is no assignment sum — only the hands are latent.

- **E-step:** run the §4b forward–backward DP with `A` fixed to the recorded roles → posterior
  `P(h_j = v | obs, A, θ)` for every government in every archived game.
- **M-step:** every parameter is a Bernoulli/multinomial rate, so the update is a weighted count
  ratio in closed form. E.g.

  ```
  λ̂↓ = Σ (expected # fascist-president governments with a downward lie)
       ─────────────────────────────────────────────────────────────
       Σ (expected # fascist-president governments where a down-lie was available)
  ```

- Iterate to convergence (fast — a handful of iterations on hundreds of governments).

A cheaper cold-start that needs no EM: use the §2b minimum-lie DP to get a hard lower bound on
lies per round, attribute them to the most likely governments, and split the counts by recorded
team. Crude, but it is grounded in certainties and gives sane initial values.

### 7b. Per-player lie tendency, with shrinkage

`λ` is not a property of the game, it is a property of **the person**. A group that plays together
has stable personalities — the timid fascist who never lies, the one who always claims 3F. Model
`λ_i ~ Beta(a, b)` with the group mean as the prior, and use the posterior mean

```
λ̂_i = (a + s_i) / (a + b + n_i)
```

where `s_i` is player `i`'s expected lie count and `n_i` their opportunity count. With few games
per player the estimate shrinks to the group mean; with many it becomes genuinely personal. This
is also, incidentally, the "lie tendency" statistic already sitting on the wish-list in
`PROGRESS.md` — the same quantity, arrived at from the other direction.

### 7c. Identifiability — the honest caveat

`β` (fascists *acting* fascist) and `λ` (fascists *lying* about it) both explain a
"fascist-looking" government, and with only presidential claims recorded they are partially
confounded. What separates them:

- **Chancellor claims** separate the pass from the report (§5) — the single most valuable addition.
- **Conflicts** separate president behaviour from chancellor behaviour.
- **Votes**, if ever tracked, separate belief from action entirely and would identify a great deal.

Until then, report `β` and `λ` as a jointly-estimated pair and do not over-interpret either alone.

---

## 8. Numerical hygiene and failure modes

- **Never assign zero likelihood to an observed event on soft grounds.** One zero anywhere in a
  product annihilates a hypothesis permanently and no later evidence can recover it. Every
  behavioural probability gets floored by the mistake rate `μ`. Zeros are reserved exclusively for
  §2 hard logic, where they are *deductions* and are supposed to be irreversible.
- **Work in log space.** Products over 20 governments × 360 assignments underflow otherwise.
- **Report intervals, not points.** Sweep `λ` and `s` across a plausible range and display the
  resulting range. A 38% that becomes 55% when `λ` moves from 0.4 to 0.7 is a fundamentally
  different claim from a 38% that stays at 38%, and the user is entitled to know which they have.
- **Score the model honestly.** The archive gives held-out labels, so use proper scoring: Brier
  score and log-loss of `P(player is fascist)` against recorded roles, plus a reliability diagram
  (of the games where the model said 70%, was it right ~70% of the time?). Compare against the
  prior-only baseline — if it doesn't beat the base rate, it isn't earning its screen space.
- **Test against simulation first.** Generate synthetic games from the generative model with known
  parameters and check that EM recovers them. This is testable *before* a single real game is
  logged, and it validates the inference code independently of whether the model matches reality.
- **Watch for overconfidence from correlated evidence.** Governments in the same round are coupled
  through the deck; treating their evidence as independent would double-count. The DP handles this
  correctly by construction — but any "per-event evidence weight" display is a marginal LLR, not an
  additive decomposition, and should be labelled as such.

---

## 9. What the model needs that the app does not currently record

Listed here as *inputs the mathematics requires*, not as design proposals:

| Input | Value | Note |
|---|---|---|
| Chancellor's claimed pair | **High** | Turns one-sided conflicts into two-sided attribution (§5); breaks the `β`/`λ` confound (§7c) |
| Operator's own role | **High** | Collapses the assignment space for free (D12); in 5–6p a fascist operator knows everything |
| Ja/Nein vote counts | Medium | Independent behavioural channel; the strongest remaining identifier |
| Per-player vote detail | Medium | Much more informative, but taxes every election — the standing product question |
| Peek claim vs next hand | **Already recorded** | The cross-check of §2c needs no new input at all, just the inference |

---

## 10. Open theoretical questions

1. **State-dependent `β(·)` functional form.** Fascist push rate clearly varies with the track
   state; is a two-parameter logistic in (fascist policies, liberal policies) enough, or does it
   need the election tracker and alive-count too? Empirical question — the archive can answer it.
2. **Do fascists coordinate their claims?** The model above treats reports as conditionally
   independent given roles. Fascists who know each other (and can read the table) may correlate
   their stories, which would break that factorisation. A pairwise interaction term is possible but
   costs the DP's clean structure.
3. **Adaptive opponents.** Any published, deterministic model becomes a target: players will learn
   what the app finds suspicious and avoid it. The equilibrium answer is randomised parameters or a
   deliberately partial display, but this is a design/game-theory question as much as a maths one.
4. **Does displaying this ruin the game?** The app sits on a shared table. A public, calibrated
   "72% fascist" readout is a different game from Secret Hitler. Worth deciding *before* building,
   because it may argue for showing only the honesty number per government and never the per-player
   role posterior.

---

## 11. Design review — flaws found, and what v1 actually ships

Reviewed against the real code (session 21, second pass). Eight problems, two of which change the
plan materially and one of which is a live bug in the shipped engine.

### F1 — §1 overstates the conservation law: it is weak *mid*-round

"Total lying is pinned to within 2 cards" is true **at a round boundary** and only there. Partway
through a round the unseen draw pile absorbs the slack, and the constraint degrades to

```
max(0, L − (N − 3j))  ≤  Σ_{j so far} h_j  ≤  min(L, 3j)
```

which is wide open early and tightens as the pile drains. So the model's power arrives in a burst
at each reshuffle rather than accruing smoothly, and numbers will visibly jump at the boundary.

**Fix:** state it honestly, and expose an "evidence strength" indicator so a number computed from
almost no constraint doesn't look as authoritative as one computed from a closed round. Don't
present an early-round posterior with the same confidence as a late-round one.

### F2 — **Live bug:** chaos policies corrupt the round accounting the whole model rests on

`Prob.retrospectiveProb()` computes `R = N − 3G`, and `derive()` computes `r.leftover` the same
way. **Neither subtracts chaos top-decks.** A chaos policy removes one card from the round pool
without being a government, so in any round containing one:

- `R` is overstated by the number of chaos cards → the retrospective denominator is wrong;
- the chaos card's identity is *public and known*, but conditioning throws it away by treating it
  as part of the unseen leftovers;
- `r.bottomLibs = clamp(effL − claimSum, 0, R)` ignores `chaosLib`, while `drawLibs` on line 318
  *does* subtract it — the two are internally inconsistent with each other.

This is wrong today, independently of anything here. It also happens to break exactly the
conservation identity §1 depends on, so it is a hard prerequisite.

**Fix:** thread chaos into the accounting — `R = N − 3G − C`, and `S = L − Σ_{j≠k} l_j − chaosLib`.
Corrected conservation: `Σ h_j + chaosLibs + r = L`.

### F3 — D1/D2 are nearly vacuous, because `enacted` is *derived* from the claim

`inferEnacted(claimLibs, conflict)` computes the enacted policy from the claim rather than
recording it. So the enacted card carries **no information independent of the claim**, and D4/D5
("claim 3L but F enacted") are unrepresentable — not because tables never produce them, but
because the data model can't express them. §2a overstated what those constraints buy.

**But the review found a stronger constraint that *is* reachable.** Conflict is permitted only on
claims of 1L or 2L. Consider **claim = 1F2L (Silver) + conflict**: the president is claiming they
discarded the fascist and passed **LL** — and a fascist policy was enacted. A chancellor cannot
enact a card they were not handed. **That story is impossible**: the president has necessarily
misstated either the hand or the pass. That is a genuine, prior-free contradiction, and it exists
in the current data model right now.

(Claim = 2F1L + conflict is *not* a contradiction — pass is LF, and the chancellor choosing the F
is exactly what a conflict means. Only the 2L case is impossible.)

**Fix:** drop D4/D5, implement the Silver-conflict contradiction instead. Longer term the real
repair is to record the enacted policy directly, since it is the one fact at the table that is
certainly true — but that changes the recording flow and is out of scope here.

### F4 — The parameter set is far too large for the available data

§7 proposes fitting `ε, λ↓, λ↑, δ, s, β(·), γ(·), τ, μ` — nine-plus parameters, several
state-dependent — by EM over latent hands. A hobby group's archive is maybe 20–50 games ≈ a few
hundred governments, with the hands *unobserved* and `β`/`λ` already known to be confounded (§7c).
That will overfit or wander, and produce confident nonsense.

**Fix:** v1 fits **nothing**. Hard logic needs no parameters at all; the posterior ships with two
exposed knobs (`λ`, `s`) at documented defaults and everything else fixed by fiat. EM stays
designed-but-unbuilt until the archive is large enough to justify it, and when it arrives it fits
**two** parameters, not nine.

### F5 — The backward-compatibility test in §4e is ill-posed as written

At `ε = λ = 0`, any claim history with `minLies > 0` has likelihood zero under every hypothesis —
the posterior is `0/0`, not the old formula.

**Fix:** run that equivalence test only on histories the min-lie DP certifies as consistent, and
assert the degenerate case separately.

### F6 — Role-assignment inference is v2, not v1

§4 leans on the behaviour model (`β`, `γ`) — the least identifiable, least defensible part — and
it is also the part carrying the game-design risk of §10.4. Shipping "Tim is 72% fascist" on a
shared table, computed from guessed parameters, is the worst version of this feature.

**Fix:** v1 stops at **per-claim honesty**, which prices a *claim* rather than indicting a
*person*. Role posteriors stay designed and unbuilt.

### F7 — The min-lie DP as specified ignores veto and chaos

A vetoed government still removes 3 cards but has no enacted card, so its bounds are `[0,3]`
rather than constrained by D1/D2. A chaos removes one card of known colour. Both must enter the
conservation or the DP is simply wrong.

**Fix:** bounds per event type, and chaos liberals as a constant term in the conservation.

### F8 — "Proven liar" is the wrong thing to put on a shared screen

The hard-logic layer is only as sound as the data entry. A user who forgets to hit Conflict
manufactures a contradiction, and the app then accuses a real person, at a real table, with the
authority of mathematics. The maths is certain; the *input* is not.

**Fix:** every hard finding is phrased as a statement about **claims**, never about people —
"these claims can't all be true", not "X lied" — and always surfaces the recording-error
alternative. This is a wording rule, and it is load-bearing.

### What v1 ships

1. Chaos-correct round accounting (F2) — a bug fix, applies whether or not the feature is on.
2. `js/honesty.js`: the min-lie DP (F7 bounds), the Silver-conflict contradiction (F3), and the
   per-government honesty posterior with fixed defaults (F4).
3. A **Lie detection** switch in a new Settings menu. Off by default; when off, nothing new is
   visible anywhere.
4. Claims-not-people wording throughout (F8), and an evidence-strength indicator (F1).

Deferred by this review: role posteriors (F6), EM calibration (F4), chancellor-claim capture,
recording the enacted policy directly (F3).

## Sources

- Helmer Aslaksen, *Secret Hitler and Bayes' Theorem*, University of Oslo (MAT4010) —
  <https://www.uio.no/studier/emner/matnat/math/MAT4010/data/forelesningsnotater/secret-hitler.pdf>
  — the canonical 2F ⇒ 3/4 result and the even-player-count table.
- *Analysis of a Secret Hitler Scenario*, LessWrong —
  <https://www.lesswrong.com/posts/C8geRCXF54FsyKydL/analysis-of-a-secret-hitler-scenario-1>
  — bold/timid fascist likelihood split; also a worked example of getting hand-Bayes wrong.
- TartanLlama, *Secret Hitler Strategy Guide* — statistics chapter —
  <https://github.com/TartanLlama/secret-hitler-strategies/blob/master/_chapters/stats_and_probabilities.md>
  — draw-odds tables; explicitly notes that after the first government the numbers stop being
  trustworthy because of deception, which is precisely the gap this model fills.
- Tommy Maranges, *Designing the policy deck in Secret Hitler* —
  <https://medium.com/@tommygents/designing-the-policy-deck-in-secret-hitler-827a0f7d165c>
  — the designers built Bayesian models of information accumulation while tuning 11F/6L.
- *Secret Hitler Game Theory: Testing the Chancellor*, Cornell INFO 2040 —
  <https://blogs.cornell.edu/info2040/2018/09/18/secret-hitler-game-theory-testing-the-chancellor/>
  — equilibrium argument that liberals should not test; the source of the `τ → 0` prior.
- *Bayesian Social Deduction with Graph-Informed Language Models* (GRAIL), arXiv:2506.17788 —
  <https://arxiv.org/html/2506.17788v2> — factor graph over role assignments, likelihoods learned
  from ~104k games, max-product belief propagation, temperature-scaled calibration. The direct
  precedent for §7; our role space is small enough that we can enumerate exactly instead.
- *Strategema: Probabilistic Analysis of Adversarial Multi-Agent Behavior with LLMs in Social
  Deduction Games*, OpenReview — <https://openreview.net/forum?id=xc9gn0fd19> — explicit Bayesian
  belief trajectories; belief-state trajectory is a strong predictor of game outcome.
- *Social deduction: Secret Hitler's Use of Probability*, The Mechanics of Magic —
  <https://mechanicsofmagic.com/2024/04/08/secrethitler/>
