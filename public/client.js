// Oyuncu ve dev ekran sayfalarının ortak yardımcıları.
export const $ = (selector, root = document) => root.querySelector(selector);

export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* gizli sekme */ } },
};

// Saat farkı: geri sayım, telefonun saatinden bağımsız olsun.
let clockOffset = 0;
export const serverNow = () => Date.now() + clockOffset;

// hello: her (yeniden) bağlantıda ilk gönderilecek mesaj (ör. admin şifresi).
export function connect(query, onMessage, onStatus, onFatal, hello) {
  let ws;
  let retry = 0;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?${query}`);
    ws.onopen = () => { retry = 0; if (hello) ws.send(JSON.stringify(hello)); onStatus(true); };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.now) clockOffset = msg.now - Date.now();
      onMessage(msg);
    };
    ws.onclose = (event) => {
      if (event.code >= 4000) { if (onFatal) onFatal(event.code); return; }
      onStatus(false);
      setTimeout(open, Math.min(4000, 400 * 2 ** retry++));
    };
  };
  open();
  return { send: (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); return ws.readyState === 1; } };
}

// Logonun sol yarısı açık zeminde siyah, sağ yarısı koyu zeminde beyaz kalır.
export const splitLogo = (cls = '') => `<div class="split-logo ${cls}" role="img" aria-label="CSAI logosu"><i class="l"></i><i class="r"></i></div>`;

// Oran çubuğu: ayıraç, logodaki orta çizginin aynısıdır.
export function ratioBar(reveal, { labels = ['Gerçek', 'Yapay'], ticks = true } = {}) {
  const none = reveal.total === 0;
  const tick = (side, label) => `<span class="ratio-label ${side}">${ticks && reveal.answer === (side === 'left' ? 'real' : 'ai') ? '<b class="tick" aria-label="Doğru cevap">✓</b>' : ''}${label}</span>`;
  return `<div class="ratio" style="--real:50">
    <div class="ratio-head">
      <div>${tick('left', labels[0])}<strong class="num" data-count="${reveal.realPct}">%50</strong></div>
      <div class="end">${tick('right', labels[1])}<strong class="num" data-count="${reveal.aiPct}">%50</strong></div>
    </div>
    <div class="ratio-bar" data-target="${none ? 50 : reveal.realPct}"><span class="seam"></span></div>
    <p class="ratio-foot">${none ? 'Bu turda oy kullanılmadı' : `${reveal.total} oy`}</p>
  </div>`;
}

export const brand = () => '<span class="brand"><b>Eko</b>Zeka2026</span>';

// Cevap ekranındaki açıklama: gerçekse neyin fotoğrafı olduğu, yapaysa neden yapay olduğu.
export function captionBlock(r) {
  if (!r.title && !r.hint) return '';
  return `<section class="caption">
    <span class="cap-label">${r.answer === 'real' ? 'Bu fotoğraf neyi gösteriyor?' : 'Bu görsel nedir?'}</span>
    ${r.title ? `<strong>${esc(r.title)}</strong>` : ''}
    ${r.hint ? `<p>${esc(r.hint)}</p>` : ''}
    ${r.credit ? `<small>${esc(r.credit)}</small>` : ''}
  </section>`;
}

export function animateRatio(root) {
  const bar = $('.ratio-bar', root);
  if (!bar) return;
  const ratio = bar.closest('.ratio');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nums = [...ratio.querySelectorAll('[data-count]')];
  const target = Number(bar.dataset.target);
  if (reduce) {
    ratio.style.setProperty('--real', target);
    nums.forEach((n) => { n.textContent = `%${n.dataset.count}`; });
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => ratio.style.setProperty('--real', target)));
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 900);
    const eased = 1 - (1 - k) ** 3;
    nums.forEach((n) => { n.textContent = `%${Math.round(50 + (Number(n.dataset.count) - 50) * eased)}`; });
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function preload(url) { if (url) { const im = new Image(); im.src = url; } }
