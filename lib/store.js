'use strict';
// Oyun durumu deposu.
// - Vercel'de: Upstash Redis (Vercel > Storage > Upstash for Redis ile bağlanır, ortam değişkenleri otomatik gelir).
// - Bilgisayarda / Render'da: bellek (tek sunucu olduğu için yeterli).
// Değerler her iki depoda da nesne/sayı olarak yazılıp okunur.

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

function upstashStore() {
  const { Redis } = require('@upstash/redis');
  const r = new Redis({ url, token });
  return {
    kind: 'redis',
    get: (k) => r.get(k),
    set: (k, v) => r.set(k, v),
    del: (...keys) => (keys.length ? r.del(...keys) : 0),
    hget: (k, f) => r.hget(k, f),
    hset: (k, obj) => r.hset(k, obj),
    hsetnx: async (k, f, v) => (await r.hsetnx(k, f, v)) === 1,
    hgetall: async (k) => (await r.hgetall(k)) || {},
    hdel: (k, ...f) => (f.length ? r.hdel(k, ...f) : 0),
    hlen: (k) => r.hlen(k),
  };
}

// Redis Cloud (Vercel > Storage > "Redis"): REDIS_URL ile normal Redis bağlantısı.
// Bağlantı sunucu kopyası başına bir kez açılır ve sonraki isteklerde yeniden kullanılır.
function tcpStore(redisUrl) {
  const { createClient } = require('redis');
  let ready = null;
  const client = () => {
    if (!ready) {
      const c = createClient({ url: redisUrl, socket: { connectTimeout: 5000, reconnectStrategy: (n) => Math.min(n * 200, 2000) } });
      c.on('error', () => {}); // Kopmalar yeniden bağlanır; hata isteğin kendisinde döner.
      ready = c.connect().then(() => c).catch((err) => { ready = null; throw err; });
    }
    return ready;
  };
  const enc = (v) => JSON.stringify(v);
  const dec = (s) => { if (s === null || s === undefined) return null; try { return JSON.parse(s); } catch { return s; } };
  return {
    kind: 'redis',
    get: async (k) => dec(await (await client()).get(k)),
    set: async (k, v) => { await (await client()).set(k, enc(v)); },
    del: async (...keys) => (keys.length ? (await client()).del(keys) : 0),
    hget: async (k, f) => dec(await (await client()).hGet(k, f)),
    hset: async (k, obj) => (await client()).hSet(k, Object.fromEntries(Object.entries(obj).map(([f, v]) => [f, enc(v)]))),
    hsetnx: async (k, f, v) => Number(await (await client()).hSetNX(k, f, enc(v))) === 1,
    hgetall: async (k) => Object.fromEntries(Object.entries((await (await client()).hGetAll(k)) || {}).map(([f, v]) => [f, dec(v)])),
    hdel: async (k, ...f) => (f.length ? (await client()).hDel(k, f) : 0),
    hlen: async (k) => Number(await (await client()).hLen(k)),
  };
}

function memoryStore() {
  const data = new Map();
  const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
  const hash = (k) => { if (!data.has(k)) data.set(k, new Map()); return data.get(k); };
  return {
    kind: 'memory',
    get: async (k) => clone(data.get(k)),
    set: async (k, v) => { data.set(k, clone(v)); },
    del: async (...keys) => { keys.forEach((k) => data.delete(k)); },
    hget: async (k, f) => clone(hash(k).get(f)),
    hset: async (k, obj) => { const h = hash(k); for (const [f, v] of Object.entries(obj)) h.set(f, clone(v)); },
    hsetnx: async (k, f, v) => { const h = hash(k); if (h.has(f)) return false; h.set(f, clone(v)); return true; },
    hgetall: async (k) => Object.fromEntries([...hash(k)].map(([f, v]) => [f, clone(v)])),
    hdel: async (k, ...f) => { const h = hash(k); f.forEach((x) => h.delete(x)); },
    hlen: async (k) => hash(k).size,
  };
}

// Vercel'de bellek kullanılamaz: her istek farklı bir kopyaya düşebilir. Açık bir hata verelim.
function missingStore() {
  const fail = async () => {
    const err = new Error('Vercel projesine Redis bağlı değil. Vercel > Storage bölümünden Redis (ya da Upstash) ekleyip projeye bağla, sonra Redeploy et.');
    err.status = 503;
    throw err;
  };
  return { kind: 'missing', get: fail, set: fail, del: fail, hget: fail, hset: fail, hsetnx: fail, hgetall: fail, hdel: fail, hlen: fail };
}

// Vercel'deki "Custom Prefix" alanına göre adres farklı adlarla gelebilir.
const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL || process.env.KV_URL;

module.exports = url && token ? upstashStore()
  : redisUrl ? tcpStore(redisUrl)
  : process.env.VERCEL ? missingStore()
  : memoryStore();
