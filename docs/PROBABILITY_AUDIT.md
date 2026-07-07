# Probability & Randomization Audit — Hold'em Trainer

**Date:** 2026-07-07
**Scope:** `js/cards.js` (deck, shuffle, RNG, hand evaluator), `js/equity.js` (Monte-Carlo
equity / hand strength), `js/game.js` (dealing, burns, side pots, showdown), `js/strategy.js`
(Chen formula, outs, rule of 4/2, pot odds), `js/bots.js` (opponent decision model).
**Verdict: SOUND.** No randomization bias, no hand-ranking error, and no equity error was
found. All 21 smoke tests pass; no code changes were required.

## Methodology

1. **Code read** of every file in scope, tracing the full deal path
   (`new Deck()` → shuffle → hole cards → burn/flop → burn/turn → burn/river → showdown).
2. **Smoke tests**: `node tests/smoke.js` → `21 passed, 0 failed` (includes a
   3,000-hand full-game chip-conservation and no-throw sweep).
3. **Statistical audit script** (throwaway, not committed):
   - Deck integrity over 2,000 fresh decks.
   - Shuffle uniformity: position distribution of a marker card (A♠) over 260,000
     shuffles, chi-square against uniform.
   - 14 adversarial hand-evaluator spot checks (wheel, steel wheel, boat tie-breaks,
     quads kicker, kicker wars, board-plays split, phantom around-the-ace straight).
   - 7-card hand-category frequencies over 200,000 random deals vs. published
     probabilities.
   - Preflop equity for 5 classic match-ups vs. **exact ground truth**.
4. **Independent verification**: a from-scratch bitwise 7-card evaluator was written for
   the audit, cross-validated against the project evaluator on 300,000 random 7-card
   match-up comparisons (**0 disagreements**), then used to **exhaustively enumerate all
   C(48,5) = 1,712,304 boards** for each equity match-up. The engine's Monte-Carlo results
   were judged against those exact numbers, not against suit-averaged published tables
   (specific suits matter — see below).

## Findings

| Area | Severity | Finding | Status |
|---|---|---|---|
| Deck construction | — | Exactly 52 unique cards (13 ranks × 4 suits); fresh deck every hand; pointer-based draw can never duplicate or lose a card; max 22 cards used per hand (14 hole + 3 burns + 5 board), so no exhaustion | **PASS** |
| Shuffle algorithm | — | Textbook **unbiased Fisher–Yates**: `for (i = n-1; i > 0; i--) j = floor(random()*(i+1)); swap(i,j)`. Correct inclusive bounds, no `sort(() => random()-0.5)` anti-pattern anywhere in the codebase | **PASS** |
| Shuffle uniformity (empirical) | — | A♠ landing position over 260,000 shuffles: χ² = 58.0 (df = 51; 95% crit 68.7) — consistent with uniform; mean position 25.484 vs 25.5 expected | **PASS** |
| RNG source | Info | `Math.random()` (V8 xorshift128+). Statistically fine and appropriate for a free trainer; not cryptographically secure. See recommendation R1 | **Documented** |
| Hand evaluator | — | Correct best-5-of-7 via all 21 combinations; wheel (A-2-3-4-5) and steel wheel handled, ranked below 6-high straight; full-house/two-pair/kicker tie-breaks correct; 14/14 spot checks; category frequencies match published 7-card odds (all \|z\| < 1.2 at n = 200k); 0/300,000 disagreements vs. an independent evaluator | **PASS** |
| Monte-Carlo equity engine | — | Board/opponent sampling uses unbiased partial Fisher–Yates (swap-remove) without replacement; all 5 benchmark match-ups within ~2 SE of exact enumeration (table below) | **PASS** |
| Tie handling, `estimatePreflopEquities` | — | Ties credited as 1/n of the pot per tied player — the standard pot-equity convention | **PASS** |
| Tie handling, `handStrength` | Minor | The strength-meter's `equity` counts a chopped pot as a full win (`(win + tie)/samples`, tie not divided). It measures "probability of not losing", which its doc comment states; overstatement is < 1 pp in typical spots since heads-up ties are rare. See recommendation R2 | **Documented, no change** |
| Dealing procedure | — | Burn before flop/turn/river; hole cards from a fresh shuffle each hand (dealing 2-at-a-time vs. alternating is statistically identical under a uniform shuffle) | **PASS** |
| Side pots & showdown | — | Standard layered side-pot algorithm; per-layer eligibility; splits computed in whole cents with the odd-chip remainder awarded starting left of the button (live-room convention); chip conservation verified over 3,000 simulated hands | **PASS** |
| Strategy math | — | Chen formula matches canonical values (AA=20, AKs=12, AKo=10, JTs=9, 72o=−1); rule of 4/2 with the standard big-draw correction above 8 outs; `potOddsPercent = call/(pot+call)` correct | **PASS** |
| Bot ranges | Info | Bots start from the same Chen/pot-odds engine, then add looseness/aggression/mistake noise (documented as intentionally loose so pots go multi-way). Nothing mathematically absurd; sizings clamped to legal min-raise/stack | **PASS** |

