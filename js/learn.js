/* Interactive Learn Lab: range chart, pot-odds calculator, preflop quiz.
   Depends on cards.js, strategy.js, render.js (all loaded first). */
(function () {
  const el = (id) => document.getElementById(id);
  const RANKS = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  const RL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' };
  const rl = (r) => RL[r] || String(r);

  /* Chen-score → color bucket */
  const BUCKETS = [
    { min: 15, name: 'Premium (15+)', bg: '#e7c45a', fg: '#1a1206' },
    { min: 10, name: 'Strong (10–14)', bg: '#56c877', fg: '#07160c' },
    { min: 7, name: 'Playable (7–9)', bg: '#3fa8d8', fg: '#04141c' },
    { min: 5, name: 'Marginal (5–6)', bg: '#69788f', fg: '#0b0f16' },
    { min: -99, name: 'Weak (<5)', bg: '#7c4a52', fg: '#f2dede' },
  ];
  const bucketFor = (score) => BUCKETS.find((b) => score >= b.min);

  function cardsForCell(i, j) {
    const hi = RANKS[Math.min(i, j)];
    const lo = RANKS[Math.max(i, j)];
    if (i === j) return [new Card(hi, 's'), new Card(hi, 'h')];       // pair
    if (i < j) return [new Card(hi, 's'), new Card(lo, 's')];         // suited (upper-right)
    return [new Card(hi, 's'), new Card(lo, 'h')];                    // offsuit (lower-left)
  }
  function handLabel(i, j) {
    const hi = RANKS[Math.min(i, j)];
    const lo = RANKS[Math.max(i, j)];
    if (i === j) return rl(hi) + rl(hi);
    return rl(hi) + rl(lo) + (i < j ? 's' : 'o');
  }
  function handType(i, j) {
    if (i === j) return 'Pocket pair';
    return i < j ? 'Suited' : 'Offsuit';
  }

  /* ---------- Range chart ---------- */
  function buildRangeChart() {
    const grid = el('range-grid');
    let html = '';
    for (let i = 0; i < 13; i++) {
      for (let j = 0; j < 13; j++) {
        const [a, b] = cardsForCell(i, j);
        const score = chenScore(a, b);
        const bk = bucketFor(score);
        html += `<div class="range-cell" data-i="${i}" data-j="${j}" ` +
          `style="background:${bk.bg};color:${bk.fg}">${handLabel(i, j)}</div>`;
      }
    }
    grid.innerHTML = html;

    el('range-legend').innerHTML = BUCKETS.map((b) =>
      `<span class="lg"><span class="sw" style="background:${b.bg}"></span>${b.name}</span>`).join('');

    const cells = grid.querySelectorAll('.range-cell');
    const show = (cell) => {
      cells.forEach((c) => c.classList.remove('sel'));
      cell.classList.add('sel');
      const i = +cell.dataset.i, j = +cell.dataset.j;
      const [a, b] = cardsForCell(i, j);
      const score = chenScore(a, b);
      const openable = POSITIONS_7MAX.filter((p) => p !== 'BB' && score >= PREFLOP_THRESHOLDS[p].open);
      const openTxt = openable.length ? openable.join(', ') : 'None — too weak to open';
      el('range-detail').innerHTML =
        `<div class="hand-title">${handLabel(i, j)} <span class="suited">${handType(i, j)}</span></div>` +
        `<div class="rd-metrics">` +
        `<div><div class="k">Chen score</div><div class="v" style="color:${bucketFor(score).bg}">${score}</div></div>` +
        `<div><div class="k">Tier</div><div class="v">${bucketFor(score).name.split(' (')[0]}</div></div>` +
        `<div><div class="k">Can open-raise from</div><div class="v">${openTxt}</div></div>` +
        `</div>`;
    };
    cells.forEach((c) => {
      c.addEventListener('mouseenter', () => show(c));
      c.addEventListener('click', () => show(c));
    });
  }

  /* ---------- Pot-odds / outs calculator ---------- */
  const DRAWS = [
    { label: 'Flush draw', outs: 9 },
    { label: 'Open-ended straight', outs: 8 },
    { label: 'Flush + gutshot', outs: 12 },
    { label: 'Gutshot', outs: 4 },
    { label: 'Two overcards', outs: 6 },
    { label: 'Set → boat/quads', outs: 10 },
    { label: 'Pair → trips', outs: 2 },
  ];
  function buildCalc() {
    el('draw-presets').innerHTML = DRAWS.map((d, k) =>
      `<span class="outs-chip" data-outs="${d.outs}" data-k="${k}">${d.label} · ${d.outs}</span>`).join('');
    el('draw-presets').querySelectorAll('.outs-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        el('calc-outs').value = chip.dataset.outs;
        recalc();
      });
    });
    ['calc-outs', 'calc-street', 'calc-pot', 'calc-call'].forEach((id) =>
      el(id).addEventListener('input', recalc));
    recalc();
  }
  function recalc() {
    const outs = Math.max(0, Math.min(20, Number(el('calc-outs').value) || 0));
    const cardsToCome = Number(el('calc-street').value);
    const pot = Math.max(0, Number(el('calc-pot').value) || 0);
    const call = Math.max(0, Number(el('calc-call').value) || 0);

    const equity = equityFromOuts(outs, cardsToCome);
    const needed = potOddsPercent(call, pot);
    const ratio = call > 0 ? (pot / call).toFixed(1) + ' : 1' : '—';

    // sync active chip highlight
    el('draw-presets').querySelectorAll('.outs-chip').forEach((c) =>
      c.classList.toggle('on', Number(c.dataset.outs) === outs));

    el('calc-out').innerHTML =
      `<div class="calc-tile"><div class="ct-val" style="color:var(--good)">${equity}%</div><div class="ct-label">Your equity</div></div>` +
      `<div class="calc-tile"><div class="ct-val" style="color:var(--accent)">${call > 0 ? needed.toFixed(1) + '%' : '—'}</div><div class="ct-label">Equity needed</div></div>` +
      `<div class="calc-tile"><div class="ct-val">${ratio}</div><div class="ct-label">Pot is laying</div></div>`;

    const v = el('calc-verdict');
    if (call <= 0) {
      v.className = 'calc-verdict call';
      v.textContent = 'No bet to call — take the free card and see the next one.';
    } else if (equity >= needed) {
      v.className = 'calc-verdict call';
      v.textContent = `✓ Profitable call — ${equity}% equity beats the ${needed.toFixed(1)}% the pot demands.`;
    } else {
      v.className = 'calc-verdict fold';
      v.textContent = `✗ Fold on price — ${equity}% equity falls short of the ${needed.toFixed(1)}% you need (unless implied odds bridge the gap).`;
    }
  }

  /* ---------- Preflop quiz ---------- */
  let quiz = { streak: 0, correct: 0, total: 0, current: null, answered: false };
  const POS_NAME = { UTG: 'Under the gun', UTG1: 'UTG+1', HJ: 'Hijack', CO: 'Cutoff', BTN: 'Button', SB: 'Small blind', BB: 'Big blind' };

  function dealQuiz() {
    const deck = new Deck();
    const holeCards = [deck.draw(), deck.draw()];
    const facingRaise = Math.random() < 0.5;
    const openPositions = ['UTG', 'UTG1', 'HJ', 'CO', 'BTN', 'SB'];
    const position = facingRaise
      ? POSITIONS_7MAX[Math.floor(Math.random() * POSITIONS_7MAX.length)]
      : openPositions[Math.floor(Math.random() * openPositions.length)];
    const numRaisesInFront = facingRaise ? 1 : 0;
    const advice = preflopAdvice({ holeCards, position, numRaisesInFront });
    quiz.current = { holeCards, position, facingRaise, numRaisesInFront, advice };
    quiz.answered = false;
    renderQuiz();
  }

  function renderQuiz() {
    const q = quiz.current;
    const situation = q.facingRaise
      ? 'A player has <b>raised</b> in front of you.'
      : 'It <b>folds to you</b> (pot unopened).';
    el('quiz-scenario').innerHTML =
      `<div class="quiz-cards"><span class="lbl">Your hand</span>` +
      q.holeCards.map((c) => cardFaceHTML(c)).join('') + `</div>` +
      `<div class="quiz-meta">` +
      `<span>Seat: <b>${POS_NAME[q.position]}</b></span>` +
      `<span>Action: <b>${q.facingRaise ? 'Facing a raise' : 'Unopened'}</b></span>` +
      `</div><div style="margin-top:0.5rem;color:var(--text-dim);font-size:0.88rem;">${situation} What's your play?</div>`;

    const options = q.facingRaise ? ['fold', 'call', 'raise'] : ['fold', 'raise'];
    const LBL = { fold: 'Fold', call: 'Call', raise: 'Raise' };
    const CLS = { fold: 'btn-fold', call: 'btn-call', raise: 'btn-bet' };
    el('quiz-actions').innerHTML = options.map((o) =>
      `<button class="btn ${CLS[o]}" data-act="${o}">${LBL[o]}</button>`).join('');
    el('quiz-actions').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => answerQuiz(b.dataset.act)));
    el('quiz-feedback').className = 'quiz-feedback';
    el('quiz-feedback').innerHTML = '';
  }

  function answerQuiz(chosen) {
    if (quiz.answered) return;
    quiz.answered = true;
    const q = quiz.current;
    // The unopened big-blind "check" case is filtered out of quiz scenarios,
    // so the recommended action here is always fold/call/raise.
    const correct = q.advice.action;
    const isRight = chosen === correct;
    quiz.total++;
    if (isRight) { quiz.correct++; quiz.streak++; } else { quiz.streak = 0; }

    const score = chenScore(q.holeCards[0], q.holeCards[1]);
    const fb = el('quiz-feedback');
    fb.className = 'quiz-feedback show ' + (isRight ? 'correct' : 'wrong');
    fb.innerHTML =
      `<div class="fb-title">${isRight ? '✓ Correct!' : `✗ Not quite — best play is ${correct.toUpperCase()}`}</div>` +
      `<div>${q.advice.reason}. Chen score <b>${score}</b> from the ${POS_NAME[q.position].toLowerCase()}.</div>` +
      `<button class="btn gold" id="quiz-next" style="margin-top:0.8rem;">Next hand ▸</button>`;
    el('quiz-next').addEventListener('click', dealQuiz);

    el('quiz-streak').textContent = quiz.streak;
    el('quiz-correct').textContent = quiz.correct;
    el('quiz-total').textContent = quiz.total;
    el('quiz-acc').textContent = quiz.total ? Math.round((100 * quiz.correct) / quiz.total) + '%' : '—';

    el('quiz-actions').querySelectorAll('button').forEach((b) => { b.disabled = true; });
  }

  /* ---------- Init ---------- */
  buildRangeChart();
  buildCalc();
  dealQuiz();
})();
