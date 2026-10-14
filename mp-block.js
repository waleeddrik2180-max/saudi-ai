/* ===================== Multiplayer (Socket.io) =====================
   الصق هذا البلوك كامل داخل الـ IIFE في اللعبة،
   قبل السطر:  /* ===================== Run logic ===================== *​/
*/
var MP_URL = 'https://gcqscbmkc1.onrender.com';
var MP_ROUTES = ['long', 'short', 'desert', 'night', 'rush', 'corniche', 'mountain', 'ring', 'flood', 'safar'];
var MP = { sock: null, me: null, room: null, host: null, players: [], peers: {}, racing: false, route: 'long', day: 1, diff: 1, ready: false, last: 0 };
var railEls = {};
function mpClean(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, ''); }
function mpName() { var n = chCfg().name; return mpClean(n || ('لاعب' + (100 + Math.floor(Math.random() * 900)))).slice(0, 14); }
function mpAck(r) { if (r && r.err) toast(r.err); }
function mpRerender() { if (mode === 'home') { var st = $('home').scrollTop; renderHome(); $('home').scrollTop = st; refresh(); } }

function mpConnect() {
  if (MP.sock) return true;
  if (typeof io === 'undefined') { toast('الأونلاين يشتغل بس لما تفتح اللعبة من رابط السيرفر'); return false; }
  var s = MP.sock = MP_URL ? io(MP_URL, { transports: ['websocket'] }) : io({ transports: ['websocket'] });
  s.on('connect', function () { MP.me = s.id; });
  s.on('room', function (r) {
    MP.room = r.id; MP.host = r.host; MP.players = r.players; MP.route = r.route; MP.day = r.day; MP.diff = r.diff;
    var me = r.players.filter(function (p) { return p.id === s.id; })[0]; MP.ready = !!(me && me.ready);
    mpRerender();
  });
  s.on('start', function (d) { mpCountdown(Math.round((d.in || 3000) / 1000)); });
  s.on('snap', function (arr) {
    var now = performance.now();
    arr.forEach(function (a) {
      if (a[0] === s.id) return;
      var p = MP.peers[a[0]] || (MP.peers[a[0]] = { dx: a[1] });
      p.x = a[1]; p.v = a[2]; p.h = a[3]; p.t = now;
    });
  });
  s.on('results', mpResults);
  s.on('disconnect', function () { MP.room = null; MP.racing = false; MP.players = []; MP.peers = {}; mpRerender(); refresh(); });
  return true;
}

/* عدّ تنازلي 3-2-1 ثم يبدأ الكل مع بعض */
function mpCountdown(n) {
  var el = $('pause');
  (function tick() {
    if (!MP.room || mode === 'run') { el.hidden = true; return; }
    if (n > 0) { el.hidden = false; el.textContent = n; sfx('click'); n--; setTimeout(tick, 1000); }
    else { el.hidden = true; el.textContent = tx('pauseTxt'); MP.racing = true; MP.peers = {}; MP.last = 0; startRun(); }
  })();
}

/* يرسل موقعك 10 مرات بالثانية */
function mpTick(ts) {
  if (!MP.sock || ts - MP.last < 100 || !R) return;
  MP.last = ts;
  MP.sock.volatile.emit('state', { x: R.x, v: R.v, h: R.hold ? 1 : 0 });
}
function mpFinish(ok) { MP.racing = false; if (MP.sock) MP.sock.emit('finish', { ok: !!ok }); }
function mpReady() { if (MP.sock) MP.sock.emit('ready', !MP.ready); }

function mpResults(res) {
  var me = MP.me, rank = -1;
  res.forEach(function (r, i) { if (r.id === me) rank = i; });
  var html = '<b>🏁 ترتيب السباق</b>' + res.map(function (r, i) {
    return '<div class="ln"><span>' + (i + 1) + '. ' + mpClean(r.name) + (r.id === me ? ' (أنت)' : '') + '</span><b>' + (r.ok ? r.t.toFixed(1) + ' ث' : '✗') + '</b></div>';
  }).join('');
  var c = document.querySelector('#end .endcard');
  if (c) { var d = document.createElement('div'); d.innerHTML = html; c.appendChild(d); }
  if (rank === 0 && res[0].ok && res.length > 1) { var b = 50 * res.length; S.money += b; save(); toast('🥇 +' + b + ' م'); refresh(); }
  MP.peers = {};
}

