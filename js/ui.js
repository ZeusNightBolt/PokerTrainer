(function () {
  const HUMAN_SEAT = 0;
  let game = null;
  let stats = loadStats();
  let pendingAdvice = null;   // { street, advice } for the current human decision
  let lastDecision = null;    // { matched, chosenLabel, recLabel, street } after the human acts
  let preHandHumanStack = 0;
  let coachEnabled = true;

  const el = (id) => document.getElementById(id);
  const ACTION_LABEL = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', allin: 'All-In' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---- action pacing ---- */
  // Bots "think" for a beat before acting so the hand visibly goes around
  // the table like a real game, instead of resolving in a single repaint.
  // stepToken invalidates any in-flight pacing loop when a new hand is dealt.
  let stepToken = 0;
  let thinkingSeat = null; // seat currently "thinking" (shows animated dots)
  const SPEEDS = [
    { label: 'Realistic', mult: 1, street: 900, deal: 620 },
    { label: 'Fast', mult: 0.42, street: 380, deal: 300 },
    { label: 'Instant', mult: 0, street: 0, deal: 0 },
  ];
  let speedIdx = Number(localStorage.getItem('pokertrainer.speed'));
  if (!Number.isInteger(speedIdx) || speedIdx < 0 || speedIdx >= SPEEDS.length) speedIdx = 0;

  /* How long a bot "thinks" before a given action. Snap folds/checks are
     quick; calls take a moment; bets and especially raises look like a real
     decision. Jittered so no two look identical, and kept in the 0.6-2.1s
     band the way a live player pauses -- long enough to feel human, short
     enough to stay bearable. */
  function thinkTime(action, isBigSpot) {
    const mult = SPEEDS[speedIdx].mult;
    if (mult === 0) return 0;
    let base;
    if (action === 'fold' || action === 'check') base = 650;
    else if (action === 'call') base = 1050;
    else base = 1450; // bet / raise / allin
    if (isBigSpot) base += 400;
    const jitter = base * (0.75 + Math.random() * 0.6); // ±
    return Math.round(Math.min(2100, jitter) * mult);
  }

  /* transient per-seat action bubbles ("Calls $6"), drawn by render() while fresh */
  const BUBBLE_TTL = 1600;
  let bubbles = {}; // seat -> { label, cls, ts }
  function setBubble(seat, cls, label) {
    bubbles[seat] = { label, cls, ts: Date.now() };
  }

  /* ---------------- Setup ---------------- */

  function populateStakes() {
    const venue = CASINO_RULES[el('venue-select').value];
    const sel = el('stake-select');
    sel.innerHTML = '';
    for (const stake of venue.stakes) {
      const opt = document.createElement('option');
      opt.value = stake.key;
      opt.textContent = `${stake.label}  ·  buy-in $${stake.minBuyIn}–${stake.maxBuyIn || '∞'}`;
      sel.appendChild(opt);
    }
    renderVenueNotes(venue);
  }
  function renderVenueNotes(venue) {
    el('venue-notes').innerHTML =
      `<strong>${venue.name}</strong><ul>${venue.notes.map((n) => `<li>${n}</li>`).join('')}</ul>`;
  }

  el('venue-select').addEventListener('change', populateStakes);
  el('stake-select').addEventListener('change', () => renderVenueNotes(CASINO_RULES[el('venue-select').value]));

  el('start-btn').addEventListener('click', () => {
    try {
      coachEnabled = el('coach-toggle').checked;
      el('coach-panel').style.display = coachEnabled ? '' : 'none';
      game = new PokerGame(el('venue-select').value, el('stake-select').value, el('name-input').value.trim() || 'You');
      el('setup-screen').style.display = 'none';
      el('game-screen').style.display = 'grid';
      Table.init();
      dealNextHand();
    } catch (e) {
      console.error('failed to start game', e);
      alert('Could not start the game — please reload the page.');
    }
  });

  /* ---------------- Hand flow ---------------- */

  function dealNextHand() {
    if (!game.humanCanContinue()) {
      const rebuyMax = game.stake.maxBuyIn || game.stake.minBuyIn * 6;
      if (!confirm(`You're out of chips. Rebuy for $${rebuyMax} and keep playing ${game.stake.label}?`)) {
        el('hand-result').style.display = 'block';
        el('hand-result').innerHTML = '<div class="headline">Session over</div><div class="detail">Refresh to sit down again.</div>';
        el('action-dock').style.display = 'none';
        return;
      }
      game.rebuyHuman(rebuyMax);
    }
    el('hand-result').style.display = 'none';
    game.newHand();
    preHandHumanStack = game.seats[HUMAN_SEAT].stack + game.seats[HUMAN_SEAT].committedHand;
    pendingAdvice = null;
    lastDecision = null;
    bubbles = {};
    thinkingSeat = null;
    try { Table.startHand(game.getPublicState()); } catch (e) { console.error(e); }
    advance();
  }

  /* Paced game loop: each bot "thinks" for a beat (animated dots on its
     seat) then acts with an action bubble; new streets pause briefly so the
     runout reads naturally. */
  async function advance() {
    const token = ++stepToken;
    try {
      render();
      while (!game.lastResult) {
        const seat = game.currentActorSeat();
        if (seat === null) { game.advanceStreet(); render(); continue; }
        if (seat === HUMAN_SEAT) { thinkingSeat = null; setupTurn(); return; }

        const legal = game.legalActionsFor(seat);
        const beforeStreet = game.street;
        const d = game.decideBot(seat); // decide first so think-time fits the action

        const isBigSpot = legal.callAmount > game.potTotal() * 0.6 || (d.amount && d.amount > game.potTotal());
        const wait = thinkTime(d.action, isBigSpot);
        if (wait) {
          thinkingSeat = seat;
          render();
          await sleep(wait);
          if (token !== stepToken) return; // a new hand superseded this loop
        }
        thinkingSeat = null;

        game.act(seat, d.action, d.amount);
        const s = game.seats[seat];
        const bubbleLabel =
          d.action === 'fold' ? 'Folds' :
          d.action === 'check' ? 'Checks' :
          d.action === 'call' ? (legal.callAmount > 0 ? `Calls $${legal.callAmount}` : 'Checks') :
          s.allIn ? `All-in $${s.committedRound}` :
          d.action === 'bet' ? `Bets $${s.committedRound}` : `Raises to $${s.committedRound}`;
        setBubble(seat, s.allIn && d.action !== 'fold' ? 'allin' : d.action, bubbleLabel);
        render();

        if (!game.lastResult && game.street !== beforeStreet) {
          const streetDelay = SPEEDS[speedIdx].street;
          if (streetDelay) { await sleep(streetDelay); if (token !== stepToken) return; render(); }
        }
      }
      render();
      finishHand();
    } catch (e) {
      // Never let a stray error leave the table frozen mid-hand: log it,
      // re-render what we can, and surface a recovery button.
      console.error('game loop error', e);
      try { render(); } catch (_) { /* ignore */ }
      showRecovery();
    }
  }

  function showRecovery() {
    el('action-dock').style.display = 'none';
    const box = el('hand-result');
    box.style.display = 'block';
    box.innerHTML = '<div class="headline">Something hiccuped</div>' +
      '<div class="detail">The hand hit an unexpected state. You can deal a fresh one.</div>' +
      '<button class="btn gold" id="next-hand-btn">Deal Next Hand ▸</button>';
    const btn = el('next-hand-btn');
    if (btn) btn.addEventListener('click', dealNextHand);
  }

  function finishHand() {
    const net = game.seats[HUMAN_SEAT].stack - preHandHumanStack;
    el('action-dock').style.display = 'none';
    const r = game.lastResult;
    const summary = r.showdown
      ? r.pots.map((p) => `${p.winners.map((w) => game.seats[w].name).join(' / ')} won $${Math.round(p.amount)} · ${p.handDescription}`).join('<br>')
      : 'Won uncontested.';
    const netCls = net > 0 ? 'net-up' : net < 0 ? 'net-down' : '';
    const netStr = net > 0 ? `+$${Math.round(net)}` : net < 0 ? `-$${Math.abs(Math.round(net))}` : 'Even';
    let coachTail = '';
    if (coachEnabled && lastDecision) {
      const mark = lastDecision.matched ? '✓ matched basic strategy' : `✗ deviated (rec: ${lastDecision.recLabel})`;
      coachTail = `<div class="detail">Last decision: <strong style="color:${lastDecision.matched ? 'var(--good)' : 'var(--bad)'}">${mark}</strong></div>`;
    }

    let varianceTail = '';
    const v = r.showdown && r.variance ? r.variance[HUMAN_SEAT] : null;
    if (v) {
      stats = recordVariance(stats, v.luckDelta);
      const luckCls = v.luckDelta > 0 ? 'net-up' : v.luckDelta < 0 ? 'net-down' : '';
      const luckStr = v.luckDelta > 0 ? `+$${Math.round(v.luckDelta)}` : v.luckDelta < 0 ? `-$${Math.abs(Math.round(v.luckDelta))}` : '$0';
      const verdict = v.luckDelta > 1 ? 'Variance helped you here' : v.luckDelta < -1 ? 'Variance hurt you here' : 'Ran about even with your equity';
      varianceTail =
        `<div class="detail">Preflop equity ${Math.round(v.equityPct * 100)}% → expected $${Math.round(v.evAmount)},` +
        ` actually won $${Math.round(v.actualAmount)}. <strong class="${luckCls}">${verdict} (${luckStr})</strong></div>`;
    }

    el('hand-result').style.display = 'block';
    el('hand-result').innerHTML =
      `<div class="headline">Hand #${game.handNumber} · <span class="${netCls}">${netStr}</span></div>` +
      `<div class="detail">${summary}</div>${coachTail}${varianceTail}` +
      `<button class="btn gold" id="next-hand-btn">Deal Next Hand ▸</button>`;
    el('next-hand-btn').addEventListener('click', dealNextHand);
    stats = recordHandResult(stats, net);
    renderStats();
    renderCoachIdle();
  }

  /* ---------------- Human turn ---------------- */

  function setupTurn() {
    const seat = game.currentActorSeat();
    if (seat !== HUMAN_SEAT) return;
    const human = game.seats[HUMAN_SEAT];
    const legal = game.legalActionsFor(HUMAN_SEAT);
    const pot = game.potTotal();

    const advice = game.board.length === 0
      ? preflopAdvice({ holeCards: human.holeCards, position: game.roles[HUMAN_SEAT], numRaisesInFront: game.numRaisesInFrontFor(HUMAN_SEAT) })
      : postflopAdvice({ holeCards: human.holeCards, board: game.board, pot, toCall: legal.callAmount });
    pendingAdvice = { street: game.street, advice };

    renderCoach(advice);
    renderOuts(human, legal, pot);
    renderActionDock(advice, legal, pot);
  }

  function renderActionDock(advice, legal, pot) {
    el('action-dock').style.display = 'block';
    const recLabel = ACTION_LABEL[advice.action] || advice.action;
    el('action-hint').innerHTML = coachEnabled
      ? `<span>Coach suggests</span> <span class="rec">${recLabel}</span>`
      : `<span>Your action</span>`;

    el('btn-fold').disabled = false;
    el('btn-check').disabled = !legal.canCheck;
    el('btn-call').disabled = !legal.canCall;
    el('btn-call').textContent = legal.canCall ? `Call $${legal.callAmount}` : 'Call';
    el('btn-bet').disabled = !legal.canRaise;
    el('btn-bet').textContent = legal.canCall ? 'Raise ▸' : 'Bet ▸';

    const showBet = legal.canRaise;
    el('bet-controls').style.display = showBet ? 'flex' : 'none';
    if (showBet) {
      const slider = el('bet-slider');
      const box = el('bet-amount');
      slider.min = legal.minRaiseTo; slider.max = legal.maxRaiseTo; slider.value = legal.minRaiseTo;
      box.value = legal.minRaiseTo;
      slider.oninput = () => { box.value = slider.value; };
      box.oninput = () => { slider.value = box.value; };
      const setTarget = (t) => {
        const c = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(t)));
        slider.value = c; box.value = c;
      };
      el('btn-half-pot').onclick = () => setTarget(legal.callAmount + pot * 0.5);
      el('btn-3q-pot').onclick = () => setTarget(legal.callAmount + pot * 0.75);
      el('btn-pot').onclick = () => setTarget(legal.callAmount + pot);
      el('btn-allin').onclick = () => submitHumanAction('allin');
    }

    el('btn-fold').onclick = () => submitHumanAction('fold');
    el('btn-check').onclick = () => submitHumanAction('check');
    el('btn-call').onclick = () => submitHumanAction('call');
    el('btn-bet').onclick = () => submitHumanAction(legal.canCall ? 'raise' : 'bet', Number(el('bet-amount').value));
  }

  function submitHumanAction(action, amount) {
    if (!game || game.lastResult || game.currentActorSeat() !== HUMAN_SEAT) return; // guard stray/double taps
    // Hide the dock before anything async runs so a double-tap can't act twice.
    el('action-dock').style.display = 'none';
    if (pendingAdvice) {
      const rec = pendingAdvice.advice.action;
      const matched = action === rec ||
        (['bet', 'raise', 'allin'].includes(action) && ['bet', 'raise'].includes(rec));
      lastDecision = {
        matched,
        chosenLabel: ACTION_LABEL[action],
        recLabel: ACTION_LABEL[rec] || rec,
        street: pendingAdvice.street,
      };
      stats = recordDecision(stats, { street: pendingAdvice.street, matched });
      renderStats();
    }
    const legal = game.legalActionsFor(HUMAN_SEAT);
    game.act(HUMAN_SEAT, action, amount);
    const s = game.seats[HUMAN_SEAT];
    const bubbleLabel =
      action === 'fold' ? 'Folds' :
      action === 'check' ? 'Checks' :
      action === 'call' ? `Calls $${legal.callAmount}` :
      s.allIn ? `All-in $${s.committedRound}` :
      action === 'bet' ? `Bets $${s.committedRound}` : `Raises to $${s.committedRound}`;
    setBubble(HUMAN_SEAT, s.allIn && action !== 'fold' ? 'allin' : action, bubbleLabel);
    advance();
  }

  /* ---------------- Coach panel ---------------- */

  function renderCoach(advice) {
    if (!coachEnabled) return;
    const recLabel = ACTION_LABEL[advice.action] || advice.action;
    let fb = '';
    if (lastDecision) {
      const cls = lastDecision.matched ? 'good' : 'bad';
      const txt = lastDecision.matched
        ? `Last: ${lastDecision.chosenLabel} ✓`
        : `Last: ${lastDecision.chosenLabel} ✗ (rec ${lastDecision.recLabel})`;
      fb = `<div class="feedback"><span class="verdict ${cls}">${txt}</span></div>`;
    }
    el('coach-content').innerHTML =
      `<span class="verdict rec">Recommend: ${recLabel}</span>` +
      `<div class="reason">${advice.reason}</div>${fb}`;
  }

  function renderCoachIdle() {
    if (!coachEnabled) return;
    if (lastDecision) {
      const cls = lastDecision.matched ? 'good' : 'bad';
      const txt = lastDecision.matched
        ? `${lastDecision.chosenLabel} — matched basic strategy ✓`
        : `${lastDecision.chosenLabel} — deviated from ${lastDecision.recLabel} ✗`;
      el('coach-content').innerHTML = `<span class="verdict ${cls}">${txt}</span><div class="reason">Deal the next hand to continue.</div>`;
    } else {
      el('coach-content').innerHTML = '<span class="reason">You folded or the hand played out without a decision from you.</span>';
    }
  }

  /* ---------------- Outs / equity ---------------- */

  function renderOuts(human, legal, pot) {
    const board = game.board;
    const c = el('outs-content');
    if (board.length === 0) {
      const score = chenScore(human.holeCards[0], human.holeCards[1]);
      const tier = score >= 9 ? 'good' : score >= 5 ? 'gold' : 'bad';
      c.innerHTML =
        `<span class="k">Chen score</span><span class="v ${tier}">${score}</span>` +
        `<span class="k">Position</span><span class="v">${game.roles[HUMAN_SEAT]}</span>` +
        `<span class="k">Hand</span><span class="v">${holeLabel(human.holeCards)}</span>`;
      return;
    }
    if (board.length >= 5) {
      const best = evaluateBest([...human.holeCards, ...board]);
      c.innerHTML = `<span class="k">Made hand</span><span class="v gold">${describeScore(best.score)}</span>`;
      return;
    }
    const { outs, cardsToCome } = countOuts(human.holeCards, board);
    const equity = equityFromOuts(outs, cardsToCome);
    const oddsNeeded = potOddsPercent(legal.callAmount, pot);
    const facing = legal.callAmount > 0;
    const priceOk = equity >= oddsNeeded;
    c.innerHTML =
      `<span class="k">Outs</span><span class="v gold">${outs}</span>` +
      `<span class="k">Equity (Rule of ${cardsToCome === 2 ? '4' : '2'})</span><span class="v">${equity}%</span>` +
      `<div class="meter equity"><span style="width:${Math.min(equity, 100)}%"></span></div>` +
      `<span class="k">Pot odds needed</span><span class="v">${facing ? oddsNeeded.toFixed(1) + '%' : '—'}</span>` +
      `<span class="k">Correct price?</span><span class="v ${facing ? (priceOk ? 'good' : 'bad') : ''}">${facing ? (priceOk ? 'Yes ✓' : 'No ✗') : '—'}</span>`;
  }

  function holeLabel(cards) {
    const RL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' };
    const lbl = (r) => RL[r] || String(r);
    const [a, b] = [...cards].sort((x, y) => y.rank - x.rank);
    if (a.rank === b.rank) return lbl(a.rank) + lbl(b.rank);
    return lbl(a.rank) + lbl(b.rank) + (a.suit === b.suit ? 's' : 'o');
  }

  /* ---------------- Table render ---------------- */

  // Rendering is delegated to the persistent Table controller (js/table.js),
  // which mutates a stable DOM in place (3D card flips, chip flight, tweened
  // stacks) instead of rebuilding the table every action. This function only
  // marshals state and updates the lightweight text panels; any error is
  // contained so a render hiccup can never freeze the game loop.
  function render() {
    if (!game) return;
    let state;
    try { state = game.getPublicState(); } catch (e) { console.error('state error', e); return; }
    try {
      Table.update(state, { thinkingSeat, bubbles, bubbleTTL: BUBBLE_TTL });
    } catch (e) { console.error('table render error', e); }
    try {
      el('street-label').textContent =
        `${state.venue.split('—')[0].trim()} · ${state.stakeLabel.split(' ')[0]} · ${state.street.toUpperCase()}`;
      const log = el('log-content');
      log.innerHTML = state.log.map((l) => `<div>${l}</div>`).join('');
      log.scrollTop = log.scrollHeight;
      renderStats();
    } catch (e) { console.error('panel render error', e); }
  }

  function renderStats() {
    const pct = (m, d) => (d ? Math.round((100 * m) / d) : 0);
    const overall = pct(stats.decisionsMatched, stats.decisionsTracked);
    const net = Math.round(stats.netWon);
    const netCls = net > 0 ? 'good' : net < 0 ? 'bad' : '';
    const luck = Math.round(stats.luckTotal || 0);
    const luckCls = luck > 0 ? 'good' : luck < 0 ? 'bad' : '';
    const luckRow = stats.showdownsSeen
      ? `<span class="k">Variance (${stats.showdownsSeen} showdown${stats.showdownsSeen === 1 ? '' : 's'})</span>` +
        `<span class="v ${luckCls}">${luck >= 0 ? '+' : '-'}$${Math.abs(luck)}</span>`
      : `<span class="k">Variance</span><span class="v">— (no showdowns yet)</span>`;
    el('stats-content').innerHTML =
      `<span class="k">Hands played</span><span class="v">${stats.handsPlayed}</span>` +
      `<span class="k">Net result</span><span class="v ${netCls}">${net >= 0 ? '+' : '-'}$${Math.abs(net)}</span>` +
      `<span class="k">Strategy match</span><span class="v gold">${overall}%</span>` +
      `<div class="meter"><span style="width:${overall}%"></span></div>` +
      `<span class="k">Preflop</span><span class="v">${pct(stats.preflopMatched, stats.preflopDecisions)}%</span>` +
      `<span class="k">Postflop</span><span class="v">${pct(stats.postflopMatched, stats.postflopDecisions)}%</span>` +
      luckRow;
  }

  el('reset-stats-btn').addEventListener('click', () => { stats = resetStats(); renderStats(); });

  el('speed-btn').addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    try { localStorage.setItem('pokertrainer.speed', speedIdx); } catch (e) { /* private mode */ }
    el('speed-btn').textContent = SPEEDS[speedIdx].label;
  });

  /* ---------------- Init ---------------- */
  el('speed-btn').textContent = SPEEDS[speedIdx].label;
  populateStakes();
  renderStats();
})();
