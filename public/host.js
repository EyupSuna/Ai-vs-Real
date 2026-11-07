import { $, esc, api, serverNow, splitLogo, ratioBar, captionBlock, brand, animateRatio, preload } from '/client.js';

const app = $('#app');
const controls = $('#controls');

let state = null;
let welcome = null;
let tickTimer = null;
let resetArmed = false;
let toastTimer = null;
let password = '';
let lastKey = '';
let polling = false;

// Şifre sekme kapanana kadar hatırlanır; yenilemede tekrar sorulmaz.
const PASS_KEY = 'csai.adminPass';
const saved = (() => { try { return sessionStorage.getItem(PASS_KEY); } catch { return null; } })();
if (saved) login(saved); else showLogin('');

function showLogin(error) {
  document.body.dataset.phase = 'login';
  setTheme(false);
  controls.innerHTML = '';
  app.innerHTML = `<main class="lock">
    <form class="admin-login">
      ${brand()}
      <h1>Dev ekran</h1>
      <p>Bu sayfa yalnızca sunucular içindir. Devam etmek için şifreyi gir.</p>
      <input class="field" type="password" id="pass" autocomplete="current-password" placeholder="Şifre" required>
      <p class="err" role="alert">${esc(error)}</p>
      <button class="btn-main" type="submit">Giriş</button>
    </form>
  </main>`;
  $('#pass').focus();
  $('.admin-login').addEventListener('submit', (event) => {
    event.preventDefault();
    const pass = $('#pass').value;
    if (!pass) return;
    $('.admin-login button').disabled = true;
    login(pass);
  });
}

async function login(pass) {
  password = pass;
  const r = await call({});
  if (r.status === 401 || r.status === 503) return fail(r.error);
  if (r.error && !state) return showLogin(r.status === 0 ? 'Sunucuya ulaşılamadı, tekrar dene.' : r.error);
  try { sessionStorage.setItem(PASS_KEY, pass); } catch { /* gizli sekme */ }
  if (!polling) { polling = true; poll(); }
}

function fail(error) {
  try { sessionStorage.removeItem(PASS_KEY); } catch { /* gizli sekme */ }
  state = null;
  polling = false;
  lastKey = '';
  clearInterval(tickTimer);
  showLogin(error);
}

// Dev ekran oyunu ilerleten taraftır: açık kaldığı sürece süre dolunca ya da herkes oylayınca cevap açılır.
async function poll() {
  if (!polling) return;
  const r = await call({});
  setTimeout(poll, r.error ? 2000 : 800);
}

// Her çağrı güncel durumu döndürür; eylem (ilerle, sıfırla, at) aynı istekle gider.
async function call(extra) {
  const r = await api('/api/host', { password, qr: !welcome, ...extra });
  if (r.status === 401 || r.status === 503) { if (state) fail(r.error); return r; }
  if (r.error) { if (state) toast('Sunucuya ulaşılamıyor, yeniden deneniyor…'); return r; }
  if (r.welcome) welcome = r.welcome;
  if (r.toast) toast(r.toast);
  onState(r.state);
  return r;
}

const send = (msg) => call({ action: msg.type, id: msg.id, from: state && { phase: state.phase, index: state.index } });

function onState(next) {
  state = next;
  // Aynı adımdaysak yalnızca sayaçları güncelle; görsel ve animasyonlar yeniden çizilmesin.
  const key = `${state.phase}|${state.gid}|${state.index}|${welcome ? 1 : 0}`;
  if (key !== lastKey) { lastKey = key; render(); return; }
  if (state.phase === 'lobby') renderPlayers();
  if (state.phase === 'question') renderVotes();
}

function toast(text) {
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'alert');
  el.textContent = text;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 5000);
}

function setTheme(ink) {
  document.body.classList.toggle('on-ink', ink);
  document.body.classList.toggle('on-paper', !ink);
}

function render() {
  clearInterval(tickTimer);
  document.body.dataset.phase = state.phase;
  if (state.phase === 'lobby') renderLobby();
  else if (state.phase === 'question') renderRound();
  else if (state.phase === 'reveal') renderReveal();
  else renderFinal();
  renderControls();
}

