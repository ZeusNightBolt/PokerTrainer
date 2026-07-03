/* Session/adherence stats, persisted to localStorage so progress survives a reload. */

const STATS_KEY = 'pokertrainer.stats.v1';

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return defaultStats();
    return { ...defaultStats(), ...JSON.parse(raw) };
  } catch (e) {
    return defaultStats();
  }
}

function defaultStats() {
  return {
    handsPlayed: 0,
    decisionsTracked: 0,
    decisionsMatched: 0,
    netWon: 0,
    preflopDecisions: 0,
    preflopMatched: 0,
    postflopDecisions: 0,
    postflopMatched: 0,
    // Variance/luck tracking: sum of (actual chips won - preflop-equity-expected
    // chips won) across every showdown the human has been part of. Positive
    // means you've won more than your cards were "entitled to" on average
    // (variance has helped); negative means the opposite (variance has hurt).
    showdownsSeen: 0,
    luckTotal: 0,
  };
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    /* localStorage unavailable (private mode, etc.) -- stats just won't persist */
  }
}

function resetStats() {
  const fresh = defaultStats();
  saveStats(fresh);
  return fresh;
}

function recordDecision(stats, { street, matched }) {
  stats.decisionsTracked++;
  if (matched) stats.decisionsMatched++;
  if (street === 'preflop') {
    stats.preflopDecisions++;
    if (matched) stats.preflopMatched++;
  } else {
    stats.postflopDecisions++;
    if (matched) stats.postflopMatched++;
  }
  saveStats(stats);
  return stats;
}

function recordHandResult(stats, netDelta) {
  stats.handsPlayed++;
  stats.netWon += netDelta;
  saveStats(stats);
  return stats;
}

function recordVariance(stats, luckDelta) {
  stats.showdownsSeen++;
  stats.luckTotal += luckDelta;
  saveStats(stats);
  return stats;
}

const STATS_EXPORTS = { loadStats, saveStats, resetStats, recordDecision, recordHandResult, recordVariance };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = STATS_EXPORTS;
} else if (typeof window !== 'undefined') {
  Object.assign(window, STATS_EXPORTS);
}
