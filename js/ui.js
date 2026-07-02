(function () {
  const HUMAN_SEAT = 0;
  let game = null;
  let stats = loadStats();
  let pendingAdvice = null; // { street, action } captured when action bar is rendered, used to score the human's actual choice
  let preHandHumanStack = 0;

  const el = (id) => document.getElementById(id);

  /* ---------- Setup screen ---------- */

  function populateStakes() {
    const venueKey = el('venue-select').value;
    const venue = CASINO_RULES[venueKey];
    const stakeSelect = el('stake-select');
    stakeSelect.innerHTML = '';
    for (const stake of venue.stakes) {
      const opt = document.createElement('option');
      opt.value = stake.key;
      opt.textContent = `${stake.label} (buy-in $${stake.minBuyIn}-${stake.maxBuyIn || '∞'})`;
      stakeSelect.appendChild(opt);
    }
    renderVenueNotes(venue);
  }

  function renderVenueNotes(venue) {
    const list = venue.notes.map((n) => `<li>${n}</li>`).join('');
    el('venue-notes').innerHTML = `<strong>${venue.name}</strong><ul>${list}</ul>`;
  }

  el('venue-select').addEventListener('change', populateStakes);
  el('stake-select').addEventListener('change', () => renderVenueNotes(CASINO_RULES[el('venue-select').value]));

  el('start-btn').addEventListener('click', () => {
    const venueKey = el('venue-select').value;
    const stakeKey = el('stake-select').value;
    const name = el('name-input').value.trim() || 'You';
    game = new PokerGame(venueKey, stakeKey, name);
    el('setup-screen').style.display = 'none';
    el('game-screen').style.display = 'grid';
    dealNextHand();
  });

  /* ---------- Hand flow ---------- */

  function dealNextHand() {
    if (!game.humanCanContinue()) {
      const rebuyMax = game.stake.maxBuyIn || game.stake.minBuyIn * 6;
      const wantsRebuy = confirm(
        `You're out of chips. Rebuy for $${rebuyMax} and keep playing at ${game.stake.label}?`
      );
      if (!wantsRebuy) {
        el('hand-over-banner').style.display = 'block';
        el('hand-over-banner').textContent = 'Session over. Refresh to sit down again.';
        el('action-bar').style.display = 'none';
        return;
      }
      game.rebuyHuman(rebuyMax);
    }
    el('hand-over-banner').style.display = 'none';
    game.newHand();
    preHandHumanStack = game.seats[HUMAN_SEAT].stack + game.seats[HUMAN_SEAT].committedHand;
    pendingAdvice = null;
    advance();
  }

  function advance() {
    const status = game.runBotsUntilHumanOrDone();
    render();
    if (status.handOver) {
      finishHand();
    } else {
      setupAdvisorAndActionBar();
    }
  }

  function finishHand() {
    const human = game.seats[HUMAN_SEAT];
    const net = human.stack - preHandHumanStack;
    el('action-bar').style.display = 'none';
    el('hand-over-banner').style.display = 'block';
    const result = game.lastResult;
    const summary = result.showdown
      ? `Showdown -- ${result.pots.map((p) => `${p.winners.map((w) => game.seats[w].name).join('/')} won $${Math.round(p.amount)} (${p.handDescription})`).join('; ')}`
      : 'Hand won uncontested.';
    el('hand-over-banner').innerHTML = `${summary}<br><button class="primary" id="next-hand-btn" style="margin-top:0.6rem;">Deal Next Hand</button>`;
    el('next-hand-btn').addEventListener('click', dealNextHand);

    stats = recordHandResult(stats, net);
    renderStats();
  }

  /* ---------- Advisor + action bar ---------- */

  function setupAdvisorAndActionBar() {
    const seat = game.currentActorSeat();
    if (seat !== HUMAN_SEAT) return; // shouldn't happen, runBotsUntilHumanOrDone stops at human turn or hand end
    const human = game.seats[HUMAN_SEAT];
    const legal = game.legalActionsFor(HUMAN_SEAT);
    const position = game.roles[HUMAN_SEAT];
    const pot = game.potTotal();

    let advice;
    if (game.board.length === 0) {
      advice = preflopAdvice({
        holeCards: human.holeCards,
        position,
        numRaisesInFront: game.numRaisesInFrontFor(HUMAN_SEAT),
      });
    } else {
      advice = postflopAdvice({
        holeCards: human.holeCards,
        board: game.board,
        pot,
        toCall: legal.callAmount,
      });
    }
    pendingAdvice = { street: game.street, advice };
    renderAdvisor(advice, legal);
    renderOuts(human, legal, pot);
    renderActionBar(legal, pot);
  }

  function renderAdvisor(advice, legal) {
    const label = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise' }[advice.action];
    el('advisor-content').innerHTML = `
      <div class="advisor-line">Basic strategy suggests: <strong>${label}</strong></div>
      <div class="advisor-reason">${advice.reason}</div>
    `;
  }

  function renderOuts(human, legal, pot) {
    const board = game.board;
    const container = el('outs-content');
    if (board.length === 0) {
      const score = chenScore(human.holeCards[0], human.holeCards[1]);
      container.innerHTML = `
        <div>Chen score</div><div class="value">${score}</div>
        <div>Position</div><div class="value">${game.roles[HUMAN_SEAT]}</div>
      `;
      return;
    }
    if (board.length >= 5) {
      const best = evaluateBest([...human.holeCards, ...board]);
      container.innerHTML = `<div>Made hand</div><div class="value">${describeScore(best.score)}</div>`;
      return;
    }
    const { outs, cardsToCome } = countOuts(human.holeCards, board);
    const equity = equityFromOuts(outs, cardsToCome);
    const oddsNeeded = potOddsPercent(legal.callAmount, pot);
    container.innerHTML = `
      <div>Outs</div><div class="value">${outs}</div>
      <div>Equity (Rule of ${cardsToCome === 2 ? '4' : '2'})</div><div class="value">${equity}%</div>
      <div>Pot odds needed</div><div class="value">${legal.callAmount > 0 ? oddsNeeded.toFixed(1) + '%' : '--'}</div>
      <div>Correct price?</div><div class="value">${legal.callAmount > 0 ? (equity >= oddsNeeded ? 'Yes' : 'No') : '--'}</div>
    `;
  }

  function renderActionBar(legal, pot) {
    const bar = el('action-bar');
    bar.style.display = 'flex';
    el('btn-fold').disabled = false;
    el('btn-check').disabled = !legal.canCheck;
    el('btn-call').disabled = !legal.canCall;
    el('btn-call').textContent = legal.canCall ? `Call $${legal.callAmount}` : 'Call';
    el('btn-bet').disabled = !legal.canRaise;
    el('btn-bet').textContent = legal.canCall ? 'Raise' : 'Bet';
    el('btn-allin').disabled = legal.maxRaiseTo <= 0;

    const slider = el('bet-slider');
    const amountBox = el('bet-amount');
    slider.min = legal.minRaiseTo;
    slider.max = legal.maxRaiseTo;
    slider.value = legal.minRaiseTo;
    amountBox.value = legal.minRaiseTo;
    slider.disabled = !legal.canRaise;
    amountBox.disabled = !legal.canRaise;

    slider.oninput = () => { amountBox.value = slider.value; };
    amountBox.oninput = () => { slider.value = amountBox.value; };

    el('btn-half-pot').onclick = () => setBetTarget(legal, Math.round(legal.callAmount + pot * 0.5));
    el('btn-pot').onclick = () => setBetTarget(legal, Math.round(legal.callAmount + pot));

    el('btn-fold').onclick = () => submitHumanAction('fold');
    el('btn-check').onclick = () => submitHumanAction('check');
    el('btn-call').onclick = () => submitHumanAction('call');
    el('btn-bet').onclick = () => submitHumanAction(legal.canCall ? 'raise' : 'bet', Number(amountBox.value));
    el('btn-allin').onclick = () => submitHumanAction('allin');
  }

  function setBetTarget(legal, target) {
    const clamped = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, target));
    el('bet-slider').value = clamped;
    el('bet-amount').value = clamped;
  }

  function submitHumanAction(action, amount) {
    if (pendingAdvice) {
      const matched = action === pendingAdvice.advice.action ||
        (['bet', 'raise', 'allin'].includes(action) && ['bet', 'raise'].includes(pendingAdvice.advice.action));
      stats = recordDecision(stats, { street: pendingAdvice.street, matched });
      renderStats();
    }
    const preStack = game.seats[HUMAN_SEAT].stack;
    game.act(HUMAN_SEAT, action, amount);
    advance();
  }

  /* ---------- Rendering ---------- */

  function cardEl(card, small) {
    const cls = `card${card.isRed ? ' red' : ''}${small ? ' small' : ''}`;
    return `<div class="${cls}">${card.label}</div>`;
  }

  function backCardEl() {
    return '<div class="card small back"></div>';
  }

  function render() {
    const state = game.getPublicState();
    el('pot-display').textContent = `Pot: $${state.pot}`;
    el('board-cards').innerHTML = state.board.map((c) => cardEl(c)).join('') || '<span style="color:#556;">-- preflop --</span>';
    el('street-label').textContent = `${state.venue} -- ${state.stakeLabel} -- ${state.street.toUpperCase()}`;

    const wrap = el('table-wrap');
    wrap.querySelectorAll('.seat').forEach((n) => n.remove());
    for (const s of state.seats) {
      const div = document.createElement('div');
      div.className = `seat seat-${s.seat}` +
        (s.folded ? ' folded' : '') +
        (s.isHuman ? ' human' : '') +
        (state.actor === s.seat ? ' acting' : '');
      const cardsHtml = s.holeCards
        ? s.holeCards.map((c) => cardEl(c, true)).join('')
        : (s.folded ? '' : backCardEl() + backCardEl());
      div.innerHTML = `
        ${state.buttonSeat === s.seat ? '<div class="dealer-chip">D</div>' : ''}
        <div class="seat-name">${s.name}</div>
        <div class="seat-role">${state.roles[s.seat] || ''}</div>
        <div class="seat-cards">${cardsHtml}</div>
        <div class="seat-stack">$${s.stack}</div>
        <div class="seat-bet">${s.committedRound > 0 ? 'Bet $' + s.committedRound : ''}${s.allIn ? ' (all-in)' : ''}</div>
      `;
      wrap.appendChild(div);
    }

    el('log-content').innerHTML = state.log.map((l) => `<div>${l}</div>`).join('');
    el('log-content').scrollTop = el('log-content').scrollHeight;
    renderStats();
  }

  function renderStats() {
    const preflopPct = stats.preflopDecisions ? Math.round((100 * stats.preflopMatched) / stats.preflopDecisions) : 0;
    const postflopPct = stats.postflopDecisions ? Math.round((100 * stats.postflopMatched) / stats.postflopDecisions) : 0;
    const overallPct = stats.decisionsTracked ? Math.round((100 * stats.decisionsMatched) / stats.decisionsTracked) : 0;
    el('stats-content').innerHTML = `
      <div>Hands played</div><div class="value">${stats.handsPlayed}</div>
      <div>Overall strategy match</div><div class="value">${overallPct}%</div>
      <div>Preflop match</div><div class="value">${preflopPct}%</div>
      <div>Postflop match</div><div class="value">${postflopPct}%</div>
    `;
  }

  el('reset-stats-btn').addEventListener('click', () => {
    stats = resetStats();
    renderStats();
  });

  /* ---------- Init ---------- */
  populateStakes();
  renderStats();
})();