function renderLobby() {
  setTheme(false);
  const counts = state.imageCounts || { real: 0, ai: 0 };
  app.innerHTML = `<main class="stage lobby">
    <section class="lobby-left">
      ${brand()}
      <h1>Gerçek mi, <br>Yapay mı?</h1>
      <p class="tag">İklim krizi gerçek. Peki ya bu görseller? QR'ı okut, görsele bak, telefonundan oyla.</p>
      <p class="tag">${counts.real + counts.ai} görsel hazır</p>
    </section>
    ${splitLogo()}
    <section class="lobby-right">
      <div class="qr" aria-label="Katılım QR kodu">${welcome ? welcome.qr : ''}</div>
      <p class="join-url">${welcome ? esc(welcome.joinUrl.replace(/^https?:\/\//, '')) : ''}</p>
      <p class="count num" data-count-now></p>
      <div class="chips" id="chips"></div>
    </section>
  </main>`;
  renderPlayers();
}

function renderPlayers() {
  const count = $('[data-count-now]');
  if (count) count.innerHTML = `${state.playerCount} <small>kişi katıldı</small>`;
  const chips = $('#chips');
  if (!chips || !state.players) return;
  chips.innerHTML = state.players.slice().reverse().map((p) => `<button class="chip ${p.online ? '' : 'off'}" data-kick="${esc(p.id)}" title="Kaldırmak için tıkla" type="button">${esc(p.name)}</button>`).join('');
}

function renderRound() {
  setTheme(false);
  app.innerHTML = `<main class="stage round">
    <div class="round-image"><img src="${state.img}" alt="Oylanan görsel"></div>
    <aside class="round-side">
      <div class="no"><span class="num">${state.index + 1} / ${state.total}</span>${brand()}</div>
      <div class="big-time" data-time></div>
      <div class="timebar tb"><i data-bar></i></div>
      <h2>Gerçek mi, yapay zekâ mı?</h2>
      <div class="votes-now" data-votes></div>
      <div class="nodes" data-nodes></div>
      ${welcome ? `<div class="late"><div class="qr">${welcome.qr}</div><span>Geç mi kaldın? Okut, hemen katıl.</span></div>` : ''}
    </aside>
  </main>`;
  renderVotes();
  const paint = () => {
    const left = Math.max(0, state.deadline - serverNow());
    const secs = Math.ceil(left / 1000);
    const time = $('[data-time]');
    if (!time) return;
    time.textContent = secs;
    time.classList.toggle('low', secs <= 5);
    const bar = $('[data-bar]');
    bar.style.transform = `scaleX(${left / (state.seconds * 1000)})`;
    bar.parentElement.classList.toggle('low', secs <= 5);
  };
  paint();
  tickTimer = setInterval(paint, 200);
}

function renderVotes() {
  const box = $('[data-votes]');
  if (!box) return;
  const voted = state.voted || 0;
  const expected = state.expected || 0;
  box.innerHTML = `<span class="num">${voted} / ${expected}</span><small>kişi oyladı</small>`;
  const nodes = $('[data-nodes]');
  const shown = Math.min(expected, 300);
  nodes.style.setProperty('--node', expected <= 40 ? '1.3em' : expected <= 120 ? '.8em' : '.45em');
  nodes.style.setProperty('--node-gap', expected <= 120 ? '.3em' : '.15em');
  const filled = expected > 300 ? Math.round((voted / expected) * 300) : voted;
  if (nodes.children.length !== shown) nodes.innerHTML = '<i></i>'.repeat(shown);
  [...nodes.children].forEach((node, i) => node.classList.toggle('on', i < filled));
}

