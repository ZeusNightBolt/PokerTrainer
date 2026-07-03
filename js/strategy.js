(function () {
/*
 * Basic Texas Hold'em strategy engine.
 *
 * Preflop: Bill Chen's point-count formula (a well-known, published, open
 * starting-hand valuation system) plus position-based thresholds in the
 * spirit of the "play tight early, loosen up late" position principle
 * taught by Wizard of Odds, Upswing Poker, and most basic-strategy guides.
 *
 * Postflop: outs counting + the Rule of 4 and 2 for equity, compared
 * against pot odds -- the direct poker analogue of a blackjack basic
 * strategy table. See resources.html for full citations and the reasoning
 * behind these simplifications.
 *
 * This is intentionally a simplified, rule-based advisor (hand-category +
 * pot odds), not a full GTO solver -- it does not model opponent ranges,
 * blockers, or multi-street planning.
 */

/* ---------- Preflop: Chen Formula ---------- */

function chenScore(cardA, cardB) {
  const hi = Math.max(cardA.rank, cardB.rank);
  const lo = Math.min(cardA.rank, cardB.rank);
  const suited = cardA.suit === cardB.suit;
  const pair = hi === lo;

  function baseScore(rank) {
    if (rank === 14) return 10;
    if (rank === 13) return 8;
    if (rank === 12) return 7;
    if (rank === 11) return 6;
    if (rank === 10) return 5;
    return rank / 2;
  }

  let score = baseScore(hi);

  if (pair) {
    score = Math.max(score * 2, 5);
  } else {
    if (suited) score += 2;
    const gap = hi - lo - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    if (gap <= 1 && hi < 12) score += 1; // straight-potential bonus
  }

  return Math.ceil(score);
}

/* 7-handed seat roles, in acting order preflop starting from UTG. */
const POSITIONS_7MAX = ['UTG', 'UTG1', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

/* Chen-score thresholds by position. Simplified & our own, inspired by
   standard position-based tightening -- not a literal reproduction of any
   single guide's proprietary table. */
const PREFLOP_THRESHOLDS = {
  UTG: { open: 9, callRaise: 12, threeBet: 16 },
  UTG1: { open: 8, callRaise: 11, threeBet: 16 },
  HJ: { open: 7, callRaise: 10, threeBet: 15 },
  CO: { open: 6, callRaise: 9, threeBet: 15 },
  BTN: { open: 5, callRaise: 8, threeBet: 14 },
  SB: { open: 7, callRaise: 9, threeBet: 15 },
  BB: { open: 6, callRaise: 6, threeBet: 14 }, // BB defends wide, gets a walk if unopened
};

function preflopAdviceFromScore(score, position, numRaisesInFront) {
  const t = PREFLOP_THRESHOLDS[position];
  if (numRaisesInFront >= 2) {
    return { score, action: score >= t.threeBet ? 'raise' : 'fold', reason: `Chen score ${score} vs 4-bet threshold ${t.threeBet}` };
  }
  if (numRaisesInFront === 1) {
    // BB gets a pot-odds discount when just facing a single raise (dead money in the pot).
    const callThreshold = position === 'BB' ? Math.max(t.callRaise - 3, 4) : t.callRaise;
    if (score >= t.threeBet) return { score, action: 'raise', reason: `Chen score ${score} clears 3-bet threshold ${t.threeBet}` };
    if (score >= callThreshold) return { score, action: 'call', reason: `Chen score ${score} clears call threshold ${callThreshold}` };
    return { score, action: 'fold', reason: `Chen score ${score} below call threshold ${callThreshold}` };
  }
  // Unopened pot
  if (position === 'BB') return { score, action: 'check', reason: 'Free option in the big blind' };
  if (score >= t.open) return { score, action: 'raise', reason: `Chen score ${score} clears open threshold ${t.open}` };
  return { score, action: 'fold', reason: `Chen score ${score} below open threshold ${t.open}` };
}

function preflopAdvice({ holeCards, position, numRaisesInFront }) {
  const score = chenScore(holeCards[0], holeCards[1]);
  return preflopAdviceFromScore(score, position, numRaisesInFront);
}

/* ---------- Postflop: outs, Rule of 4/2, pot odds ---------- */

const { evaluateBest, HAND_CATEGORY } = (typeof module !== 'undefined' && module.exports ? require('./cards.js') : window);

function unseenCards(known) {
  const knownKeys = new Set(known.map((c) => `${c.rank}${c.suit}`));
  const deck = [];
  const suits = ['s', 'h', 'd', 'c'];
  for (const suit of suits) {
    for (let rank = 2; rank <= 14; rank++) {
      if (!knownKeys.has(`${rank}${suit}`)) deck.push({ rank, suit });
    }
  }
  return deck;
}

/* Counts outs that improve the player's hand CATEGORY (not just kicker),
   which is the standard definition used when teaching the rule of 4-and-2
   (flush draws, straight draws, trips/quads draws, two-pair-or-better
   upgrades, etc). Only meaningful with 3 or 4 board cards (flop/turn). */
function countOuts(holeCards, board) {
  if (board.length < 3 || board.length >= 5) return { outs: 0, cardsToCome: 0 };
  const current = evaluateBest([...holeCards, ...board]).score;
  const candidates = unseenCards([...holeCards, ...board]);
  let outs = 0;
  for (const card of candidates) {
    const improved = evaluateBest([...holeCards, ...board, card]).score;
    if (improved[0] <= current[0]) continue;
    // Deliberately excluded: HIGH_CARD -> PAIR. A bare, uncoordinated pair
    // (yours or the board's) is too weak and opponent-dependent a hand to
    // treat like a "classic" out alongside flush/straight completions or
    // pair-to-trips/boat upgrades, so it's left out of this simplified
    // count (matches how flush draw = 9 outs / OESD = 8 outs / gutshot = 4
    // outs are conventionally taught, without diluting them with marginal
    // overcard equity).
    if (current[0] === HAND_CATEGORY.HIGH_CARD && improved[0] === HAND_CATEGORY.PAIR) continue;
    outs++;
  }
  return { outs, cardsToCome: board.length === 3 ? 2 : 1 };
}

/* Rule of 4 and 2, with the standard correction for big draws on the
   flop: above 8 outs, subtract (outs - 8) from the times-4 estimate,
   since the plain rule overstates equity for combo draws. This tracks
   true two-card equity closely (e.g. 12 outs: 48-4=44 vs. true ~45%;
   15 outs: 60-7=53 vs. true ~54%). */
function equityFromOuts(outs, cardsToCome) {
  if (cardsToCome === 2) {
    const equity = outs <= 8 ? outs * 4 : outs * 4 - (outs - 8);
    return Math.min(equity, 96);
  }
  return Math.min(outs * 2, 100);
}

function potOddsPercent(toCall, pot) {
  if (toCall <= 0) return 0;
  return (toCall / (pot + toCall)) * 100;
}

/* Postflop advisor. `topBoardRank` lets us distinguish "top pair" from a
   weak backdoor pair. */
function postflopAdvice({ holeCards, board, pot, toCall }) {
  const madeScore = evaluateBest([...holeCards, ...board]).score;
  const category = madeScore[0];
  const topBoardRank = Math.max(...board.map((c) => c.rank));
  const hasTopPair = category === HAND_CATEGORY.PAIR && madeScore[1] >= topBoardRank;

  const { outs, cardsToCome } = countOuts(holeCards, board);
  const equity = cardsToCome ? equityFromOuts(outs, cardsToCome) : null;
  const oddsNeeded = potOddsPercent(toCall, pot);

  if (toCall <= 0) {
    if (category >= HAND_CATEGORY.TRIPS) {
      return { action: 'bet', reason: `${categoryName(category)} is a strong value hand -- bet for value.` };
    }
    if (outs >= 8) {
      return { action: 'bet', reason: `Big draw (${outs} outs) -- semi-bluff bet builds the pot / can win immediately.` };
    }
    return { action: 'check', reason: 'No strong made hand or big draw -- take the free card.' };
  }

  if (category >= HAND_CATEGORY.TWO_PAIR) {
    return { action: 'raise', reason: `${categoryName(category)} is well ahead of most ranges -- raise for value.` };
  }
  if (hasTopPair && toCall <= pot) {
    return { action: 'call', reason: 'Top pair is worth defending against a reasonably sized bet.' };
  }
  if (cardsToCome && outs > 0) {
    if (equity >= oddsNeeded) {
      return {
        action: 'call',
        reason: `${outs} outs ≈ ${equity}% equity, pot odds need ${oddsNeeded.toFixed(1)}% -- correct call.`,
      };
    }
    return {
      action: 'fold',
      reason: `${outs} outs ≈ ${equity}% equity, but pot odds need ${oddsNeeded.toFixed(1)}% -- not enough price to draw.`,
    };
  }
  return { action: 'fold', reason: 'Weak, undefined hand facing a bet with no real draw.' };
}

function categoryName(category) {
  const names = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
  return names[category];
}

const STRATEGY_EXPORTS = {
  chenScore, POSITIONS_7MAX, PREFLOP_THRESHOLDS, preflopAdvice, preflopAdviceFromScore,
  countOuts, equityFromOuts, potOddsPercent, postflopAdvice, categoryName,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = STRATEGY_EXPORTS;
} else if (typeof window !== 'undefined') {
  Object.assign(window, STRATEGY_EXPORTS);
}
})();
