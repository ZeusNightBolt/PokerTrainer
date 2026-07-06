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

  /* Live "hand strength": the hero's probability of winning right now against
     `opponents` unknown random hands, given the current board (0, 3, 4, or 5
     cards). This is the number a poker-app strength meter shows -- unlike the
     variance tracker above, the opponents' hole cards are unknown and sampled
     each trial along with the rest of the runout. Returns { equity, winPct,
     tiePct } in [0,1]. */
  function handStrength(holeCards, board, opponents, samples) {
    opponents = Math.max(1, opponents || 1);
    samples = samples || 300;
    board = board || [];

    const used = new Set();
    for (const c of holeCards) used.add(`${c.rank}${c.suit}`);
    for (const c of board) used.add(`${c.rank}${c.suit}`);
    const baseDeck = [];
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) {
        const key = `${rank}${suit}`;
        if (!used.has(key)) baseDeck.push({ rank, suit });
      }
    }
    const needBoard = 5 - board.length;
    const draws = needBoard + opponents * 2; // board completion + each opp's 2 cards
    if (draws > baseDeck.length) return { equity: 0, winPct: 0, tiePct: 0 };

    let win = 0, tie = 0;
    for (let s = 0; s < samples; s++) {
      const pool = baseDeck.slice();
      // draw without replacement
      const drawn = [];
      for (let d = 0; d < draws; d++) {
        const idx = Math.floor(Math.random() * pool.length);
        drawn.push(pool[idx]);
        pool[idx] = pool[pool.length - 1];
        pool.pop();
      }
      const fullBoard = board.concat(drawn.slice(0, needBoard));
      const heroScore = evaluateBest([...holeCards, ...fullBoard]).score;
      let heroBeat = true, split = false;
      let o = needBoard;
      for (let opp = 0; opp < opponents; opp++) {
        const oppCards = [drawn[o], drawn[o + 1]]; o += 2;
        const cmp = compareScores(evaluateBest([...oppCards, ...fullBoard]).score, heroScore);
        if (cmp > 0) { heroBeat = false; break; }
        if (cmp === 0) split = true;
      }
      if (heroBeat && !split) win++;
      else if (heroBeat && split) tie++;
    }
    return { winPct: win / samples, tiePct: tie / samples, equity: (win + tie) / samples };
  }

  const EQUITY_EXPORTS = { estimatePreflopEquities, handStrength };
  if (typeof module !== 'undefined' && module.exports) module.exports = EQUITY_EXPORTS;
  else if (typeof window !== 'undefined') Object.assign(window, EQUITY_EXPORTS);
})();