function renderReveal() {
  const r = state.reveal;
  preload(state.nextImg);
  setTheme(r.answer === 'ai');
  app.innerHTML = `<main class="stage round-reveal">
    <div class="round-image"><img src="${r.img}" alt="Cevaplanan görsel"></div>
    <aside class="reveal-side">
      <p class="kicker num">${state.index + 1} / ${state.total} · Bu görsel</p>
      <h1 class="answer">${r.answer === 'real' ? 'Gerçek' : 'Yapay zekâ'}</h1>
      ${ratioBar(r)}
      ${r.total ? `<p class="fooled num">${r.correct} kişi bildi, ${r.total - r.correct} kişi kandı.</p>` : ''}
      ${captionBlock(r)}
    </aside>
  </main>`;
  animateRatio(app);
}

function renderFinal() {
  setTheme(true);
  const f = state.final;
  const versus = { realPct: f.humanPct, aiPct: f.aiPct, total: f.votes };
  const rows = (state.top || []).map((p) => `<li><b class="num">${p.rank}</b><span>${esc(p.name)}</span><span class="s">${p.score}/${state.total}<small>${p.sec} sn</small></span></li>`).join('');
  app.innerHTML = `<main class="stage final">
    <section class="final-left versus">
      ${brand()}
      <h1>İnsan vs Yapay Zekâ</h1>
      ${ratioBar(versus, { labels: ['İnsan bildi', 'YZ kandırdı'], ticks: false })}
      ${f.hardest ? `<div class="hardest">
        <img src="${f.hardest.img}" alt="En zor görsel">
        <div><h3>En zor görsel</h3><strong class="num">%${f.hardest.fooledPct}</strong><p>kandı. Cevap: ${f.hardest.answer === 'real' ? 'gerçek' : 'yapay zekâ'}${f.hardest.title ? `<br>${esc(f.hardest.title)}` : ''}</p></div>
      </div>` : ''}
    </section>
    <section class="final-right">
      <h2>Sıralama</h2>
      ${rows ? `<ol class="board">${rows}</ol>` : '<p class="empty">Bu oyunda oyuncu yoktu.</p>'}
    </section>
  </main>`;
  animateRatio(app);
}

function renderControls() {
  const label = { lobby: 'Oyunu başlat', question: 'Cevabı göster', reveal: state.index + 1 >= state.total ? 'Sonuçları göster' : 'Sonraki görsel' }[state.phase];
  controls.innerHTML = `
    ${state.phase === 'lobby' ? '' : `<button class="ctl ${resetArmed ? 'danger' : ''}" data-act="reset" type="button">${resetArmed ? 'Emin misin? Skorlar silinir' : 'Sıfırla'}</button>`}
    <button class="ctl" data-act="fullscreen" type="button">Tam ekran (F)</button>
    ${label ? `<button class="ctl primary" data-act="advance" type="button">${label} (Boşluk)</button>` : ''}`;
}

controls.addEventListener('click', (event) => {
  const act = event.target.closest('[data-act]')?.dataset.act;
  if (act === 'advance') send({ type: 'advance' });
  if (act === 'fullscreen') toggleFullscreen();
  if (act === 'reset') {
    if (resetArmed) { resetArmed = false; send({ type: 'reset' }); return; }
    resetArmed = true;
    renderControls();
    setTimeout(() => { resetArmed = false; if (state) renderControls(); }, 4000);
  }
});

app.addEventListener('click', (event) => {
  const id = event.target.closest('[data-kick]')?.dataset.kick;
  if (id) send({ type: 'kick', id });
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

// Yanlışlıkla iki kez basınca tur atlanmasın.
let lastAdvance = 0;
document.addEventListener('keydown', (event) => {
  if (!state || event.target.closest?.('input, textarea')) return;
  if (event.code === 'Space' || event.code === 'Enter' || event.code === 'ArrowRight') {
    event.preventDefault();
    if (event.repeat || Date.now() - lastAdvance < 700) return;
    lastAdvance = Date.now();
    send({ type: 'advance' });
  } else if (event.key === 'f' || event.key === 'F') toggleFullscreen();
});

// Projeksiyon temiz kalsın: fare durunca düğmeler kaybolur, boşluk tuşu çalışmaya devam eder.
let idleTimer = null;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500);
}
document.addEventListener('mousemove', wake);
wake();
