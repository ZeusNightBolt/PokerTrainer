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

- **7-handed table**: you + 6 randomized bot opponents, one fresh 52-card shuffle per hand.
- **Real casino rules**: pick Borgata (Atlantic City) or Parx (Bensalem/Philadelphia) and a
  posted stake -- blinds, buy-in range, and rake/time-charge all match that room's real
  structure. See `resources.html` for the sourced numbers.
- **Strategy Advisor**: every decision is checked against a Chen-Formula preflop chart
  (position-adjusted) and an outs/pot-odds postflop advisor, with a running "% matched basic
  strategy" stat (preflop and postflop broken out separately) persisted across sessions.
- **Outs & Equity Counter**: a live panel on the flop/turn showing your outs, Rule-of-4-and-2
  equity, and the pot odds you're being laid -- poker's actual analogue to a blackjack count,
  explained in full on the Resources page (`resources.html`) along with why classic
  card-counting doesn't carry over from blackjack to hold'em (fresh shuffle every hand, no
  shoe to track).

## Project structure

```
index.html          Game screen
resources.html       Strategy guide, casino-rules citations, card-counting theory
css/style.css        Shared styling for both pages
js/cards.js          Card/Deck classes + best-5-of-7 hand evaluator
js/rules.js          Borgata/Parx stake, buy-in, and rake configuration
js/strategy.js        Chen Formula preflop scoring + outs/pot-odds postflop advisor
js/bots.js           6 randomized bot personalities built on the strategy engine
js/game.js           Betting-round state machine, side pots, showdown, rake
js/stats.js          localStorage-backed session/adherence stats
js/ui.js             DOM rendering and event wiring
```

Each `js/` file works both as a browser `<script>` (falls back to attaching its exports to
`window`) and under plain Node (`module.exports`), which is how the engine was unit- and
simulation-tested during development (chip-conservation checked across tens of thousands of
simulated hands across every modeled stake).
