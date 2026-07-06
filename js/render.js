/* Shared card-face rendering, used by the game table (js/table.js) and the
   flat cards on the Learn page (js/learn.js). */
(function () {
  const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RANK_LBL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' };
  const rl = (r) => RANK_LBL[r] || String(r);
  const isRed = (suit) => suit === 'h' || suit === 'd';

  /* Inner markup of a card face (corner index + centre pip). Shared so the
     flat learn-page cards and the 3D table cards look identical. */
  function faceInner(card) {
    const r = rl(card.rank);
    const s = SUIT_SYM[card.suit];
    return `<span class="corner tl"><span class="r">${r}</span><span class="s">${s}</span></span>` +
      `<span class="pip">${s}</span>` +
      `<span class="corner br"><span class="r">${r}</span><span class="s">${s}</span></span>`;
  }

  /* Flat (non-flipping) card face -- used on the Learn page. opts: { small }. */
  function cardFaceHTML(card, opts) {
    opts = opts || {};
    const cls = `card${opts.small ? ' small' : ''}${isRed(card.suit) ? ' red' : ''}`;
    return `<div class="${cls}">${faceInner(card)}</div>`;
  }
  function cardBackHTML(small) {
    return `<div class="card${small ? ' small' : ''} back"></div>`;
  }
  function cardPlaceholderHTML(small) {
    return `<div class="card${small ? ' small' : ''} placeholder"></div>`;
  }

  const R = { SUIT_SYM, faceInner, isRed, cardFaceHTML, cardBackHTML, cardPlaceholderHTML };
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
  else if (typeof window !== 'undefined') Object.assign(window, R);
})();
