'use strict';
// EkoZeka2026 "Gerçek mi, Yapay mı?" canlı oyun sunucusu.
// Oyun durumu bellektedir: yeniden başlatınca skorlar sıfırlanır.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 3000;
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS) || 20;
const QUESTION_COUNT = Number(process.env.QUESTION_COUNT) || Infinity;
// Dev ekran (admin) şifresi. Yayında mutlaka ADMIN_PASSWORD ortam değişkeniyle ver.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.HOST_KEY || crypto.randomBytes(4).toString('hex');
const passwordHash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const ADMIN_HASH = passwordHash(ADMIN_PASSWORD);
const isAdminPassword = (s) => typeof s === 'string' && crypto.timingSafeEqual(passwordHash(s), ADMIN_HASH);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'images');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PLAYERS = 2000;

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// ---------- Sorular ----------
// Dosya adı cevabı ele vereceği için istemciye yalnızca rastgele kimlik gider.
const imageById = new Map();

// .txt biçimi: 1. satır başlık, 2. satır açıklama, varsa "Foto:" ile başlayan satır kaynak.
function readCaption(file) {
  if (!fs.existsSync(file)) return { title: '', hint: '', credit: '' };
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const credit = lines.find((l) => /^foto:/i.test(l)) || '';
  const [title = '', ...rest] = lines.filter((l) => l !== credit);
  return { title: title.slice(0, 90), hint: rest.join(' ').slice(0, 260), credit: credit.slice(0, 120) };
}

function scanQuestions() {
  const out = [];
  for (const [folder, answer] of [['gercek', 'real'], ['yapay', 'ai']]) {
    const dir = path.join(IMAGES_DIR, folder);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!IMG_EXT.has(path.extname(file).toLowerCase())) continue;
      const full = path.join(dir, file);
      const captionFile = full.slice(0, -path.extname(file).length) + '.txt';
      out.push({ file: full, answer, ...readCaption(captionFile) });
    }
  }
  return out;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---------- Oyun durumu ----------
const players = new Map(); // token -> oyuncu
const hosts = new Set();
const game = { phase: 'lobby', order: [], index: -1, deadline: 0, startedAt: 0, votes: new Map(), results: [], final: null, timer: null };

function pct(part, whole) { return whole ? Math.round((part / whole) * 100) : 0; }

function resetGame() {
  clearTimeout(game.timer);
  Object.assign(game, { phase: 'lobby', order: [], index: -1, deadline: 0, startedAt: 0, votes: new Map(), results: [], final: null });
  for (const p of players.values()) { p.score = 0; p.ms = 0; }
}

function ranking() {
  return [...players.values()].sort((a, b) => b.score - a.score || a.ms - b.ms);
}

function expectedVoters() {
  let n = game.votes.size;
  for (const p of players.values()) if (p.conns.size > 0 && !game.votes.has(p.token)) n++;
  return n;
}

function startGame() {
  const questions = shuffle(scanQuestions()).slice(0, QUESTION_COUNT);
  if (!questions.length) return toastHosts('images/gercek ve images/yapay klasörlerinde görsel yok.');
  imageById.clear();
  game.order = questions.map((q) => {
    const id = crypto.randomBytes(8).toString('hex');
    imageById.set(id, q.file);
    return { ...q, img: `/img/${id}` };
  });
  game.results = [];
  game.index = -1;
  nextQuestion();
}

function nextQuestion() {
  game.index++;
  if (game.index >= game.order.length) return finishGame();
  game.phase = 'question';
  game.votes = new Map();
  game.startedAt = Date.now();
  game.deadline = game.startedAt + ROUND_SECONDS * 1000;
  clearTimeout(game.timer);
  game.timer = setTimeout(reveal, ROUND_SECONDS * 1000 + 250);
  broadcastState();
}

function reveal() {
  if (game.phase !== 'question') return;
  clearTimeout(game.timer);
  const q = game.order[game.index];
  let real = 0, correct = 0;
  for (const [token, vote] of game.votes) {
    if (vote.choice === 'real') real++;
    const isCorrect = vote.choice === q.answer;
    if (isCorrect) correct++;
    const p = players.get(token);
    if (!p) continue;
    if (isCorrect) { p.score++; p.ms += vote.ms; }
  }
  const total = game.votes.size;
  const realPct = pct(real, total);
  game.results[game.index] = {
    img: q.img, answer: q.answer, title: q.title, hint: q.hint, credit: q.credit, total, correct,
    realCount: real, aiCount: total - real,
    realPct, aiPct: total ? 100 - realPct : 0,
    correctPct: pct(correct, total),
  };
  game.phase = 'reveal';
  broadcastState();
}

