'use strict';
// EkoZeka2026 "Gerçek mi, Yapay mı?" oyun mantığı.
// Sunucusuz (Vercel) çalışır: kalıcı bağlantı yok, telefonlar ve dev ekran kısa aralıklarla sorar.
// Oyunu yalnızca dev ekran ilerletir (tek yazar); oyuncular yalnızca katılır ve oy verir.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const store = require('./store');

const ROUND_SECONDS = Number(process.env.ROUND_SECONDS) || 20;
const QUESTION_COUNT = Number(process.env.QUESTION_COUNT) || Infinity;
const ONLINE_MS = (Number(process.env.ONLINE_SECONDS) || 30) * 1000; // Bu süre ses vermeyen telefon beklenmez.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, '..', 'images');
const MAX_PLAYERS = 2000;
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const IMG_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const K = {
  game: 'ez:game',
  players: 'ez:players', // token -> { pid, name }
  seen: 'ez:seen', // token -> son görülme (ms)
  votes: (gid, index) => `ez:v:${gid}:${index}`, // token -> { c, ms }
};

const rand = (bytes) => crypto.randomBytes(bytes).toString('hex');
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const validToken = (t) => typeof t === 'string' && /^[\w-]{16,64}$/.test(t);

// ---------- Sorular ----------
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
      const ext = path.extname(file);
      if (!IMG_EXT.has(ext.toLowerCase())) continue;
      out.push({ file: `${folder}/${file}`, answer, ...readCaption(path.join(dir, file.slice(0, -ext.length) + '.txt')) });
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
// Cevaplar ve dosya adları yalnızca bu nesnede durur; istemciye hiç gitmez.
const freshGame = () => ({ gid: '', phase: 'lobby', index: -1, order: [], deadline: 0, startedAt: 0, results: [], final: null, scores: {} });

// Aynı sunucu kopyası art arda gelen istekler için oyunu kısa süre bellekte tutar.
let cache = { at: 0, game: null };
async function loadGame(maxAgeMs = 0) {
  if (cache.game && Date.now() - cache.at <= maxAgeMs) return cache.game;
  const game = (await store.get(K.game)) || freshGame();
  cache = { at: Date.now(), game };
  return game;
}
async function saveGame(game) {
  await store.set(K.game, game);
  cache = { at: Date.now(), game };
}

// Oyuncular, son görülmeler ve bu turun oyları: hepsi paralel okunur.
async function loadContext(game, { votes = game.phase === 'question' } = {}) {
  const [players, seen, voteMap] = await Promise.all([
    store.hgetall(K.players),
    store.hgetall(K.seen),
    votes && game.gid ? store.hgetall(K.votes(game.gid, game.index)) : {},
  ]);
  // Atılan oyuncunun oyu sayılmaz.
  for (const t of Object.keys(voteMap)) if (!players[t]) delete voteMap[t];
  return { players, seen, votes: voteMap, now: Date.now() };
}

function expectedVoters(ctx) {
  let n = Object.keys(ctx.votes).length;
  for (const t of Object.keys(ctx.players)) {
    if (!ctx.votes[t] && ctx.now - (Number(ctx.seen[t]) || 0) <= ONLINE_MS) n++;
  }
  return n;
}

function ranking(game, ctx) {
  return Object.entries(ctx.players)
    .map(([t, p]) => { const [score, ms] = game.scores[t] || [0, 0]; return { token: t, pid: p.pid, name: p.name, score, ms }; })
    .sort((a, b) => b.score - a.score || a.ms - b.ms);
}

async function clearVotes(game) {
  if (!game.gid) return;
  await store.del(...game.order.map((_, i) => K.votes(game.gid, i)));
}

async function startGame(game) {
  const questions = shuffle(scanQuestions()).slice(0, QUESTION_COUNT);
  if (!questions.length) return 'images/gercek ve images/yapay klasörlerinde görsel yok.';
  await clearVotes(game);
  Object.assign(game, freshGame(), { gid: rand(6), order: questions.map((q) => ({ ...q, id: rand(8) })) });
  nextQuestion(game);
  return null;
}

function nextQuestion(game) {
  game.index++;
  if (game.index >= game.order.length) return finishGame(game);
  game.phase = 'question';
  game.startedAt = Date.now();
  game.deadline = game.startedAt + ROUND_SECONDS * 1000;
}

function reveal(game, ctx) {
  const q = game.order[game.index];
  let real = 0, correct = 0;
  for (const [token, vote] of Object.entries(ctx.votes)) {
    if (vote.c === 'real') real++;
    if (vote.c !== q.answer) continue;
    correct++;
    const [score, ms] = game.scores[token] || [0, 0];
    game.scores[token] = [score + 1, ms + vote.ms];
  }
  const total = Object.keys(ctx.votes).length;
  const realPct = pct(real, total);
  game.results[game.index] = {
    img: `/img/${q.id}`, answer: q.answer, title: q.title, hint: q.hint, credit: q.credit, total, correct,
    realCount: real, aiCount: total - real, realPct, aiPct: total ? 100 - realPct : 0, correctPct: pct(correct, total),
  };
  game.phase = 'reveal';
}

