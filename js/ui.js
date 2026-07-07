(function () {
  const HUMAN_SEAT = 0;
  let game = null;
  let stats = loadStats();
  let pendingAdvice = null;   // { street, advice } for the current human decision
  let lastDecision = null;    // { matched, chosenLabel, recLabel, street } after the human acts
  let preHandHumanStack = 0;
  let vpipCountedThisHand = false; // ensures VPIP counts at most once per hand
  let coachEnabled = true;

  const el = (id) => document.getElementById(id);
  const ACTION_LABEL = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', allin: 'All-In' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Fun default seat name: a random Dragon Ball / Naruto character.
  const HERO_NAMES = [
    'Goku', 'Vegeta', 'Gohan', 'Piccolo', 'Trunks', 'Krillin', 'Frieza', 'Cell',
    'Beerus', 'Gotenks', 'Broly', 'Roshi', 'Bulma', 'Majin Buu',
    'Naruto', 'Sasuke', 'Sakura', 'Kakashi', 'Itachi', 'Gaara', 'Hinata',
    'Jiraiya', 'Rock Lee', 'Shikamaru', 'Madara', 'Minato', 'Tsunade', 'Obito',
  ];
  const randomHero = () => HERO_NAMES[Math.floor(Math.random() * HERO_NAMES.length)];

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
      el('genie-fab-wrap').style.display = coachEnabled ? '' : 'none';
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
    vpipCountedThisHand = false;
    stats = recordHandDealt(stats);
    bubbles = {};
    thinkingSeat = null;
    // Populate the strength meter + "this hand" analytics the moment cards
    // are dealt (not only when it's your turn), so you can read your spot as
    // the action folds around to you.
    try { previewHand(); if (coachEnabled) { genieReset(); genieSay('New hand dealt. I\'ll weigh in when it\'s your move. 🪄'); } } catch (e) { console.error(e); }
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
    // Showdown reached by the human (didn't fold): track win rate at showdown.
    if (r.showdown && !game.seats[HUMAN_SEAT].folded) {
      const humanWon = r.pots.some((pp) => pp.winners.includes(HUMAN_SEAT));
      stats = recordShowdownResult(stats, humanWon);
    }
    renderStats();
    genieWrapUp(net, r);
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

    renderStrength(human, legal, pot);
    genieAdvise(advice, human, legal, pot);
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
    el('btn-call').innerHTML = legal.canCall ? `<span class="ba-ic">🪙</span>Call $${legal.callAmount}` : `<span class="ba-ic">🪙</span>Call`;
    el('btn-bet').disabled = !legal.canRaise;
    el('btn-bet').innerHTML = legal.canCall ? `<span class="ba-ic">⬆</span>Raise` : `<span class="ba-ic">⬆</span>Bet`;

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
    // Session texture (independent of the coach): betting aggression + VPIP.
    if (action === 'call') stats = recordAggression(stats, false);
    else if (action === 'bet' || action === 'raise' || action === 'allin') stats = recordAggression(stats, true);
    const preflop = game.board.length === 0;
    if (preflop && !vpipCountedThisHand &&
        (action === 'call' || action === 'bet' || action === 'raise' || action === 'allin')) {
      vpipCountedThisHand = true;
      stats = recordVPIP(stats);
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

  /* ---------------- Hand-strength meter ---------------- */

  function opponentsInHand() {
    // players still live besides the human
    return Math.max(1, game.playersInHand().filter((s) => s.seat !== HUMAN_SEAT).length);
  }

  function strengthTier(pct) {
    if (pct >= 0.80) return { name: 'Monster', cls: 'monster' };
    if (pct >= 0.62) return { name: 'Strong', cls: 'strong' };
    if (pct >= 0.45) return { name: 'Ahead', cls: 'ahead' };
    if (pct >= 0.30) return { name: 'Marginal', cls: 'marginal' };
    return { name: 'Weak', cls: 'weak' };
  }

  let lastStrength = null; // cached for the genie's "win%" follow-up

  function renderStrength(human, legal, pot) {
    const opps = opponentsInHand();
    let s;
    try {
      s = handStrength(human.holeCards, game.board, opps, 320);
    } catch (e) { console.error(e); return; }
    lastStrength = { pct: s.equity, opps };
    const pct = Math.round(s.equity * 100);
    const tier = strengthTier(s.equity);
    el('strength-pct').textContent = `${pct}%`;
    const tierEl = el('strength-tier');
    tierEl.textContent = tier.name;
    tierEl.className = `strength-tier ${tier.cls}`;
    const fill = el('strength-fill');
    fill.style.width = `${pct}%`;
    fill.className = tier.cls;
    const made = game.board.length >= 3 ? describeScore(evaluateBest([...human.holeCards, ...game.board]).score) : holeLabel(human.holeCards);
    el('strength-sub').textContent = `${made} — win odds vs ${opps} opponent${opps === 1 ? '' : 's'} still in the hand`;
  }

  // Fill the strength meter + "this hand" analytics from the freshly dealt
  // hole cards, before any betting action (a neutral no-bet context so the
  // pot-odds row reads "—" until you actually face a bet).
  function previewHand() {
    const human = game.seats[HUMAN_SEAT];
    if (!human || !human.holeCards) { resetStrength(); return; }
    const noBet = { callAmount: 0, canCheck: true, canCall: false, canRaise: false };
    const pot = game.potTotal();
    renderStrength(human, noBet, pot);
    renderOuts(human, noBet, pot);
  }

  function resetStrength() {
    lastStrength = null;
    el('strength-pct').textContent = '—';
    el('strength-tier').textContent = '';
    el('strength-tier').className = 'strength-tier';
    el('strength-fill').style.width = '0%';
    el('strength-sub').textContent = 'Dealing…';
  }

  /* ---------------- Genie assistant (explains the WHY) ---------------- */

  const POS_NAME = { UTG: 'under the gun', UTG1: 'UTG+1', HJ: 'the hijack', CO: 'the cutoff', BTN: 'the button', SB: 'the small blind', BB: 'the big blind' };
  const POS_WHY = {
    UTG: 'you act first with the whole table still to respond, so only premium hands are safe here',
    UTG1: 'you\'re still early with most players left to act, so keep the range tight',
    HJ: 'you\'re nearing the button and fewer players remain, so you can open things up a little',
    CO: 'only the button acts after you, so you can play a wider, more aggressive range',
    BTN: 'you act last on every street after the flop — the best seat at the table — so you can play the widest range',
    SB: 'you\'ll be out of position for the rest of the hand, so be a touch more selective',
    BB: 'you already have a blind invested and you close the action, so you can defend fairly wide',
  };
  const ACT_VERB = { fold: 'fold', check: 'check', call: 'call', bet: 'bet', raise: 'raise' };

  let genieCtx = null; // context for follow-up questions

  function genieReset() {
    const log = el('genie-log');
    if (log) log.innerHTML = '';
    const acts = el('genie-actions');
    if (acts) acts.innerHTML = '';
  }

  function genieSay(html, opts) {
    opts = opts || {};
    const log = el('genie-log');
    if (!log) return;
    const row = document.createElement('div');
    row.className = 'g-msg' + (opts.user ? ' user' : '');
    row.innerHTML = opts.user
      ? `<div class="g-bubble user">${html}</div>`
      : `<div class="g-ava">🧞</div><div class="g-bubble">${html}</div>`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    // A genie message the player can't see yet => flash the floating icon.
    if (!opts.user && !genieOpen) flashGenie();
  }

  /* ---- floating Genie icon (flashes on new advice, opens a card on tap) ---- */
  let genieOpen = false;

  function flashGenie() {
    const wrap = el('genie-fab-wrap');
    const dot = el('genie-dot');
    if (wrap) wrap.classList.add('has-news');
    if (dot) dot.hidden = false;
  }
  function clearGenieFlash() {
    const wrap = el('genie-fab-wrap');
    const dot = el('genie-dot');
    if (wrap) wrap.classList.remove('has-news');
    if (dot) dot.hidden = true;
  }
  function setGenieOpen(open) {
    genieOpen = open;
    const card = el('genie-card');
    const wrap = el('genie-fab-wrap');
    if (card) card.hidden = !open;
    if (wrap) wrap.classList.toggle('open', open);
    if (open) {
      clearGenieFlash();
      const log = el('genie-log');
      if (log) log.scrollTop = log.scrollHeight;
    }
  }

  function genieChips(chips) {
    const acts = el('genie-actions');
    if (!acts) return;
    acts.innerHTML = '';
    for (const c of chips) {
      const b = document.createElement('button');
      b.className = 'g-chip';
      b.textContent = c.label;
      b.addEventListener('click', () => { genieSay(c.label, { user: true }); genieFollowup(c.key); });
      acts.appendChild(b);
    }
  }

  function preflopTier(score) {
    if (score >= 15) return 'a premium holding — top of the range';
    if (score >= 10) return 'a strong hand';
    if (score >= 7) return 'a solid, playable hand';
    if (score >= 5) return 'a marginal, speculative hand';
    return 'a weak hand';
  }

  function genieAdvise(advice, human, legal, pot) {
    if (!coachEnabled) return;
    genieReset();
    const rec = ACT_VERB[advice.action] || advice.action;
    const preflop = game.board.length === 0;

    if (preflop) {
      const bd = chenBreakdown(human.holeCards[0], human.holeCards[1]);
      const pos = game.roles[HUMAN_SEAT];
      const t = PREFLOP_THRESHOLDS[pos];
      genieCtx = { phase: 'preflop', advice, bd, pos, legal, pot, human };
      genieSay(`I'd <b>${rec}</b> here.`);
      const clears = advice.action === 'raise' || advice.action === 'call';
      const need = t.open;
      genieSay(
        `${holeLabel(human.holeCards)} is <b>${preflopTier(bd.score)}</b> — it scores <b>${bd.score}</b> on the Chen scale. ` +
        `From ${POS_NAME[pos]} you'd want about <b>${need}+</b> to come in, and ` +
        (clears
          ? `your ${bd.score} ${bd.score >= need ? 'clears that comfortably' : 'is close enough with the dead money out there'}, so it's worth playing.`
          : `your ${bd.score} falls short, so the disciplined play is to let it go.`)
      );
      genieChips([
        { label: 'Break down the score', key: 'chen' },
        { label: 'Why does position matter?', key: 'position' },
        { label: 'What are my win odds?', key: 'winpct' },
      ]);
    } else {
      const madeScore = evaluateBest([...human.holeCards, ...game.board]).score;
      const made = describeScore(madeScore);
      const { outs, cardsToCome } = countOuts(human.holeCards, game.board);
      const equity = cardsToCome ? equityFromOuts(outs, cardsToCome) : null;
      const oddsNeeded = potOddsPercent(legal.callAmount, pot);
      genieCtx = { phase: 'postflop', advice, made, outs, cardsToCome, equity, oddsNeeded, legal, pot, human };
      genieSay(`I'd <b>${rec}</b> here.`);
      if (legal.callAmount > 0 && outs > 0 && equity != null && madeScore[0] <= 1) {
        genieSay(
          `You've got <b>${made}</b> but you're drawing. I count <b>${outs} outs</b> ≈ <b>${equity}% equity</b>, ` +
          `and the pot is asking you to be good <b>${oddsNeeded.toFixed(0)}%</b> of the time. ` +
          (equity >= oddsNeeded
            ? `Your equity beats the price, so continuing is profitable.`
            : `That's more than your draw is worth, so folding is the disciplined play (unless you expect big future payouts).`)
        );
        genieChips([{ label: 'Show the pot-odds math', key: 'potodds' }, { label: 'What are my outs?', key: 'outs' }, { label: 'My win %?', key: 'winpct' }]);
      } else if (madeScore[0] >= 2) {
        genieSay(
          `You've made <b>${made}</b> — that's ahead of most of what your opponents are holding here. ` +
          (advice.action === 'raise' || advice.action === 'bet'
            ? `Betting builds the pot and charges draws that would love a free card.`
            : `Keep control of the pot and get value where you can.`)
        );
        genieChips([{ label: 'Why bet now?', key: 'value' }, { label: 'My win %?', key: 'winpct' }]);
      } else {
        genieSay(
          `You've only got <b>${made}</b> with no real draw. ` +
          (advice.action === 'check' ? `No need to put money in — take the free card and re-evaluate.` : `There's not enough here to keep calling bets, so let it go.`)
        );
        genieChips([{ label: 'My win %?', key: 'winpct' }, { label: 'What are outs?', key: 'outs' }]);
      }
    }
  }

  function genieFollowup(key) {
    const c = genieCtx;
    if (!c) return;
    if (key === 'chen' && c.bd) {
      const parts = c.bd.steps.map((s) => `${s.label}: <b>${s.value > 0 ? '+' : ''}${s.value}</b>`).join(' &nbsp;·&nbsp; ');
      genieSay(`Here's the Chen math for ${holeLabel(c.human.holeCards)}:<br>${parts}<br>Total ≈ <b>${c.bd.score}</b>. The formula rewards high cards, pairs (doubled), suitedness and connectedness — everything that makes a hand win more often or make the nuts.`);
    } else if (key === 'position') {
      genieSay(`Position is leverage: ${POS_WHY[c.pos]}. Acting later means you see what everyone else does before you commit chips, so the same hand is worth more the closer you are to the button — which is exactly why the threshold to play loosens as you move around the table.`);
    } else if (key === 'winpct') {
      const s = lastStrength;
      if (s) genieSay(`Right now you'll win about <b>${Math.round(s.pct * 100)}%</b> of the time against ${s.opps} random opponent${s.opps === 1 ? '' : 's'} still in the hand (Monte-Carlo estimate over hundreds of simulated run-outs). The strength bar up top tracks this live as the board develops.`);
      else genieSay(`Once it's your turn I'll simulate your live win odds against the field.`);
    } else if (key === 'potodds' && c.oddsNeeded != null) {
      const call = c.legal.callAmount;
      genieSay(`Pot odds = call ÷ (pot + call) = $${call} ÷ ($${Math.round(c.pot)} + $${call}) = <b>${c.oddsNeeded.toFixed(1)}%</b>. That's the share of the time you need to win to break even on the call. Your ~${c.equity}% equity ${c.equity >= c.oddsNeeded ? 'exceeds' : 'falls short of'} that, which is why ${c.equity >= c.oddsNeeded ? 'calling is +EV' : 'folding is correct on price alone'}.`);
    } else if (key === 'outs') {
      if (c.outs > 0) genieSay(`You have <b>${c.outs} outs</b> — cards left in the deck that improve you to (likely) the best hand. With ${c.cardsToCome} card${c.cardsToCome === 1 ? '' : 's'} to come, the Rule of ${c.cardsToCome === 2 ? '4' : '2'} puts you around <b>${c.equity}%</b> to get there.`);
      else genieSay(`No clean outs to a clearly-best hand here — your equity comes mostly from what you've already made.`);
    } else if (key === 'value') {
      genieSay(`With a hand this strong you want money going in while you're ahead. Betting gets value from worse hands that call, and it charges flush/straight draws that would happily take a free card and outdraw you. Checking here just lets the pot stay small and gives free equity away.`);
    }
  }

  function genieWrapUp(net, result) {
    if (!coachEnabled) return;
    const acts = el('genie-actions');
    if (acts) acts.innerHTML = '';
    if (lastDecision) {
      if (lastDecision.matched) genieSay(`Nice — your <b>${lastDecision.chosenLabel}</b> matched the book play. ✅`);
      else genieSay(`You chose <b>${lastDecision.chosenLabel}</b>; the textbook line was <b>${lastDecision.recLabel}</b>. Not always wrong, but worth noting. 🤔`);
    }
    if (result && result.showdown && result.variance && result.variance[HUMAN_SEAT]) {
      const v = result.variance[HUMAN_SEAT];
      if (v.luckDelta > 1) genieSay(`You ran <b>hotter</b> than your equity by about $${Math.round(v.luckDelta)} that hand — variance in your favour.`);
      else if (v.luckDelta < -1) genieSay(`You ran <b>colder</b> than your equity by about $${Math.round(Math.abs(v.luckDelta))} — a cooler, not a misplay.`);
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
    const madeNow = describeScore(evaluateBest([...human.holeCards, ...board]).score);
    const { outs, cardsToCome } = countOuts(human.holeCards, board);
    const groups = describeOuts(human.holeCards, board);
    const equity = equityFromOuts(outs, cardsToCome);
    const oddsNeeded = potOddsPercent(legal.callAmount, pot);
    const facing = legal.callAmount > 0;
    const priceOk = equity >= oddsNeeded;
    c.innerHTML =
      `<span class="k">Made now</span><span class="v">${madeNow}</span>` +
      `<span class="k">Outs</span><span class="v gold">${outs}</span>` +
      outsBreakdownHTML(groups) +
      `<span class="k">Equity (Rule of ${cardsToCome === 2 ? '4' : '2'})</span><span class="v">${equity}%</span>` +
      `<div class="meter equity"><span style="width:${Math.min(equity, 100)}%"></span></div>` +
      `<span class="k">Pot odds needed</span><span class="v">${facing ? oddsNeeded.toFixed(1) + '%' : '—'}</span>` +
      `<span class="k">Correct price?</span><span class="v ${facing ? (priceOk ? 'good' : 'bad') : ''}">${facing ? (priceOk ? 'Yes ✓' : 'No ✗') : '—'}</span>`;
  }

  // The actual out cards, grouped by what they make, as a compact chip row.
  function outsBreakdownHTML(groups) {
    if (!groups || !groups.length) {
      return `<div class="outs-break outs-none">No category-upgrading outs — your equity is what you've already made.</div>`;
    }
    const cardChip = (card) => {
      const red = card.suit === 'h' || card.suit === 'd';
      return `<span class="ocard${red ? ' red' : ''}">${rankLabel(card.rank)}${SUIT_SYMBOL[card.suit]}</span>`;
    };
    return `<div class="outs-break">` + groups.map((g) =>
      `<div class="outs-group">` +
        `<span class="og-label">${g.makes} <b>×${g.cards.length}</b></span>` +
        `<span class="og-cards">${g.cards.map(cardChip).join('')}</span>` +
      `</div>`
    ).join('') + `</div>`;
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
    const hands = stats.handsPlayed;
    const net = Math.round(stats.netWon);
    const netCls = net > 0 ? 'good' : net < 0 ? 'bad' : '';

    // $/hand — the honest "are you beating the game" number.
    const perHand = hands ? stats.netWon / hands : 0;
    const perHandStr = hands ? `${perHand >= 0 ? '+' : '-'}$${Math.abs(perHand).toFixed(1)}` : '—';
    const perHandCls = hands ? (perHand > 0 ? 'good' : perHand < 0 ? 'bad' : '') : '';

    const winRate = hands ? pct(stats.handsWon, hands) : null;
    const sdWin = stats.showdownsPlayed ? pct(stats.showdownsWon, stats.showdownsPlayed) : null;
    // Denominator is hands DEALT (includes the live hand) so VPIP is a true
    // share and never exceeds 100% mid-hand.
    const vpipDenom = stats.handsDealt || hands;
    const vpip = vpipDenom ? Math.min(100, pct(stats.vpipHands, vpipDenom)) : null;

    // Aggression factor = (bets+raises) / calls, the classic tracker stat.
    const af = stats.passiveActions
      ? (stats.aggressiveActions / stats.passiveActions)
      : (stats.aggressiveActions ? Infinity : null);
    const afStr = af == null ? '—' : af === Infinity ? '∞' : af.toFixed(1);

    const luck = Math.round(stats.luckTotal || 0);
    const luckCls = luck > 0 ? 'good' : luck < 0 ? 'bad' : '';
    const luckRow = stats.showdownsSeen
      ? `<span class="k">Variance (${stats.showdownsSeen} showdown${stats.showdownsSeen === 1 ? '' : 's'})</span>` +
        `<span class="v ${luckCls}">${luck >= 0 ? '+' : '-'}$${Math.abs(luck)}</span>`
      : `<span class="k">Variance</span><span class="v">— (no showdowns yet)</span>`;

    const row = (k, v, cls = '') => `<span class="k">${k}</span><span class="v ${cls}">${v}</span>`;
    el('stats-content').innerHTML =
      row('Hands played', hands) +
      row('Net result', `${net >= 0 ? '+' : '-'}$${Math.abs(net)}`, netCls) +
      row('Per hand', perHandStr, perHandCls) +
      row('Best pot won', stats.bestWon > 0 ? `+$${Math.round(stats.bestWon)}` : '—') +
      row('Hands won', winRate == null ? '—' : `${winRate}%`) +
      row('Showdown win', sdWin == null ? '—' : `${sdWin}% (${stats.showdownsWon}/${stats.showdownsPlayed})`) +
      row('VPIP', vpip == null ? '—' : `${vpip}%`) +
      row('Aggression', afStr) +
      luckRow +
      `<span class="k">Strategy match</span><span class="v gold">${overall}%</span>` +
      `<div class="meter"><span style="width:${overall}%"></span></div>` +
      row('Preflop', `${pct(stats.preflopMatched, stats.preflopDecisions)}%`) +
      row('Postflop', `${pct(stats.postflopMatched, stats.postflopDecisions)}%`);
  }

  el('reset-stats-btn').addEventListener('click', () => { stats = resetStats(); renderStats(); });

  el('speed-btn').addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    try { localStorage.setItem('pokertrainer.speed', speedIdx); } catch (e) { /* private mode */ }
    el('speed-btn').textContent = SPEEDS[speedIdx].label;
  });

  // random hero name (Dragon Ball / Naruto), re-rollable with the 🎲 button
  const nameInput = el('name-input');
  if (nameInput) nameInput.value = randomHero();
  const shuffleBtn = el('name-shuffle');
  if (shuffleBtn) shuffleBtn.addEventListener('click', () => { if (nameInput) nameInput.value = randomHero(); });

  // floating Genie open/close
  const fab = el('genie-fab');
  if (fab) fab.addEventListener('click', (e) => { e.stopPropagation(); setGenieOpen(!genieOpen); });
  const genieClose = el('genie-close');
  if (genieClose) genieClose.addEventListener('click', (e) => { e.stopPropagation(); setGenieOpen(false); });
  // tap outside the card (but not on the FAB) closes it
  document.addEventListener('click', (e) => {
    if (!genieOpen) return;
    const wrap = el('genie-fab-wrap');
    if (wrap && !wrap.contains(e.target)) setGenieOpen(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && genieOpen) setGenieOpen(false); });

  /* ---------------- Init ---------------- */
  el('speed-btn').textContent = SPEEDS[speedIdx].label;
  populateStakes();
  renderStats();
})();