function finishGame() {
  clearTimeout(game.timer);
  game.phase = 'final';
  const answered = game.results.filter((r) => r.total > 0);
  const votes = answered.reduce((s, r) => s + r.total, 0);
  const correct = answered.reduce((s, r) => s + r.correct, 0);
  const humanPct = pct(correct, votes);
  const hardest = answered.reduce((w, r) => (!w || r.correctPct < w.correctPct ? r : w), null);
  game.final = {
    votes,
    humanPct,
    aiPct: votes ? 100 - humanPct : 0,
    hardest: hardest && { img: hardest.img, answer: hardest.answer, title: hardest.title, fooledPct: 100 - hardest.correctPct },
  };
  broadcastState();
}

function advance() {
  if (game.phase === 'lobby') startGame();
  else if (game.phase === 'question') reveal();
  else if (game.phase === 'reveal') nextQuestion();
}

function maybeAutoReveal() {
  if (game.phase === 'question' && game.votes.size > 0 && game.votes.size >= expectedVoters()) reveal();
}

// ---------- Durum mesajları ----------
function baseState() {
  const s = { type: 'state', now: Date.now(), phase: game.phase, index: game.index, total: game.order.length, seconds: ROUND_SECONDS, playerCount: players.size };
  if (game.phase === 'question') {
    s.img = game.order[game.index].img;
    s.deadline = game.deadline;
    s.voted = game.votes.size;
    s.expected = expectedVoters();
  }
  if (game.phase === 'reveal') {
    s.reveal = game.results[game.index];
    const next = game.order[game.index + 1];
    s.nextImg = next ? next.img : null;
  }
  if (game.phase === 'final') s.final = game.final;
  return s;
}

function playerState(p, base, ranks) {
  const s = { ...base };
  if (!p) return { ...s, me: null };
  const vote = game.votes.get(p.token);
  s.me = { name: p.name, score: p.score, rank: ranks.get(p.token), vote: vote ? vote.choice : null };
  return s;
}

function hostState(base) {
  const s = { ...base };
  if (game.phase === 'final') {
    s.top = ranking().slice(0, 10).map((p, i) => ({ id: p.id, rank: i + 1, name: p.name, score: p.score, sec: Math.round(p.ms / 100) / 10 }));
  }
  if (game.phase === 'lobby') {
    s.players = playerList();
    const qs = scanQuestions();
    s.imageCounts = { real: qs.filter((q) => q.answer === 'real').length, ai: qs.filter((q) => q.answer === 'ai').length };
  }
  return s;
}

