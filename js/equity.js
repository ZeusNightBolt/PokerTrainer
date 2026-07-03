/*
 * Monte Carlo preflop equity estimator, used for the "variance / luck"
 * tracker: how likely each showdown hand was to win BEFORE any community
 * cards were seen, versus what the actual dealt board produced. This is
 * the same underlying idea trackers call "all-in EV" -- comparing actual
 * results to what your equity entitled you to, on average, over many
 * possible runouts.
 *
 * Runs entirely client-side: samples random 5-card boards from the
 * remaining deck (excluding only the known hole cards, since we want
 * *preflop* equity independent of how this particular hand's board fell)
 * and tallies wins/ties with the existing hand evaluator.
 */
(function () {
  const { evaluateBest, compareScores } = (typeof module !== 'undefined' && module.exports ? require('./cards.js') : window);

  const SUITS = ['s', 'h', 'd', 'c'];

  /* holeCardsList: array of 2-card arrays (one per contender).
     Returns an array (same order/length) of { winPct, tiePct, equity } in [0,1]. */
  function estimatePreflopEquities(holeCardsList, samples) {
    samples = samples || 400;
    const n = holeCardsList.length;
    if (n === 0) return [];
    if (n === 1) return [{ winPct: 1, tiePct: 0, equity: 1 }];

    const used = new Set();
    for (const hc of holeCardsList) for (const c of hc) used.add(`${c.rank}${c.suit}`);
    const remaining = [];
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) {
        const key = `${rank}${suit}`;
        if (!used.has(key)) remaining.push({ rank, suit });
      }
    }

    const wins = new Array(n).fill(0);
    const ties = new Array(n).fill(0);

    for (let s = 0; s < samples; s++) {
      const pool = remaining.slice();
      const board = [];
      for (let i = 0; i < 5; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        board.push(pool[idx]);
        pool[idx] = pool[pool.length - 1];
        pool.pop();
      }

      let bestScore = null;
      let bestIdxs = [];
      for (let i = 0; i < n; i++) {
        const res = evaluateBest([...holeCardsList[i], ...board]);
        if (!bestScore || compareScores(res.score, bestScore) > 0) {
          bestScore = res.score;
          bestIdxs = [i];
        } else if (compareScores(res.score, bestScore) === 0) {
          bestIdxs.push(i);
        }
      }
      if (bestIdxs.length === 1) {
        wins[bestIdxs[0]]++;
      } else {
        for (const i of bestIdxs) ties[i] += 1 / bestIdxs.length;
      }
    }

    return holeCardsList.map((_, i) => ({
      winPct: wins[i] / samples,
      tiePct: ties[i] / samples,
      equity: (wins[i] + ties[i]) / samples,
    }));
  }

  const EQUITY_EXPORTS = { estimatePreflopEquities };
  if (typeof module !== 'undefined' && module.exports) module.exports = EQUITY_EXPORTS;
  else if (typeof window !== 'undefined') Object.assign(window, EQUITY_EXPORTS);
})();