function finishGame(game) {
  game.phase = 'final';
  const answered = game.results.filter((r) => r && r.total > 0);
  const votes = answered.reduce((s, r) => s + r.total, 0);
  const correct = answered.reduce((s, r) => s + r.correct, 0);
  const humanPct = pct(correct, votes);
  const hardest = answered.reduce((w, r) => (!w || r.correctPct < w.correctPct ? r : w), null);
  game.final = {
    votes, humanPct, aiPct: votes ? 100 - humanPct : 0,
    hardest: hardest && { img: hardest.img, answer: hardest.answer, title: hardest.title, fooledPct: 100 - hardest.correctPct },
  };
}

// Herkes oyladıysa ya da süre bittiyse cevabı aç.
function autoReveal(game, ctx) {
  if (game.phase !== 'question') return false;
  const voted = Object.keys(ctx.votes).length;
  if (ctx.now < game.deadline + 250 && !(voted > 0 && voted >= expectedVoters(ctx))) return false;
  reveal(game, ctx);
  return true;
}

// ---------- İstemciye giden görünümler ----------
function publicView(game, ctx) {
  const s = { phase: game.phase, gid: game.gid, index: game.index, total: game.order.length, seconds: ROUND_SECONDS, playerCount: Object.keys(ctx.players).length };
  if (game.phase === 'question') {
    s.img = `/img/${game.order[game.index].id}`;
    s.deadline = game.deadline;
    s.voted = Object.keys(ctx.votes).length;
    s.expected = expectedVoters(ctx);
  }
  if (game.phase === 'reveal') {
    s.reveal = game.results[game.index];
    const next = game.order[game.index + 1];
    s.nextImg = next ? `/img/${next.id}` : null;
  }
  if (game.phase === 'final') s.final = game.final;
  // Telefon kendi puanını ve sırasını buradan bulur (takma adlar değil, rastgele kimlikler).
  if (game.phase === 'reveal' || game.phase === 'final') s.board = ranking(game, ctx).map((p) => [p.pid, p.score]);
  return s;
}

function hostView(game, ctx) {
  const s = publicView(game, ctx);
  delete s.board;
  if (game.phase === 'lobby') {
    s.players = Object.entries(ctx.players).map(([t, p]) => ({ id: p.pid, name: p.name, online: ctx.now - (Number(ctx.seen[t]) || 0) <= ONLINE_MS }));
    const qs = scanQuestions();
    s.imageCounts = { real: qs.filter((q) => q.answer === 'real').length, ai: qs.filter((q) => q.answer === 'ai').length };
  }
  if (game.phase === 'final') {
    s.top = ranking(game, ctx).slice(0, 10).map((p, i) => ({ id: p.pid, rank: i + 1, name: p.name, score: p.score, sec: Math.round(p.ms / 100) / 10 }));
  }
  return s;
}