function playerList() {
  return [...players.values()].map((p) => ({ id: p.id, name: p.name, online: p.conns.size > 0 }));
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

function sendPlayerState(ws, token) {
  const ranks = new Map(ranking().map((p, i) => [p.token, i + 1]));
  send(ws, playerState(players.get(token), baseState(), ranks));
}

const anonymous = new Set(); // takma ad girmemiş bağlantılar

function broadcastState() {
  progressPending = false;
  const base = baseState();
  const ranks = new Map(ranking().map((p, i) => [p.token, i + 1]));
  for (const p of players.values()) {
    const payload = JSON.stringify(playerState(p, base, ranks));
    for (const ws of p.conns) send(ws, payload);
  }
  const anon = JSON.stringify({ ...base, me: null });
  for (const ws of anonymous) send(ws, anon);
  const hostPayload = JSON.stringify(hostState(base));
  for (const ws of hosts) send(ws, hostPayload);
}

// Oy ve katılım sayaçları kalabalıkta saniyede en çok 5 kez yayınlanır.
let progressPending = false;
function scheduleProgress() {
  if (progressPending) return;
  progressPending = true;
  setTimeout(() => {
    if (!progressPending) return;
    progressPending = false;
    const msg = { type: 'progress', playerCount: players.size };
    if (game.phase === 'question') { msg.voted = game.votes.size; msg.expected = expectedVoters(); }
    const payload = JSON.stringify(msg);
    for (const p of players.values()) for (const ws of p.conns) send(ws, payload);
    const hostPayload = JSON.stringify(game.phase === 'lobby' ? { ...msg, players: playerList() } : msg);
    for (const ws of hosts) send(ws, hostPayload);
  }, 200);
}

function toastHosts(text) { for (const ws of hosts) send(ws, { type: 'toast', text }); }

// ---------- İstemci mesajları ----------
function cleanName(raw) {
  return String(raw || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function uniqueName(name) {
  const taken = new Set([...players.values()].map((p) => p.name.toLocaleLowerCase('tr')));
  if (!taken.has(name.toLocaleLowerCase('tr'))) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name.slice(0, 13)} ${i}`;
    if (!taken.has(candidate.toLocaleLowerCase('tr'))) return candidate;
  }
}

function onPlayerMessage(ws, token, msg) {
  const player = players.get(token);
  if (msg.type === 'join') {
    if (player) return sendPlayerState(ws, token);
    const name = cleanName(msg.name);
    if (!name) return send(ws, { type: 'joinError', text: 'Bir takma ad yaz.' });
    if (players.size >= MAX_PLAYERS) return send(ws, { type: 'joinError', text: 'Oyun dolu.' });
    anonymous.delete(ws);
    players.set(token, { token, id: crypto.randomBytes(6).toString('hex'), name: uniqueName(name), score: 0, ms: 0, conns: new Set([ws]) });
    sendPlayerState(ws, token);
    scheduleProgress();
    return;
  }
  if (msg.type === 'vote' && player && game.phase === 'question') {
    if (msg.choice !== 'real' && msg.choice !== 'ai') return;
    const now = Date.now();
    if (game.votes.has(token) || now > game.deadline + 250) return;
    game.votes.set(token, { choice: msg.choice, ms: now - game.startedAt });
    sendPlayerState(ws, token);
    maybeAutoReveal();
    if (game.phase === 'question') scheduleProgress();
  }
}

function onHostMessage(msg) {
  if (msg.type === 'advance') advance();
  else if (msg.type === 'reset') { resetGame(); broadcastState(); }
  else if (msg.type === 'kick') {
    for (const p of players.values()) {
      if (p.id !== msg.id) continue;
      players.delete(p.token);
      game.votes.delete(p.token);
      for (const ws of p.conns) {
        anonymous.add(ws);
        send(ws, { type: 'kicked' });
        send(ws, { ...baseState(), me: null });
      }
      maybeAutoReveal();
      scheduleProgress();
      break;
    }
  }
}

// ---------- Katılım adresi ve QR ----------
function lanAddress() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/virtual|vethernet|vmware|vbox|wsl|hyper-v|loopback|docker|tailscale/i.test(name)) continue;
    for (const a of addrs) if (a.family === 'IPv4' && !a.internal) candidates.push(a.address);
  }
  return candidates.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) || candidates[0] || 'localhost';
}

function joinUrlFor(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host || /^(localhost|127\.|\[::1\])/.test(host)) return `http://${lanAddress()}:${PORT}`;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${host}`;
}

// ---------- HTTP ----------
function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Bulunamadı'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'no-cache');
  if (pathname === '/host') return serveFile(res, path.join(PUBLIC_DIR, 'host.html'), 'no-cache');
  if (pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (pathname.startsWith('/img/')) {
    const file = imageById.get(pathname.slice(5));
    if (!file) { res.writeHead(404); return res.end(); }
    return serveFile(res, file, 'public, max-age=3600');
  }
  let rel;
  try { rel = path.normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, ''); } catch { res.writeHead(400); return res.end(); }
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(res, file, file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=86400' : 'no-cache');
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });

wss.on('connection', async (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});
  const parse = (data) => { try { return JSON.parse(data); } catch { return {}; } };

  if (params.get('role') === 'host') {
    // Şifre adres çubuğunda değil, bağlantının ilk mesajında gelir.
    const authTimer = setTimeout(() => ws.close(4001, 'auth'), 5000);
    ws.once('message', (d) => {
      clearTimeout(authTimer);
      const msg = parse(d);
      // Yanlış şifrede kısa bekleme: deneme-yanılmayı yavaşlatır.
      if (msg.type !== 'auth' || !isAdminPassword(msg.password)) return setTimeout(() => ws.close(4001, 'auth'), 800);
      startHost(ws, req);
    });
    return;
  }

  const token = params.get('token') || '';
  if (!/^[\w-]{16,64}$/.test(token)) return ws.close(4002, 'token');
  const existing = players.get(token);
  if (existing) existing.conns.add(ws); else anonymous.add(ws);
  ws.on('message', (d) => onPlayerMessage(ws, token, parse(d)));
  ws.on('close', () => {
    anonymous.delete(ws);
    const p = players.get(token);
    if (!p) return;
    p.conns.delete(ws);
    maybeAutoReveal(); // Ayrılan kişi son bekleneni olabilir.
    scheduleProgress();
  });
  sendPlayerState(ws, token);
  scheduleProgress();
});

async function startHost(ws, req) {
  if (ws.readyState !== ws.OPEN) return;
  hosts.add(ws);
  ws.on('close', () => hosts.delete(ws));
  ws.on('message', (d) => { try { onHostMessage(JSON.parse(d)); } catch { /* bozuk mesaj */ } });
  const joinUrl = joinUrlFor(req);
  send(ws, hostState(baseState()));
  const qr = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#14231c', light: '#ffffff' } });
  send(ws, { type: 'welcome', joinUrl, qr });
}

// Kilitlenen telefonların bağlantısı sessizce ölür; ping onları "çevrimdışı" sayar.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 10000).unref();

server.listen(PORT, () => {
  const base = PUBLIC_URL || `http://${lanAddress()}:${PORT}`;
  console.log(`\n  EkoZeka2026 — Gerçek mi, Yapay mı?\n`);
  console.log(`  Dev ekran : ${base}/host`);
  console.log(`  Şifre     : ${process.env.ADMIN_PASSWORD || process.env.HOST_KEY ? '(ADMIN_PASSWORD ortam değişkeni)' : `${ADMIN_PASSWORD}  (rastgele üretildi; ADMIN_PASSWORD ile sabitle)`}`);
  console.log(`  Oyuncular : ${base}\n`);
});
