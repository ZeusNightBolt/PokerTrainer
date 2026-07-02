/* Shared card-face rendering, used by both the game UI and the Learn widgets. */
(function () {
  const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RANK_LBL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' };
  const rl = (r) => RANK_LBL[r] || String(r);
  const isRed = (suit) => suit === 'h' || suit === 'd';

  /* card: any object with .rank (2-14) and .suit (s/h/d/c). */
  function cardFaceHTML(card, opts) {
    const small = opts && opts.small;
    const r = rl(card.rank);
    const s = SUIT_SYM[card.suit];
    const cls = `card${small ? ' small' : ''}${isRed(card.suit) ? ' red' : ''}`;
    return `<div class="${cls}">` +
      `<span class="corner tl"><span class="r">${r}</span><span class="s">${s}</span></span>` +
      `<span class="pip">${s}</span>` +
      `<span class="corner br"><span class="r">${r}</span><span class="s">${s}</span></span>` +
      `</div>`;
  }
  function cardBackHTML(small) {
    return `<div class="card${small ? ' small' : ''} back"></div>`;
  }
  function cardPlaceholderHTML(small) {
    return `<div class="card${small ? ' small' : ''} placeholder"></div>`;
  }

  const R = { cardFaceHTML, cardBackHTML, cardPlaceholderHTML };
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
  else if (typeof window !== 'undefined') Object.assign(window, R);
})();