// ---------- Takma ad ----------
function cleanName(raw) {
  return String(raw || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function uniqueName(name, players) {
  const taken = new Set(Object.values(players).map((p) => p.name.toLocaleLowerCase('tr')));
  if (!taken.has(name.toLocaleLowerCase('tr'))) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name.slice(0, 13)} ${i}`;
    if (!taken.has(candidate.toLocaleLowerCase('tr'))) return candidate;
  }
}

// ---------- HTTP yardımcıları ----------
function send(res, status, body, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? String(req.body) : '';
  if (!raw && req.readable) {
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) break; }
  }
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

const query = (req) => req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

const handler = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Sunucu hatası' });
    if (!err.status) console.error(err);
  }
};

function lanFallback(host) {
  return !host || /^(localhost|127\.|\[::1\])/.test(host) ? process.env.LAN_URL : null;
}

function joinUrlFor(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const lan = lanFallback(host);
  if (lan) return lan;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${proto}://${host}`;
}

// Şifre karşılaştırması: süre farkından ipucu vermesin.
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
function isAdmin(password) {
  const real = process.env.ADMIN_PASSWORD || process.env.HOST_KEY || '';
  return Boolean(real) && typeof password === 'string' && crypto.timingSafeEqual(hash(password), hash(real));
}

// ---------- Uç noktalar ----------
const handlers = {
  // GET /api/state: herkese aynı yanıt; CDN 1 sn önbellekler, kalabalıkta depoya yük binmez.
  state: handler(async (req, res) => {
    const game = await loadGame(500);
    const ctx = await loadContext(game);
    send(res, 200, publicView(game, ctx), 'public, max-age=0, s-maxage=1');
  }),

  // GET /api/me?token=…: kimlik + saat eşitleme + "hâlâ buradayım" sinyali.
  me: handler(async (req, res) => {
    const { token } = query(req);
    if (!validToken(token)) return send(res, 400, { error: 'token' });
    const p = await store.hget(K.players, token);
    if (p) await store.hset(K.seen, { [token]: Date.now() });
    send(res, 200, { now: Date.now(), beat: Math.round(ONLINE_MS / 3), me: p ? { pid: p.pid, name: p.name } : null });
  }),

  // POST /api/join { token, name }
  join: handler(async (req, res) => {
    const { token, name: raw } = await readBody(req);
    if (!validToken(token)) return send(res, 400, { error: 'Geçersiz istek.' });
    const players = await store.hgetall(K.players);
    if (players[token]) return send(res, 200, { now: Date.now(), me: players[token] });
    const name = cleanName(raw);
    if (!name) return send(res, 400, { error: 'Bir takma ad yaz.' });
    if (Object.keys(players).length >= MAX_PLAYERS) return send(res, 400, { error: 'Oyun dolu.' });
    const me = { pid: rand(6), name: uniqueName(name, players) };
    await Promise.all([store.hset(K.players, { [token]: me }), store.hset(K.seen, { [token]: Date.now() })]);
    send(res, 200, { now: Date.now(), me });
  }),

  // POST /api/vote { token, choice, gid, index }
  vote: handler(async (req, res) => {
    const { token, choice, gid, index } = await readBody(req);
    if (!validToken(token) || (choice !== 'real' && choice !== 'ai')) return send(res, 400, { error: 'Geçersiz oy.' });
    let game = await loadGame(500);
    if (game.gid !== gid || game.index !== index || game.phase !== 'question') game = await loadGame(0);
    const now = Date.now();
    if (game.gid !== gid || game.index !== index || game.phase !== 'question' || now > game.deadline + 250) {
      return send(res, 200, { ok: false, now, error: 'Bu tur kapandı.' });
    }
    const player = await store.hget(K.players, token);
    if (!player) return send(res, 200, { ok: false, now, unknown: true });
    await store.hsetnx(K.votes(gid, index), token, { c: choice, ms: now - game.startedAt });
    const vote = await store.hget(K.votes(gid, index), token); // İlk oy geçerlidir.
    send(res, 200, { ok: true, now, choice: vote ? vote.c : choice });
  }),

  // POST /api/host { password, action?, from?, id?, qr? }: dev ekran. Oyunu ilerleten tek yer.
  host: handler(async (req, res) => {
    if (!(process.env.ADMIN_PASSWORD || process.env.HOST_KEY)) {
      return send(res, 503, { error: 'ADMIN_PASSWORD ortam değişkeni ayarlı değil. Vercel > Settings > Environment Variables bölümünden ekleyip yeniden deploy et.' });
    }
    const body = await readBody(req);
    if (!isAdmin(body.password)) {
      await new Promise((r) => setTimeout(r, 800)); // Deneme-yanılmayı yavaşlatır.
      return send(res, 401, { error: 'Şifre yanlış.' });
    }
    let game = await loadGame(0);
    let ctx = await loadContext(game);
    let changed = false;
    let toast = null;
    const at = body.from;
    const sameStep = !at || (at.phase === game.phase && at.index === game.index); // Çift basış tur atlamasın.

    if (body.action === 'advance' && sameStep) {
      if (game.phase === 'lobby') toast = await startGame(game);
      else if (game.phase === 'question') reveal(game, ctx);
      else if (game.phase === 'reveal') nextQuestion(game);
      changed = !toast;
    } else if (body.action === 'reset') {
      await clearVotes(game);
      game = freshGame();
      changed = true;
    } else if (body.action === 'kick' && typeof body.id === 'string') {
      const token = Object.keys(ctx.players).find((t) => ctx.players[t].pid === body.id);
      if (token) {
        await Promise.all([
          store.hdel(K.players, token),
          store.hdel(K.seen, token),
          game.gid ? store.hdel(K.votes(game.gid, game.index), token) : null,
        ]);
        delete game.scores[token];
        changed = true;
      }
    }
    if (changed) ctx = await loadContext(game);
    if (autoReveal(game, ctx)) changed = true;
    if (changed) await saveGame(game);

    const out = { now: Date.now(), state: hostView(game, ctx) };
    if (toast) out.toast = toast;
    if (body.qr) {
      const joinUrl = joinUrlFor(req);
      out.welcome = { joinUrl, qr: await QRCode.toString(joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#14231c', light: '#ffffff' } }) };
    }
    send(res, 200, out);
  }),

  // GET /img/<id>: rastgele kimlikle görsel. Kimlik her oyunda değişir, bu yüzden CDN rahatça önbellekler.
  img: handler(async (req, res) => {
    const id = String(query(req).id || '');
    let game = await loadGame(5000);
    let q = game.order.find((x) => x.id === id);
    if (!q) { game = await loadGame(0); q = game.order.find((x) => x.id === id); }
    const file = q && path.join(IMAGES_DIR, q.file);
    if (!file || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.statusCode = 200;
    res.setHeader('Content-Type', IMG_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.end(fs.readFileSync(file));
  }),
};

module.exports = { handlers, storeKind: store.kind };
