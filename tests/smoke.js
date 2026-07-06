/*
 * Dependency-free smoke tests for the poker engine, strategy, and equity
 * math. Run with `node tests/smoke.js`. Exits non-zero on any failure so it
 * can gate CI. No test framework required -- keeps the project buildless.
 */
'use strict';
const path = require('path');
const J = (p) => require(path.join(__dirname, '..', 'js', p));

const { Card, evaluateBest, compareScores, describeScore, Deck } = J('cards.js');
const { chenScore, chenBreakdown, preflopAdvice, countOuts, equityFromOuts, potOddsPercent } = J('strategy.js');
const { estimatePreflopEquities, handStrength } = J('equity.js');
const { makeBotPersonality } = J('bots.js');
const { PokerGame } = J('game.js');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
function approx(name, actual, expected, tol) {
  ok(name + ` (${actual.toFixed(3)} ≈ ${expected})`, Math.abs(actual - expected) <= tol, `off by ${Math.abs(actual - expected).toFixed(3)}`);
}
const C = (str) => { const m = { A: 14, K: 13, Q: 12, J: 11, T: 10 }; const r = str.slice(0, -1); return new Card(m[r] || Number(r), str.slice(-1)); };

/* ---------- hand evaluator ---------- */
ok('royal flush beats quads',
  compareScores(evaluateBest('Ah Kh Qh Jh Th'.split(' ').map(C)).score, evaluateBest('9h 9d 9c 9s 2h'.split(' ').map(C)).score) > 0);
ok('wheel is a straight', describeScore(evaluateBest('Ah 2d 3c 4s 5h'.split(' ').map(C)).score) === 'Straight');
ok('boat name', describeScore(evaluateBest('Ah Ad Ac Kh Kd'.split(' ').map(C)).score) === 'Full House');
ok('AA > KK on same board',
  compareScores(evaluateBest('Ah Ad 2c 7d 9s'.split(' ').map(C)).score, evaluateBest('Kh Kd 2c 7d 9s'.split(' ').map(C)).score) > 0);

/* ---------- Chen formula + breakdown ---------- */
ok('AA scores 20', chenScore(C('Ah'), C('As')) === 20);
ok('72o scores -1', chenScore(C('7h'), C('2s')) === -1);
ok('AKs scores 12', chenScore(C('Ah'), C('Kh')) === 12);
ok('AKo scores 10', chenScore(C('Ah'), C('Ks')) === 10);
ok('breakdown sums to score (JTs)', (() => {
  const b = chenBreakdown(C('Jh'), C('Th'));
  const sum = b.steps.reduce((a, s) => a + s.value, 0);
  return Math.abs(Math.ceil(sum) - b.score) < 0.001 && b.score === 9;
})());

/* ---------- outs / equity ---------- */
ok('flush draw = 9 outs', countOuts([C('Ah'), C('Kh')], 'Qh 5h 9c'.split(' ').map(C)).outs === 9);
ok('OESD = 8 outs', countOuts([C('9h'), C('8s')], '7d 6c 2h'.split(' ').map(C)).outs === 8);
ok('rule of 4: 9 outs ~35%', equityFromOuts(9, 2) === 35);
approx('pot odds 25 into 100', potOddsPercent(25, 100), 20, 0.001);

/* ---------- Monte-Carlo equity (statistical, wide tolerance) ---------- */
const avg = (fn, t) => { let s = 0; for (let i = 0; i < t; i++) s += fn(); return s / t; };
approx('AA vs KK heads-up', avg(() => estimatePreflopEquities([[C('Ah'), C('As')], [C('Kh'), C('Ks')]], 800)[0].equity, 4), 0.82, 0.04);
approx('handStrength AA vs 1', avg(() => handStrength([C('Ah'), C('As')], [], 1, 600).equity, 4), 0.85, 0.04);
approx('handStrength AA vs 5', avg(() => handStrength([C('Ah'), C('As')], [], 5, 600).equity, 4), 0.49, 0.05);
ok('made nut flush on flop is strong', handStrength([C('Ah'), C('Kh')], '2h 7h 9h'.split(' ').map(C), 2, 500).equity > 0.85);

/* ---------- preflop advisor sanity ---------- */
ok('AA UTG raises', preflopAdvice({ holeCards: [C('Ah'), C('As')], position: 'UTG', numRaisesInFront: 0 }).action === 'raise');
ok('72o BTN folds', preflopAdvice({ holeCards: [C('7h'), C('2s')], position: 'BTN', numRaisesInFront: 0 }).action === 'fold');

/* ---------- full-game chip conservation + no-throw over many hands ---------- */
(function conservation() {
  const simP = makeBotPersonality();
  const autoHuman = (g) => {
    const seat = g.currentActorSeat();
    const saved = g.seats[seat].personality;
    g.seats[seat].personality = saved || simP;
    const d = g.decideBot(seat);
    g.seats[seat].personality = saved;
    return d;
  };
  const configs = [['borgata', 'borgata-1-3'], ['parx', 'parx-2-5']];
  let bad = 0, hands = 0, threw = 0;
  for (const [venue, stake] of configs) {
    const game = new PokerGame(venue, stake, 'You');
    for (let h = 0; h < 1500; h++) {
      try {
        game.newHand();
        const baseline = game.seats.reduce((a, p) => a + p.stack + p.committedHand, 0);
        let guard = 0;
        while (!game.lastResult && guard < 1000) {
          guard++;
          const st = game.runBotsUntilHumanOrDone();
          if (st.handOver) break;
          const seat = game.currentActorSeat();
          if (seat === null) continue;
          const d = autoHuman(game);
          game.act(seat, d.action, d.amount);
        }
        const after = game.seats.reduce((a, p) => a + p.stack, 0);
        const rake = game.lastResult.rake;
        const maxRake = rake.type === 'time' ? rake.perSeatCharge * 7 : rake.amount;
        if (after > baseline + 0.01 || after < baseline - maxRake - 0.01) bad++;
        hands++;
      } catch (e) { threw++; }
    }
  }
  ok('no exceptions across 3000 hands', threw === 0, threw + ' threw');
  ok('chip conservation across 3000 hands', bad === 0, bad + ' mismatches');
})();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
