/* fx.js: optional sounds, celebrations and small animations for Tim's board games.
 Every sound is synthesised with Web Audio (no files, no network). Copy unchanged into js/fx.js.
 Load: <script src="js/fx.js"></script>  or  import "./fx.js";  then use window.FX.  See README.md. */
(function (G) {
'use strict';
if (G.FX && G.FX.version) return;
const VERSION = '1.0.3';
const DEFAULTS = { sound: true, volume: 60, moves: true, alerts: true, ui: true, celebrations: true, animations: true, animSpeed: 'normal' };
const CATS = ['moves', 'alerts', 'ui', 'celebrations'];
let key = 'fx:settings', S = Object.assign({}, DEFAULTS), subs = [], accent = '#6ea8fe';
const stats = { plays: 0, nodes: 0 };

// ---------- settings ----------
const store = () => { try { return G.localStorage || null; } catch (e) { return null; } };
const reduced = () => { try { return !!(G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
function clean(o) {
  const r = {};
  for (const k in DEFAULTS) {
    const d = DEFAULTS[k], v = o[k];
    if (k === 'volume') { const n = Number(v); r[k] = isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : d; }
    else if (k === 'animSpeed') r[k] = v === 'fast' ? 'fast' : 'normal';
    else r[k] = typeof v === 'boolean' ? v : d;
  }
  return r;
}
function load() {
  let saved = null;
  try { const s = store(), raw = s && s.getItem(key); saved = raw ? JSON.parse(raw) : null; } catch (e) { saved = null; }
  const base = Object.assign({}, DEFAULTS, { animations: !reduced() });
  S = clean(Object.assign(base, saved && typeof saved === 'object' ? saved : {}));
}
function save() { try { const s = store(); if (s) s.setItem(key, JSON.stringify(S)); } catch (e) { /* storage blocked: keep in memory */ } }
function emit(k) { const snap = Object.assign({}, S); subs.slice().forEach(fn => { try { fn(k, snap[k], snap); } catch (e) { /* ignore */ } }); }
function set(k, v) {
  if (!(k in DEFAULTS)) return false;
  const old = S[k], o = Object.assign({}, S); o[k] = v; S = clean(o);
  if (S[k] === old) return true;
  save();
  if (k === 'volume' || k === 'sound') setMaster();
  emit(k);
  return true;
}
function onChange(fn) { if (typeof fn === 'function') subs.push(fn); return () => { subs = subs.filter(f => f !== fn); }; }

// ---------- audio ----------
let ac = null, master = null, noiseBuf = null, gestureHooked = false;
const recent = {}; // name -> [start times]
const masterGain = () => S.sound ? Math.pow(S.volume / 100, 2) * 0.9 : 0;
function setMaster() { if (master) try { master.gain.setTargetAtTime(masterGain(), ac.currentTime, 0.02); } catch (e) { /* ignore */ } }
function ensure() {
  if (ac) return ac;
  const C = G.AudioContext || G.webkitAudioContext;
  if (!C) return null;
  try {
    ac = new C();
    master = ac.createGain(); master.gain.value = masterGain();
    const comp = ac.createDynamicsCompressor ? ac.createDynamicsCompressor() : null;
    if (comp) { master.connect(comp); comp.connect(ac.destination); } else master.connect(ac.destination);
  } catch (e) { ac = null; master = null; }
  return ac;
}
function unlock() {
  const c = ensure(); if (!c) return false;
  try { if (c.state === 'suspended' && c.resume) { const p = c.resume(); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* ignore */ }
  try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (e) { /* ignore */ }
  return true;
}
function hookGesture() {
  if (gestureHooked || !G.document) return; gestureHooked = true;
  const evs = ['pointerdown', 'touchend', 'keydown', 'click'];
  const h = () => { unlock(); if (ac && ac.state === 'running') evs.forEach(e => G.document.removeEventListener(e, h, true)); };
  evs.forEach(e => G.document.addEventListener(e, h, true));
}
function noise() {
  if (noiseBuf) return noiseBuf;
  const n = Math.floor(ac.sampleRate || 44100), b = ac.createBuffer(1, n, ac.sampleRate || 44100), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = b);
}
function env(g, t, a, dur, vol) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
const glide = (p, f, f2, t, dur) => { p.setValueAtTime(f, t); if (f2 && f2 !== f) p.exponentialRampToValueAtTime(f2, t + dur); };

// Recipe context: tone()/noise() schedule one voice each. Frequencies scale by pitch.
function voiceCtx(out, t0, m) {
  const k = {
    t: t0, pitch: m, rnd: (a, b) => a + Math.random() * (b - a),
    // tone({f, f2, dur, a, vol, type, at, lp})
    tone(o) {
      const t = t0 + (o.at || 0), dur = o.dur || 0.15, osc = ac.createOscillator(), g = ac.createGain();
      osc.type = o.type || 'sine'; glide(osc.frequency, o.f * m, o.f2 ? o.f2 * m : 0, t, dur);
      env(g, t, o.a || 0.005, dur, o.vol == null ? 0.2 : o.vol);
      let n = osc; stats.nodes += 2;
      if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); n = f; stats.nodes++; }
      n.connect(g); g.connect(out); osc.start(t); osc.stop(t + dur + 0.02);
    },
    // noise({f, f2, q, filter, dur, a, vol, at})
    noise(o) {
      const t = t0 + (o.at || 0), dur = o.dur || 0.1, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noise(); s.loop = true;
      f.type = o.filter || 'bandpass'; f.Q.value = o.q == null ? 1 : o.q; glide(f.frequency, (o.f || 1000) * m, o.f2 ? o.f2 * m : 0, t, dur);
      env(g, t, o.a || 0.003, dur, o.vol == null ? 0.3 : o.vol);
      s.connect(f); f.connect(g); g.connect(out); stats.nodes += 3;
      s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    },
  };
  return k;
}

// ---------- the sound palette (each under 1.2 s) ----------
const R = {};
const def = (name, cat, fn) => { R[name] = { cat, fn }; };
const knock = (k, at, f, v) => { k.tone({ f, f2: f * 0.72, dur: 0.08, vol: v, at }); k.tone({ f: f * 2.1, dur: 0.03, vol: v * 0.3, type: 'triangle', at }); k.noise({ f: 2200, q: 1.5, dur: 0.025, vol: v * 0.5, at }); };
const chipClick = (k, at, m) => { k.tone({ f: 3100 * m, dur: 0.05, vol: 0.13, at }); k.tone({ f: 4650 * m, dur: 0.04, vol: 0.07, at }); k.noise({ f: 6000, filter: 'highpass', dur: 0.02, vol: 0.15, at }); };
const ping = (k, at, f, v) => { k.tone({ f, dur: 0.35, vol: v, at }); k.tone({ f: f * 2.76, dur: 0.14, vol: v * 0.4, at }); k.tone({ f: f * 5.4, dur: 0.07, vol: v * 0.2, at }); };
def('tap', 'ui', k => { k.tone({ f: 900, f2: 600, dur: 0.04, vol: 0.12 }); });
def('click', 'ui', k => { k.tone({ f: 1500, f2: 1100, dur: 0.03, vol: 0.1, type: 'triangle' }); k.noise({ f: 5000, filter: 'highpass', dur: 0.012, vol: 0.06 }); });
def('cardFlip', 'moves', k => { k.noise({ f: 2500, f2: 4500, dur: 0.07, vol: 0.45 }); k.noise({ f: 1300, dur: 0.05, vol: 0.25, at: 0.045 }); });
def('cardDeal', 'moves', k => { k.noise({ f: 3200, f2: 1700, dur: 0.11, a: 0.01, vol: 0.5 }); k.tone({ f: 180, f2: 90, dur: 0.05, vol: 0.15, at: 0.09 }); });
def('cardSlide', 'moves', k => { k.noise({ f: 1700, f2: 3200, q: 0.8, dur: 0.28, a: 0.08, vol: 0.32 }); });
def('shuffle', 'moves', k => { for (let i = 0; i < 9; i++) k.noise({ f: k.rnd(2200, 3400), q: 2, dur: 0.035, vol: 0.28, at: i * 0.045 + k.rnd(0, 0.01) }); k.noise({ f: 1800, f2: 3000, dur: 0.18, a: 0.05, vol: 0.3, at: 0.43 }); });
def('chip', 'moves', k => chipClick(k, 0, 1));
def('chips', 'moves', k => { for (let i = 0; i < 4; i++) chipClick(k, i * 0.04 + k.rnd(0, 0.015), k.rnd(0.88, 1.12)); });
def('coin', 'moves', k => ping(k, 0, 2100, 0.14));
def('coins', 'moves', k => { for (let i = 0; i < 5; i++) ping(k, i * 0.055 + k.rnd(0, 0.02), 2100 * k.rnd(0.85, 1.2), 0.09); });
def('diceShake', 'moves', k => { let t = 0; for (let i = 0; i < 11; i++) { t += k.rnd(0.03, 0.06); k.noise({ f: k.rnd(2500, 4000), q: 3, dur: 0.03, vol: 0.3, at: t }); k.tone({ f: k.rnd(1500, 2400), dur: 0.015, vol: 0.05, type: 'triangle', at: t }); } });
def('diceRoll', 'moves', k => { let t = 0, gap = 0.04; for (let i = 0; i < 8; i++) { k.tone({ f: k.rnd(1200, 2000), dur: 0.02, vol: 0.1, type: 'triangle', at: t }); k.noise({ f: 2600, q: 2, dur: 0.025, vol: 0.2, at: t }); t += gap; gap *= 1.22; } k.noise({ f: 500, filter: 'lowpass', dur: t, a: 0.05, vol: 0.18 }); });
def('diceLand', 'moves', k => { k.tone({ f: 220, f2: 110, dur: 0.08, vol: 0.3 }); k.noise({ f: 1500, dur: 0.03, vol: 0.3 }); k.tone({ f: 260, f2: 130, dur: 0.06, vol: 0.15, at: 0.07 }); k.noise({ f: 1800, dur: 0.02, vol: 0.15, at: 0.07 }); });
def('place', 'moves', k => knock(k, 0, 520, 0.32));
def('slide', 'moves', k => { k.noise({ f: 900, f2: 1600, filter: 'lowpass', q: 0.7, dur: 0.3, a: 0.1, vol: 0.3 }); });
def('capture', 'moves', k => { knock(k, 0, 600, 0.3); k.tone({ f: 880, f2: 1320, dur: 0.16, vol: 0.12, type: 'triangle', at: 0.06 }); });
def('hit', 'moves', k => { k.noise({ f: 1200, f2: 300, filter: 'lowpass', dur: 0.3, vol: 0.7 }); k.tone({ f: 120, f2: 50, dur: 0.3, vol: 0.45 }); });
def('miss', 'moves', k => { k.noise({ f: 600, f2: 300, dur: 0.22, vol: 0.3 }); k.tone({ f: 300, f2: 150, dur: 0.16, vol: 0.1 }); });
def('splash', 'moves', k => { k.noise({ f: 1500, f2: 600, q: 0.7, dur: 0.55, a: 0.02, vol: 0.55 }); k.noise({ f: 3000, filter: 'highpass', dur: 0.25, vol: 0.2, at: 0.05 }); k.tone({ f: 400, f2: 120, dur: 0.1, vol: 0.12 }); });
def('explosion', 'moves', k => { k.noise({ f: 1800, f2: 80, filter: 'lowpass', dur: 1.1, a: 0.005, vol: 0.9 }); k.tone({ f: 90, f2: 30, dur: 0.8, vol: 0.55 }); });
def('sink', 'moves', k => { k.tone({ f: 300, f2: 60, dur: 1.0, vol: 0.22 }); k.noise({ f: 500, f2: 150, filter: 'lowpass', dur: 1.0, a: 0.2, vol: 0.35 }); for (let i = 0; i < 4; i++) { const f = k.rnd(500, 900); k.tone({ f, f2: f * 1.8, dur: 0.04, vol: 0.08, at: k.rnd(0.2, 0.9) }); } });
def('whoosh', 'moves', k => { k.noise({ f: 400, f2: 2400, q: 1.2, dur: 0.35, a: 0.15, vol: 0.45 }); });
def('ding', 'moves', k => { k.tone({ f: 1320, dur: 0.8, vol: 0.18 }); k.tone({ f: 2653, dur: 0.4, vol: 0.05 }); k.tone({ f: 3960, dur: 0.2, vol: 0.025 }); });
def('turn', 'alerts', k => { k.tone({ f: 784, dur: 0.35, vol: 0.17, type: 'triangle' }); k.tone({ f: 1047, dur: 0.5, vol: 0.17, type: 'triangle', at: 0.12 }); k.tone({ f: 2094, dur: 0.3, vol: 0.03, at: 0.12 }); });
def('error', 'alerts', k => { k.tone({ f: 330, f2: 290, dur: 0.12, vol: 0.15, type: 'triangle' }); k.tone({ f: 247, dur: 0.16, vol: 0.15, type: 'triangle', at: 0.1 }); });
def('tick', 'alerts', k => { k.tone({ f: 1500, dur: 0.025, vol: 0.1 }); k.noise({ f: 6000, filter: 'highpass', dur: 0.01, vol: 0.05 }); });
def('alarm', 'alerts', k => { for (let i = 0; i < 6; i++) k.tone({ f: i % 2 ? 660 : 880, dur: 0.1, vol: 0.14, type: 'triangle', at: i * 0.13 }); });
def('train', 'moves', k => { [523, 659, 784].forEach(f => k.tone({ f: f * 0.97, f2: f, dur: 0.9, a: 0.08, vol: 0.1, type: 'sawtooth', lp: 1800 })); k.noise({ f: 2000, q: 0.8, dur: 0.9, a: 0.08, vol: 0.12 }); });
def('stamp', 'moves', k => { k.tone({ f: 160, f2: 60, dur: 0.12, vol: 0.45 }); k.noise({ f: 1500, filter: 'lowpass', dur: 0.06, vol: 0.45 }); k.noise({ f: 3000, dur: 0.03, vol: 0.2, at: 0.02 }); });
def('pop', 'moves', k => { k.tone({ f: 400, f2: 1200, dur: 0.06, vol: 0.2 }); });
def('drumroll', 'moves', k => { for (let t = 0, i = 0; t < 0.9; t += 0.035, i++) k.noise({ f: 1500, q: 0.8, dur: 0.03, vol: 0.08 + t * 0.25 + (i % 2) * 0.03, at: t }); k.tone({ f: 180, f2: 60, dur: 0.2, vol: 0.4, at: 0.93 }); k.noise({ f: 2500, filter: 'lowpass', dur: 0.15, vol: 0.4, at: 0.93 }); });
def('win', 'celebrations', k => { [523, 659, 784].forEach((f, i) => { k.tone({ f, dur: 0.14, vol: 0.15, type: 'triangle', at: i * 0.11 }); k.tone({ f: f * 2, dur: 0.1, vol: 0.04, at: i * 0.11 }); }); k.tone({ f: 1047, dur: 0.6, vol: 0.17, type: 'triangle', at: 0.33 }); k.tone({ f: 784, dur: 0.6, vol: 0.08, type: 'triangle', at: 0.33 }); k.tone({ f: 2094, dur: 0.4, vol: 0.04, at: 0.33 }); ping(k, 0.5, 3136, 0.04); ping(k, 0.62, 4186, 0.03); });
def('lose', 'celebrations', k => { [523, 466, 392].forEach((f, i) => k.tone({ f, dur: 0.24, vol: 0.13, type: 'triangle', at: i * 0.16, lp: 2000 })); k.tone({ f: 330, f2: 311, dur: 0.6, vol: 0.13, type: 'triangle', at: 0.48, lp: 1500 }); });
def('cheer', 'celebrations', k => { [900, 1600, 2600].forEach(f => k.noise({ f, q: 2, dur: 1.1, a: 0.18, vol: 0.14 })); for (let i = 0; i < 8; i++) k.noise({ f: 1800, filter: 'highpass', dur: 0.03, vol: 0.18, at: k.rnd(0.1, 1.0) }); });

function define(name, recipe, cat) {
  if (!name) return false;
  let fn = recipe;
  if (Array.isArray(recipe)) fn = k => recipe.forEach(s => (s.noise ? k.noise(s) : k.tone(s)));
  if (typeof fn !== 'function') return false;
  R[name] = { cat: CATS.includes(cat) ? cat : 'moves', fn };
  return true;
}
function allowed(cat) { return S.sound && S.volume > 0 && (!CATS.includes(cat) || S[cat] !== false); }
function play(name, o) {
  o = o || {};
  const r = R[name]; if (!r) return false;
  const cat = o.cat || r.cat;
  if (!o.force && !allowed(cat)) return false;
  if (o.force && !(S.sound && S.volume > 0)) return false;
  if (!ac || !master) return false; // no audio yet (no user gesture) or not supported
  try {
    if (ac.state === 'suspended') unlock();
    const now = ac.currentTime, list = (recent[name] || []).filter(t => now - t < 0.08);
    if (list.length >= 3) return false; // throttle identical sounds
    list.push(now); recent[name] = list;
    const out = ac.createGain(); out.gain.value = o.vol == null ? 1 : Math.max(0, Math.min(2, o.vol)); stats.nodes++;
    let dest = master;
    if (o.pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); p.connect(master); dest = p; stats.nodes++; }
    out.connect(dest);
    r.fn(voiceCtx(out, now + 0.01, o.pitch > 0 ? o.pitch : 1));
    stats.plays++;
    return true;
  } catch (e) { return false; }
}

// ---------- animations (transform/opacity only) ----------
const on = () => S.animations && !!G.document;
const sp = () => (S.animSpeed === 'fast' ? 0.55 : 1);
const done = () => Promise.resolve();
function run(el, frames, ms, opts) {
  if (!on() || !el || !el.animate) return done();
  const d = Math.round(ms * sp());
  return new Promise(res => {
    let a; try { a = el.animate(frames, Object.assign({ duration: d, easing: 'ease-out' }, opts || {})); } catch (e) { return res(); }
    const fin = () => { clearTimeout(tm); res(); };
    const tm = setTimeout(fin, d + 120); a.onfinish = fin; a.oncancel = fin;
  });
}
const pop = el => run(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.4 }, { transform: 'scale(1)' }], 240);
const shake = el => run(el, [0, -7, 7, -5, 5, -2, 0].map(x => ({ transform: `translateX(${x}px)` })), 380, { easing: 'linear' });
const pulse = el => run(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], 700, { easing: 'ease-in-out' });
function layer(rect, css) {
  const d = G.document.createElement('div');
  d.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;z-index:2147483000;margin:0;` + (css || '');
  G.document.body.appendChild(d); return d;
}
function flash(el, color) {
  if (!on() || !el || !el.getBoundingClientRect) return done();
  let br = '0'; try { br = G.getComputedStyle(el).borderRadius; } catch (e) { /* ignore */ }
  const d = layer(el.getBoundingClientRect(), `background:${color || accent};border-radius:${br};opacity:0`);
  return run(d, [{ opacity: 0.55 }, { opacity: 0 }], 450).then(() => d.remove());
}
function flyTo(el, to, o) {
  o = o || {};
  if (!on() || !el || !to) return done();
  const a = el.getBoundingClientRect(), b = to.getBoundingClientRect ? to.getBoundingClientRect() : to;
  const bw = b.width || a.width, bh = b.height || a.height;
  const dx = (b.left + bw / 2) - (a.left + a.width / 2), dy = (b.top + bh / 2) - (a.top + a.height / 2);
  const s = o.scale != null ? o.scale : (a.width ? Math.max(0.2, Math.min(1, bw / a.width)) : 1);
  const frames = [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(${s})`, opacity: o.fade ? 0.2 : 1 }];
  const ms = o.duration || 420, easing = 'cubic-bezier(.3,.7,.3,1)';
  if (o.clone === false) return run(el, frames, ms, { easing });
  const g = el.cloneNode(true); g.removeAttribute && g.removeAttribute('id');
  g.style.cssText += `;position:fixed;left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px;margin:0;pointer-events:none;z-index:2147483000;box-sizing:border-box;transform-origin:center`;
  G.document.body.appendChild(g);
  return run(g, frames, ms, { easing }).then(() => g.remove());
}
function floatText(el, text, color) {
  if (!on() || !el || !el.getBoundingClientRect) return done();
  const r = el.getBoundingClientRect(), d = G.document.createElement('div');
  d.textContent = text;
  d.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;transform:translate(-50%,-50%);pointer-events:none;z-index:2147483001;font-weight:800;font-size:18px;white-space:nowrap;color:${color || accent};text-shadow:0 1px 3px rgba(0,0,0,.6)`;
  G.document.body.appendChild(d);
  return run(d, [{ transform: 'translate(-50%,-50%)', opacity: 1 }, { transform: 'translate(-50%,-50%) translateY(-10px)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%,-50%) translateY(-40px)', opacity: 0 }], 900).then(() => d.remove());
}
function countUp(el, from, to, o) {
  o = o || {};
  const fmt = o.format || (n => String(Math.round(n)));
  if (!el) return done();
  if (!on() || !G.requestAnimationFrame) { el.textContent = fmt(to); return done(); }
  const ms = (o.duration || 600) * sp(), t0 = G.performance ? G.performance.now() : Date.now();
  return new Promise(res => {
    const step = now => {
      const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) G.requestAnimationFrame(step); else res();
    };
    G.requestAnimationFrame(step);
    setTimeout(() => { el.textContent = fmt(to); res(); }, ms + 200);
  });
}

// ---------- celebrations ----------
function celebrate(o) {
  o = o || {};
  const kind = o.kind || 'win';
  if (!S.celebrations) return done();
  play(kind === 'lose' ? 'lose' : kind === 'big' ? 'ding' : 'win', { cat: 'celebrations' });
  if (kind === 'win' && o.cheer !== false) setTimeout(() => play('cheer', { cat: 'celebrations', vol: 0.6 }), 250);
  if (!on() || !G.document.body) return done();
  const doc = G.document, c = doc.createElement('canvas'), dpr = Math.min(2, G.devicePixelRatio || 1);
  const W = G.innerWidth, H = G.innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483002';
  c.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(c);
  const x = c.getContext && c.getContext('2d');
  if (!x) { c.remove(); return done(); }
  x.scale(dpr, dpr);
  const cols = o.colors && o.colors.length ? o.colors : [accent, '#f0b354', '#6ee7a8', '#f08c8c', '#e8eaf0', '#b48cff'];
  const P = [], rnd = (a, b) => a + Math.random() * (b - a);
  let life = 1200;
  if (kind === 'win') {
    life = 2600;
    const burst = (x0, y0, ang, n) => { for (let i = 0; i < n; i++) { const a = ang + rnd(-0.45, 0.45), v = rnd(9, 17); P.push({ x: x0, y: y0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rnd(6, 10), h: rnd(9, 15), r: rnd(0, 6), vr: rnd(-0.3, 0.3), c: cols[i % cols.length], sq: Math.random() < 0.75 }); } };
    burst(0, H, -Math.PI / 3, 70); burst(W, H, -Math.PI * 2 / 3, 70);
    for (let i = 0; i < 50; i++) P.push({ x: rnd(0, W), y: rnd(-H * 0.3, -10), vx: rnd(-1, 1), vy: rnd(1, 3), w: rnd(6, 10), h: rnd(9, 15), r: rnd(0, 6), vr: rnd(-0.2, 0.2), c: cols[i % cols.length], sq: true });
  } else if (kind === 'big') {
    const at = o.at && o.at.getBoundingClientRect ? o.at.getBoundingClientRect() : null;
    const cx = at ? at.left + at.width / 2 : W / 2, cy = at ? at.top + at.height / 2 : H / 2;
    for (let i = 0; i < 36; i++) { const a = rnd(0, Math.PI * 2), v = rnd(2, 7); P.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rnd(3, 6), r: 0, vr: 0.1, c: cols[i % cols.length], star: true }); }
  }
  life *= sp();
  const t0 = G.performance ? G.performance.now() : Date.now();
  return new Promise(res => {
    let ended = false, last = t0;
    const end = () => { if (ended) return; ended = true; c.remove(); res(); };
    const frame = now => {
      if (ended) return;
      const t = (now - t0) / life;
      // Time-based motion: k = frames' worth of 60 fps elapsed, so confetti moves at the same speed on 30, 60 or 120 Hz screens.
      const k = Math.max(0, Math.min(4, (now - last) / (1000 / 60))); last = now;
      x.clearRect(0, 0, W, H);
      if (t >= 1) return end();
      if (kind === 'lose') { x.fillStyle = `rgba(0,0,0,${0.35 * Math.sin(Math.PI * t)})`; x.fillRect(0, 0, W, H); }
      const fade = t > 0.75 ? (1 - t) / 0.25 : 1;
      for (const p of P) {
        if (p.star) { const d = Math.pow(0.94, k); p.vx *= d; p.vy *= d; } else { const d = Math.pow(0.985, k); p.vx *= d; p.vy = p.vy * d + 0.32 * k; }
        p.x += p.vx * k; p.y += p.vy * k; p.r += p.vr * k;
        x.globalAlpha = fade; x.fillStyle = p.c;
        x.save(); x.translate(p.x, p.y); x.rotate(p.r);
        if (p.star) { const s = p.w * (1 - t * 0.6); x.beginPath(); for (let i = 0; i < 8; i++) { const rr = i % 2 ? s * 0.35 : s, a = i * Math.PI / 4; x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } x.closePath(); x.fill(); }
        else if (p.sq) x.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.r * 2)), p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
        else { x.beginPath(); x.arc(0, 0, p.w / 2, 0, Math.PI * 2); x.fill(); }
        x.restore();
      }
      x.globalAlpha = 1;
      G.requestAnimationFrame(frame);
    };
    G.requestAnimationFrame(frame);
    setTimeout(end, life + 500); // safety net if frames stop (background tab)
  });
}

// ---------- settings UI ----------
const CSS = (`.fx-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line,#2a3042);min-height:44px}
.fx-row:first-child{border-top:0}
.fx-lab{flex:1;min-width:0;display:flex;align-items:center;gap:4px}
.fx-row.dim{opacity:.4}
.switch{position:relative;width:44px;height:26px;flex:none;display:inline-block}
.switch input{opacity:0;position:absolute;inset:0;margin:0;cursor:pointer;z-index:1}
.switch span{position:absolute;inset:0;background:var(--line,#2a3042);border-radius:13px;transition:background .15s}
.switch span::after{content:"";position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .15s}
.switch input:checked+span{background:var(--good,#6ee7a8)}
.switch input:checked+span::after{transform:translateX(18px)}
.seg{display:flex;gap:3px;background:var(--bg-soft,#161923);border:1px solid var(--line,#2a3042);border-radius:10px;padding:3px}
.seg button{border:0;background:none;color:var(--muted,#969db4);font:inherit;font-size:13.5px;font-weight:650;padding:6px 12px;border-radius:7px}
.seg button[aria-pressed="true"]{background:var(--card-hover,#212636);color:var(--text,#e8eaf0)}
.fx-vol{flex:0 1 150px;min-width:80px;accent-color:var(--accent,#6ea8fe)}
.fx-test{flex:none;font:inherit;font-size:13px;font-weight:650;padding:6px 12px;border-radius:8px;border:1px solid var(--line,#2a3042);background:var(--card-hover,#212636);color:var(--text,#e8eaf0)}
.q{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;border:1px solid var(--line,#2a3042);color:var(--muted,#969db4);font-size:11.5px;font-weight:700;background:none;padding:0}
.fx-why{font-size:12.5px;color:var(--muted,#969db4);padding:0 0 8px}`).split('\n').map(r => ':where(.fx-set) ' + r).join('\n');
let uid = 0;
function renderSettings(box) {
  if (!box || !G.document) return null;
  const doc = G.document;
  if (!doc.getElementById('fx-css')) { const st = doc.createElement('style'); st.id = 'fx-css'; st.textContent = CSS; (doc.head || doc.body).appendChild(st); }
  const id = 'fx' + (++uid);
  const sw = (k, label, extra) => `<div class="set-row fx-row" data-row="${k}"><label class="fx-lab" for="${id}-${k}">${label}</label>${extra || ''}<label class="switch"><input type="checkbox" id="${id}-${k}" data-fx="${k}"><span></span></label></div>`;
  const wrap = doc.createElement('div');
  wrap.className = 'fx-set';
  wrap.innerHTML =
    `<div class="set-row fx-row" data-row="sound"><span class="fx-lab"><label for="${id}-sound">Sound</label><button type="button" class="q" aria-label="Why no sound?" aria-expanded="false">?</button></span><label class="switch"><input type="checkbox" id="${id}-sound" data-fx="sound"><span></span></label></div>` +
    `<div class="fx-why" hidden>Sounds follow your phone's volume. The iPhone silent switch may mute them.</div>` +
    `<div class="set-row fx-row" data-row="volume"><label class="fx-lab" for="${id}-vol">Volume</label><input type="range" class="fx-vol" id="${id}-vol" min="0" max="100" step="5" aria-label="Volume"><button type="button" class="fx-test">Test</button></div>` +
    sw('moves', 'Game sounds') + sw('alerts', 'Alerts') + sw('ui', 'Button clicks') + sw('celebrations', 'Celebrations') + sw('animations', 'Animations') +
    `<div class="set-row fx-row" data-row="animSpeed"><span class="fx-lab">Effects speed</span><div class="seg" role="group" aria-label="Animation speed"><button type="button" data-fxspeed="normal">Normal</button><button type="button" data-fxspeed="fast">Fast</button></div></div>`;
  const q = s => wrap.querySelector(s), qa = s => Array.from(wrap.querySelectorAll(s));
  const sync = () => {
    qa('input[data-fx]').forEach(i => { i.checked = !!S[i.dataset.fx]; const l = i.parentNode; if (l.classList) l.classList.toggle('on', i.checked); });
    q('.fx-vol').value = S.volume;
    qa('[data-fxspeed]').forEach(b => b.setAttribute('aria-pressed', String(S.animSpeed === b.dataset.fxspeed)));
    ['volume', 'moves', 'alerts', 'ui'].forEach(k => q(`[data-row="${k}"]`).classList.toggle('dim', !S.sound));
    q('[data-row="animSpeed"]').classList.toggle('dim', !S.animations);
  };
  wrap.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.fx; if (k) set(k, e.target.checked); });
  q('.fx-vol').addEventListener('input', e => set('volume', +e.target.value));
  q('.fx-vol').addEventListener('change', () => play('ding', { force: true }));
  wrap.addEventListener('click', e => {
    const t = e.target;
    if (t.dataset && t.dataset.fxspeed) { set('animSpeed', t.dataset.fxspeed); pop(t); }
    else if (t.classList && t.classList.contains('fx-test')) { unlock(); play('turn', { force: true }); pop(t); }
    else if (t.classList && t.classList.contains('q')) { const w = q('.fx-why'); w.hidden = !w.hidden; t.setAttribute('aria-expanded', String(!w.hidden)); }
  });
  const off = onChange(() => { if (!wrap.isConnected) return off(); sync(); });
  sync();
  box.appendChild(wrap);
  return wrap;
}

// ---------- auto button clicks (category "ui") ----------
let clicksHooked = false;
function hookClicks(sel) {
  if (clicksHooked || !G.document) return; clicksHooked = true;
  G.document.addEventListener('click', e => {
    const t = e.target && e.target.closest && e.target.closest(sel);
    if (t && !t.disabled && !t.closest('.fx-set')) play('tap');
  }, true);
}

function init(o) {
  o = o || {};
  if (o.accent) accent = o.accent;
  key = o.settingsKey || ('fx:' + (o.game || 'settings'));
  load();
  if (o.onChange) onChange(o.onChange);
  setMaster();
  hookGesture();
  if (o.clicks !== false) hookClicks(o.clickSelector || 'button, [role="button"], .btn');
  return FX;
}

const FX = {
  version: VERSION, init, set, onChange, play, define, unlock, celebrate, renderSettings,
  pop, shake, pulse, flash, flyTo, floatText, countUp,
  get settings() { return Object.assign({}, S); },
  get sounds() { return Object.keys(R); },
  get supported() { return !!(G.AudioContext || G.webkitAudioContext); },
  get ready() { return !!(ac && ac.state === 'running'); },
  defaults: Object.assign({}, DEFAULTS), stats,
  soundCategory: n => (R[n] ? R[n].cat : null),
  reset() { S = Object.assign({}, DEFAULTS, { animations: !reduced() }); save(); setMaster(); emit('*'); },
};
load();
G.FX = FX;
})(typeof window !== 'undefined' ? window : globalThis);
