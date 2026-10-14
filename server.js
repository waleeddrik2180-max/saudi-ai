// سيرفر أونلاين لـ "طريق الدوام" — Node + Express + Socket.io
// التشغيل: npm install && npm start  ثم افتح http://localhost:3000
// حط ملف اللعبة باسم public/index.html
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const ROUTES_OK = new Set(['long', 'short', 'desert', 'night', 'rush', 'corniche', 'mountain', 'ring', 'flood', 'safar']);
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 1;          // خلّها 2 إذا تبي السباق ما يبدأ إلا بين لاعبين
const MAX_RACE_MS = 4 * 60 * 1000;
const MAX_SPEED = 120;          // م/ث، حد أعلى لمنع القفز في الموقع
const rooms = new Map();

const clean = (s, n) => String(s == null ? '' : s).replace(/[<>&"'`]/g, '').slice(0, n);
const color = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#e0362d');
const int = (v, a, b, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function pub(r) {
  return {
    id: r.id, host: r.host, route: r.route, day: r.day, diff: r.diff, state: r.state,
    players: [...r.players.values()].map((p) => ({ id: p.id, name: p.name, col: p.col, ready: p.ready }))
  };
}
const push = (r) => io.to(r.id).emit('room', pub(r));

function addPlayer(r, socket, d) {
  r.players.set(socket.id, {
    id: socket.id, name: clean(d.name, 14) || 'لاعب', col: color(d.col),
    ready: false, x: 0, v: 0, h: 0, ts: 0, fin: null
  });
  socket.join(r.id);
  socket.data.room = r.id;
}

function endRace(r) {
  if (r.state !== 'racing') return;
  clearTimeout(r.timer);
  const results = [...r.players.values()]
    .map((p) => ({ id: p.id, name: p.name, ok: !!(p.fin && p.fin.ok), t: p.fin ? p.fin.t : null }))
    .sort((a, b) => (b.ok - a.ok) || ((a.t == null ? 1e9 : a.t) - (b.t == null ? 1e9 : b.t)));
  r.state = 'lobby';
  r.players.forEach((p) => { p.ready = false; p.fin = null; p.x = 0; p.v = 0; p.h = 0; });
  io.to(r.id).emit('results', results);
  push(r);
}
function maybeStart(r) {
  if (r.state !== 'lobby' || r.players.size < MIN_PLAYERS) return;
  if (![...r.players.values()].every((p) => p.ready)) return;
  r.state = 'racing';
  r.startAt = Date.now() + 3000;
  r.players.forEach((p) => { p.x = 0; p.v = 0; p.h = 0; p.ts = 0; p.fin = null; });
  io.to(r.id).emit('start', { in: 3000 });
  push(r);
  r.timer = setTimeout(() => endRace(r), MAX_RACE_MS);
}
function leave(socket) {
  const r = rooms.get(socket.data.room);
  socket.data.room = null;
  if (!r) return;
  socket.leave(r.id);
  r.players.delete(socket.id);
  if (!r.players.size) { clearTimeout(r.timer); rooms.delete(r.id); return; }
  if (r.host === socket.id) r.host = r.players.keys().next().value;
  if (r.state === 'racing' && [...r.players.values()].every((p) => p.fin)) endRace(r);
  else push(r);
}

io.on('connection', (socket) => {
  socket.on('create', (d, cb) => {
    d = d || {};
    leave(socket);
    const r = {
      id: newCode(), host: socket.id, state: 'lobby', players: new Map(), timer: null, startAt: 0,
      route: ROUTES_OK.has(d.route) ? d.route : 'long', day: int(d.day, 1, 500, 1), diff: int(d.diff, 0, 2, 1)
    };
    rooms.set(r.id, r);
    addPlayer(r, socket, d);
    push(r);
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('join', (d, cb) => {
    d = d || {};
    const r = rooms.get(clean(d.room, 4).toUpperCase());
    const reply = typeof cb === 'function' ? cb : () => {};
    if (!r) return reply({ err: 'الغرفة مو موجودة' });
    if (r.state !== 'lobby') return reply({ err: 'السباق شغال الحين، انتظر لين يخلص' });
    if (r.players.size >= MAX_PLAYERS) return reply({ err: 'الغرفة ممتلئة' });
    leave(socket);
    addPlayer(r, socket, d);
    push(r);
    reply({ ok: true });
  });

  socket.on('config', (d) => {
    const r = rooms.get(socket.data.room);
    if (!r || r.host !== socket.id || r.state !== 'lobby' || !d) return;
    if (ROUTES_OK.has(d.route)) r.route = d.route;
    r.day = int(d.day, 1, 500, r.day);
    r.diff = int(d.diff, 0, 2, r.diff);
    r.players.forEach((p) => { p.ready = false; });
    push(r);
  });

  socket.on('ready', (v) => {
    const r = rooms.get(socket.data.room);
    const p = r && r.players.get(socket.id);
    if (!p || r.state !== 'lobby') return;
    p.ready = !!v;
    push(r);
    maybeStart(r);
  });

  socket.on('state', (d) => {
    const r = rooms.get(socket.data.room);
    const p = r && r.players.get(socket.id);
    if (!p || r.state !== 'racing' || p.fin || !d) return;
    const now = Date.now(), dt = p.ts ? (now - p.ts) / 1000 : 0.1, x = +d.x;
    p.ts = now;
    if (Number.isFinite(x) && x >= p.x && x - p.x <= MAX_SPEED * dt + 10) p.x = x;
    p.v = Math.max(0, Math.min(80, +d.v || 0));
    p.h = d.h ? 1 : 0;
  });

  socket.on('finish', (d) => {
    const r = rooms.get(socket.data.room);
    const p = r && r.players.get(socket.id);
    if (!p || r.state !== 'racing' || p.fin) return;
    p.fin = { ok: !!(d && d.ok), t: Math.max(0, (Date.now() - r.startAt) / 1000) };  // الوقت يحسبه السيرفر
    if ([...r.players.values()].every((q) => q.fin)) endRace(r);
  });

  socket.on('leave', () => leave(socket));
  socket.on('disconnect', () => leave(socket));
});

// بث مواقع السيارات 10 مرات بالثانية (volatile = لو تأخرت الحزمة تنرمي)
setInterval(() => {
  rooms.forEach((r) => {
    if (r.state !== 'racing') return;
    io.to(r.id).volatile.emit('snap', [...r.players.values()].map((p) => [p.id, +p.x.toFixed(1), +p.v.toFixed(1), p.h]));
  });
}, 100);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Dawam server on :' + PORT));
