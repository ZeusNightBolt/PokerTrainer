/*
 * Persistent poker-table renderer.
 *
 * The old renderer rebuilt every seat with innerHTML on each action, so
 * nothing could transition -- stacks teleported, cards snapped, chips
 * popped (the "static website" feel). This controller builds the table DOM
 * once and then mutates it in place: cards are real 3D flip elements, chips
 * physically fly to the pot when a street closes, stacks and glows tween.
 *
 * Public API (attached to window):
 *   Table.init()                 build the DOM once
 *   Table.startHand(state)       reset for a freshly dealt hand
 *   Table.update(state, ui)      reconcile to the given public game state
 * ui = { thinkingSeat, bubbles, bubbleTTL }.
 *
 * Everything here is defensive: a bad state or a missing element degrades
 * gracefully (skips an animation) rather than throwing and freezing the game.
 */
(function () {
  const SEATS = 7;
  const HUMAN = 0;
  const AVATAR = (isHuman) => (isHuman ? '🧑' : '🤖');
  const reduce = () => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  };
  const faceInner = (card) => (typeof window !== 'undefined' && window.faceInner ? window.faceInner(card) : '');

  let built = false;
  let seatEls = [];       // per-seat element refs
  let boardSlots = [];    // 5 board card slots
  let potEl = null, boardWrap = null, wrap = null;

  // change-tracking so we only animate real transitions
  let prevHand = -1;
  let prevStreet = null;
  let prevPot = 0;
  let prevCommitted = new Array(SEATS).fill(0);
  let shownBoard = 0;
  let cardKey = {};       // slotId -> "rank+suit" currently shown face-up
  let resultHandled = false;

  /* ---------- element builders ---------- */

  function cardSlot(small) {
    const slot = document.createElement('div');
    slot.className = 'card-slot' + (small ? ' small' : '');
    const flip = document.createElement('div');
    flip.className = 'flipper';
    const front = document.createElement('div');
    front.className = 'cface front';
    const back = document.createElement('div');
    back.className = 'cface back';
    flip.appendChild(front);
    flip.appendChild(back);
    slot.appendChild(flip);
    slot._flip = flip; slot._front = front;
    return slot;
  }

  function buildSeat(i) {
    const seat = document.createElement('div');
    seat.className = `seat seat-${i}`;

    const dealer = document.createElement('div');
    dealer.className = 'dealer-chip'; dealer.textContent = 'D';
    dealer.style.display = 'none';

    const betArea = document.createElement('div');
    betArea.className = 'bet-area';
    betArea.style.display = 'none';

    const bubble = document.createElement('div');
    bubble.className = 'action-bubble';
    bubble.style.display = 'none';

    const inner = document.createElement('div');
    inner.className = 'seat-inner';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';

    const nameEl = document.createElement('div');
    nameEl.className = 'seat-name';

    const roleEl = document.createElement('div');
    roleEl.className = 'seat-role';

    const hole = document.createElement('div');
    hole.className = 'hole';
    const slotA = cardSlot(true), slotB = cardSlot(true);
    hole.appendChild(slotA); hole.appendChild(slotB);

    const stackEl = document.createElement('div');
    stackEl.className = 'seat-stack';

    const allin = document.createElement('div');
    allin.className = 'badge-allin'; allin.textContent = 'ALL-IN';
    allin.style.display = 'none';

    inner.append(avatar, nameEl, roleEl, hole, stackEl, allin);
    seat.append(dealer, betArea, bubble, inner);

    return { root: seat, inner, dealer, betArea, bubble, avatar, nameEl, roleEl, stackEl, allin, holeSlots: [slotA, slotB] };
  }

  function init() {
    if (built) return;
    wrap = document.getElementById('table-wrap');
    potEl = document.getElementById('pot-display');
    boardWrap = document.getElementById('board-cards');
    if (!wrap || !boardWrap) return;

    // board slots
    boardWrap.innerHTML = '';
    boardSlots = [];
    for (let i = 0; i < 5; i++) {
      const slot = cardSlot(false);
      slot.classList.add('board-slot', 'empty');
      boardWrap.appendChild(slot);
      boardSlots.push(slot);
    }

    // seats
    seatEls = [];
    for (let i = 0; i < SEATS; i++) {
      const s = buildSeat(i);
      wrap.appendChild(s.root);
      seatEls.push(s);
    }
    built = true;
  }

  /* ---------- card flip helpers ---------- */

  function faceUp(slot, card, deal, delayMs) {
    const key = card ? `${card.rank}${card.suit}` : '';
    if (card) slot._front.innerHTML = faceInner(card);
    slot._front.classList.toggle('red', !!(card && window.isRed && window.isRed(card.suit)));
    if (deal && !reduce()) {
      slot.classList.remove('dealing'); void slot.offsetWidth;
      slot.style.setProperty('--deal-delay', (delayMs || 0) + 'ms');
      slot.classList.add('dealing');
    }
    // flip up (after the deal-in settles, if animating)
    const doFlip = () => slot._flip.classList.add('up');
    if (deal && !reduce()) setTimeout(doFlip, (delayMs || 0) + 180); else doFlip();
    slot.classList.remove('hidden');
    slot._key = key;
  }

  function faceDown(slot, deal, delayMs) {
    slot._flip.classList.remove('up');
    slot._front.innerHTML = '';
    slot._key = '';
    slot.classList.remove('hidden');
    if (deal && !reduce()) {
      slot.classList.remove('dealing'); void slot.offsetWidth;
      slot.style.setProperty('--deal-delay', (delayMs || 0) + 'ms');
      slot.classList.add('dealing');
    }
  }

  function hideSlot(slot) {
    slot.classList.add('hidden');
    slot._flip.classList.remove('up');
    slot._front.innerHTML = '';
    slot._key = '';
  }

  /* ---------- chip flight ---------- */

  function centreOf(elm) {
    if (!elm) return null;
    const r = elm.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function flyChip(from, to, hue, delayMs) {
    if (reduce() || !from || !to) return;
    const chip = document.createElement('div');
    chip.className = 'fly-chip';
    if (hue) chip.style.setProperty('--chip-hue', hue);
    chip.style.left = from.x + 'px';
    chip.style.top = from.y + 'px';
    document.body.appendChild(chip);
    const run = () => {
      chip.style.transform = `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(0.55)`;
      chip.style.opacity = '0.15';
    };
    if (delayMs) setTimeout(() => requestAnimationFrame(run), delayMs);
    else requestAnimationFrame(run);
    setTimeout(() => chip.remove(), 640 + (delayMs || 0));
  }

  function sweepBetsToPot() {
    const pot = centreOf(potEl);
    if (!pot) return;
    for (let i = 0; i < SEATS; i++) {
      if (prevCommitted[i] > 0) {
        const from = centreOf(seatEls[i].betArea);
        const n = prevCommitted[i] >= 60 ? 3 : prevCommitted[i] >= 15 ? 2 : 1;
        for (let k = 0; k < n; k++) flyChip(from, pot, null, k * 70);
      }
    }
  }

  function bloomPotToWinners(winners) {
    const pot = centreOf(potEl);
    if (!pot) return;
    for (const w of winners) {
      const to = centreOf(seatEls[w] && seatEls[w].root);
      for (let k = 0; k < 4; k++) flyChip(pot, to, '150', k * 90);
    }
  }

  /* ---------- chip stack markup for a seat's live bet ---------- */

  function chipStack(amount) {
    const n = amount >= 200 ? 4 : amount >= 60 ? 3 : amount >= 15 ? 2 : 1;
    let html = '<span class="chip-stack">';
    for (let i = 0; i < n; i++) html += '<span class="pchip"></span>';
    return html + `</span><span class="bet-amt">$${amount}</span>`;
  }

  /* ---------- lifecycle ---------- */

  function startHand(state) {
    init();
    prevHand = state.handNumber;
    prevStreet = state.street;
    prevPot = 0;
    prevCommitted = new Array(SEATS).fill(0);
    shownBoard = 0;
    resultHandled = false;

    // clear board
    for (const slot of boardSlots) { hideSlot(slot); slot.classList.add('empty'); }

    // deal hole cards: everyone face-down, human flips up
    for (let i = 0; i < SEATS; i++) {
      const s = seatEls[i];
      const st = state.seats[i];
      const delay = i * 90;
      if (st.holeCards) faceUp(s.holeSlots[0], st.holeCards[0], true, delay);
      else faceDown(s.holeSlots[0], true, delay);
      if (st.holeCards) faceUp(s.holeSlots[1], st.holeCards[1], true, delay + 45);
      else faceDown(s.holeSlots[1], true, delay + 45);
      s.betArea.style.display = 'none';
      s.betArea.innerHTML = '';
      s.bubble.style.display = 'none';
      s.root.classList.remove('winner', 'folded', 'acting', 'thinking');
    }
  }

  function update(state, ui) {
    init();
    if (!built) return;
    ui = ui || {};

    // new hand? re-deal
    if (state.handNumber !== prevHand) startHand(state);

    // ----- pot -----
    if (potEl) {
      potEl.textContent = `Pot $${state.pot}`;
      if (state.pot > prevPot) {
        potEl.classList.remove('bump'); void potEl.offsetWidth; potEl.classList.add('bump');
      }
    }

    // ----- street change: sweep the just-closed street's bets into the pot -----
    if (state.street !== prevStreet) {
      sweepBetsToPot();
      prevCommitted = new Array(SEATS).fill(0);
      prevStreet = state.street;
    }

    // ----- board reveal -----
    for (let i = 0; i < 5; i++) {
      const slot = boardSlots[i];
      if (i < state.board.length) {
        const card = state.board[i];
        const key = `${card.rank}${card.suit}`;
        if (slot._key !== key) {
          slot.classList.remove('empty');
          faceUp(slot, card, i >= shownBoard, Math.max(0, (i - shownBoard)) * 140);
        }
      } else {
        slot.classList.add('empty');
        hideSlot(slot);
      }
    }
    shownBoard = state.board.length;

    // ----- winners (for glow) -----
    const winners = new Set();
    if (state.lastResult) for (const p of state.lastResult.pots) for (const w of p.winners) winners.add(w);

    // ----- seats -----
    for (let i = 0; i < SEATS; i++) {
      const s = seatEls[i];
      const st = state.seats[i];
      s.avatar.textContent = AVATAR(st.isHuman);
      s.nameEl.textContent = st.name;
      s.roleEl.textContent = state.roles[st.seat] || '';

      // stack (pulse on change)
      const stackTxt = `$${st.stack}`;
      if (s.stackEl.textContent !== stackTxt) {
        s.stackEl.textContent = stackTxt;
        s.stackEl.classList.remove('flash'); void s.stackEl.offsetWidth; s.stackEl.classList.add('flash');
      }

      // seat state classes
      s.root.classList.toggle('human', !!st.isHuman);
      s.root.classList.toggle('folded', !!st.folded && !winners.has(i));
      s.root.classList.toggle('acting', state.actor === i && !state.lastResult);
      s.root.classList.toggle('thinking', ui.thinkingSeat === i && !state.lastResult);
      s.root.classList.toggle('winner', winners.has(i));
      s.allin.style.display = st.allIn ? '' : 'none';
      s.dealer.style.display = state.buttonSeat === i ? '' : 'none';

      // showdown / hole reveal: flip a shown-but-face-down bot hand up
      if (st.holeCards) {
        const want0 = `${st.holeCards[0].rank}${st.holeCards[0].suit}`;
        const want1 = `${st.holeCards[1].rank}${st.holeCards[1].suit}`;
        if (s.holeSlots[0]._key !== want0) faceUp(s.holeSlots[0], st.holeCards[0], false);
        if (s.holeSlots[1]._key !== want1) faceUp(s.holeSlots[1], st.holeCards[1], false);
      }

      // live bet chips in front of the seat
      if (st.committedRound > 0) {
        s.betArea.style.display = '';
        if (prevCommitted[i] !== st.committedRound) s.betArea.innerHTML = chipStack(st.committedRound);
      } else {
        s.betArea.style.display = 'none';
        s.betArea.innerHTML = '';
      }
      prevCommitted[i] = st.committedRound;

      // action / thinking bubble
      const b = ui.bubbles && ui.bubbles[i];
      if (ui.thinkingSeat === i && !state.lastResult) {
        s.bubble.style.display = '';
        s.bubble.className = 'action-bubble thinking-dots';
        s.bubble.innerHTML = '<span></span><span></span><span></span>';
      } else if (b && Date.now() - b.ts < (ui.bubbleTTL || 1600) && !state.lastResult) {
        s.bubble.style.display = '';
        s.bubble.className = 'action-bubble ' + b.cls;
        s.bubble.textContent = b.label;
      } else {
        s.bubble.style.display = 'none';
      }
    }

    prevPot = state.pot;

    // ----- pot delivered to winner(s) at hand end -----
    if (state.lastResult && !resultHandled) {
      resultHandled = true;
      bloomPotToWinners([...winners]);
    }
  }

  window.Table = { init, startHand, update };
})();
