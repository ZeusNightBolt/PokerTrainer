(function () {
/*
 * Six randomized opponents ("6 random bots"). Each is dealt a random
 * personality at the start of a session -- a mix of looseness, aggression,
 * and bluff frequency -- so the table plays differently every session
 * while still making broadly sensible decisions (they lean on the same
 * strategy engine used for the player's advisor, then add randomness on
 * top, rather than acting with pure noise, which would make for a
 * meaningless training partner).
 */

const {
  chenScore, preflopAdviceFromScore, postflopAdvice, countOuts, equityFromOuts, potOddsPercent,
} = (typeof module !== 'undefined' && module.exports ? require('./strategy.js') : window);

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function makeBotPersonality() {
  return {
    looseness: randRange(0, 1), // higher = plays more hands / calls wider
    aggression: randRange(0, 1), // higher = prefers bet/raise over check/call
    bluffFreq: randRange(0, 0.35), // chance to bluff-raise a hand the strategy engine would fold
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/* Round a bet size to a whole dollar and keep it within [minRaiseTo, maxRaiseTo] (the bot's stack). */
function sizeTo(amount, minRaiseTo, maxRaiseTo) {
  return clamp(Math.round(amount), minRaiseTo, maxRaiseTo);
}

function decidePreflop(ctx, personality) {
  const { holeCards, position, numRaisesInFront, bigBlind, toCall, pot, minRaiseTo, maxRaiseTo, canCheck } = ctx;
  const baseScore = chenScore(holeCards[0], holeCards[1]);
  const skew = (personality.looseness - 0.5) * 6; // loose bots act like they hold a better hand than they do
  const effectiveScore = baseScore + skew;
  const advice = preflopAdviceFromScore(effectiveScore, position, numRaisesInFront);

  let action = advice.action;

  // Occasional bluff: raise a hand the engine would otherwise fold.
  if (action === 'fold' && numRaisesInFront === 0 && Math.random() < personality.bluffFreq * 0.4) {
    action = 'raise';
  }
  // Aggressive bots upgrade some calls into raises (a light 3-bet/squeeze).
  if (action === 'call' && Math.random() < personality.aggression * 0.3) {
    action = 'raise';
  }

  if (action === 'check' && canCheck) return { action: 'check' };
  if (action === 'fold') return canCheck ? { action: 'check' } : { action: 'fold' };
  if (action === 'call') return { action: 'call' };
  if (action === 'raise') {
    const openSize = bigBlind * randRange(2.2, 3.2);
    const raiseSize = toCall > 0 ? toCall * randRange(2.2, 3) + pot * 0.3 : openSize;
    return { action: 'raise', amount: sizeTo(raiseSize, minRaiseTo, maxRaiseTo) };
  }
  return { action: canCheck ? 'check' : 'fold' };
}

function decidePostflop(ctx, personality) {
  const { holeCards, board, pot, toCall, minRaiseTo, maxRaiseTo, canCheck } = ctx;
  const advice = postflopAdvice({ holeCards, board, pot, toCall });
  let action = advice.action;

  if ((action === 'fold') && toCall > 0 && Math.random() < personality.looseness * 0.25 && toCall <= pot * 0.6) {
    action = 'call'; // loose/curious call
  }
  if (action === 'call' && Math.random() < personality.aggression * 0.3) {
    action = 'raise';
  }
  if (action === 'check' && Math.random() < personality.aggression * 0.3) {
    action = 'bet';
  }
  if (action === 'fold' && canCheck) action = 'check';

  if (action === 'check') return { action: 'check' };
  if (action === 'fold') return { action: 'fold' };
  if (action === 'call') return { action: 'call' };
  if (action === 'bet' || action === 'raise') {
    const fraction = randRange(0.5, 1.0) * (0.6 + personality.aggression * 0.6);
    const target = toCall > 0 ? toCall + pot * fraction : pot * fraction;
    return { action: toCall > 0 ? 'raise' : 'bet', amount: sizeTo(target + toCall, minRaiseTo, maxRaiseTo) };
  }
  return { action: canCheck ? 'check' : 'fold' };
}

/* Main entry point called by the game engine.
   ctx: { holeCards, board, position, pot, toCall, minRaiseTo, maxRaiseTo,
          numRaisesInFront, bigBlind, canCheck }
   Returns { action: 'fold'|'check'|'call'|'bet'|'raise', amount? } */
function decideBotAction(ctx, personality) {
  if (ctx.board.length === 0) return decidePreflop(ctx, personality);
  return decidePostflop(ctx, personality);
}

const BOTS_EXPORTS = { makeBotPersonality, decideBotAction };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BOTS_EXPORTS;
} else if (typeof window !== 'undefined') {
  Object.assign(window, BOTS_EXPORTS);
}
})();
