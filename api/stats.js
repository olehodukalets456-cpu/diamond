// /api/stats?key=ТВІЙ_СЕКРЕТ
// Показує, скільки підписок дав кожен креатив (твоя власна статистика).
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.query.key !== process.env.STATS_SECRET) {
    res.status(403).send("forbidden");
    return;
  }
  const stats = (await redis.hgetall("stats:subs")) || {};
  res.status(200).json({ subscribers_by_ad: stats });
}
