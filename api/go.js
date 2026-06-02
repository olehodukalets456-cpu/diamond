// /api/go  — людина натиснула кнопку на сторінці й потрапляє сюди.
// Тут ми ловимо мітку кліку Meta, ховаємо її під коротким токеном
// і відправляємо людину в бота з цим токеном у посиланні.
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

export default async function handler(req, res) {
  const bot = process.env.BOT_USERNAME;
  try {
    const q = req.query || {};
    const fbclid = q.fbclid || "";
    let fbc = q.fbc || "";
    // якщо браузер не дав готовий _fbc, але є fbclid — складаємо fbc самі
    if (!fbc && fbclid) fbc = `fb.1.${Date.now()}.${fbclid}`;

    const data = {
      fbc,
      fbp: q.fbp || "",
      fbclid,
      ad_id: q.ad_id || "",
      adset_id: q.adset_id || "",
      campaign_id: q.campaign_id || "",
      ad_name: q.ad_name || "",
      ts: Date.now(),
    };

    const token = makeToken();
    // зберігаємо на 1 годину — вистачить, щоб людина дійшла до каналу
    await redis.set(`s:${token}`, data, { ex: 3600 });

    res.writeHead(302, { Location: `https://t.me/${bot}?start=${token}` });
    res.end();
  } catch (e) {
    // якщо щось пішло не так — все одно ведемо людину в бота, щоб не втратити її
    res.writeHead(302, { Location: `https://t.me/${bot}` });
    res.end();
  }
}