/* قسم الأونلاين في الشاشة الرئيسية */
function mpUI() {
  var h = '<div class="routes"><h3>🌐 أونلاين</h3>';
  if (!MP.room) {
    h += '<div class="routegrid"><button class="route safe" data-mp="create"><div class="rt"><b>أنشئ غرفة</b></div><p>سوّ غرفة وأرسل الرابط لخويك.</p></button>' +
      '<button class="route sand" data-mp="join"><div class="rt"><b>ادخل غرفة</b></div><p>اكتب رمز الغرفة اللي عطاك إياه خويك.</p></button></div>';
  } else {
    var link = location.origin + location.pathname + '?room=' + MP.room, isHost = MP.host === MP.me;
    h += '<div class="special"><b>غرفة ' + MP.room + '</b><span dir="ltr">' + link + '</span><button class="buy" data-mp="copy">نسخ الرابط</button></div>';
    h += '<ol class="toplist">' + MP.players.map(function (p) {
      return '<li><span style="color:' + p.col + '">●</span> ' + mpClean(p.name) + (p.id === MP.host ? ' 👑' : '') + (p.id === MP.me ? ' (أنت)' : '') + (p.ready ? ' ✓ جاهز' : '') + '</li>';
    }).join('') + '</ol>';
    h += '<p class="muted">الطريق: ' + tx('route')[MP.route][0] + ' · يوم ' + MP.day + ' · اضغط الزر الكبير تحت عشان تجهز، ويبدأ السباق لما الكل يجهز.</p>';
    if (isHost) h += '<button class="buy" data-mp="cfg">اعتمد الطريق المختار (فوق) للغرفة</button>';
    h += '<button class="reset" data-mp="leave">خروج من الغرفة</button>';
  }
  return h + '</div>';
}
function mpClick(a) {
  if (a === 'create' || a === 'join') {
    if (!mpConnect()) return;
    var info = { name: mpName(), col: paintCol(VEH[S.veh])[0] };
    if (a === 'create') MP.sock.emit('create', { name: info.name, col: info.col, route: MP_ROUTES.indexOf(S.route) >= 0 ? S.route : 'long', day: S.day, diff: getDiff() }, mpAck);
    else { var c = (prompt('رمز الغرفة؟') || '').trim().toUpperCase(); if (c) MP.sock.emit('join', { room: c, name: info.name, col: info.col }, mpAck); }
  } else if (a === 'cfg') {
    if (MP_ROUTES.indexOf(S.route) < 0) { toast('اختر طريق ثاني (الروقان والمدفوع والمخصص ما ينفع للأونلاين)'); return; }
    MP.sock.emit('config', { route: S.route, day: S.day, diff: getDiff() });
  } else if (a === 'copy') {
    var link = location.origin + location.pathname + '?room=' + MP.room;
    try { navigator.clipboard.writeText(link).then(function () { toast('اننسخ الرابط ✓'); }, function () { toast(link); }); } catch (e) { toast(link); }
  } else if (a === 'leave') {
    if (MP.sock) MP.sock.emit('leave');
    MP.room = null; MP.players = []; MP.peers = {}; MP.ready = false; mpRerender();
  }
}
function mpAuto() {
  var q = (new URLSearchParams(location.search).get('room') || '').toUpperCase().slice(0, 4);
  if (!q || !mpConnect()) return;
  MP.sock.emit('join', { room: q, name: mpName(), col: paintCol(VEH[S.veh])[0] }, mpAck);
}

/* رسم سيارات اللاعبين الثانيين على الخط + مؤشرهم على شريط التقدم */
function drawGhosts(camX, Y) {
  if (!MP.racing || mode !== 'run' || !R) return;
  var now = performance.now(), idx = 0;
  MP.players.forEach(function (pl) {
    var p = MP.peers[pl.id]; if (pl.id === MP.me || !p || p.x === undefined) return;
    idx++;
    var gx = p.x + p.v * Math.min(.25, (now - p.t) / 1000);
    p.dx += (gx - p.dx) * .25;
    var sx = (p.dx - camX) * PX;
    ctx.save(); ctx.textAlign = 'center'; ctx.font = '700 12px "IBM Plex Sans Arabic", sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.fillStyle = '#fff';
    if (sx < -60 || sx > W + 60) {
      var right = sx > W, tag = (right ? '▶ ' : '◀ ') + mpClean(pl.name) + ' ' + Math.round(Math.abs(p.dx - R.x)) + 'م';
      ctx.textAlign = right ? 'right' : 'left'; ctx.strokeText(tag, right ? W - 8 : 8, H * .4 + idx * 18); ctx.fillText(tag, right ? W - 8 : 8, H * .4 + idx * 18);
    } else {
      var y = Y(p.dx) + (idx % 3) * 3, a = Math.atan(slopeAt(p.dx) * YS / PX);
      ctx.globalAlpha = .9; npcCar(sx, y, pl.col, a); ctx.globalAlpha = 1;
      ctx.strokeText(mpClean(pl.name), sx, y - 46); ctx.fillText(mpClean(pl.name), sx, y - 46);
    }
    ctx.restore();
  });
}
function mpRail() {
  var rail = document.querySelector('.rail'), live = {};
  if (MP.racing && mode === 'run' && R) MP.players.forEach(function (pl) {
    var p = MP.peers[pl.id]; if (pl.id === MP.me || !p || p.dx === undefined) return;
    live[pl.id] = 1;
    var u = railEls[pl.id]; if (!u) { u = railEls[pl.id] = document.createElement('u'); rail.appendChild(u); }
    u.style.background = pl.col; u.style.left = clamp(p.dx / R.dist, 0, 1) * 100 + '%';
  });
  Object.keys(railEls).forEach(function (id) { if (!live[id]) { railEls[id].remove(); delete railEls[id]; } });
}
