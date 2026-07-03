(function () {
/*
 * 7-handed (you + 6 bots) No-Limit Hold'em cash-game engine: blinds/button
 * rotation, a full betting-round state machine, all-in side pots, showdown,
 * and rake, driven by a selected casino ruleset (see rules.js).
 *
 * This models a live cash game closely enough for training purposes, but is
 * intentionally simplified in a couple of ways that are called out inline
 * (short all-in raises re-open the full action; time-charge rake is
 * approximated as a flat per-hand fee rather than a real half-hour clock).
 */

const { Deck, evaluateBest, compareScores, describeScore } = (typeof module !== 'undefined' && module.exports ? require('./cards.js') : window);
const { makeBotPersonality, decideBotAction } = (typeof module !== 'undefined' && module.exports ? require('./bots.js') : window);
const { POSITIONS_7MAX } = (typeof module !== 'undefined' && module.exports ? require('./strategy.js') : window);
const { estimatePreflopEquities } = (typeof module !== 'undefined' && module.exports ? require('./equity.js') : window);

const SEAT_COUNT = 7;
const HANDS_PER_HALF_HOUR = 25; // rough live-table pace, used to prorate time-charge rake per hand
const HUMAN_SEAT_INDEX = 0; // seat 0 is always the human (see PokerGame constructor)
const EQUITY_SAMPLES = 250; // Monte Carlo sample count for the variance/luck tracker

function seatOffset(seat, offset) {
  return (seat + offset) % SEAT_COUNT;
}

function computeSidePots(contribs) {
  let remaining = contribs.filter((c) => c.amount > 0).map((c) => ({ ...c }));
  const layers = [];
  while (remaining.length) {
    const minAmt = Math.min(...remaining.map((c) => c.amount));
    const potAmt = minAmt * remaining.length;
    const eligibleSeats = remaining.filter((c) => !c.folded).map((c) => c.seat);
    layers.push({ amount: potAmt, eligibleSeats });
    remaining = remaining.map((c) => ({ ...c, amount: c.amount - minAmt })).filter((c) => c.amount > 0);
  }
  return layers;
}

class PokerGame {
  constructor(venueKey, stakeKey, humanName = 'You') {
    this.setRuleset(venueKey, stakeKey);
    this.seats = [];
    const startingStack = Math.round((this.stake.minBuyIn + (this.stake.maxBuyIn || this.stake.minBuyIn * 4)) / 2);
    for (let i = 0; i < SEAT_COUNT; i++) {
      this.seats.push({
        seat: i,
        name: i === 0 ? humanName : `Bot ${i}`,
        isHuman: i === 0,
        stack: startingStack,
        personality: i === 0 ? null : makeBotPersonality(),
      });
    }
    this.buttonSeat = SEAT_COUNT - 1; // so seat 0 (human) posts SB on the very first hand dealt
    this.handNumber = 0;
    this.log = [];
    this.lastResult = null;
  }

  setRuleset(venueKey, stakeKey) {
    const { CASINO_RULES } = (typeof module !== 'undefined' && module.exports ? require('./rules.js') : window);
    this.venue = CASINO_RULES[venueKey];
    this.stake = this.venue.stakes.find((s) => s.key === stakeKey) || this.venue.stakes[0];
  }

  addLog(message) {
    this.log.push(message);
  }

  /* Top any bot (and, optionally, the human) back up to a sane stack if
     they're felted or below the room's minimum buy-in, mirroring how a live
     cash-game seat gets refilled by a new/rebuying player. */
  topUpBusted() {
    for (const s of this.seats) {
      if (s.isHuman) continue;
      if (s.stack < this.stake.minBuyIn) {
        const max = this.stake.maxBuyIn || this.stake.minBuyIn * 6;
        s.stack = Math.round((this.stake.minBuyIn + max) / 2);
        s.personality = makeBotPersonality();
      }
    }
  }

  humanCanContinue() {
    return this.seats[0].stack >= this.stake.bb;
  }

  rebuyHuman(amount) {
    this.seats[0].stack += amount;
  }

  newHand() {
    this.topUpBusted();
    this.handNumber++;
    this.buttonSeat = seatOffset(this.buttonSeat, 1);
    this.deck = new Deck();
    this.board = [];
    this.street = 'preflop';
    this.log = [];
    this.lastResult = null;

    for (const s of this.seats) {
      s.holeCards = [this.deck.draw(), this.deck.draw()];
      s.folded = false;
      s.allIn = false;
      s.committedRound = 0;
      s.committedHand = 0;
    }

    // Roles, 7-handed: BTN, SB, BB, UTG, UTG1, HJ, CO
    this.roles = {};
    const roleCycle = ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'HJ', 'CO'];
    for (let i = 0; i < SEAT_COUNT; i++) {
      this.roles[seatOffset(this.buttonSeat, i)] = roleCycle[i];
    }

    const sbSeat = seatOffset(this.buttonSeat, 1);
    const bbSeat = seatOffset(this.buttonSeat, 2);
    this.postBlind(sbSeat, this.stake.sb);
    this.postBlind(bbSeat, this.stake.bb);
    this.addLog(`Hand #${this.handNumber}. Button: ${this.seats[this.buttonSeat].name}.`);

    this.currentBet = this.stake.bb;
    this.minRaiseIncrement = this.stake.bb;
    this.raiseCountThisRound = 1; // the big blind counts as the opening "bet" for 3-bet/4-bet counting
    const order = [];
    for (let i = 3; i < SEAT_COUNT; i++) order.push(seatOffset(this.buttonSeat, i)); // UTG..CO
    order.push(this.buttonSeat, sbSeat, bbSeat); // BTN, SB, BB act last preflop
    this.actionQueue = order.filter((seat) => this.canAct(seat));
    this.streetDone = false;
    this.checkForImmediateEnd();
  }

  postBlind(seat, amount) {
    const s = this.seats[seat];
    const pay = Math.min(amount, s.stack);
    s.stack -= pay;
    s.committedRound += pay;
    s.committedHand += pay;
    if (s.stack === 0) s.allIn = true;
  }

  canAct(seat) {
    const s = this.seats[seat];
    return !s.folded && !s.allIn;
  }

  playersInHand() {
    return this.seats.filter((s) => !s.folded);
  }

  checkForImmediateEnd() {
    if (this.playersInHand().length === 1) {
      this.resolveUncontested();
    }
  }

  currentActorSeat() {
    if (this.lastResult) return null;
    while (this.actionQueue.length && !this.canAct(this.actionQueue[0])) {
      this.actionQueue.shift();
    }
    return this.actionQueue.length ? this.actionQueue[0] : null;
  }

  legalActionsFor(seat) {
    const s = this.seats[seat];
    const toCall = this.currentBet - s.committedRound;
    const canCheck = toCall <= 0;
    const minRaiseTo = this.currentBet + this.minRaiseIncrement;
    const maxRaiseTo = s.committedRound + s.stack;
    return {
      canCheck,
      canCall: toCall > 0,
      callAmount: Math.min(toCall, s.stack),
      canRaise: s.stack > toCall,
      minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
      maxRaiseTo,
    };
  }

  /* action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'
     amount: for 'bet'/'raise', the TOTAL amount the seat will have
     committed this round after acting (a "raise to" figure), not the
     incremental chip count. */
  act(seat, action, amount) {
    const s = this.seats[seat];
    const legal = this.legalActionsFor(seat);

    if (action === 'fold') {
      s.folded = true;
      this.addLog(`${s.name} folds.`);
    } else if (action === 'check') {
      this.addLog(`${s.name} checks.`);
    } else if (action === 'call') {
      const pay = legal.callAmount;
      s.stack -= pay; s.committedRound += pay; s.committedHand += pay;
      if (s.stack === 0) s.allIn = true;
      this.addLog(`${s.name} calls $${pay}${s.allIn ? ' (all-in)' : ''}.`);
    } else if (action === 'bet' || action === 'raise' || action === 'allin') {
      const raiseTo = action === 'allin' ? legal.maxRaiseTo : Math.min(Math.max(amount, legal.minRaiseTo), legal.maxRaiseTo);
      const pay = raiseTo - s.committedRound;
      s.stack -= pay; s.committedRound += pay; s.committedHand += pay;
      if (s.stack === 0) s.allIn = true;
      const increment = raiseTo - this.currentBet;
      const isFullRaise = increment >= this.minRaiseIncrement;
      if (isFullRaise) this.minRaiseIncrement = increment;
      this.currentBet = Math.max(this.currentBet, raiseTo);
      this.raiseCountThisRound++;
      this.addLog(`${s.name} ${action === 'bet' ? 'bets' : 'raises to'} $${raiseTo}${s.allIn ? ' (all-in)' : ''}.`);
      // A raise (even a short all-in one, for simplicity) re-opens action
      // for every other seat still able to act.
      const others = this.seats
        .map((p) => p.seat)
        .filter((seatIdx) => seatIdx !== seat && this.canAct(seatIdx));
      this.actionQueue = others;
      this.checkForImmediateEnd();
      return this.afterAction();
    }

    this.actionQueue.shift();
    this.checkForImmediateEnd();
    return this.afterAction();
  }

  afterAction() {
    if (this.lastResult) return { handOver: true };
    if (this.currentActorSeat() === null) {
      this.advanceStreet();
    }
    return { handOver: !!this.lastResult };
  }

  numRaisesInFrontFor(seat) {
    return Math.max(this.raiseCountThisRound - 1, 0);
  }

  advanceStreet() {
    const remaining = this.playersInHand();
    const allInOrOne = remaining.filter((s) => !s.allIn).length <= 1;

    if (this.street === 'river') {
      this.resolveShowdown();
      return;
    }

    if (allInOrOne) {
      // Deal remaining streets with no further betting, then showdown.
      this.runOutBoard();
      this.resolveShowdown();
      return;
    }

    for (const s of this.seats) s.committedRound = 0;
    this.currentBet = 0;
    this.minRaiseIncrement = this.stake.bb;
    this.raiseCountThisRound = 0;

    if (this.street === 'preflop') {
      this.street = 'flop';
      this.deck.burn();
      this.board.push(this.deck.draw(), this.deck.draw(), this.deck.draw());
      this.addLog(`Flop: ${this.board.map((c) => c.label).join(' ')}`);
    } else if (this.street === 'flop') {
      this.street = 'turn';
      this.deck.burn();
      this.board.push(this.deck.draw());
      this.addLog(`Turn: ${this.board.map((c) => c.label).join(' ')}`);
    } else if (this.street === 'turn') {
      this.street = 'river';
      this.deck.burn();
      this.board.push(this.deck.draw());
      this.addLog(`River: ${this.board.map((c) => c.label).join(' ')}`);
    }

    const order = [];
    for (let i = 1; i <= SEAT_COUNT; i++) order.push(seatOffset(this.buttonSeat, i)); // SB..BTN
    this.actionQueue = order.filter((seat) => this.canAct(seat));
    if (this.actionQueue.length === 0) {
      this.advanceStreet();
    }
  }

  runOutBoard() {
    while (this.board.length < 5) {
      this.deck.burn();
      this.board.push(this.deck.draw());
    }
    this.addLog(`Board runs out: ${this.board.map((c) => c.label).join(' ')}`);
  }

  resolveUncontested() {
    const winner = this.playersInHand()[0];
    const total = this.seats.reduce((sum, s) => sum + s.committedHand, 0);
    const rake = this.computeRake(total, false);
    winner.stack += total - rake.amount;
    this.addLog(`${winner.name} wins $${total - rake.amount} uncontested.`);
    this.lastResult = {
      showdown: false,
      board: this.board,
      pots: [{ amount: total - rake.amount, winners: [winner.seat] }],
      rake,
    };
  }

  computeRake(totalPot, sawFlop) {
    if (this.stake.rakeType === 'time') {
      const perHand = this.stake.timeChargePerHalfHour / HANDS_PER_HALF_HOUR;
      for (const s of this.seats) {
        s.stack = Math.max(0, s.stack - perHand);
      }
      return { amount: 0, type: 'time', perSeatCharge: Math.round(perHand * 100) / 100 };
    }
    if (!sawFlop && this.venue.noFlopNoDrop) {
      return { amount: 0, type: 'percentage' };
    }
    const jackpot = this.stake.jackpotDrop || 0;
    const rake = Math.min(totalPot * this.stake.rakePercent, this.stake.rakeCap) + jackpot;
    return { amount: Math.min(Math.round(rake), totalPot), type: 'percentage' };
  }

  resolveShowdown() {
    const contribs = this.seats.map((s) => ({ seat: s.seat, amount: s.committedHand, folded: s.folded }));
    const layers = computeSidePots(contribs);
    const sawFlop = this.board.length >= 3;
    const totalPot = layers.reduce((sum, l) => sum + l.amount, 0);
    const rake = this.computeRake(totalPot, sawFlop);

    const hands = {};
    for (const s of this.playersInHand()) {
      hands[s.seat] = evaluateBest([...s.holeCards, ...this.board]);
    }

    let rakeRemaining = rake.amount;
    const pots = [];
    const actualWon = {};
    const evWon = {};
    const eligibleTotal = {};
    for (const layer of layers) {
      let layerAmount = layer.amount;
      if (rakeRemaining > 0) {
        const take = Math.min(rakeRemaining, layerAmount);
        layerAmount -= take;
        rakeRemaining -= take;
      }
      const eligible = layer.eligibleSeats;
      let best = null;
      for (const seat of eligible) {
        const h = hands[seat];
        if (!best || compareScores(h.score, best.score) > 0) best = h;
      }
      const winners = eligible.filter((seat) => compareScores(hands[seat].score, best.score) === 0);
      // Split in whole cents (not dollars) so the odd-chip remainder logic
      // stays exact even when the time-charge rake has left a fractional
      // pot amount -- Math.floor'ing to whole dollars here would silently
      // overpay winners by up to $1 per side pot.
      const totalCents = Math.round(layerAmount * 100);
      const shareCents = Math.floor(totalCents / winners.length);
      let remainderCents = totalCents - shareCents * winners.length;
      const orderedWinners = winners.slice().sort((a, b) => {
        const da = (a - this.buttonSeat - 1 + SEAT_COUNT) % SEAT_COUNT;
        const db = (b - this.buttonSeat - 1 + SEAT_COUNT) % SEAT_COUNT;
        return da - db;
      });
      for (const w of orderedWinners) {
        const bonusCents = remainderCents > 0 ? 1 : 0;
        if (remainderCents > 0) remainderCents--;
        const amt = (shareCents + bonusCents) / 100;
        this.seats[w].stack += amt;
        actualWon[w] = (actualWon[w] || 0) + amt;
      }
      pots.push({ amount: layerAmount, winners: orderedWinners, handDescription: describeScore(best.score) });

      // Variance/luck tracking: each eligible seat's PREFLOP equity share of
      // this layer, regardless of who actually won it. Computed per-layer
      // (not once for the whole pot) so side pots credit equity only to the
      // seats that were actually eligible to win them.
      //
      // Only bother running the Monte Carlo when the human is actually in
      // this pot -- the UI never shows any other seat's variance, and in a
      // 7-handed game most showdowns don't involve the human at all, so
      // skipping those keeps this from being a real cost on every hand.
      if (layerAmount > 0 && eligible.includes(HUMAN_SEAT_INDEX)) {
        if (eligible.length > 1) {
          const equities = estimatePreflopEquities(eligible.map((seat) => this.seats[seat].holeCards), EQUITY_SAMPLES);
          eligible.forEach((seat, i) => {
            evWon[seat] = (evWon[seat] || 0) + equities[i].equity * layerAmount;
            eligibleTotal[seat] = (eligibleTotal[seat] || 0) + layerAmount;
          });
        } else {
          evWon[eligible[0]] = (evWon[eligible[0]] || 0) + layerAmount;
          eligibleTotal[eligible[0]] = (eligibleTotal[eligible[0]] || 0) + layerAmount;
        }
      }
    }

    for (const p of pots) {
      const names = p.winners.map((seat) => this.seats[seat].name).join(', ');
      this.addLog(`${names} win $${p.amount} with ${p.handDescription}.`);
    }

    const variance = {};
    for (const seat of Object.keys(evWon).map(Number)) {
      const ev = evWon[seat];
      const actual = actualWon[seat] || 0;
      const total = eligibleTotal[seat] || 0;
      variance[seat] = {
        equityPct: total > 0 ? ev / total : null,
        evAmount: ev,
        actualAmount: actual,
        luckDelta: actual - ev,
      };
    }

    this.lastResult = {
      showdown: true,
      board: this.board,
      pots,
      rake,
      hands,
      variance,
    };
  }

  /* Runs bot decisions until it's the human's turn or the hand is over.
     Returns { handOver } so the UI knows whether to show the result panel
     or the action controls. */
  runBotsUntilHumanOrDone() {
    for (let guard = 0; guard < 500; guard++) {
      if (this.lastResult) return { handOver: true };
      const seat = this.currentActorSeat();
      if (seat === null) {
        this.advanceStreet();
        continue;
      }
      if (this.seats[seat].isHuman) return { handOver: false };
      const decision = this.decideBot(seat);
      this.act(seat, decision.action, decision.amount);
    }
    return { handOver: !!this.lastResult };
  }

  decideBot(seat) {
    const s = this.seats[seat];
    const legal = this.legalActionsFor(seat);
    const position = this.roles[seat];
    const ctx = {
      holeCards: s.holeCards,
      board: this.board,
      position,
      pot: this.potTotal(),
      toCall: legal.callAmount,
      minRaiseTo: legal.minRaiseTo,
      maxRaiseTo: legal.maxRaiseTo,
      numRaisesInFront: this.numRaisesInFrontFor(seat),
      bigBlind: this.stake.bb,
      canCheck: legal.canCheck,
    };
    return decideBotAction(ctx, s.personality);
  }

  potTotal() {
    return this.seats.reduce((sum, s) => sum + s.committedHand, 0);
  }

  getPublicState() {
    return {
      handNumber: this.handNumber,
      street: this.street,
      board: this.board,
      pot: this.potTotal(),
      buttonSeat: this.buttonSeat,
      roles: this.roles,
      currentBet: this.currentBet,
      actor: this.currentActorSeat(),
      log: this.log,
      lastResult: this.lastResult,
      seats: this.seats.map((s) => ({
        seat: s.seat,
        name: s.name,
        isHuman: s.isHuman,
        stack: Math.round(s.stack * 100) / 100,
        folded: s.folded,
        allIn: s.allIn,
        committedRound: s.committedRound,
        committedHand: s.committedHand,
        holeCards: (s.isHuman || (this.lastResult && this.lastResult.showdown && !s.folded)) ? s.holeCards : null,
      })),
      venue: this.venue.name,
      stakeLabel: this.stake.label,
    };
  }
}

const GAME_EXPORTS = { PokerGame, computeSidePots, SEAT_COUNT };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GAME_EXPORTS;
} else if (typeof window !== 'undefined') {
  Object.assign(window, GAME_EXPORTS);
}
})();
