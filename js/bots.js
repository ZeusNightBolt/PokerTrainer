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
    // Sampled from a floor of 0.25 rather than 0: a table of 6 strict-basic-
    // strategy bots folds almost everything preflop and rarely sees a flop,
    // let alone a showdown. Recreational live tables run looser than that,
    // and this trainer wants multi-way pots to actually play out (see the
    // limp/call-anyway logic below) rather than ending in a walk-over.
    looseness: randRange(0.25, 1), // higher = plays more hands / calls wider
    aggression: randRange(0, 1),   // higher = prefers bet/raise over check/call
    bluffFreq: randRange(0, 0.3),  // chance to bluff-raise a hand the strategy engine would fold
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

  if (numRaisesInFront === 0) {
    // Unopened pot: occasionally bluff-raise, otherwise limp along instead
    // of mucking outright -- a purely tight-fold-only table never builds a
    // multi-way pot, and limping a speculative hand for one bet is exactly
    // how loose-passive recreational tables actually play.
    if (action === 'fold' && Math.random() < personality.bluffFreq * 0.4) {
      action = 'raise';
    } else if (action === 'fold' && !canCheck) {
      const limpChance = 0.25 + personality.looseness * 0.45;
      if (Math.random() < limpChance) action = 'call';
    }
  } else if (action === 'fold') {
    // Facing a raise: call anyway often enough that raised pots stay
    // multi-way instead of folding around to the raiser every time.
    const callChance = 0.22 + personality.looseness * 0.55;
    if (Math.random() < callChance) action = 'call';
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

  // Loose call-down: a floor probability (not just a looseness-scaled one)
  // so hands regularly see later streets instead of folding to the first
  // bet, up to a bet size where calling anyway stops being plausible.
  if (action === 'fold' && toCall > 0 && toCall <= pot * 1.3) {
    const callChance = 0.3 + personality.looseness * 0.55;
    if (Math.random() < callChance) action = 'call';
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
