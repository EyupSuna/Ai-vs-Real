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

// Sunucuya istek. Yanıttaki `now`, yolculuk süresinin yarısı düzeltilerek saati eşitler.
// Hata durumunda { status, error } döner, istisna fırlatmaz.
export async function api(path, body) {
  const sent = Date.now();
  try {
    const res = await fetch(path, body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (typeof data.now === 'number') clockOffset = data.now + (Date.now() - sent) / 2 - Date.now();
    return res.ok ? data : { status: res.status, error: data.error || 'Sunucu hatası' };
  } catch {
    return { status: 0, error: 'Bağlantı yok' };
  }
}

// Ortak durum. Herkes aynı adresi sorar ki CDN tek yanıtı herkese dağıtsın.
export const fetchState = async () => {
  try {
    const res = await fetch('/api/state');
    return res.ok ? await res.json() : null;
  } catch { return null; }
};

// Düzenli sorgu: fn bitince ms kadar bekler, art arda hata olursa yavaşlar.
export function every(ms, fn) {
  let fails = 0;
  let stopped = false;
  const loop = async () => {
    if (stopped) return;
    const ok = await fn();
    fails = ok === false ? fails + 1 : 0;
    setTimeout(loop, fails ? Math.min(4000, ms * 2 ** fails) : ms);
  };
  loop();
  return () => { stopped = true; };
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
