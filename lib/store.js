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
    const err = new Error('Vercel projesine Upstash Redis bağlı değil. Vercel > Storage > Upstash for Redis ekleyip yeniden deploy et.');
    err.status = 503;
    throw err;
  };
  return { kind: 'missing', get: fail, set: fail, del: fail, hget: fail, hset: fail, hsetnx: fail, hgetall: fail, hdel: fail, hlen: fail };
}

module.exports = url && token ? upstashStore() : process.env.VERCEL ? missingStore() : memoryStore();
