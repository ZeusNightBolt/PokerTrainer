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
- **7-handed felt table**: you + 6 randomized bot opponents, one fresh 52-card shuffle per hand,
  with dealt-card animations, chip/bet visuals, dealer button, and winner highlighting.
- **Live Coach**: every decision is graded against a Chen-Formula preflop chart
  (position-adjusted) and an outs/pot-odds postflop advisor -- it shows the recommended action
  with a plain-English reason, then marks your actual choice ✓ matched / ✗ deviated. A running
  "% matched basic strategy" stat (preflop and postflop split out) plus net result persist
  across sessions. Coaching can be toggled off for unassisted play.
- **Outs & Equity panel**: live outs, Rule-of-4-and-2 equity (with a meter), and the pot odds
  you're being laid.
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
js/strategy.js       Chen Formula preflop scoring + outs/pot-odds postflop advisor
js/bots.js           6 randomized bot personalities built on the strategy engine
js/game.js           Betting-round state machine, side pots, showdown, rake
js/stats.js          localStorage-backed session/adherence stats
js/render.js         Shared card-face rendering (game + learn widgets)
js/ui.js             Game-table DOM rendering and event wiring
js/learn.js          Learn-page interactive widgets
```

Each `js/` file works both as a browser `<script>` (falls back to attaching its exports to
`window`) and under plain Node (`module.exports`), which is how the engine was unit- and
simulation-tested during development (chip-conservation checked across tens of thousands of
simulated hands across every modeled stake).
