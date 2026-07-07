<p align="center">
  <img src="assets/logo.svg" width="112" height="112" alt="Hold'em Trainer logo">
</p>

<h1 align="center">♠ Hold'em Trainer</h1>

<p align="center">
  <b>A browser-based No-Limit Texas Hold'em trainer.</b><br>
  Play real hands against medium-hard bots, get a live win-odds meter, and let a
  chatty <b>Genie</b> explain the <i>why</i> behind every recommendation.
</p>

<p align="center">
  <a href="https://zeusnightbolt.github.io/PokerTrainer/"><img src="https://img.shields.io/badge/%F0%9F%8E%B0%20Play%20now-live%20demo-1f7a54?style=for-the-badge" alt="Live demo"></a>
</p>

<p align="center">
  <a href="https://github.com/ZeusNightBolt/PokerTrainer/actions/workflows/ci.yml"><img src="https://github.com/ZeusNightBolt/PokerTrainer/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ZeusNightBolt/PokerTrainer/actions/workflows/deploy-pages.yml"><img src="https://github.com/ZeusNightBolt/PokerTrainer/actions/workflows/deploy-pages.yml/badge.svg" alt="Deploy"></a>
  <img src="https://img.shields.io/badge/build-none-brightgreen" alt="No build step">
  <img src="https://img.shields.io/badge/deps-0-brightgreen" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/vanilla-JS%20%2F%20HTML%20%2F%20CSS-f0b429" alt="Vanilla JS">
</p>

> **▶️ [zeusnightbolt.github.io/PokerTrainer](https://zeusnightbolt.github.io/PokerTrainer/)** — no install, no sign-up, works on your phone.

---

## ✨ Highlights

| | |
|---|---|
| 🃏 **Live-feeling table** | Persistent-DOM renderer with real 3D card flips, chips that physically fly to the pot, tweened stacks and a rotating "on the clock" ring. |
| 🏆 **Win celebrations** | Take a pot and the table shows it: a burst of chips slides from the pot to the winner's stack, a "+$X · hand" badge pops over the seat, and a centered **"YOU WIN +$480 — a Flush, K-high"** card takes the spotlight — on top of the exact pot-split read-out. |
| 💪 **Hand-strength meter** | A poker-app-style bar + win-% from a Monte Carlo run against the opponents *still in the hand*, tiered Weak → Monster — and it fills **the moment you're dealt**, so you can read your spot while the action folds around. |
| 📊 **Analytics panel** | One panel, two lenses. *This hand:* your made hand, your **outs shown as actual cards grouped by what they complete** (e.g. `Flush ×9 — Q♥ J♥ T♥ …`), Rule-of-4-and-2 equity, pot odds and a price verdict. *Session:* $/hand, best pot, hands-won %, showdown win %, **VPIP**, **aggression factor**, variance, and strategy-match %. |
| 🕹️ **Modern controls** | Fold / Check / Call / Raise as clean, tactile buttons with a real press, chip-disc bet presets and a gold **All-In** — a mobile game, not a worksheet. |
| 🧞 **Genie assistant** | A chat coach that recommends the play **and explains the reasoning** — tap follow-ups to see the Chen breakdown, position logic, pot-odds math and your outs. |
| 🤖 **Medium-hard bots** | Randomized skill levels with human-like mistakes, so the table is beatable and natural — not six pros drilling you. Hands run deep and multi-way. |
| ⏱️ **Realistic pacing** | Opponents "think" for a beat that fits the decision (quick folds, longer for big bets), with Realistic / Fast / Instant speeds. |
| 🎲 **Play as your hero** | Your default seat name is a random Dragon Ball / Naruto character — re-roll with the dice button. |
| 📈 **Variance tracker** | At showdown, compares what you *actually* won to your equity's expectation — luck vs. skill, separated. |
| 🏦 **Real cardroom rules** | Borgata (AC) and Parx (Philly) blinds, buy-ins and rake/time-charge modeled from posted structures. |
| 📱 **Mobile-first** | Portrait table, a single-line top bar that never crowds the felt, thumb-zone action dock, full-size touch targets, zero horizontal overflow. |

## 🚀 Quick start

```bash
# it's a static site — just serve the folder
python3 -m http.server 8000
# then open http://localhost:8000
```

No build, no dependencies, no bundler. Every `js/` file runs unchanged in the browser and under
Node (that dual mode powers the tests below).

## 🗺️ The three pages

- **♠ Play** (`index.html`) — the felt table, Genie, and strength meter.
- **🎓 Learn** (`learn.html`) — an interactive 13×13 range chart, an outs/pot-odds calculator, and a preflop quiz.
- **📚 Reference** (`resources.html`) — basic-strategy write-up, Borgata/Parx rule tables, and a card-counting-theory section on why blackjack-style counting doesn't transfer to hold'em (and what does).

## 🧪 Tests & CI

```bash
node tests/smoke.js      # 21 assertions, dependency-free
```

`tests/smoke.js` checks the hand evaluator, Chen formula + breakdown, outs/Rule-of-4, pot odds,
Monte-Carlo equity + hand-strength against known values, the preflop advisor, and chip
conservation with **zero exceptions across 3,000 simulated hands**. CI (`.github/workflows/ci.yml`)
runs it plus a `node --check` syntax pass on every push and PR; merges to `main` auto-deploy to
GitHub Pages.

## 🧱 Project structure

```
assets/logo.svg      Poker-chip + spade logo mark (also the favicon)
index.html           ♠ Play — the game table
learn.html           🎓 Learn — range chart, calculator, quiz
resources.html       📚 Reference — strategy, casino rules, counting theory
css/style.css        Shared design system for all three pages

js/cards.js          Card/Deck classes + best-5-of-7 hand evaluator
js/rules.js          Borgata/Parx stake, buy-in, and rake configuration
js/strategy.js       Chen Formula (+ component breakdown) + outs/pot-odds advisor
js/equity.js         Monte Carlo equity: preflop variance tracker + live hand-strength
js/bots.js           6 medium-hard bot personalities (skill/mistake model)
js/game.js           Betting-round state machine, side pots, showdown, rake, variance
js/stats.js          localStorage-backed session/adherence/variance stats
js/render.js         Shared card-face markup (table + learn widgets)
js/table.js          Persistent-DOM table renderer (3D flips, chip flight)
js/ui.js             Game flow, pacing, strength meter, Genie assistant, panels
js/learn.js          Learn-page interactive widgets

tests/smoke.js       Dependency-free assertions + 3,000-hand simulation
.github/workflows/   ci.yml (tests) · deploy-pages.yml (GitHub Pages)
```

## ⚠️ Note

This is a **training tool for education and practice**, not real-money gambling. Rake and stakes
figures are representative of the modeled cardrooms as of mid-2026; always confirm posted rules at
the actual table.

<p align="center"><sub>Built with vanilla JS · deployed on GitHub Pages · ♠ ♥ ♦ ♣</sub></p>
