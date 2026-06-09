// /api/stats?key=ТВІЙ_СЕКРЕТ
// subscribers_by_ad — підписки по креативах (як було).
// funnel — діагностика воронки: де саме губляться підписки.
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const n = (v) => parseInt(v || 0, 10) || 0;

export default async function handler(req, res) {
  if (req.query.key !== process.env.STATS_SECRET) {
    res.status(403).send("forbidden");
    return;
  }

  const stats = (await redis.hgetall("stats:subs")) || {};
  const f = (await redis.hgetall("funnel")) || {};

  // зрозумілі підсумки воронки
  const funnel = {
    "1_бота_відкрили": n(f.start_total),
    "1a_з_рекламною_привязкою": n(f.start_with_ad),
    "1b_без_привязки": n(f.start_no_ad),
    "2_заявок_на_вступ": n(f.jr_total),
    "2a_наші_посилання": n(f.jr_ours),
    "2b_чужі_посилання_(повз_бота)": n(f.jr_foreign),
    "3a_привязка_була": n(f.bind_present),
    "3b_привязки_не_було_(unknown)": n(f.bind_missing),
    "4_апрув_ок": n(f.approve_ok),
    "4_апрув_впав": n(f.approve_fail),
    "5_CAPI_прийнято_Meta": n(f.capi_ok),
    "5_CAPI_помилка": n(f.capi_fail),
  };

  res.status(200).json({ subscribers_by_ad: stats, funnel });
}
