/* Shared card-face rendering, used by both the game UI and the Learn widgets. */
(function () {
  const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RANK_LBL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' };
  const rl = (r) => RANK_LBL[r] || String(r);
  const isRed = (suit) => suit === 'h' || suit === 'd';

  /* opts: { small, deal, dealDelay } -- deal adds a one-shot deal-in
     animation (only pass it for genuinely new cards, else the card
     re-animates on every repaint). */
  function cardFaceHTML(card, opts) {
    opts = opts || {};
    const r = rl(card.rank);
    const s = SUIT_SYM[card.suit];
    const cls = `card${opts.small ? ' small' : ''}${isRed(card.suit) ? ' red' : ''}${opts.deal ? ' deal' : ''}`;
    const style = opts.deal && opts.dealDelay ? ` style="animation-delay:${opts.dealDelay}ms"` : '';
    return `<div class="${cls}"${style}>` +
      `<span class="corner tl"><span class="r">${r}</span><span class="s">${s}</span></span>` +
      `<span class="pip">${s}</span>` +
      `<span class="corner br"><span class="r">${r}</span><span class="s">${s}</span></span>` +
      `</div>`;
  }
  function cardBackHTML(small, deal, dealDelay) {
    const cls = `card${small ? ' small' : ''} back${deal ? ' deal' : ''}`;
    const style = deal && dealDelay ? ` style="animation-delay:${dealDelay}ms"` : '';
    return `<div class="${cls}"${style}></div>`;
  }
  function cardPlaceholderHTML(small) {
    return `<div class="card${small ? ' small' : ''} placeholder"></div>`;
  }

  const R = { cardFaceHTML, cardBackHTML, cardPlaceholderHTML };
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
  else if (typeof window !== 'undefined') Object.assign(window, R);
})();
