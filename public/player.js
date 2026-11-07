import { $, esc, store, connect, serverNow, splitLogo, ratioBar, captionBlock, brand, animateRatio, preload } from '/client.js';

const app = $('#app');
let token = store.get('csai.token');
if (!token) {
  token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  store.set('csai.token', token);
}

let state = null;
let view = '';
let notice = '';
let tickTimer = null;

const label = (answer) => (answer === 'real' ? 'Gerçek' : 'Yapay zekâ');

const game = connect(`role=player&token=${token}`, onMessage, setOnline);

function onMessage(msg) {
  if (msg.type === 'state') {
    state = msg;
    if (msg.me) store.set('csai.name', msg.me.name);
    render();
  } else if (msg.type === 'progress' && state) {
    Object.assign(state, msg);
    const note = $('[data-progress]');
    if (note) note.textContent = progressText();
    const lobbyCount = $('[data-lobby-count]');
    if (lobbyCount) lobbyCount.textContent = `${msg.playerCount} kişi hazır`;
  } else if (msg.type === 'joinError') {
    const err = $('.err');
    if (err) err.textContent = msg.text;
    const button = $('.join-form button');
    if (button) button.disabled = false;
  } else if (msg.type === 'kicked') {
    notice = 'Takma adın sunucu tarafından kaldırıldı. Başka bir ad seçebilirsin.';
    view = '';
  }
}

function setOnline(online) {
  let bar = $('.offline');
  if (online) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'offline';
    bar.setAttribute('role', 'status');
    bar.textContent = 'Bağlantı koptu, yeniden bağlanıyor…';
    document.body.append(bar);
  }
}

const progressText = () => (state.expected ? `${state.voted} / ${state.expected} kişi oyladı` : '');

function setTheme(ink) {
  document.body.classList.toggle('on-ink', ink);
  document.body.classList.toggle('on-paper', !ink);
  document.querySelector('meta[name=theme-color]').content = ink ? '#14231c' : '#f1efe6';
}

function render() {
  clearInterval(tickTimer);
  if (!state.me) return renderJoin();
  if (state.phase === 'lobby') return renderLobby();
  if (state.phase === 'question') return renderQuestion();
  if (state.phase === 'reveal') return renderReveal();
  return renderFinal();
}

function renderJoin() {
  if (view === 'join') return; // Yazarken gelen güncellemeler alanı silmesin.
  view = 'join';
  setTheme(false);
  app.innerHTML = `<main class="phone">
    <header class="hero join-hero">
      ${splitLogo()}
      <h1 class="word left">Gerçek mi,</h1>
      <div class="word right" aria-hidden="false">Yapay mı?</div>
    </header>
    <form class="join-form">
      ${brand()}
      <p>İklim krizi gerçek. Peki ya bu görseller? Her görsele bak, gerçek mi yapay zekâ mı oyla.</p>
      <label class="sr" for="name">Takma adın</label>
      <input class="field" id="name" maxlength="16" autocomplete="off" autocapitalize="words" enterkeyhint="go" placeholder="Takma adın" value="${esc(store.get('csai.name') || '')}">
      <button class="btn-main" type="submit">Oyuna gir</button>
      <p class="err" role="alert">${esc(notice)}</p>
      <p class="sign">CSAI topluluğu</p>
    </form>
  </main>`;
  $('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#name').value.trim();
    if (!name) { $('.err').textContent = 'Bir takma ad yaz.'; return; }
    notice = '';
    requestWakeLock();
    if (game.send({ type: 'join', name })) $('.join-form button').disabled = true;
    else $('.err').textContent = 'Bağlantı bekleniyor, tekrar dene.';
  });
}

function renderLobby() {
  view = 'lobby';
  setTheme(true);
  app.innerHTML = `<main class="phone"><div class="wait">
    ${brand()}
    <div class="pulse" aria-hidden="true"><i></i><i></i><i></i></div>
    <h2>Hazırsın, ${esc(state.me.name)}.</h2>
    <p>Sunucu oyunu başlatınca ilk görsel burada açılacak.</p>
    <p class="who" data-lobby-count>${state.playerCount} kişi hazır</p>
  </div></main>`;
}

