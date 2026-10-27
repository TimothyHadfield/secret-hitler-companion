/* profile.js: a local player profile for Tim's board games. Name + avatar (shared by every game on the
 site), per-game stats, a local Elo against the computer levels, achievements, a daily-game helper and
 a "My stats" panel. localStorage only, no network; works with storage blocked (keeps it in memory).
 Copy unchanged into js/profile.js (and profile.css into css/). Load: <script src="js/profile.js"></script>
 or import "./profile.js"; then use window.Profile.  See README.md. */
(function (G) {
'use strict';
if (G.Profile && G.Profile.version) return;
const VERSION = '1.1.0';
const ID_KEY = 'profile:me';              // name + avatar, shared by all games on this site
const gameKey = g => 'profile:' + g;      // one stats record per game
const START = 1200, K_NEW = 40, K = 24, NEW_GAMES = 10, FLOOR = 100;
const MAX_RECENT = 30, MAX_DAYS = 120;

// ---------- storage (every access guarded) ----------
const mem = {};          // in-page copy of keys that storage refused (blocked, private mode, full)
let blocked = false;
function store() { try { const s = G.localStorage; if (s) { s.getItem('profile:probe'); blocked = false; return s; } } catch (e) { /* blocked */ } blocked = true; return null; }
function read(k) {
  let raw = null;
  if (k in mem) raw = mem[k];
  else { try { const s = store(); raw = s ? s.getItem(k) : null; } catch (e) { blocked = true; raw = null; } }
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function write(k, v) {
  const raw = JSON.stringify(v);
  try { const s = store(); if (!s) throw new Error('no storage'); s.setItem(k, raw); delete mem[k]; } catch (e) { mem[k] = raw; }
}

// ---------- small helpers ----------
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const cnt = v => (Number.isInteger(v) && v >= 0 ? v : 0);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const str = (v, n, d) => (typeof v === 'string' ? v.slice(0, n) : d);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function dayOf(d) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function addDays(day, n) { const [y, m, d] = day.split('-').map(Number); return dayOf(new Date(y, m - 1, d + n)); }
function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function mulberry(a) { return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Expected score of a player rated a against b. */
const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
/** New rating after one game: s = 1 win, 0.5 draw, 0 loss; games = rated games played before this one. */
function eloStep(r, opp, s, games) { const k = games < NEW_GAMES ? K_NEW : K; return Math.max(FLOOR, Math.round(r + k * (s - expected(r, opp)))); }

// ---------- avatars: original icons, one colour disc + a white glyph ----------
const AV = [
  ['fox', '#e0763a', '<path d="M7 9 9 4l3 4 3-4 2 5c1 2 1 4-1 6l-4 3-4-3c-2-2-2-4-1-6z" fill="#fff"/><path d="M10 13h.01M14 13h.01" stroke="#333" stroke-width="1.8" stroke-linecap="round"/><path d="M12 16.2 11 15h2z" fill="#333"/>'],
  ['owl', '#8a6bd1', '<path d="M6 8c0-2 2-3 3-1l3 1 3-1c1-2 3-1 3 1v6c0 3-3 5-6 5s-6-2-6-5z" fill="#fff"/><circle cx="9.5" cy="11" r="1.9" fill="#333"/><circle cx="14.5" cy="11" r="1.9" fill="#333"/><path d="M12 13l-1 1.4h2z" fill="#e0a43a"/>'],
  ['cat', '#4f8fd8', '<path d="M6 6l3 3h6l3-3v8c0 3-3 5-6 5s-6-2-6-5z" fill="#fff"/><path d="M9.7 12.5h.01M14.3 12.5h.01" stroke="#333" stroke-width="2" stroke-linecap="round"/><path d="M11.2 15h1.6l-.8.9z" fill="#e57"/>'],
  ['bear', '#a06a42', '<circle cx="7.5" cy="7.5" r="2.4" fill="#fff"/><circle cx="16.5" cy="7.5" r="2.4" fill="#fff"/><circle cx="12" cy="13" r="6" fill="#fff"/><path d="M9.8 11.8h.01M14.2 11.8h.01" stroke="#333" stroke-width="1.9" stroke-linecap="round"/><ellipse cx="12" cy="15" rx="1.4" ry="1" fill="#333"/>'],
  ['crown', '#d6a419', '<path d="M5 17 4 8l4.5 3.5L12 6l3.5 5.5L20 8l-1 9z" fill="#fff"/><rect x="5" y="17.5" width="14" height="2" rx="1" fill="#fff"/>'],
  ['rocket', '#d8504f', '<path d="M12 3c3 2 4.5 5.5 4 10l-2 3h-4l-2-3c-.5-4.5 1-8 4-10z" fill="#fff"/><circle cx="12" cy="9.5" r="1.8" fill="#d8504f"/><path d="M8.5 13 6 16l3 .5M15.5 13 18 16l-3 .5" fill="#fff"/><path d="M11 17.5h2l-1 3z" fill="#f6c453"/>'],
  ['anchor', '#2f7d9a', '<circle cx="12" cy="5.5" r="2" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M12 7.5V19M8.5 10.5h7M5.5 13c0 3.5 3 6 6.5 6s6.5-2.5 6.5-6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>'],
  ['leaf', '#3f9c5a', '<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z" fill="#fff"/><path d="M6 18 15 9" stroke="#3f9c5a" stroke-width="1.5" stroke-linecap="round"/>'],
  ['flame', '#e2613a', '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 0 2 1 3 2 3-1-3 0-6 .5-8z" fill="#fff"/>'],
  ['bolt', '#6d63d8', '<path d="M13.5 3 6 13.5h5L10 21l8-11h-5z" fill="#fff"/>'],
  ['moon', '#3b4f8f', '<path d="M15.5 4.5a7.5 7.5 0 1 0 4 12.8A6.5 6.5 0 0 1 15.5 4.5z" fill="#fff"/><circle cx="17.5" cy="7" r="1" fill="#fff"/>'],
  ['sun', '#e59a1f', '<circle cx="12" cy="12" r="4" fill="#fff"/><path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>'],
  ['star', '#c94f8f', '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="#fff"/>'],
  ['gem', '#2aa6a0', '<path d="M7 5h10l3.5 4.5L12 20 3.5 9.5z" fill="#fff"/><path d="M3.5 9.5h17M9 5l3 15 3-15" fill="none" stroke="#2aa6a0" stroke-width="1.1"/>'],
  ['peak', '#5b6b84', '<path d="M3 19 9.5 8l3 5 2-3L21 19z" fill="#fff"/><path d="m9.5 8 1.8 3-1.8-.8-1.6.9z" fill="#5b6b84"/>'],
  ['wave', '#2f78c9', '<path d="M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 10c2-2 4-2 6 0s4 2 6 0 4-2 6 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'],
];
const AVATAR_IDS = AV.map(a => a[0]);
function avatarSVG(id, size) {
  const a = AV.find(x => x[0] === id) || AV[0];
  const s = size || 40;
  return `<svg class="pf-av" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="${a[1]}"/><circle cx="12" cy="12" r="11.3" fill="none" stroke="rgba(255,255,255,.28)" stroke-width=".8"/><g transform="translate(2.4 2.4) scale(.8)">${a[2]}</g></svg>`;
}

// ---------- state ----------
let cfg = { game: 'game', levels: [], achievements: [], modes: {}, daily: null, toast: true, now: () => new Date() };
let me = { name: '', avatar: 'fox' };
let st = null;   // this game's stats
let subs = [];

function cleanMe(o) {
  o = isObj(o) ? o : {};
  return { name: str(o.name, 20, '').trim(), avatar: AVATAR_IDS.includes(o.avatar) ? o.avatar : 'fox' };
}
const blankRec = () => ({ g: 0, w: 0, l: 0, d: 0 });
function cleanRec(r) { r = isObj(r) ? r : {}; return { g: cnt(r.g), w: cnt(r.w), l: cnt(r.l), d: cnt(r.d) }; }
function cleanMap(m, max) {
  const out = {};
  if (isObj(m)) Object.keys(m).slice(0, max || 200).forEach(k => { out[String(k).slice(0, 40)] = cleanRec(m[k]); });
  return out;
}
function blankStats() {
  return { v: 1, games: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, byMode: {}, byLevel: {},
    elo: { rating: START, peak: START, games: 0 }, ach: {}, daily: { days: {}, streak: 0, best: 0, last: '' }, recent: [], first: '' };
}
/** Whatever was stored (or imported) -> a complete, valid stats record. */
function cleanStats(o) {
  const d = blankStats();
  if (!isObj(o)) return d;
  ['games', 'wins', 'losses', 'draws', 'streak', 'bestStreak'].forEach(k => { d[k] = cnt(o[k]); });
  d.bestStreak = Math.max(d.bestStreak, d.streak);
  d.byMode = cleanMap(o.byMode); d.byLevel = cleanMap(o.byLevel);
  if (isObj(o.elo)) {
    d.elo.rating = Math.max(FLOOR, Math.round(num(o.elo.rating, START)));
    d.elo.peak = Math.max(d.elo.rating, Math.round(num(o.elo.peak, d.elo.rating)));
    d.elo.games = cnt(o.elo.games);
  }
  if (isObj(o.ach)) Object.keys(o.ach).slice(0, 200).forEach(k => { const v = o.ach[k]; if (typeof v === 'string' && DAY_RE.test(v)) d.ach[k.slice(0, 40)] = v; });
  if (isObj(o.daily)) {
    const days = isObj(o.daily.days) ? o.daily.days : {};
    Object.keys(days).filter(k => DAY_RE.test(k)).sort().slice(-MAX_DAYS).forEach(k => {
      const r = days[k]; if (!isObj(r)) return;
      d.daily.days[k] = { r: ['w', 'l', 'd', 'p'].includes(r.r) ? r.r : 'p', score: r.score == null ? null : num(r.score, null) };
    });
    d.daily.best = cnt(o.daily.best);
    d.daily.last = typeof o.daily.last === 'string' && DAY_RE.test(o.daily.last) ? o.daily.last : '';
    d.daily.streak = cnt(o.daily.streak);
    d.daily.best = Math.max(d.daily.best, d.daily.streak);
  }
  if (Array.isArray(o.recent)) d.recent = o.recent.slice(0, MAX_RECENT).filter(isObj).map(x => ({
    t: str(x.t, 10, ''), mode: str(x.mode, 30, ''), level: x.level == null ? null : str(String(x.level), 30, null),
    r: ['w', 'l', 'd', 'p'].includes(x.r) ? x.r : 'p', score: x.score == null ? null : num(x.score, null), elo: x.elo == null ? null : num(x.elo, null),
  }));
  d.first = typeof o.first === 'string' && DAY_RE.test(o.first) ? o.first : '';
  return d;
}
const saveMe = () => write(ID_KEY, me);
const saveStats = () => write(gameKey(cfg.game), st);
function emit(what) { subs.slice().forEach(fn => { try { fn(what); } catch (e) { /* ignore */ } }); }
const today = () => dayOf(cfg.now());

function load() { me = cleanMe(read(ID_KEY)); st = cleanStats(read(gameKey(cfg.game))); }

// ---------- levels ----------
function cleanLevels(list) {
  return (Array.isArray(list) ? list : []).filter(l => l && l.id != null).map(l => ({ id: String(l.id), name: String(l.name || l.id), rating: num(l.rating, START) }));
}
const levelOf = id => cfg.levels.find(l => l.id === String(id)) || null;

// ---------- achievements ----------
function ctx(last) {
  return { stats: snapshot(), last: last || null, levels: cfg.levels.slice(), daily: dailyInfo() };
}
function checkAchievements(last) {
  const got = [];
  const c = ctx(last);
  for (const a of cfg.achievements) {
    if (!a || !a.id || st.ach[a.id] || typeof a.test !== 'function') continue;
    let ok = false;
    try { ok = !!a.test(c); } catch (e) { ok = false; }
    if (ok) { st.ach[a.id] = today(); got.push({ id: a.id, title: a.title, desc: a.desc || '' }); }
  }
  return got;
}

// ---------- recording ----------
/** One finished game. o = { mode, level, won (true / false / null = nobody of mine), draw, score, daily, extra,
 *  date ('YYYY-MM-DD', for bringing in older games; default today), quiet (no banner) }. */
function recordResult(o) {
  o = o || {};
  if (!st) load();
  const mode = String(o.mode || 'computer').slice(0, 30);
  const draw = !!o.draw;
  const r = draw ? 'd' : o.won === true ? 'w' : o.won === false ? 'l' : 'p';
  const lv = o.level != null ? levelOf(o.level) : null;
  const t = typeof o.date === 'string' && DAY_RE.test(o.date) ? o.date : today();
  if (!st.first) st.first = t;
  st.games++;
  if (r === 'w') st.wins++; else if (r === 'l') st.losses++; else if (r === 'd') st.draws++;
  if (r === 'w') { st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); }
  else if (r === 'l' || r === 'd') st.streak = 0;
  const bm = st.byMode[mode] || (st.byMode[mode] = blankRec()); bm.g++; if (r !== 'p') bm[r]++;
  let elo = null;
  if (lv && r !== 'p') {
    const before = st.elo.rating, s = r === 'w' ? 1 : r === 'd' ? 0.5 : 0;
    st.elo.rating = eloStep(before, lv.rating, s, st.elo.games);
    st.elo.games++;
    st.elo.peak = Math.max(st.elo.peak, st.elo.rating);
    elo = { before, after: st.elo.rating, change: st.elo.rating - before };
    const bl = st.byLevel[lv.id] || (st.byLevel[lv.id] = blankRec()); bl.g++; bl[r]++;
  }
  let dailyNew = false;
  if (o.daily && !st.daily.days[t]) {
    dailyNew = true;
    st.daily.days[t] = { r, score: o.score == null ? null : num(o.score, null) };
    const keys = Object.keys(st.daily.days).sort();
    if (keys.length > MAX_DAYS) keys.slice(0, keys.length - MAX_DAYS).forEach(k => delete st.daily.days[k]);
    st.daily.streak = st.daily.last === addDays(t, -1) ? st.daily.streak + 1 : 1;
    st.daily.best = Math.max(st.daily.best, st.daily.streak);
    st.daily.last = t;
  }
  st.recent.unshift({ t, mode, level: lv ? lv.id : null, r, score: o.score == null ? null : num(o.score, null), elo: elo ? elo.after : null });
  st.recent = st.recent.slice(0, MAX_RECENT);
  const last = { mode, level: lv ? lv.id : null, won: r === 'w', draw: r === 'd', result: r, score: o.score == null ? null : o.score, daily: !!o.daily, dailyNew, elo, extra: isObj(o.extra) ? o.extra : {} };
  const unlocked = checkAchievements(last);
  saveStats();
  emit('result');
  // one banner per game, however many unlocked (the rest are named in the panel)
  if (unlocked.length && cfg.toast && !o.quiet) setTimeout(() => banner(unlocked[0], unlocked.length - 1), 900);
  if (unlocked.length && typeof cfg.onUnlock === 'function') unlocked.forEach(a => { try { cfg.onUnlock(a); } catch (e) { /* ignore */ } });
  return { unlocked, elo, streak: st.streak, daily: dailyNew ? dailyInfo() : null };
}

// ---------- daily ----------
function dailyInfo() {
  const t = today(), y = addDays(t, -1);
  const live = st.daily.last === t || st.daily.last === y;
  return { date: t, played: !!st.daily.days[t], result: st.daily.days[t] || null, streak: live ? st.daily.streak : 0, best: st.daily.best };
}
const daily = {
  /** Today's local date, YYYY-MM-DD (or the date of d). */
  date: d => (d ? dayOf(d) : today()),
  /** A 32-bit seed: same for every player on the same day of the same game. */
  seed: (day, salt) => hash((cfg.game || '') + '|' + (day || today()) + '|' + (salt || '')),
  /** A seeded random function (0..1), like Math.random, for building today's deal. */
  rng: (day, salt) => mulberry(daily.seed(day, salt)),
  played: day => !!(st && st.daily.days[day || today()]),
  result: day => (st && st.daily.days[day || today()]) || null,
  streak: () => { const i = dailyInfo(); return { cur: i.streak, best: i.best }; },
  info: () => dailyInfo(),
};

// ---------- export / import ----------
function exportJSON() {
  return JSON.stringify({ kit: 'game-profile', v: 1, exported: today(), me, games: { [cfg.game]: st } }, null, 1);
}
/** Replaces the name/avatar and the stats of every game in the file. Returns { ok, games, error }. */
function importJSON(text) {
  let o = null;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { ok: false, error: 'Not a profile file.' }; }
  if (!isObj(o) || o.kit !== 'game-profile' || !isObj(o.games)) return { ok: false, error: 'Not a profile file.' };
  const names = Object.keys(o.games).filter(k => /^[a-z0-9_-]{1,40}$/i.test(k) && isObj(o.games[k]));
  if (isObj(o.me)) { me = cleanMe(o.me); saveMe(); }
  names.forEach(k => write(gameKey(k), cleanStats(o.games[k])));
  st = cleanStats(read(gameKey(cfg.game)));
  emit('import');
  return { ok: true, games: names };
}

// ---------- read-only snapshot ----------
function snapshot() {
  const s = JSON.parse(JSON.stringify(st || blankStats()));
  s.name = me.name; s.avatar = me.avatar;
  return s;
}

// ---------- UI: banner ----------
const hasDoc = () => !!(G.document && G.document.body);
const icons = {
  close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  medal: (on) => `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M8 2h3l2 6H10zM13 2h3l-2 6h-3z" fill="${on ? '#c9473f' : '#4a4f60'}"/><circle cx="12" cy="15" r="6.5" fill="${on ? '#e8b53a' : '#3a3f4f'}" stroke="${on ? '#9c7414' : '#2a2e3a'}" stroke-width="1.2"/><path d="m12 11.3 1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3z" fill="${on ? '#fff6d8' : '#4d5263'}"/></svg>`,
};
function banner(a, more) {
  if (!hasDoc()) return;
  const doc = G.document;
  const el = doc.createElement('div');
  el.className = 'pf-banner';
  el.setAttribute('role', 'status');
  el.innerHTML = `${icons.medal(true)}<span><small>Achievement${more ? 's' : ''}</small>${esc(a.title)}${more ? ` <em>+${more} more</em>` : ''}</span>`;
  doc.body.appendChild(el);
  try { if (G.FX && G.FX.play) G.FX.play('ding', { cat: 'celebrations' }); } catch (e) { /* ignore */ }
  setTimeout(() => el.classList.add('out'), 2300);
  setTimeout(() => el.remove(), 2700);
}

// ---------- UI: My stats panel ----------
let ov = null, tab = 'levels', editing = false, lastFocus = null;
/** Draw columns: init's draws true/false wins; by default shown only once a draw has been recorded
 *  (so games that can't draw, like Clue, never show an empty "Drawn" column). */
const showDraws = () => (cfg.draws === true || cfg.draws === false ? cfg.draws : st.draws > 0);
const pct = (w, d, g) => (g ? Math.round(100 * (w + d / 2) / g) : null);
/** red -> green for a 0..100 score (tight range: 30% red, 70% green). */
function scale(p) { if (p == null) return 'var(--muted,#969db4)'; const t = Math.max(0, Math.min(1, (p - 30) / 40)); const h = Math.round(4 + t * 128); return `hsl(${h} 62% 62%)`; }
function levelsHTML() {
  const D = showDraws();
  const rows = cfg.levels.map(l => {
    const r = st.byLevel[l.id] || blankRec(), p = pct(r.w, r.d, r.g);
    return `<tr><td><b>${esc(l.name)}</b><small>${Math.round(l.rating)}</small></td><td>${r.w}</td>${D ? `<td>${r.d}</td>` : ''}<td>${r.l}</td><td style="color:${scale(p)}">${p == null ? '–' : p + '%'}</td></tr>`;
  }).join('');
  const other = Object.keys(st.byMode).filter(m => !(cfg.modes[m] && cfg.modes[m].hide) && m !== 'computer').map(m => {
    const r = st.byMode[m];
    const nm = (cfg.modes[m] && cfg.modes[m].name) || m;
    return `<tr><td><b>${esc(nm)}</b></td><td colspan="${D ? 4 : 3}">${r.g} game${r.g === 1 ? '' : 's'}${r.w + r.l + r.d ? ` · ${D ? `${r.w}–${r.d}–${r.l}` : `${r.w}–${r.l}`}` : ''}</td></tr>`;
  }).join('');
  // a game with no computer opponent (e.g. Wavelength) gets no empty "Vs the computer" heading
  return (cfg.levels.length ? `<h4>Vs the computer</h4><table class="pf-tbl"><thead><tr><th>Level</th><th>W</th>${D ? '<th>D</th>' : ''}<th>L</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table>` : '') +
    (other ? `<h4>Other games</h4><table class="pf-tbl pf-modes"><tbody>${other}</tbody></table>` : '');
}
function awardsHTML() {
  const list = cfg.achievements.filter(a => a && a.id);
  const n = list.filter(a => st.ach[a.id]).length;
  return `<h4>Achievements <span class="pf-n">${n} / ${list.length}</span></h4><div class="pf-aw">` + list.map(a => {
    const on = !!st.ach[a.id];
    return `<div class="pf-a ${on ? 'on' : ''}">${icons.medal(on)}<span><b>${esc(a.title)}</b><small>${esc(a.desc || '')}</small></span></div>`;
  }).join('') + '</div>';
}
function dailyHTML() {
  const d = dailyInfo(), title = (cfg.daily && cfg.daily.title) || 'Daily game';
  const word = { w: 'Won', l: 'Lost', d: 'Drawn', p: 'Played' };
  const strip = [];
  for (let i = 13; i >= 0; i--) {
    const k = addDays(d.date, -i), r = st.daily.days[k];
    strip.push(`<i class="pf-dd ${r ? 'r-' + r.r : ''}" title="${k}${r ? ': ' + word[r.r] : ''}"></i>`);
  }
  const canPlay = cfg.daily && typeof cfg.daily.onPlay === 'function';
  return `<h4>${esc(title)}</h4><div class="pf-day">
    <div class="pf-today"><small>Today</small><b>${d.played ? word[d.result.r] + (d.result.score != null ? ` · ${d.result.score}` : '') : 'Not played'}</b></div>
    ${canPlay ? `<button type="button" class="pf-btn ${d.played ? '' : 'pri'}" data-pf="play" ${d.played ? 'disabled' : ''}>${d.played ? 'Done today' : 'Play'}</button>` : ''}</div>
    <div class="pf-nums pf-nums2"><div><b>${d.streak}</b><small>Streak</small></div><div><b>${d.best}</b><small>Best</small></div></div>
    <div class="pf-strip" aria-label="Last 14 days">${strip.join('')}</div>`;
}
function editHTML() {
  return `<div class="pf-edit">
    <label class="pf-lab" for="pf-name">Name</label>
    <input type="text" id="pf-name" maxlength="20" autocomplete="nickname" placeholder="Your name" value="${esc(me.name)}">
    <span class="pf-lab">Picture</span>
    <div class="pf-pick" role="radiogroup" aria-label="Picture">${AVATAR_IDS.map(id => `<button type="button" role="radio" aria-checked="${me.avatar === id}" aria-label="${id}" data-av="${id}">${avatarSVG(id, 40)}</button>`).join('')}</div>
    <div class="pf-row"><button type="button" class="pf-btn" data-pf="export">Export</button><button type="button" class="pf-btn" data-pf="import">Import</button><input type="file" accept="application/json,.json" hidden data-pf="file"><button type="button" class="pf-btn pri" data-pf="done">Done</button></div>
    <div class="pf-msg" aria-live="polite">${blocked ? 'Storage is blocked here: stats last until you close the page.' : ''}</div></div>`;
}
function panelHTML() {
  const shown = st.wins + st.losses + st.draws;
  const tabs = [['levels', 'Levels'], ['awards', 'Awards']].concat(cfg.daily ? [['daily', 'Daily']] : []);
  if (!tabs.some(t => t[0] === tab)) tab = 'levels';
  return `<div class="pf-panel ${editing ? 'is-edit' : ''}" role="dialog" aria-modal="true" aria-label="My stats">
    <div class="pf-head">
      <button type="button" class="pf-me" data-pf="edit" aria-label="Change name and picture">${avatarSVG(me.avatar, 46)}<span class="pf-who"><b>${esc(me.name || 'You')}</b><small>${editing ? 'Editing' : 'Change'}</small></span></button>
      <div class="pf-elo"><small>Elo</small><b>${st.elo.rating}</b><small>best ${st.elo.peak}</small></div>
      <button type="button" class="pf-x" data-pf="close" aria-label="Close">${icons.close}</button>
    </div>
    ${editing ? editHTML() : `
    <div class="pf-nums${showDraws() ? '' : ' pf-nums5'}"><div><b>${st.games}</b><small>Games</small></div><div><b>${st.wins}</b><small>Won</small></div><div><b>${st.losses}</b><small>Lost</small></div>${showDraws() ? `<div><b>${st.draws}</b><small>Drawn</small></div>` : ''}<div><b style="color:${scale(pct(st.wins, st.draws, shown))}">${shown ? pct(st.wins, st.draws, shown) + '%' : '–'}</b><small>Score</small></div><div><b>${st.streak}</b><small>Streak${st.bestStreak ? ' · ' + st.bestStreak : ''}</small></div></div>
    <div class="pf-tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`).join('')}</div>
    <div class="pf-body" data-show="${tab}">
      <section class="pf-sec" data-sec="levels">${levelsHTML()}</section>
      <section class="pf-sec" data-sec="awards">${awardsHTML()}</section>
      ${cfg.daily ? `<section class="pf-sec" data-sec="daily">${dailyHTML()}</section>` : ''}
    </div>`}
  </div>`;
}
function draw() { if (ov) ov.innerHTML = panelHTML(); }
function msg(t) { const m = ov && ov.querySelector('.pf-msg'); if (m) m.textContent = t; }
function onClick(e) {
  const t = e.target;
  if (t === ov) { closePanel(); return; }
  const b = t.closest && t.closest('[data-pf],[data-tab],[data-av]');
  if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; const body = ov.querySelector('.pf-body'); if (body) body.dataset.show = tab; ov.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.tab === tab))); return; }
  if (b.dataset.av) { setAvatar(b.dataset.av); ov.querySelectorAll('[data-av]').forEach(x => x.setAttribute('aria-checked', String(x.dataset.av === me.avatar))); const h = ov.querySelector('.pf-me .pf-av'); if (h) h.outerHTML = avatarSVG(me.avatar, 46); return; }
  const k = b.dataset.pf;
  if (k === 'close') closePanel();
  else if (k === 'edit') { editing = !editing; draw(); if (editing) { const i = ov.querySelector('#pf-name'); if (i && !matchTouch()) i.focus(); } }
  else if (k === 'done') { editing = false; draw(); }
  else if (k === 'play') { closePanel(); try { cfg.daily.onPlay(); } catch (err) { /* game's problem */ } }
  else if (k === 'export') {
    try {
      const blob = new G.Blob([exportJSON()], { type: 'application/json' });
      const a = G.document.createElement('a');
      a.href = G.URL.createObjectURL(blob); a.download = `${cfg.game}-profile-${today()}.json`;
      G.document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => G.URL.revokeObjectURL(a.href), 4000);
      msg('Saved a copy to your downloads.');
    } catch (err) { msg('Export failed on this browser.'); }
  } else if (k === 'import') { const f = ov.querySelector('input[data-pf="file"]'); if (f) f.click(); }
}
function onChangeEv(e) {
  const t = e.target;
  if (t.id === 'pf-name') { setName(t.value); const w = ov.querySelector('.pf-who b'); if (w) w.textContent = me.name || 'You'; }
  if (t.dataset && t.dataset.pf === 'file' && t.files && t.files[0]) {
    const file = t.files[0];
    if (file.size > 2e6) { msg('That file is too big.'); return; }
    const fr = new G.FileReader();
    fr.onload = () => {
      const ok = G.confirm ? G.confirm('Replace your stats with the ones in this file?') : true;
      if (!ok) return;
      const r = importJSON(String(fr.result));
      if (!r.ok) { msg(r.error); return; }
      draw(); msg('Imported.');
    };
    fr.readAsText(file);
  }
}
const matchTouch = () => { try { return G.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
function onKey(e) { if (e.key === 'Escape' && ov) closePanel(); }
function openPanel(o) {
  if (!hasDoc()) return false;
  if (!st) load();
  o = o || {};
  if (o.tab) tab = o.tab;
  editing = !!o.edit;
  const doc = G.document;
  if (!ov) {
    ov = doc.createElement('div');
    ov.className = 'pf-ov';
    ov.addEventListener('click', onClick);
    ov.addEventListener('input', onChangeEv);
    ov.addEventListener('change', onChangeEv);
  }
  lastFocus = doc.activeElement;
  draw();
  doc.body.appendChild(ov);
  doc.addEventListener('keydown', onKey);
  const x = ov.querySelector('.pf-x'); if (x && !matchTouch()) x.focus({ preventScroll: true });
  emit('open');
  return true;
}
function closePanel() {
  if (!ov || !ov.isConnected) return false;
  ov.remove();
  editing = false;
  G.document.removeEventListener('keydown', onKey);
  try { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  emit('close');
  return true;
}

// ---------- identity ----------
function setName(n) { if (!st) load(); me.name = str(String(n == null ? '' : n), 20, '').trim(); saveMe(); emit('me'); return me.name; }
function setAvatar(id) { if (!st) load(); if (!AVATAR_IDS.includes(id)) return false; me.avatar = id; saveMe(); emit('me'); return true; }

// ---------- init ----------
function init(o) {
  o = o || {};
  cfg = {
    game: /^[a-z0-9_-]{1,40}$/i.test(o.game || '') ? o.game : 'game',
    levels: cleanLevels(o.levels),
    achievements: Array.isArray(o.achievements) ? o.achievements.filter(a => a && a.id && typeof a.test === 'function') : [],
    modes: isObj(o.modes) ? o.modes : {},
    daily: o.daily ? (isObj(o.daily) ? o.daily : {}) : null,
    draws: o.draws === true || o.draws === false ? o.draws : 'auto',
    toast: o.toast !== false,
    onUnlock: o.onUnlock,
    now: typeof o.now === 'function' ? o.now : () => new Date(),
  };
  load();
  if (!me.name && o.name) { me.name = str(String(o.name), 20, '').trim(); saveMe(); }
  // achievements that are already true (e.g. a list that grew) unlock quietly
  if (checkAchievements(null).length) saveStats();
  if (o.onChange) onChange(o.onChange);
  return Profile;
}
function onChange(fn) { if (typeof fn === 'function') subs.push(fn); return () => { subs = subs.filter(f => f !== fn); }; }
function reset() { st = blankStats(); saveStats(); emit('reset'); }

const Profile = {
  version: VERSION, init, recordResult, openPanel, closePanel, onChange, setName, setAvatar, avatarSVG, reset,
  export: exportJSON, import: importJSON, daily,
  isOpen: () => !!(ov && ov.isConnected),
  stats: () => snapshot(),
  get name() { return me.name; }, get avatar() { return me.avatar; },
  get elo() { return st ? st.elo.rating : START; },
  get storageBlocked() { if (!st) load(); return blocked; },
  avatars: AVATAR_IDS.slice(),
  levelRating: id => { const l = levelOf(id); return l ? l.rating : null; },
  // pure helpers (tested)
  _: { expected, eloStep, cleanStats, cleanMe, hash, mulberry, addDays, dayOf, START, panelHTML },
};
G.Profile = Profile;
})(typeof window !== 'undefined' ? window : globalThis);
