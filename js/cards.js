(function () {
/* Card, Deck, and best-5-of-7 hand evaluator for Texas Hold'em. */

const SUITS = ['s', 'h', 'd', 'c'];
const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_ORDER = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function rankLabel(rank) {
  return RANK_LABEL[rank] || String(rank);
}

class Card {
  constructor(rank, suit) {
    this.rank = rank; // 2-14 (14 = Ace)
    this.suit = suit; // s,h,d,c
  }
  get label() {
    return `${rankLabel(this.rank)}${SUIT_SYMBOL[this.suit]}`;
  }
  get isRed() {
    return this.suit === 'h' || this.suit === 'd';
  }
  toString() {
    return this.label;
  }
}

/* A single 52-card deck, freshly shuffled every hand.
   Real-money cardrooms (Borgata, Parx, etc.) shuffle a fresh deck for every
   hand dealt -- unlike blackjack's multi-deck shoe, there is no persistent
   "shoe" whose composition carries information from one hand to the next.
   This is the central fact behind the Resources page's card-counting-theory
   section: there is nothing analogous to a running/true count to keep here. */
class Deck {
  constructor() {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANK_ORDER) {
        this.cards.push(new Card(rank, suit));
      }
    }
    this.shuffle();
  }
  shuffle() {
    // Fisher-Yates
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    this.pointer = 0;
  }
  draw() {
    if (this.pointer >= this.cards.length) {
      throw new Error('Deck exhausted');
    }
    return this.cards[this.pointer++];
  }
  burn() {
    this.pointer++;
  }
  remaining() {
    return this.cards.slice(this.pointer);
  }
}

const HAND_CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
};

const HAND_CATEGORY_NAME = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

function combinations(arr, k) {
  const results = [];
  const combo = [];
  function recurse(start) {
    if (combo.length === k) {
      results.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      recurse(i + 1);
      combo.pop();
    }
  }
  recurse(0);
  return results;
}

/* Evaluate exactly 5 cards. Returns a comparable score array:
   [category, tiebreak1, tiebreak2, ...] where higher is always better
   and arrays compare lexicographically. */
function evaluate5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const byCount = Object.entries(counts)
    .map(([rank, count]) => ({ rank: Number(rank), count }))
    .sort((a, b) => (b.count - a.count) || (b.rank - a.rank));

  // Straight detection (including wheel A-2-3-4-5)
  const uniqueRanksDesc = [...new Set(ranks)];
  let straightHigh = null;
  if (uniqueRanksDesc.length === 5) {
    if (uniqueRanksDesc[0] - uniqueRanksDesc[4] === 4) {
      straightHigh = uniqueRanksDesc[0];
    } else if (
      uniqueRanksDesc[0] === 14 &&
      uniqueRanksDesc[1] === 5 &&
      uniqueRanksDesc[2] === 4 &&
      uniqueRanksDesc[3] === 3 &&
      uniqueRanksDesc[4] === 2
    ) {
      straightHigh = 5; // wheel plays as a 5-high straight
    }
  }

  if (straightHigh && isFlush) {
    return [HAND_CATEGORY.STRAIGHT_FLUSH, straightHigh];
  }
  if (byCount[0].count === 4) {
    const kicker = byCount.find((g) => g.count === 1).rank;
    return [HAND_CATEGORY.QUADS, byCount[0].rank, kicker];
  }
  if (byCount[0].count === 3 && byCount[1] && byCount[1].count === 2) {
    return [HAND_CATEGORY.FULL_HOUSE, byCount[0].rank, byCount[1].rank];
  }
  if (isFlush) {
    return [HAND_CATEGORY.FLUSH, ...ranks];
  }
  if (straightHigh) {
    return [HAND_CATEGORY.STRAIGHT, straightHigh];
  }
  if (byCount[0].count === 3) {
    const kickers = byCount.filter((g) => g.count === 1).map((g) => g.rank).sort((a, b) => b - a);
    return [HAND_CATEGORY.TRIPS, byCount[0].rank, ...kickers];
  }
  if (byCount[0].count === 2 && byCount[1] && byCount[1].count === 2) {
    const pairs = [byCount[0].rank, byCount[1].rank].sort((a, b) => b - a);
    const kicker = byCount.find((g) => g.count === 1).rank;
    return [HAND_CATEGORY.TWO_PAIR, ...pairs, kicker];
  }
  if (byCount[0].count === 2) {
    const kickers = byCount.filter((g) => g.count === 1).map((g) => g.rank).sort((a, b) => b - a);
    return [HAND_CATEGORY.PAIR, byCount[0].rank, ...kickers];
  }
  return [HAND_CATEGORY.HIGH_CARD, ...ranks];
}

function compareScores(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? -1;
    const bv = b[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/* Evaluate the best 5-card hand out of 5, 6, or 7 cards. */
function evaluateBest(cards) {
  if (cards.length === 5) {
    return { score: evaluate5(cards), cards };
  }
  const combos = combinations(cards, 5);
  let best = null;
  for (const combo of combos) {
    const score = evaluate5(combo);
    if (!best || compareScores(score, best.score) > 0) {
      best = { score, cards: combo };
    }
  }
  return best;
}

function describeScore(score) {
  return HAND_CATEGORY_NAME[score[0]];
}

const CARDS_EXPORTS = {
  Card, Deck, SUITS, SUIT_SYMBOL, RANK_LABEL, rankLabel,
  HAND_CATEGORY, HAND_CATEGORY_NAME, combinations,
  evaluate5, evaluateBest, compareScores, describeScore,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CARDS_EXPORTS;
} else if (typeof window !== 'undefined') {
  Object.assign(window, CARDS_EXPORTS);
}
})();