function renderQuestion() {
  const key = `q${state.index}:${state.me.vote || ''}`;
  if (view === key) return startTick();
  view = key;
  setTheme(false);
  const vote = state.me.vote;
  app.innerHTML = `<main class="phone question-screen ${vote ? 'voted' : ''}">
    <div class="topbar"><span class="num">${state.index + 1} / ${state.total}</span><button class="zoom-chip" type="button">Büyüt</button><span class="time" data-time></span></div>
    <div class="timebar"><i data-bar></i></div>
    <div class="shot">
      <img src="${state.img}" alt="Oylanan görsel" draggable="false">
      <button class="zoom" type="button" aria-label="Görseli büyüt"></button>
    </div>
    ${vote
      ? `<p class="voted-note">Oyun alındı. <span data-progress>${progressText()}</span></p>`
      : '<p class="ask">Bu görsel gerçek mi, yapay zekâ mı?</p>'}
    <div class="vote-row">
      <button class="vote real ${vote === 'real' ? 'chosen' : ''}" data-v="real" type="button">Gerçek<small>${vote === 'real' ? 'Senin oyun' : ''}</small></button>
      <button class="vote ai ${vote === 'ai' ? 'chosen' : ''}" data-v="ai" type="button">Yapay<small>${vote === 'ai' ? 'Senin oyun' : ''}</small></button>
    </div>
  </main>`;
  app.querySelectorAll('.vote').forEach((btn) => btn.addEventListener('click', () => {
    if (state.me.vote) return;
    game.send({ type: 'vote', choice: btn.dataset.v });
  }));
  app.querySelectorAll('.zoom, .zoom-chip').forEach((btn) => btn.addEventListener('click', openLightbox));
  startTick();
}

function startTick() {
  const paint = () => {
    const left = Math.max(0, state.deadline - serverNow());
    const secs = Math.ceil(left / 1000);
    const time = $('[data-time]');
    const bar = $('[data-bar]');
    if (!time) return;
    time.textContent = secs;
    time.classList.toggle('low', secs <= 5);
    bar.style.transform = `scaleX(${left / (state.seconds * 1000)})`;
    bar.parentElement.classList.toggle('low', secs <= 5);
  };
  paint();
  tickTimer = setInterval(paint, 200);
}

function openLightbox() {
  const box = document.createElement('button');
  box.className = 'lightbox';
  box.type = 'button';
  box.setAttribute('aria-label', 'Kapat');
  box.innerHTML = `<img src="${state.img}" alt="Oylanan görsel, büyük">`;
  box.addEventListener('click', () => box.remove());
  document.body.append(box);
}

function closeLightbox() { const box = $('.lightbox'); if (box) box.remove(); }

function renderReveal() {
  closeLightbox();
  const key = `r${state.index}`;
  const r = state.reveal;
  preload(state.nextImg);
  const firstPaint = view !== key;
  view = key;
  setTheme(r.answer === 'ai');
  const vote = state.me.vote;
  const verdict = !vote
    ? '<div class="verdict none">Oy vermedin</div>'
    : vote === r.answer
      ? '<div class="verdict good">✓ Doğru bildin</div>'
      : '<div class="verdict bad">✕ Kandırıldın</div>';
  app.innerHTML = `<main class="phone"><div class="result">
    ${verdict}
    <p class="answer-line">Bu görsel: <b>${label(r.answer)}</b></p>
    <img class="thumb" src="${r.img}" alt="">
    ${captionBlock(r)}
    ${ratioBar(r)}
    <div class="stat-row">
      <div><span>Puanın</span><strong class="num">${state.me.score} / ${state.index + 1}</strong></div>
      <div><span>Sıralama</span><strong class="num">#${state.me.rank}</strong></div>
    </div>
  </div></main>`;
  if (firstPaint) animateRatio(app);
  else { const ratio = $('.ratio'); ratio.style.setProperty('--real', $('.ratio-bar').dataset.target); ratio.querySelectorAll('[data-count]').forEach((n) => { n.textContent = `%${n.dataset.count}`; }); }
}

function titleFor(score, total) {
  const rate = total ? score / total : 0;
  if (rate >= 0.9) return 'Yapay zekâ seni kandıramıyor.';
  if (rate >= 0.7) return 'Keskin göz. Sahteyi çoğu zaman yakaladın.';
  if (rate >= 0.5) return 'Yarı yarıya. Yapay zekâ da senin kadar iyi.';
  return 'Bu tur yapay zekâ kazandı.';
}

function renderFinal() {
  closeLightbox();
  view = 'final';
  setTheme(true);
  const { score, rank } = state.me;
  app.innerHTML = `<main class="phone"><div class="final-me">
    <p class="who">${esc(state.me.name)}</p>
    <div class="final-score num">${score}<small> / ${state.total}</small></div>
    <h2 class="title">${titleFor(score, state.total)}</h2>
    <div class="stat-row">
      <div><span>Sıralama</span><strong class="num">#${rank} / ${state.playerCount}</strong></div>
      <div><span>Salon doğruluğu</span><strong class="num">%${state.final.humanPct}</strong></div>
    </div>
    <p class="sign">Teşekkürler! EkoZeka2026 · CSAI</p>
  </div></main>`;
}

// Oyun sırasında ekran kapanırsa bağlantı düşer; tarayıcı destekliyorsa açık tutalım.
let wakeLock = null;
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* HTTP veya destek yok */ }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && wakeLock) requestWakeLock();
});
