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
    handsDealt: 0,        // hands dealt to the human (VPIP denominator; counts the live hand)
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
    // richer session texture
    handsWon: 0,            // hands finished net-positive
    bestWon: 0,             // biggest single-hand profit
    showdownsPlayed: 0,     // showdowns the human actually reached (didn't fold)
    showdownsWon: 0,        // ...of which the human won a share
    vpipHands: 0,           // hands the human voluntarily put money in preflop
    aggressiveActions: 0,   // bets + raises + all-ins
    passiveActions: 0,      // calls
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
  if (netDelta > 0) {
    stats.handsWon++;
    if (netDelta > stats.bestWon) stats.bestWon = netDelta;
  }
  saveStats(stats);
  return stats;
}

function recordVariance(stats, luckDelta) {
  stats.showdownsSeen++;
  stats.luckTotal += luckDelta;
  saveStats(stats);
  return stats;
}

// A showdown the human reached (didn't fold), and whether they won a share.
function recordShowdownResult(stats, won) {
  stats.showdownsPlayed++;
  if (won) stats.showdownsWon++;
  saveStats(stats);
  return stats;
}

// A hand dealt to the human — the VPIP denominator (includes the live hand,
// so VPIP stays a true share and never exceeds 100%).
function recordHandDealt(stats) {
  stats.handsDealt++;
  saveStats(stats);
  return stats;
}

// One voluntary preflop investment (call/bet/raise), counted once per hand.
function recordVPIP(stats) {
  stats.vpipHands++;
  saveStats(stats);
  return stats;
}

// Betting texture: aggressive = bet/raise/all-in, passive = call.
function recordAggression(stats, aggressive) {
  if (aggressive) stats.aggressiveActions++;
  else stats.passiveActions++;
  saveStats(stats);
  return stats;
}

const STATS_EXPORTS = {
  loadStats, saveStats, resetStats, recordDecision, recordHandResult, recordVariance,
  recordShowdownResult, recordHandDealt, recordVPIP, recordAggression,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = STATS_EXPORTS;
} else if (typeof window !== 'undefined') {
  Object.assign(window, STATS_EXPORTS);
}
