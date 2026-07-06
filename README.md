# PokerTrainer

Texas Hold'Em Poker Trainer

A browser-based No-Limit Texas Hold'em trainer, in the same spirit as a blackjack basic-strategy
trainer: play real hands against randomized bot opponents, get a live strategy recommendation
on every decision, and track how often your play matches basic strategy over a session.

**Live site: https://zeusnightbolt.github.io/PokerTrainer/**

## Play

Open the live site above, or run it locally: open `index.html` in a browser (no build step, no
server required beyond static file hosting -- e.g. `python3 -m http.server` from the repo root,
then visit `http://localhost:8000`).

The site is deployed automatically by `.github/workflows/deploy-pages.yml` on every push to
`main`, via GitHub Pages with the "GitHub Actions" source (no build step -- the repo root is
uploaded as-is).

The site has three pages:

### Play (`index.html`)
- **Live-feeling felt table**: you + 6 randomized bot opponents, one fresh 52-card shuffle per
  hand. The table renders through a persistent-DOM controller (`js/table.js`) that mutates a
  stable layout in place rather than rebuilding it each action, so everything transitions
  smoothly: cards are real perspective **3D flips** (dealt face-down, flipped up on reveal),
  **poker chips physically fly to the pot** when a street closes and back out to the winner,
  stacks tween, and the "on the clock" seat gets a rotating ring. Rendering is wrapped in a
  guard so a hiccup surfaces a recovery button instead of freezing the table.
- **Medium-hard, natural opponents**: each bot has a randomized skill level (a spread from
  medium to hard) layered on its loose-passive personality. Lower-skill bots make human-like
  mistakes -- missed value bets, over-folds to big bets, softer sizing, less light 3-betting --
  so the table is a beatable, natural mix rather than six always-correct pros drilling you.
  Hands still play deep and multi-way (most showdowns see 3-4+ players to the river).
- **Realistic pacing**: bots "think" for a beat before acting (animated dots on the seat that's
  on the clock), with the pause length fitting the decision -- snap folds are quick, big
  bets/raises take ~1-2 seconds like a real player -- then act with a floating bubble ("Calls
  $6", "Raises to $20"). New streets pause briefly so each runout reads naturally. A speed
  toggle cycles Realistic / Fast / Instant (persisted).
- **Mobile-first play**: on phones the table flips to a portrait oval with seats redistributed
  around it, and the action dock sticks to the thumb zone with full-size touch targets. All
  three pages are responsive with proper viewport handling.
- **Hand-strength meter** (poker-app style): a live gradient bar and win-% showing your Monte
  Carlo equity against the opponents *still in the hand*, with a tier label (Weak → Monster).
  Updates as the board develops (`handStrength()` in `js/equity.js`).
- **Genie assistant**: a chat-style coach that recommends the play **and explains the reasoning**
  -- not just the Chen number but *why* it implies that action. Tap follow-up chips ("Break down
  the score", "Why does position matter?", "Show the pot-odds math", "My win %?") and it walks
  through the Chen component breakdown, why position loosens the range, the pot-odds arithmetic,
  and your outs. Your choice is still graded ✓/✗ against the book line, with a running
  "% matched" stat and net result persisted across sessions. Toggleable for unassisted play.
- **Outs & Equity panel**: live outs, Rule-of-4-and-2 equity (with a meter), and the pot odds
  you're being laid.
- **Variance / luck tracker**: at every showdown, a Monte Carlo simulation (`js/equity.js`)
  estimates each player's preflop hole-card equity and compares it to what they actually won --
  the same "actual vs. all-in EV" idea used by real poker tracking software. The result banner
  shows it per hand, and the Session panel keeps a running total, so you can see whether
  variance has been helping or hurting independent of whether your decisions were sound.
- **Real casino rules**: pick Borgata (Atlantic City) or Parx (Bensalem/Philadelphia) and a
  posted stake -- blinds, buy-in range, and rake/time-charge all match that room's real
  structure.

### Learn (`learn.html`) — interactive tools
- **Starting-hand range chart**: all 169 hands in a 13×13 grid, color-coded by Chen score, with
  hover/tap details (score, tier, which positions can open-raise it).
- **Outs & pot-odds calculator**: pick a draw (or set outs), enter the pot and bet, and see your
  equity, the equity you need, the price the pot lays, and a call/fold verdict.
- **Preflop quiz**: a random spot every time (your cards, seat, action in front) graded against
  the Chen-formula baseline, with streak/accuracy scoring.

### Reference (`resources.html`)
Basic-strategy write-up, sourced Borgata/Parx rule tables, and a card-counting-theory section on
why blackjack-style counting doesn't carry over to hold'em (fresh shuffle every hand, no shoe to
track) and what the real poker equivalent is (outs, blockers, range reading).

## Project structure

```
index.html           Play — the game table
learn.html           Learn — interactive range chart, calculator, quiz
resources.html       Reference — strategy, casino rules, card-counting theory
css/style.css        Shared design system for all three pages
js/cards.js          Card/Deck classes + best-5-of-7 hand evaluator
js/rules.js          Borgata/Parx stake, buy-in, and rake configuration
js/strategy.js       Chen Formula (+ component breakdown) + outs/pot-odds advisor
js/equity.js         Monte Carlo equity: preflop variance tracker + live hand-strength
js/bots.js           6 medium-hard bot personalities (skill/mistake model) on the strategy engine
js/game.js           Betting-round state machine, side pots, showdown, rake, variance calc
js/stats.js          localStorage-backed session/adherence/variance stats
js/render.js         Shared card-face markup (game table + learn widgets)
js/table.js          Persistent-DOM table renderer (3D card flips, chip flight)
js/ui.js             Game flow, pacing loop, hand-strength meter, Genie assistant, panels
js/learn.js          Learn-page interactive widgets
tests/smoke.js       Dependency-free assertions (engine, strategy, equity, 3000-hand sim)
.github/workflows/   ci.yml (syntax-check + smoke tests on every push/PR) + Pages deploy
```

Each `js/` file works both as a browser `<script>` (falls back to attaching its exports to
`window`) and under plain Node (`module.exports`). That dual mode powers `tests/smoke.js`, a
buildless test suite run in CI on every push and pull request (`node tests/smoke.js`) that
asserts hand-evaluator, Chen-formula, outs/equity, and Monte-Carlo invariants and checks chip
conservation with zero exceptions across 3,000 simulated hands.

## Running the tests

```
node tests/smoke.js
```

No dependencies, no build step. CI (`.github/workflows/ci.yml`) runs it plus a `node --check`
syntax pass on every push to `main` and every pull request.