## Equity spot checks (engine Monte-Carlo vs. exact enumeration)

Engine: `estimatePreflopEquities`, 400,000 trials per match-up. Exact: full enumeration of
all 1,712,304 five-card boards with an independently written evaluator. Equity = win + tie/2.

| Match-up (exact cards) | Exact equity | Engine measured | Deviation |
|---|---|---|---|
| A♥A♠ vs K♥K♠ (AA vs KK) | 82.64 % | 82.56 % | 0.08 pp |
| A♥K♥ vs 2♠2♣ (AKs vs 22) | 50.08 % | 50.14 % | 0.06 pp |
| A♥K♦ vs Q♠Q♣ (AKo vs QQ) | 42.84 % | 42.78 % | 0.06 pp |
| A♥A♠ vs 7♦2♣ (AA vs 72o) | 87.42 % | 87.44 % | 0.02 pp |
| J♥T♥ vs A♦Q♣ (JTs vs AQo) | 40.93 % | 40.99 % | 0.06 pp |

All deviations are within ~2 Monte-Carlo standard errors. Note that the familiar published
headline numbers (AA vs KK "82/18", AKs vs 22 "coin flip") are **averages over suit
assignments**; the engine correctly reproduces the *suit-specific* values — e.g. A♥A♠ vs
K♥K♠ is exactly 82.64 % (AA blocks both of KK's flush suits), which the engine hits. This
was double-checked during the audit: naive comparison against suit-averaged tables first
looked like a small bias, and exact enumeration proved the engine right.

Category frequencies over 200,000 random 7-card deals (engine deck + evaluator) vs.
published 7-card probabilities — every category within \|z\| < 1.2, including the rare ones
(quads: 0.166 % vs 0.168 %; straight flush: 0.030 % vs 0.031 %).

## Shuffle / RNG verdict

The shuffle is a **correct, unbiased Fisher–Yates** — the two classic defects
(comparator-shuffle via `sort()`, or off-by-one index bounds) are absent, and the empirical
position distribution is statistically uniform. The entropy source is `Math.random()`,
which is a high-quality statistical PRNG (xorshift128+) but not cryptographically secure
and not seedable. For a free, no-stakes trainer this is an acceptable and conventional
choice; nothing in the game conditions on it being unpredictable, and no adversary has
anything to gain. It would **not** be acceptable for real-money dealing.

## Recommendations (no code changes made)

- **R1 — Crypto RNG (optional hardening).** If provable fairness ever matters (e.g. any
  competitive or wagering mode), switch `Deck.shuffle()` to `crypto.getRandomValues` with
  rejection sampling for the `[0, i]` bound (the same pattern the sibling Roulette Trainer
  uses for its live table). Keep a seedable PRNG (e.g. mulberry32) available for
  reproducible tests only. As-is, `Math.random()` is fine for this trainer.
- **R2 — `handStrength` tie convention.** Consider crediting ties as a pot share
  (`tie / (tied players)`), matching `estimatePreflopEquities`, or renaming the field to
  `winOrChopPct`, so the strength meter and the variance tracker use one definition of
  "equity". Impact is < 1 pp in typical spots, so this is cosmetic consistency, not a bug.
- **R3 — Lock in the benchmarks.** The smoke suite already asserts AA-vs-KK ≈ 0.82; adding
  one non-pair benchmark with a published suit-specific value (e.g. A♥K♦ vs Q♠Q♣ ≈ 0.428
  ± 0.03) would guard the equity engine against future sampling regressions from a second
  angle.
