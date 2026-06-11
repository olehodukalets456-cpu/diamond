// /api/go  — людина натиснула кнопку на сторінці й потрапляє сюди.
// Ловимо мітку кліку Meta + IP/User-Agent (для match quality), ховаємо під токеном,
// відправляємо людину в бота з токеном у посиланні.
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

function makeToken(n = 10) {
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

// реальний IP клієнта за заголовками проксі
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.headers["x-real-ip"] || "";
}

export default async function handler(req, res) {
  const bot = process.env.BOT_USERNAME;
  try {
    const q = req.query || {};
    const fbclid = q.fbclid || "";
    let fbc = q.fbc || "";
    if (!fbc && fbclid) fbc = `fb.1.${Date.now()}.${fbclid}`;

    const data = {
      fbc,
      fbp: q.fbp || "",
      fbclid,
      ad_id: q.ad_id || "",
      adset_id: q.adset_id || "",
      campaign_id: q.campaign_id || "",
      campaign_name: q.campaign_name || "",
      ad_name: q.ad_name || "",
      // дані юзера для кращої атрибуції (ловимо тут, бо в боті це вже IP сервера)
      client_ip: clientIp(req),
      client_ua: req.headers["user-agent"] || "",
      ts: Date.now(),
    };

    const token = makeToken();
    await redis.set(`s:${token}`, data, { ex: 2592000 }); // 30 днів
    // ДІАГНОСТИКА: скільки людей реально дійшло до редіректу в бота
    try { await redis.hincrby("funnel", "go_redirects", 1); } catch (e) {}

    res.writeHead(302, { Location: `https://t.me/${bot}?start=${token}` });
    res.end();
  } catch (e) {
    res.writeHead(302, { Location: `https://t.me/${bot}` });
    res.end();
  }
}
