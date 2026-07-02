(function () {
/*
 * Casino house rules for the two live-cardroom rulesets modeled by this
 * trainer. Numbers are sourced from public cardroom listings (PokerAtlas,
 * PokerNews, Upswing Poker room reviews) as of mid-2026 and are meant to be
 * representative of real cash-game structure, not a guaranteed live quote --
 * cardrooms adjust rake and spreads over time. See resources.html for
 * citations.
 */

const CASINO_RULES = {
  borgata: {
    name: 'Borgata Poker Room — Atlantic City, NJ',
    maxSeats: 8,
    noFlopNoDrop: true,
    bombPotAllowed: false,
    stakes: [
      {
        key: 'borgata-1-3',
        label: '$1/$3 No-Limit Hold’em',
        sb: 1, bb: 3, minBuyIn: 100, maxBuyIn: 400,
        rakeType: 'percentage', rakePercent: 0.10, rakeCap: 6, jackpotDrop: 1,
      },
      {
        key: 'borgata-2-5',
        label: '$2/$5 No-Limit Hold’em',
        sb: 2, bb: 5, minBuyIn: 200, maxBuyIn: 1000,
        rakeType: 'time', timeChargePerHalfHour: 5, jackpotDrop: 1,
      },
      {
        key: 'borgata-5-10',
        label: '$5/$10 No-Limit Hold’em',
        sb: 5, bb: 10, minBuyIn: 500, maxBuyIn: 2500,
        rakeType: 'time', timeChargePerHalfHour: 10, jackpotDrop: 0,
      },
      {
        key: 'borgata-10-25',
        label: '$10/$25 No-Limit Hold’em',
        sb: 10, bb: 25, minBuyIn: 2500, maxBuyIn: null,
        rakeType: 'time', timeChargePerHalfHour: 15, jackpotDrop: 0,
      },
    ],
    notes: [
      'No flop, no drop: the house only rakes a pot that sees a flop.',
      '$1/$3 games rake 10% up to $6, plus a $1 Bad Beat Jackpot drop per hand.',
      '$2/$5 and higher are time-collection games: a flat charge per half hour instead of a rake off each pot.',
      'Maximum 8 players per table.',
    ],
  },
  parx: {
    name: 'Parx Casino Poker Room — Bensalem, PA (Philadelphia area)',
    maxSeats: 9,
    noFlopNoDrop: true,
    bombPotAllowed: false,
    stakes: [
      {
        key: 'parx-1-3',
        label: '$1/$3 No-Limit Hold’em',
        sb: 1, bb: 3, minBuyIn: 100, maxBuyIn: 500,
        rakeType: 'percentage', rakePercent: 0.10, rakeCap: 5, jackpotDrop: 2,
      },
      {
        key: 'parx-2-5',
        label: '$2/$5 No-Limit Hold’em',
        sb: 2, bb: 5, minBuyIn: 200, maxBuyIn: 1000,
        rakeType: 'percentage', rakePercent: 0.10, rakeCap: 5, jackpotDrop: 2,
      },
      {
        key: 'parx-10-10',
        label: '$10/$10 No-Limit Hold’em (spread on demand)',
        sb: 10, bb: 10, minBuyIn: 1000, maxBuyIn: 3000,
        rakeType: 'time', timeChargePerHalfHour: 12, jackpotDrop: 0,
      },
      {
        key: 'parx-10-25',
        label: '$10/$25 No-Limit Hold’em (spread on demand)',
        sb: 10, bb: 25, minBuyIn: 2500, maxBuyIn: null,
        rakeType: 'time', timeChargePerHalfHour: 15, jackpotDrop: 0,
      },
    ],
    notes: [
      'No flop, no drop, same as most Northeast cardrooms.',
      '$1/$3 and $2/$5 rake 10% up to $5, plus a $2 high-hand/jackpot drop.',
      'Straddles are allowed under the gun only; no "kill" games.',
      'Regularly spreads 9-handed; this trainer always seats you with 6 opponents (7-handed) regardless of the room’s normal max.',
    ],
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CASINO_RULES };
} else if (typeof window !== 'undefined') {
  window.CASINO_RULES = CASINO_RULES;
}
})();
