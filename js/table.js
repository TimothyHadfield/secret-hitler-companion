/* table.js: helpers for the "real table" look (decks, piles, hands, seats, chips, dice, motion).
   Classic script, sets window.TABLE. Needs table.css. Copy both unchanged. See README.md. */
(function (G) {
'use strict';
if (G.TABLE && G.TABLE.version) return;
const VERSION = '1.0.2';
const doc = () => G.document;

// ---------- pure helpers (tested in node) ----------
function hash(s) { // FNV-1a, 32-bit
  s = String(s); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) { // mulberry32
  let a = (typeof seed === 'number' ? seed : hash(seed)) >>> 0;
  return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Same (seed, i) always gives the same small offset + rotation, so a pile never "reshuffles" on re-render.
function jitter(seed, i, o) {
  o = o || {}; const r = rng(hash(seed + ':' + i)), rot = o.rot != null ? o.rot : 14, off = o.off != null ? o.off : 5;
  return { x: +((r() * 2 - 1) * off).toFixed(2), y: +((r() * 2 - 1) * off).toFixed(2), r: +((r() * 2 - 1) * rot).toFixed(2) };
}
// Deck edge thickness in px: about a quarter px per card (52 cards = 13px), capped.
function deckThickness(count, o) {
  o = o || {}; const per = o.perCard != null ? o.perCard : 0.25, max = o.max != null ? o.max : 14;
  count = Math.max(0, Math.floor(Number(count) || 0));
  return count ? Math.max(1, Math.min(max, Math.round(count * per))) : 0;
}
// box-shadow list: alternating paper edge lines + a soft shadow under the stack.
function stackShadow(count, o) {
  const t = deckThickness(count, o), out = [];
  for (let i = 1; i <= t; i++) out.push(`${(i * 0.25).toFixed(2)}px ${i}px 0 ${i % 2 ? '#e8e2d2' : '#b9b19d'}`);
  out.push(`${(t * 0.25 + 1).toFixed(2)}px ${t + 2}px ${4 + t / 2}px rgba(0,0,0,.4)`);
  return { thickness: t, layers: t, shadow: out.join(', ') };
}
// Positions for a held hand. Cards overlap like real held cards; the step shrinks so any count fits the width.
function fanLayout(n, o) {
  o = o || {};
  const width = o.width || 361, cw = o.cardW || 56, ch = o.cardH || cw * 88 / 63;
  const spread = o.spread != null ? o.spread : 0.55, arc = o.arc != null ? o.arc : 1;
  if (n <= 0) return [];
  const R = arc * Math.min(o.maxRot != null ? o.maxRot : 18, 2 + n * 2); // half-angle of the arc, degrees
  // tilted end cards swing their top corner outwards: keep that inside the box
  const pad = Math.min((width - cw) / 4, ch * Math.sin(R * Math.PI / 180) * 0.85);
  const step = n > 1 ? Math.max(1, Math.min(cw * spread, (width - 2 * pad - cw) / (n - 1))) : 0;
  const total = cw + step * (n - 1), x0 = Math.max(0, (width - total) / 2);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0, rot = t * R;
    const y = (1 - Math.cos(rot * Math.PI / 180)) * ch * 3; // cards at the ends sit lower, like an arc
    out.push({ x: +(x0 + i * step).toFixed(2), y: +y.toFixed(2), r: +rot.toFixed(2), step: +step.toFixed(2) });
  }
  return out;
}
// Opponent seats around the far half of an oval (percent of the table box), left to right.
function seatPositions(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI + Math.PI * (i + 1) / (n + 1);
    out.push({ x: +(50 + 43 * Math.cos(a)).toFixed(2), y: +(48 + 38 * Math.sin(a)).toFixed(2) });
  }
  return out;
}
// Greedy chip breakdown, e.g. 137 -> [{v:100,n:1},{v:25,n:1},{v:10,n:1},{v:1,n:2}].
const DENOMS = [1000, 500, 100, 25, 10, 5, 1];
function chipBreakdown(amount, denoms) {
  let a = Math.max(0, Math.floor(Number(amount) || 0)); const out = [];
  for (const v of (denoms || DENOMS).slice().sort((x, y) => y - x)) { const n = Math.floor(a / v); if (n) { out.push({ v, n }); a -= n * v; } }
  return out;
}
const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

// ---------- motion gate ----------
function animOn() {
  try { if (G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { /* ignore */ }
  try { if (G.FX && G.FX.settings && G.FX.settings.animations === false) return false; } catch (e) { /* ignore */ }
  return !!doc();
}
const speed = () => { try { return G.FX && G.FX.settings && G.FX.settings.animSpeed === 'fast' ? 0.55 : 1; } catch (e) { return 1; } };
function run(el, frames, ms, opts) {
  if (!animOn() || !el || !el.animate) return Promise.resolve();
  const d = Math.round(ms * speed());
  return new Promise(res => {
    let a; try { a = el.animate(frames, Object.assign({ duration: d, easing: 'cubic-bezier(.3,.7,.3,1)' }, opts || {})); } catch (e) { return res(); }
    const fin = () => { clearTimeout(tm); res(); }, tm = setTimeout(fin, d + 150);
    a.onfinish = fin; a.oncancel = fin;
  });
}

// ---------- DOM builders ----------
const toEl = c => { if (c && c.nodeType) return c; const t = doc().createElement('template'); t.innerHTML = String(c == null ? '' : c).trim(); return t.content.firstElementChild || doc().createElement('div'); };
const SUITS = { S: '♠︎', H: '♥︎', D: '♦︎', C: '♣︎' };
// Standard playing card face from a code like "AS", "10H", "QD". Returns HTML.
// Standard pip layouts (x%, y%) for 2-10; pips below the middle print upside down, like real cards.
const PIPXY = (() => {
  const c = [50, 20], C = [50, 80], m = [50, 50], q = [[30, 20], [70, 20], [30, 80], [70, 80]], s = [[30, 50], [70, 50]];
  const nine = [[30, 20], [70, 20], [30, 40], [70, 40], [30, 60], [70, 60], [30, 80], [70, 80]];
  return { 2: [c, C], 3: [c, m, C], 4: q, 5: q.concat([m]), 6: q.concat(s), 7: q.concat(s, [[50, 35]]), 8: q.concat(s, [[50, 35], [50, 65]]),
    9: nine.concat([m]), 10: nine.concat([[50, 30], [50, 70]]) };
})();
// Small seeded tilt + nudge for loose pieces (decks, dice, tokens) so nothing sits perfectly square.
function scatter(nodes, seed, o) {
  o = Object.assign({ rot: 4, off: 2 }, o); let i = 0;
  for (const el of nodes || []) { const j = jitter(seed == null ? 'scatter' : seed, i++, o); el.style.rotate = j.r + 'deg'; el.style.translate = j.x + 'px ' + j.y + 'px'; }
  return nodes;
}
function pc(code, o) {
  o = o || {}; const m = /^(10|[2-9AJQKT])([SHDC])$/i.exec(String(code).trim());
  if (!m) return `<div class="tbl-card tbl-pc">${code}</div>`;
  const rank = m[1].toUpperCase() === 'T' ? '10' : m[1].toUpperCase(), s = SUITS[m[2].toUpperCase()], red = /[HD]/i.test(m[2]);
  const court = 'JQK'.includes(rank), cls = `tbl-card tbl-pc${red ? ' red' : ''}${court ? ' court' : ''}${o.cls ? ' ' + o.cls : ''}`;
  const idx = b => `<span class="tbl-idx${b ? ' b' : ''}">${rank}<i>${s}</i></span>`;
  let mid;
  if (court) mid = `<span class="tbl-pip tbl-court"><em>${rank}${s}</em><em>${rank}${s}</em></span>`;
  else if (rank === 'A') mid = `<span class="tbl-pip">${s}</span>`;
  else mid = '<span class="tbl-pips">' + PIPXY[rank].map(([x, y]) => `<b style="left:${x}%;top:${y}%"${y > 50 ? ' class="r"' : ''}>${s}</b>`).join('') + '</span>';
  return `<div class="${cls}" data-card="${rank}${m[2].toUpperCase()}">${idx()}${mid}${idx(1)}</div>`;
}
function back(o) { o = o || {}; return `<div class="tbl-card tbl-back tbl-${o.pattern || 'lattice'}${o.cls ? ' ' + o.cls : ''}"></div>`; }
// Flippable card: front HTML + back. Toggle with TABLE.flip(el).
function card(front, o) {
  o = o || {}; const f = toEl(front), inner = f.innerHTML, fc = f.className.replace(/\btbl-card\b/, '').trim();
  return `<div class="tbl-card tbl-flip${o.down ? ' is-down' : ''}${o.cls ? ' ' + o.cls : ''}"><div class="tbl-inner"><div class="tbl-face ${fc}">${inner}</div><div class="tbl-face tbl-back tbl-${o.pattern || 'lattice'}"></div></div></div>`;
}

function deck(el, count, o) {
  if (!el) return null; o = o || {};
  const n = Math.max(0, Math.floor(Number(count) || 0)), st = stackShadow(n, o);
  el.classList.add('tbl-deck'); el.classList.toggle('is-empty', !n); el.dataset.count = n;
  if (!n) { el.innerHTML = ''; return el; }
  el.innerHTML = back(o) + (o.badge === false ? '' : `<span class="tbl-badge">${n}</span>`);
  const top = el.firstElementChild;
  top.style.setProperty('--tbl-stack', st.shadow);
  top.style.setProperty('--tbl-rise', -st.thickness + 'px');
  return el;
}

// Discard pile: last `max` cards, each with stable seeded jitter by its position in the whole pile.
function pile(el, cards, o) {
  if (!el) return null; o = o || {}; cards = cards || [];
  const max = o.max || 6, start = Math.max(0, cards.length - max), seed = o.seed != null ? o.seed : 'pile';
  el.classList.add('tbl-pile'); el.innerHTML = '';
  if (!cards.length) el.classList.add('tbl-spot'); else el.classList.remove('tbl-spot');
  for (let i = start; i < cards.length; i++) {
    const c = toEl(cards[i]), j = jitter(seed, i, o);
    c.style.setProperty('--x', j.x + 'px'); c.style.setProperty('--y', j.y + 'px'); c.style.setProperty('--r', j.r + 'deg');
    el.appendChild(c);
  }
  return el;
}

// Held hand. cards: HTML strings or elements. Returns { cards, layout(), select(i), selected() }.
function fan(el, cards, o) {
  if (!el) return null; o = o || {};
  el.classList.add('tbl-fan'); el.classList.toggle('is-back', !!o.backs); el.classList.toggle('is-across', !!o.across);
  el.innerHTML = '';
  const els = (cards || []).map(c => { const e = toEl(c); el.appendChild(e); return e; });
  const lift = o.lift != null ? o.lift : 18;
  el.style.setProperty('--lift', lift + 'px');
  const api = {
    cards: els,
    layout() {
      if (!els.length) { el.style.height = (o.minHeight || 0) + 'px'; return; }
      const cw = els[0].offsetWidth || 56, ch = els[0].offsetHeight || cw * 88 / 63;
      const L = fanLayout(els.length, Object.assign({}, o, { width: el.clientWidth || o.width || 361, cardW: cw, cardH: ch }));
      const drop = Math.max.apply(null, L.map(p => p.y));
      els.forEach((e, i) => { const p = L[i]; e.style.setProperty('--x', p.x + 'px'); e.style.setProperty('--y', (p.y - drop) + 'px'); e.style.setProperty('--r', p.r + 'deg'); e.style.zIndex = i + 1; });
      el.style.height = Math.ceil(ch + drop + (o.backs ? 4 : lift + 4)) + 'px';
    },
    select(i, on) {
      const e = els[i]; if (!e) return;
      const v = on != null ? on : !e.classList.contains('is-up');
      if (v && !o.multi) els.forEach(x => x.classList.remove('is-up'));
      e.classList.toggle('is-up', v);
    },
    selected() { return els.reduce((a, e, i) => (e.classList.contains('is-up') ? a.concat(i) : a), []); },
  };
  if (!o.backs && o.pick !== false) {
    els.forEach((e, i) => e.addEventListener('click', () => { api.select(i); if (o.onPick) o.onPick(i, e, api.selected()); }));
  }
  api.layout();
  if (G.ResizeObserver) {
    // relayout on the next frame, not inside the observer: layout() sets el's height, and doing that
    // inside the callback makes WebKit throw "ResizeObserver loop completed with undelivered notifications"
    const later = G.requestAnimationFrame ? f => G.requestAnimationFrame(f) : f => setTimeout(f, 16);
    let queued = false, live = true;
    const ro = new G.ResizeObserver(() => { if (queued) return; queued = true; later(() => { queued = false; if (live) api.layout(); }); });
    ro.observe(el); api.disconnect = () => { live = false; ro.disconnect(); };
  }
  return api;
}

// Seats: players [{ name, turn }]. Phone = top strip, wide (>=700px) with oval:true = round the far side.
function seats(el, players, o) {
  if (!el) return []; o = o || {};
  el.classList.add('tbl-seats'); el.classList.toggle('tbl-oval', o.oval !== false); el.innerHTML = '';
  const pos = seatPositions(players.length);
  return players.map((p, i) => {
    const s = doc().createElement('div');
    s.className = 'tbl-seat' + (p.turn ? ' is-turn' : '');
    s.style.setProperty('--sx', pos[i].x + '%'); s.style.setProperty('--sy', pos[i].y + '%');
    const plate = doc().createElement('div'); plate.className = 'tbl-plate'; plate.textContent = p.name == null ? '' : String(p.name);
    const area = doc().createElement('div'); area.className = 'tbl-seat-area';
    s.appendChild(plate); s.appendChild(area); el.appendChild(s);
    return area;
  });
}

// Chip stacks for an amount (one column per colour, at most `cap` chips drawn per column).
function chips(el, amount, o) {
  if (!el) return null; o = o || {}; const cap = o.cap || 12;
  el.classList.add('tbl-stacks'); el.innerHTML = '';
  for (const { v, n } of chipBreakdown(amount, o.denoms)) {
    const k = Math.min(n, cap), st = doc().createElement('div');
    st.className = 'tbl-stack'; st.style.setProperty('--n', k); st.title = `${n} × ${v}`;
    for (let i = 0; i < k; i++) { const c = doc().createElement('span'); c.className = 'tbl-chip v' + v; c.style.setProperty('--i', i); st.appendChild(c); }
    el.appendChild(st);
  }
  return el;
}

function die(el, v) {
  if (!el) return null; v = Math.max(1, Math.min(6, Math.round(Number(v) || 1)));
  el.classList.add('tbl-die'); el.dataset.v = v;
  el.innerHTML = PIPS[v].map(c => `<i style="grid-area:${Math.ceil(c / 3)}/${(c - 1) % 3 + 1}"></i>`).join('');
  el.setAttribute('aria-label', 'Die showing ' + v);
  return el;
}
// Tumble a die and land on `v`. Faces change while it rolls. Transform only.
function roll(el, v, o) {
  o = o || {}; if (!el) return Promise.resolve();
  if (!animOn()) { die(el, v); return Promise.resolve(); }
  const ms = o.duration || 650, r = rng(o.seed != null ? o.seed : Date.now() + Math.random());
  const spin = (r() < 0.5 ? -1 : 1) * (540 + Math.round(r() * 180)), dx = Math.round((r() * 2 - 1) * 10);
  const tick = setInterval(() => die(el, 1 + Math.floor(r() * 6)), 70);
  return run(el, [
    { transform: `translate(${dx}px,-18px) rotate(${spin}deg) scale(1.08)` },
    { transform: `translate(${Math.round(dx / 3)}px,0) rotate(${Math.round(spin / 6)}deg)`, offset: 0.7 },
    { transform: 'translate(0,-3px) rotate(0deg)', offset: 0.85 },
    { transform: 'none' },
  ], ms, { easing: 'ease-out' }).then(() => { clearInterval(tick); die(el, v); });
}

function flip(el, down) {
  if (!el) return Promise.resolve();
  const want = down != null ? !!down : !el.classList.contains('is-down');
  if (!animOn()) { el.classList.add('tbl-instant'); el.classList.toggle('is-down', want); void el.offsetWidth; el.classList.remove('tbl-instant'); return Promise.resolve(); }
  el.classList.toggle('is-down', want);
  const inner = el.querySelector('.tbl-inner');
  return new Promise(res => { const t = setTimeout(res, 520); if (inner) { const end = e => { if (e.target !== inner) return; inner.removeEventListener('transitionend', end); clearTimeout(t); res(); }; inner.addEventListener('transitionend', end); } });
}

// Fly a ghost from `from` to `to`. Uses FX.flyTo when present (it follows the FX Animations setting).
function ghostFly(ghostHTML, from, to, o) {
  o = o || {};
  if (!animOn() || !from || !to || !from.getBoundingClientRect) return Promise.resolve();
  const a = from.getBoundingClientRect(), g = toEl(ghostHTML);
  g.style.cssText += `;position:fixed;left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px;margin:0;pointer-events:none;z-index:2147482000;--card-w:${a.width}px`;
  doc().body.appendChild(g);
  const ms = o.duration || 420, rot = o.rotate || 0;
  let p;
  if (G.FX && typeof G.FX.flyTo === 'function') p = G.FX.flyTo(g, to, { clone: false, duration: ms });
  else {
    const b = to.getBoundingClientRect(), s = a.width ? Math.max(0.2, Math.min(1.4, (b.width || a.width) / a.width)) : 1;
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    p = run(g, [{ transform: 'translate(0,0) scale(1) rotate(0deg)' }, { transform: `translate(${dx}px,${dy}px) scale(${s}) rotate(${rot}deg)` }], ms);
  }
  return Promise.resolve(p).then(() => g.remove(), () => g.remove());
}
// Deal the top card of a deck element to a target. o.face = HTML to show (else a back).
function deal(deckEl, to, o) {
  o = o || {}; const top = deckEl && (deckEl.querySelector('.tbl-back') || deckEl);
  const pat = top && top.className && (/tbl-(lattice|diamonds|sunburst)/.exec(top.className) || [])[1];
  return ghostFly(o.face || back({ pattern: o.pattern || pat || 'lattice', cls: o.cls }), top, to, o);
}
// Slide a card element onto a pile (or any target).
function slide(cardEl, to, o) { return cardEl ? ghostFly(cardEl.cloneNode(true), cardEl, to, Object.assign({ rotate: 8 }, o)) : Promise.resolve(); }

G.TABLE = {
  version: VERSION,
  hash, rng, jitter, deckThickness, stackShadow, fanLayout, seatPositions, chipBreakdown, DENOMS, PIPS,
  PIPXY, scatter, pc, back, card, deck, pile, fan, seats, chips, die, roll, flip, deal, slide, animOn,
};
})(typeof window !== 'undefined' ? window : globalThis);
