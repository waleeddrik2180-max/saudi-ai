const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(404); return res.end('index.html not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const clean = (s) => String(s || 'لاعب').replace(/[<>&"']/g, '').trim().slice(0, 12) || 'لاعب';
const other = (ws) => { const r = rooms.get(ws.room); return r ? r.players.find((p) => p !== ws) : null; };
function newCode() { let c; do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c)); return c; }

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    if (raw.length > 500) return;
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'create' && !ws.room) {
      const day = Math.max(1, Math.min(999, parseInt(m.cfg && m.cfg.day) || 1));
      const route = m.cfg && m.cfg.route === 'short' ? 'short' : 'long';
      const code = newCode();
      ws.name = clean(m.name); ws.room = code;
      rooms.set(code, { players: [ws], cfg: { day, route }, fin: {}, winner: false });
      send(ws, { t: 'created', code, cfg: { day, route } });

    } else if (m.t === 'join' && !ws.room) {
      const room = rooms.get(String(m.code));
      if (!room) return send(ws, { t: 'err', msg: 'ما لقيت غرفة بهذا الكود' });
      if (room.players.length >= 2) return send(ws, { t: 'err', msg: 'الغرفة ممتلئة' });
      ws.name = clean(m.name); ws.room = String(m.code);
      room.players.push(ws);
      const names = room.players.map((p) => p.name);
      room.players.forEach((p) => send(p, { t: 'ready', names, cfg: room.cfg }));

    } else if (m.t === 'start') {
      const room = rooms.get(ws.room);
      if (room && room.players[0] === ws && room.players.length === 2) {
        room.fin = {}; room.winner = false;
        room.players.forEach((p) => send(p, { t: 'go' }));
      }

    } else if (m.t === 'pos') {
      const o = other(ws);
      if (o) send(o, { t: 'pos', x: +m.x || 0, v: +m.v || 0, veh: Math.max(0, Math.min(3, parseInt(m.veh) || 0)) });

    } else if (m.t === 'fin') {
      const room = rooms.get(ws.room);
      if (!room || room.winner) return;
      const o = other(ws);
      if (m.ok) {
        room.winner = true;
        send(ws, { t: 'result', win: true });
        send(o, { t: 'result', win: false });
      } else {
        room.fin[room.players.indexOf(ws)] = true;
        if (!o || room.fin[room.players.indexOf(o)]) room.players.forEach((p) => send(p, { t: 'result', win: null }));
      }
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    room.players = room.players.filter((p) => p !== ws);
    if (!room.players.length) rooms.delete(ws.room);
    else send(room.players[0], { t: 'left' });
  });
});

setInterval(() => {
  wss.clients.forEach((ws) => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); });
}, 30000);

server.listen(PORT, () => console.log('listening on ' + PORT));
