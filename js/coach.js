/* coach.js: guided first game + rules sheet for Tim's board game sites (game-coach 1.2.0).
   Copy unchanged into js/coach.js. Classic script (sets window.COACH) or CommonJS (node tests).
   No dependencies. Works with or without fx.js / table.js. Original look only. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.COACH = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const VERSION = '1.2.0';
  const doc = () => (typeof document !== 'undefined' ? document : null);

  // ------------------------------------------------------------------ storage (never throws)
  const store = {
    get(k) { try { const v = root.localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
    set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { root.localStorage.removeItem(k); } catch (e) { /* */ } },
  };

  // ------------------------------------------------------------------ motion gate
  function motionOn() {
    try { if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { /* */ }
    if (root.FX && root.FX.settings && root.FX.settings.animations === false) return false;
    return true;
  }

  // ------------------------------------------------------------------ pure geometry (tested in node)
  // union of rectangles (ignores empty ones); null when nothing is visible
  function unionRect(rects) {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const x of rects || []) {
      if (!x || !(x.width > 0 || x.height > 0)) continue;
      l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.left + x.width); b = Math.max(b, x.top + x.height);
    }
    if (l === Infinity) return null;
    return { left: l, top: t, width: r - l, height: b - t, right: r, bottom: b };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // where the text bubble goes. target: {left, top, width, height} (already padded) or null (centre).
  // box: {w, h} wanted size. view: {w, h}. Returns {x, y, w, maxH, side}: never off-screen, never over
  // the target unless the target leaves no room at all (side 'over', bubble pinned to the roomier edge).
  function place(target, box, view, opt) {
    const o = opt || {}, m = o.margin == null ? 8 : o.margin, g = o.gap == null ? 10 : o.gap;
    const w = Math.min(box.w, view.w - 2 * m);
    if (!target) {
      const h = Math.min(box.h, view.h - 2 * m);
      return { x: Math.round((view.w - w) / 2), y: Math.round((view.h - h) / 2), w, maxH: view.h - 2 * m, side: 'center' };
    }
    const T = { l: target.left, t: target.top, r: target.left + target.width, b: target.top + target.height };
    const room = {
      below: view.h - m - (T.b + g), above: T.t - g - m,
      right: view.w - m - (T.r + g), left: T.l - g - m,
    };
    const cx = T.l + (T.r - T.l) / 2, cy = T.t + (T.b - T.t) / 2;
    const at = side => {
      if (side === 'below' || side === 'above') {
        const h = Math.min(box.h, Math.max(0, room[side]));
        const x = clamp(Math.round(cx - w / 2), m, view.w - m - w);
        const y = side === 'below' ? Math.round(T.b + g) : Math.round(T.t - g - h);
        return { x, y, w, maxH: Math.max(0, Math.floor(room[side])), side };
      }
      const ww = Math.min(w, Math.max(0, room[side]));
      // a narrower note wraps onto more lines: estimate its height from the width it loses
      const h = Math.min(ww > 0 ? Math.ceil(box.h * w / ww) : box.h, view.h - 2 * m);
      const y = clamp(Math.round(cy - h / 2), m, view.h - m - h);
      const x = side === 'right' ? Math.round(T.r + g) : Math.round(T.l - g - ww);
      return { x, y, w: Math.floor(ww), maxH: view.h - m - y, side };
    };
    const fits = side => (side === 'below' || side === 'above') ? room[side] >= box.h : room[side] >= w && box.h <= view.h - 2 * m;
    const order = ['below', 'above', 'right', 'left'];
    if (o.prefer && order.includes(o.prefer)) order.unshift(...order.splice(order.indexOf(o.prefer), 1));
    for (const s of order) if (fits(s)) return at(s);
    // a narrower note beside the target, if it then fits whole (phone sideways: tall targets, little height)
    const sideMin = o.sideMin || 160;
    for (const s of ['left', 'right'].sort((a, b) => room[b] - room[a])) {
      if (room[s] >= Math.max(sideMin, 200) && Math.ceil(box.h * w / room[s]) <= view.h - 2 * m) return at(s);
    }
    // nothing fits whole: the roomier of above/below, the bubble scrolls inside (still not over the target),
    // if that room shows a readable note: the title, 2 lines and the buttons (minH; the tour measures it, 136 =
    // the default look). Less room than that was a thin strip of one line (Connect Four, 1.0.0).
    const read = Math.min(box.h, o.minH || 136, view.h - 2 * m);
    const v = room.below >= room.above ? 'below' : 'above';
    if (room[v] >= read) return at(v);
    const hz = room.right >= room.left ? 'right' : 'left';
    if (room[hz] >= sideMin) return at(hz);
    // the target leaves no readable room (it fills most of the screen): the readable note sits at the edge
    // with more room, over the target's edge only by what is missing
    const h = Math.max(read, Math.min(box.h, Math.floor(room[v])));
    return { x: clamp(Math.round(cx - w / 2), m, view.w - m - w), y: v === 'below' ? view.h - m - h : m, w, maxH: h, side: 'over' };
  }

  // the area two rectangles share ({left, top, width, height}); 0 when apart
  function overlapArea(a, b) {
    if (!a || !b) return 0;
    const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
    const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }
  // the first-visit card's spot (place: 'auto'): of the candidate boxes [{name, rect}], the one that covers
  // the least: a "hard" box (a tab bar, the avoid list, data-coach-avoid) counts 100x a "soft" one (any
  // other button or link). A box that would leave the screen is never picked unless all would. Ties keep
  // the earlier candidate (so the usual bottom spot wins when nothing is in the way).
  function offerPick(cands, hard, soft, view) {
    let best = -1, bestS = Infinity;
    (cands || []).forEach((c, i) => {
      const r = c.rect;
      const off = r.top < -0.5 || r.left < -0.5 || r.top + r.height > view.h + 0.5 || r.left + r.width > view.w + 0.5;
      let s = off ? 1e12 : 0;
      for (const x of hard || []) s += 100 * overlapArea(r, x);
      for (const x of soft || []) s += overlapArea(r, x);
      if (s < bestS - 0.5) { bestS = s; best = i; }
    });
    return best;
  }

  // ------------------------------------------------------------------ seeded + stackable random numbers
  // COACH.rng(seed): a repeatable random function (mulberry32). rng.stack([...0..1 values]) makes the next
  // calls return exactly those values (then back to the seeded stream): that is how a game stacks a deal
  // or a roll for the tutorial without touching its rules engine. rng.stackInts([3, 0], 6) = "next
  // rint(rng, 6) gives 3, then 0".
  function rng(seed) {
    let a = (typeof seed === 'number' ? seed : hash(String(seed == null ? 1 : seed))) >>> 0;
    const q = [];
    const base = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const f = () => (q.length ? q.shift() : base());
    f.stack = vals => { for (const v of vals) q.push(clamp(+v, 0, 0.999999)); return f; };
    f.stackInts = (ints, n) => f.stack(ints.map(i => (i + 0.5) / n));
    f.left = () => q.length;
    f.clear = () => { q.length = 0; return f; };
    return f;
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // the first seed (from..from+max) whose deal passes test(rngForThatSeed): search once, then hard-code it
  function findSeed(test, opt) {
    const o = opt || {}, from = o.from || 1, max = o.max || 5000;
    for (let s = from; s < from + max; s++) { try { if (test(rng(s), s)) return s; } catch (e) { /* bad deal */ } }
    return -1;
  }

  // ------------------------------------------------------------------ DOM helpers
  function el(tag, cls, html) { const e = doc().createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  const escH = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // the target's on-screen box: a selector (all matches together), an element, a list, or a function.
  // display:contents elements count as their children's box.
  function targets(t) {
    if (!t) return [];
    if (typeof t === 'function') { try { t = t(); } catch (e) { return []; } }
    if (!t) return [];
    if (typeof t === 'string') { try { return [...doc().querySelectorAll(t)]; } catch (e) { return []; } }
    if (Array.isArray(t)) return t.flatMap(x => targets(x));
    return [t];
  }
  function boxOf(nodes) {
    const rects = [];
    const add = n => {
      if (!n || !n.getBoundingClientRect) return;
      let cs = null; try { cs = root.getComputedStyle(n); } catch (e) { /* */ }
      if (cs && cs.display === 'contents') { [...n.children].forEach(add); return; }
      if (cs && (cs.visibility === 'hidden' || cs.display === 'none')) return;
      const r = n.getBoundingClientRect(); if (r.width > 0 && r.height > 0) rects.push(r);
    };
    nodes.forEach(add);
    return unionRect(rects);
  }

  // ------------------------------------------------------------------ the tour
  let active = null;
  const L = { next: 'Next', back: 'Back', skip: 'Skip', done: 'Done', of: 'of' };
  function tour(cfg) {
    const id = String(cfg.id || 'tour');
    const KEY = 'coach:' + id;
    const steps = cfg.steps || [];
    const lab = Object.assign({}, L, cfg.labels || {});
    const t = {
      id, steps, index: -1, active: false, fired: new Set(),
      start(at) { stopOthers(t); t.fired = new Set(); go(at || 0, true); return t; },
      // carry on after a reload: true if there was a tour in progress
      resume() { const s = store.get(KEY); if (!s || s.done || !Number.isInteger(s.i) || s.i < 0 || s.i >= steps.length) return false; stopOthers(t); t.fired = new Set(s.fired || []); go(s.i, false); return true; },
      saved() { const s = store.get(KEY); return !!(s && !s.done && Number.isInteger(s.i)); },
      seen() { const s = store.get(KEY); return !!(s && s.done); },
      next() { if (t.active) go(t.index + 1, true); },
      back() { const b = prevInfo(t.index); if (b >= 0) go(b, true); },
      skip() { finish('skip'); },
      finish(reason) { finish(reason || 'done'); },
      stop() { teardown(); t.active = false; if (active === t) active = null; },   // hide, keep progress
      reset() { store.del(KEY); },
      emit(ev) { t.fired.add(String(ev)); persist(); check(); },
      update() { check(); layout(); },
      current() { return steps[t.index] || null; },
    };
    let ui = null, raf = 0, last = '', shown = false, scrolled = -1, frames = 0, entered = -1;
    function persist() { if (t.active) store.set(KEY, { i: t.index, fired: [...t.fired].slice(-40) }); }
    function stopOthers(x) { if (active && active !== x) active.stop(); active = x; }
    // the previous step that is just text (an action step that is already done would skip straight on)
    function prevInfo(i) { for (let k = i - 1; k >= 0; k--) { const s = steps[k]; if (!s.waitFor && !s.until && !s.when) return k; } return -1; }
    function go(i, save) {
      if (i >= steps.length) { finish('done'); return; }
      t.active = true; t.index = i; shown = false; last = ''; scrolled = -1;
      persist();
      if (cfg.onStep) { try { cfg.onStep(i, steps[i]); } catch (e) { /* */ } }
      ensureUi(); check(); layout();
    }
    function finish(reason) {
      store.set(KEY, { done: true, how: reason });
      t.stop();
      if (cfg.onFinish) { try { cfg.onFinish(reason); } catch (e) { /* */ } }
    }
    const ok = fn => { try { return !!fn(); } catch (e) { return false; } };
    // is this step's action done? (an event that fired, or a condition on the game's state)
    function doneNow(s) { return (s.waitFor && t.fired.has(s.waitFor)) || (s.until && ok(s.until)); }
    function check() {
      if (!t.active) return;
      // the game has something on top (a sheet, the rules): step aside until it closes
      if (cfg.pauseIf && ok(cfg.pauseIf)) { hide(); return; }
      if (rulesEl) { hide(); return; }
      for (let guard = 0; guard < steps.length + 1; guard++) {
        const s = steps[t.index];
        if (!s) { finish('done'); return; }
        if (s.skipIf && ok(s.skipIf)) { t.index++; persist(); continue; }
        // before its moment (when), only a fired event can finish a step: "not asked yet" is not "answered"
        if (s.when && !ok(s.when) && !(s.waitFor && t.fired.has(s.waitFor)) && !(entered === t.index && doneNow(s))) { hide(); return; }
        if (doneNow(s)) { if (s.waitFor) t.fired.delete(s.waitFor); if (t.index + 1 >= steps.length) { finish('done'); return; } t.index++; shown = false; last = ''; persist(); if (cfg.onStep) { try { cfg.onStep(t.index, steps[t.index]); } catch (e) { /* */ } } continue; }
        entered = t.index;   // this step's moment has come (it is on screen)
        draw(s); return;
      }
    }
    function ensureUi() {
      if (ui || !doc()) return;
      const wrap = el('div', 'coach-layer'); wrap.setAttribute('aria-live', 'polite');
      const ring = el('div', 'coach-ring');
      const blk = ['t', 'r', 'b', 'l'].map(k => el('div', 'coach-block ' + k));
      const bub = el('div', 'coach-bubble'); bub.setAttribute('role', 'dialog'); bub.setAttribute('aria-label', 'Tutorial');
      wrap.append(...blk, ring, bub);
      doc().body.appendChild(wrap);
      bub.addEventListener('click', e => {
        const b = e.target.closest('[data-coach]'); if (!b) return;
        e.stopPropagation();
        const a = b.dataset.coach;
        if (a === 'next') t.next(); else if (a === 'back') t.back(); else if (a === 'skip') t.skip();
      });
      blk.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); nudge(); }));
      ui = { wrap, ring, blk, bub };
      prevSig = ''; meas = { key: null, bw: 0, h: 0 };   // a fresh note: measure and place it again
      root.addEventListener('resize', layout); root.addEventListener('scroll', layout, true);
      // follows the target as the game redraws; conditions (until / when) are re-checked ~4 times a second
      const loop = () => { if (!ui) return; if (++frames % 15 === 0) check(); layout(); if (ui) raf = root.requestAnimationFrame(loop); };
      raf = root.requestAnimationFrame(loop);
    }
    function teardown() {
      if (!ui) return;
      root.cancelAnimationFrame(raf); root.removeEventListener('resize', layout); root.removeEventListener('scroll', layout, true);
      ui.wrap.remove(); ui = null;
    }
    function nudge() { if (!ui || !motionOn()) return; ui.bub.classList.remove('nudge'); void ui.bub.offsetWidth; ui.bub.classList.add('nudge'); }
    function hide() { if (ui) ui.wrap.classList.add('coach-off'); }
    function draw(s) {
      ensureUi(); if (!ui) return;
      ui.wrap.classList.remove('coach-off');
      ui.wrap.classList.toggle('coach-still', !motionOn());
      const n = steps.length, i = t.index;
      const action = !!(s.waitFor || s.until);
      const showNext = s.next !== undefined ? !!s.next : !action;
      const back = prevInfo(i) >= 0 && s.back !== false;
      const key = i + '|' + showNext + back;
      if (key !== last) {
        last = key;
        ui.bub.innerHTML = `${s.title ? `<b class="coach-title">${escH(s.title)}</b>` : ''}<div class="coach-text">${s.html || escH(s.text || '')}</div>
          <div class="coach-row"><span class="coach-count">${i + 1} ${escH(lab.of)} ${n}</span>
          <button type="button" class="coach-btn ghost" data-coach="skip">${escH(lab.skip)}</button>
          ${back ? `<button type="button" class="coach-btn" data-coach="back">${escH(lab.back)}</button>` : ''}
          ${showNext ? `<button type="button" class="coach-btn primary" data-coach="next">${escH(i + 1 >= n ? lab.done : lab.next)}</button>` : ''}</div>`;
        if (!shown && motionOn()) { ui.bub.classList.remove('enter'); void ui.bub.offsetWidth; ui.bub.classList.add('enter'); }
        shown = true;
      }
      ui.wrap.classList.toggle('coach-blocking', !!s.block);
      layout();
    }
    let prevSig = '', meas = { key: null, bw: 0, h: 0 };
    function layout() {
      if (!ui || !t.active || ui.wrap.classList.contains('coach-off')) return;
      const s = steps[t.index]; if (!s) return;
      const vw = root.innerWidth, vh = root.innerHeight;
      const r = s.target ? boxOf(targets(s.target)) : null;
      // a target scrolled out of view is brought in once per step
      if (r && scrolled !== t.index && (r.top < 0 || r.bottom > vh)) { scrolled = t.index; const n = targets(s.target)[0]; if (n && n.scrollIntoView) n.scrollIntoView({ block: 'center' }); return; }
      const pad = s.pad == null ? 6 : s.pad;
      const hole = r ? { left: Math.max(2, r.left - pad), top: Math.max(2, r.top - pad) } : null;
      if (hole) { hole.width = Math.min(vw - 2, r.left + r.width + pad) - hole.left; hole.height = Math.min(vh - 2, r.top + r.height + pad) - hole.top; }
      const bw = Math.min(s.width || 320, vw - 16);
      // the note's natural height is measured once per text and width (re-measuring every frame cleared the
      // height cap the placement had set, and the note grew back over its target)
      if (meas.key !== last || meas.bw !== bw) {
        ui.bub.style.width = bw + 'px'; ui.bub.style.maxHeight = '';
        // readable = the note with its text cut to 2 lines (title and buttons whole)
        const tx = ui.bub.querySelector('.coach-text');
        let lh = 21; try { lh = parseFloat(root.getComputedStyle(tx).lineHeight) || 21; } catch (e) { /* */ }
        const th = tx ? tx.offsetHeight : 0;
        meas = { key: last, bw, h: ui.bub.offsetHeight, read: Math.ceil(ui.bub.offsetHeight - th + Math.min(th, 2 * lh)) + 2 }; prevSig = '';
      }
      const bh = meas.h;
      const sig = [vw, vh, bh, hole && [hole.left, hole.top, hole.width, hole.height].map(Math.round).join(',')].join('|');
      if (sig === prevSig) return;
      prevSig = sig;
      const p = place(hole, { w: bw, h: bh }, { w: vw, h: vh }, { prefer: s.place, minH: meas.read });
      Object.assign(ui.bub.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', maxHeight: p.maxH + 'px' });
      ui.bub.dataset.side = p.side;
      if (hole) {
        Object.assign(ui.ring.style, { display: '', left: hole.left + 'px', top: hole.top + 'px', width: hole.width + 'px', height: hole.height + 'px' });
        const [bt, br, bb, bl] = ui.blk;
        Object.assign(bt.style, { left: 0, top: 0, width: vw + 'px', height: hole.top + 'px' });
        Object.assign(bb.style, { left: 0, top: hole.top + hole.height + 'px', width: vw + 'px', height: Math.max(0, vh - hole.top - hole.height) + 'px' });
        Object.assign(bl.style, { left: 0, top: hole.top + 'px', width: hole.left + 'px', height: hole.height + 'px' });
        Object.assign(br.style, { left: hole.left + hole.width + 'px', top: hole.top + 'px', width: Math.max(0, vw - hole.left - hole.width) + 'px', height: hole.height + 'px' });
        ui.wrap.classList.remove('coach-nohole');
      } else {
        ui.ring.style.display = 'none';
        ui.blk.forEach((b, k) => Object.assign(b.style, k === 0 ? { left: 0, top: 0, width: vw + 'px', height: vh + 'px' } : { width: 0, height: 0 }));
        ui.wrap.classList.add('coach-nohole');
      }
    }
    return t;
  }
  function emit(ev) { if (active) active.emit(ev); }
  function update() { if (active) active.update(); }

  // ------------------------------------------------------------------ "first time here?" offer (once)
  function offer(o) {
    const KEY = 'coach-offer:' + (o.id || 'tour');
    if (!o.force && store.get(KEY)) return false;
    if (!doc()) return false;
    const old = doc().querySelector('.coach-offer'); if (old) old.remove();
    const box = el('div', 'coach-offer' + (motionOn() ? ' enter' : ''));
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', o.title || 'Tutorial');
    box.innerHTML = `${o.title ? `<b class="coach-title">${escH(o.title)}</b>` : ''}<div class="coach-text">${escH(o.text || '')}</div>
      <div class="coach-row"><button type="button" class="coach-btn ghost" data-o="no">${escH(o.no || 'No thanks')}</button><button type="button" class="coach-btn primary" data-o="yes">${escH(o.yes || 'Show me')}</button></div>`;
    (o.parent || doc().body).appendChild(box);
    store.set(KEY, 1);
    // place: 'top' | 'bottom' | 'auto' (1.2.0). Left out = the game's own css decides (1.1.0 behaviour).
    let onResize = null;
    if (o.place === 'top' || o.place === 'bottom' || o.place === 'auto') {
      const again = () => { if (!box.isConnected) { root.removeEventListener('resize', onResize); return; } placeOffer(box, o); };
      onResize = again;
      again();
      // the game may draw its screen right after asking: look again before the first paint
      if (root.requestAnimationFrame) root.requestAnimationFrame(again);
      root.addEventListener('resize', onResize);
    }
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-o]'); if (!b) return;
      if (onResize) root.removeEventListener('resize', onResize);
      box.remove();
      const f = b.dataset.o === 'yes' ? o.onYes : o.onNo;
      if (f) f();
    });
    return true;
  }
  // bars along the top / bottom edge of the screen (tab bars, fixed headers): fixed or sticky, or a
  // nav / footer / tablist, at least 40% of the width and at most 35% of the height, touching the edge
  function edgeBars(skip) {
    const d = doc(), vw = root.innerWidth, vh = root.innerHeight, out = { top: [], bottom: [] };
    if (!d.elementsFromPoint) return out;
    const seen = new Set();
    const isBar = e => {
      if (e === d.body || e === d.documentElement || skip.contains(e) || (e.closest && e.closest('.coach-layer'))) return false;
      let cs = null; try { cs = root.getComputedStyle(e); } catch (x) { return false; }
      const tag = e.tagName ? e.tagName.toLowerCase() : '', role = e.getAttribute && e.getAttribute('role');
      if (!(cs.position === 'fixed' || cs.position === 'sticky' || tag === 'nav' || tag === 'footer' || role === 'tablist' || role === 'navigation')) return false;
      const r = e.getBoundingClientRect();
      return r.width >= 0.4 * vw && r.height > 0 && r.height <= 0.35 * vh;
    };
    for (const [edge, y] of [['bottom', vh - 2], ['top', 2]]) {
      for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        let hits = []; try { hits = d.elementsFromPoint(Math.round(vw * f), y); } catch (x) { /* */ }
        for (const e of hits.slice(0, 20)) {
          if (seen.has(e) || !isBar(e)) continue;
          seen.add(e);
          const r = e.getBoundingClientRect();
          if (edge === 'bottom' ? r.bottom >= vh - 4 : r.top <= 4) out[edge].push(r);
        }
      }
    }
    return out;
  }
  const visibleBoxes = (list, skip) => list.filter(n => !skip.contains(n) && !(n.closest && n.closest('.coach-layer'))).map(n => boxOf([n])).filter(Boolean);
  function placeOffer(box, o) {
    const st = box.style, vw = root.innerWidth, vh = root.innerHeight;
    const SB = 'calc(var(--coach-offer-bottom, 14px) + env(safe-area-inset-bottom, 0px))';
    const ST = 'calc(var(--coach-offer-top, 10px) + env(safe-area-inset-top, 0px))';
    const put = c => { st.top = c.top; st.bottom = c.bottom; };
    if (o.place === 'top' || o.place === 'bottom') {
      put(o.place === 'top' ? { top: ST, bottom: 'auto' } : { top: 'auto', bottom: SB });
      box.dataset.place = o.place; return o.place;
    }
    // auto: try each spot, measure it, keep the one that covers the least
    const bars = edgeBars(box);
    const cands = [{ name: 'bottom', top: 'auto', bottom: SB }];
    if (bars.bottom.length) cands.push({ name: 'above-bar', top: 'auto', bottom: Math.round(vh - Math.min(...bars.bottom.map(r => r.top)) + 10) + 'px' });
    cands.push({ name: 'top', top: ST, bottom: 'auto' });
    if (bars.top.length) cands.push({ name: 'below-bar', top: Math.round(Math.max(...bars.top.map(r => r.bottom)) + 10) + 'px', bottom: 'auto' });
    const h = box.offsetHeight, x = box.getBoundingClientRect();
    for (const c of cands) {
      put(c);
      // from the computed top / bottom, not the box on screen: the slide-in animation moves that by a few px
      const cs = root.getComputedStyle(box);
      const y = c.top === 'auto' ? vh - parseFloat(cs.bottom) - h : parseFloat(cs.top);
      c.rect = { left: x.left, top: y, width: x.width, height: h };
    }
    let avoid = [];
    for (const a of [].concat(o.avoid || [])) avoid = avoid.concat(targets(a));
    avoid = avoid.concat([...doc().querySelectorAll('[data-coach-avoid]')]);
    const hard = visibleBoxes(avoid, box).concat(bars.top, bars.bottom);
    const soft = visibleBoxes([...doc().querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"]')], box);
    const k = Math.max(0, offerPick(cands, hard, soft, { w: vw, h: vh }));
    put(cands[k]);
    box.dataset.place = cands[k].name;
    return cands[k].name;
  }
  const offered = id => !!store.get('coach-offer:' + (id || 'tour'));
  const resetOffer = id => store.del('coach-offer:' + (id || 'tour'));
  const closeOffer = () => { const d = doc(); const b = d && d.querySelector('.coach-offer'); if (b) b.remove(); };

  // ------------------------------------------------------------------ rules sheet
  // COACH.rules({ title, sections: [{ id, title, html }], open: 'id' }): a paper rulebook sheet with
  // a row of section tabs (no search). Close: X, tap outside, Esc, or COACH.closeRules() from Back.
  let rulesEl = null, rulesCfg = null;
  // videos: [{ id: 'YouTube id', title, channel }] -> a list of links that open in a new tab. Rows with an id
  // that is not an 11-character YouTube id are left out. Check each link first (see README).
  function videosHtml(list) {
    const rows = (list || []).filter(v => v && /^[\w-]{11}$/.test(String(v.id || '')));
    if (!rows.length) return '';
    return `<ul class="coach-vids">${rows.map(v => `<li><a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">${escH(v.title || 'Video')}</a>${v.channel ? ` <span class="coach-vid-ch">${escH(v.channel)}</span>` : ''}</li>`).join('')}</ul>`;
  }
  function rules(cfg) {
    if (!doc()) return null;
    closeRules();
    rulesCfg = cfg || {};
    let secs = rulesCfg.sections || [];
    const vids = videosHtml(rulesCfg.videos);
    if (vids) secs = secs.concat([{ id: 'videos', title: rulesCfg.videosTitle || 'Videos', short: rulesCfg.videosShort || rulesCfg.videosTitle || 'Videos', html: vids }]);
    const back = el('div', 'coach-rules-back' + (motionOn() ? ' enter' : ''));
    back.innerHTML = `<div class="coach-rules" role="dialog" aria-modal="true" aria-label="${escH(rulesCfg.title || 'Rules')}">
      <div class="coach-rules-head"><b>${escH(rulesCfg.title || 'Rules')}</b><button type="button" class="coach-x" data-r="x" aria-label="Close">×</button></div>
      ${secs.length > 1 ? `<nav class="coach-rules-nav">${secs.map((s, k) => `<button type="button" data-sec="${k}">${escH(s.short || s.title)}</button>`).join('')}</nav>` : ''}
      <div class="coach-rules-body" tabindex="0">${rulesCfg.intro ? `<p class="coach-rules-intro">${rulesCfg.intro}</p>` : ''}${secs.map((s, k) => `<section id="coach-sec-${k}" data-k="${k}"><h3>${escH(s.title)}</h3>${s.html || ''}</section>`).join('')}
      ${rulesCfg.foot ? `<p class="coach-rules-foot">${rulesCfg.foot}</p>` : ''}</div></div>`;
    doc().body.appendChild(back);
    rulesEl = back;
    const body = back.querySelector('.coach-rules-body');
    const nav = back.querySelector('.coach-rules-nav');
    const mark = k => { if (!nav) return; nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', String(+b.dataset.sec === k))); const b = nav.querySelector(`[data-sec="${k}"]`); if (b && b.scrollIntoView) { const nr = nav.getBoundingClientRect(), br = b.getBoundingClientRect(); if (br.left < nr.left || br.right > nr.right) nav.scrollLeft += br.left - nr.left - 12; } };
    // the body is position:relative, so a section's offsetTop is measured from the top of the body
    const jump = k => { const s = body.querySelector(`[data-k="${k}"]`); if (s) body.scrollTop = s.offsetTop - 4; mark(k); };
    back.addEventListener('click', e => {
      if (e.target === back || e.target.closest('[data-r="x"]')) { closeRules(); return; }
      const b = e.target.closest('[data-sec]'); if (b) jump(+b.dataset.sec);
    });
    body.addEventListener('scroll', () => {
      let cur = 0; body.querySelectorAll('section').forEach(s => { if (s.offsetTop - body.scrollTop <= 24) cur = +s.dataset.k; });
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2) cur = secs.length - 1;
      mark(cur);
    }, { passive: true });
    back._key = e => { if (e.key === 'Escape') closeRules(); };
    doc().addEventListener('keydown', back._key);
    const at = rulesCfg.open != null ? secs.findIndex(s => s.id === rulesCfg.open) : 0;
    if (at > 0) jump(at); else mark(0);
    const x = back.querySelector('.coach-x'); if (x && x.focus) x.focus({ preventScroll: true });
    return back;
  }
  function closeRules() {
    if (!rulesEl) return false;
    doc().removeEventListener('keydown', rulesEl._key);
    rulesEl.remove(); rulesEl = null;
    const f = rulesCfg && rulesCfg.onClose; rulesCfg = null;
    if (f) { try { f(); } catch (e) { /* */ } }
    return true;
  }
  const rulesOpen = () => !!rulesEl;

  return { VERSION, tour, emit, update, offer, offered, resetOffer, closeOffer, rules, closeRules, rulesOpen, videosHtml, rng, findSeed, hash, place, unionRect, overlapArea, offerPick, motionOn, get active() { return active; } };
});
