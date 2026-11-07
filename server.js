'use strict';
// Yerel sunucu: `npm start`. Vercel'deki fonksiyonların aynısını tek bir Node sunucusunda çalıştırır.
// Upstash ortam değişkenleri yoksa oyun durumu bellekte tutulur (sunucu kapanınca sıfırlanır).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;

function lanAddress() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/virtual|vethernet|vmware|vbox|wsl|hyper-v|loopback|docker|tailscale/i.test(name)) continue;
    for (const a of addrs) if (a.family === 'IPv4' && !a.internal) candidates.push(a.address);
  }
  return candidates.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) || candidates[0] || 'localhost';
}

// Dev ekran localhost'tan açılınca QR, telefonların erişebileceği ağ adresini göstersin.
process.env.LAN_URL = `http://${lanAddress()}:${PORT}`;

const { handlers, storeKind } = require('./lib/game');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Bulunamadı'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;
  req.query = Object.fromEntries(url.searchParams);
  const api = pathname.match(/^\/api\/(\w+)$/);
  if (api && handlers[api[1]] && api[1] !== 'img') return handlers[api[1]](req, res);
  if (pathname.startsWith('/img/')) { req.query.id = pathname.slice(5); return handlers.img(req, res); }
  if (pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (pathname === '/') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'no-cache');
  if (pathname === '/host') return serveFile(res, path.join(PUBLIC_DIR, 'host.html'), 'no-cache');
  let rel;
  try { rel = path.normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, ''); } catch { res.writeHead(400); return res.end(); }
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(res, file, file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=86400' : 'no-cache');
});

server.listen(PORT, () => {
  const base = process.env.PUBLIC_URL || process.env.LAN_URL;
  console.log(`\n  EkoZeka2026 — Gerçek mi, Yapay mı?   (depo: ${storeKind === 'redis' ? 'Upstash Redis' : 'bellek'})\n`);
  console.log(`  Dev ekran : ${base}/host`);
  console.log(`  Oyuncular : ${base}\n`);
});
