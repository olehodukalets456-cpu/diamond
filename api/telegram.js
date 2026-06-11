// /api/telegram  — сюди Telegram присилає всі події бота.
// Обробляємо дві: натискання Start (перехід зі сторінки) і заявку на вступ.
// + ДІАГНОСТИКА ВОРОНКИ: лічильники в Redis-хеш "funnel" (видно через /api/stats).
import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const TG = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const BOT_PHOTO = "https://raw.githubusercontent.com/olehodukalets456-cpu/diamond/main/DMND1.jpg";

// лічильник етапу воронки (не валимо обробку, якщо Redis на мить недоступний)
async function bump(field) {
  try { await redis.hincrby("funnel", field, 1); } catch (e) {}
}

async function tg(method, body) {
  const r = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

function sha256(v) {
  return crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");
}

function asObject(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

// чи є в збережених даних реальна рекламна прив'язка
function hasAdData(d) {
  return !!(d && (d.ad_id || d.ad_name || d.fbc || d.fbp || d.campaign_id));
}

async function getCampaignLink(d) {
  const campKey = String(d.campaign_id || d.campaign_name || "default");
  const stored = await redis.get(`camp:${campKey}`);
  if (stored) return typeof stored === "string" ? stored : String(stored);

  const name = String(d.campaign_name || d.campaign_id || "Ads / DMND").slice(0, 32);
  const link = await tg("createChatInviteLink", {
    chat_id: process.env.CHANNEL_ID,
    creates_join_request: true,
    name,
  });
  const inviteUrl = link.result && link.result.invite_link;
  if (inviteUrl) {
    await redis.set(`camp:${campKey}`, inviteUrl);
    await redis.sadd("links:mine", inviteUrl);
  }
  return inviteUrl;
}

// повертає true, якщо Meta прийняла подію
async function sendCapi(d, userId) {
  const url =
    `https://graph.facebook.com/v21.0/${process.env.FB_PIXEL_ID}/events` +
    `?access_token=${process.env.FB_TOKEN}`;

  const event = {
    event_name: "Subscribe",
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_source_url: process.env.EVENT_SOURCE_URL || "https://dmnd.online/",
    event_id: `sub_${userId}_${Math.floor(Date.now() / 1000)}`,
    user_data: { external_id: sha256(userId) },
  };
  if (d.fbc) event.user_data.fbc = d.fbc;
  if (d.fbp) event.user_data.fbp = d.fbp;
  if (d.client_ip) event.user_data.client_ip_address = d.client_ip;
  if (d.client_ua) event.user_data.client_user_agent = d.client_ua;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] }),
    });
    const j = await r.json().catch(() => ({}));
    return !!(r.ok && j && (j.events_received >= 1));
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("ok");
    return;
  }

  const update = req.body || {};

  try {
    // 1) Людина натиснула Start у боті (прийшла зі сторінки)
    if (update.message && update.message.text && update.message.text.startsWith("/start")) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const startToken = (update.message.text.split(" ")[1] || "").trim();

      let data = {};
      if (startToken) data = asObject(await redis.get(`s:${startToken}`));

      // ДІАГНОСТИКА: скільки відкрили бота і чи була рекламна прив'язка на цей момент
      await bump("start_total");
      await bump(hasAdData(data) ? "start_with_ad" : "start_no_ad");

      await redis.set(`u:${userId}`, data, { ex: 2592000 }); // 30 днів

      const inviteUrl = await getCampaignLink(data);
      const caption = "Нажми кнопку ниже, чтобы вступить в канал 👇\nПосле заявки тебя впустят автоматически.";
      const keyboard = { inline_keyboard: [[{ text: "🚀 Вступить в канал", url: inviteUrl }]] };

      const photo = await tg("sendPhoto", {
        chat_id: chatId, photo: BOT_PHOTO, caption, reply_markup: keyboard,
      });
      if (!photo || !photo.ok) {
        await tg("sendMessage", { chat_id: chatId, text: caption, reply_markup: keyboard });
      }

      res.status(200).send("ok");
      return;
    }

    // 2) Людина подала заявку на вступ
    if (update.chat_join_request) {
      const userId = update.chat_join_request.from.id;
      await bump("jr_total"); // усі заявки, що дійшли до бота

      const usedLink =
        update.chat_join_request.invite_link &&
        update.chat_join_request.invite_link.invite_link;

      // запобіжник: чіпаємо ТІЛЬКИ заявки з наших посилань
      const isOurs = usedLink && (await redis.sismember("links:mine", usedLink));
      if (!isOurs) {
        await bump("jr_foreign"); // вступ повз наші посилання — ігноруємо
        res.status(200).send("ok");
        return;
      }
      await bump("jr_ours");

      const data = asObject(await redis.get(`u:${userId}`));
      const bound = hasAdData(data);
      await bump(bound ? "bind_present" : "bind_missing"); // була/не була рекламна прив'язка

      // впускаємо людину; навіть якщо апрув впав — подію все одно шлемо
      try {
        const ap = await tg("approveChatJoinRequest", {
          chat_id: process.env.CHANNEL_ID,
          user_id: userId,
        });
        await bump(ap && ap.ok ? "approve_ok" : "approve_fail");
      } catch (e) {
        await bump("approve_fail");
      }

      const ok = await sendCapi(data, userId);
      await bump(ok ? "capi_ok" : "capi_fail");

      const adKey = data.ad_id || data.ad_name || "unknown";
      await redis.hincrby("stats:subs", adKey, 1);

      await redis.del(`u:${userId}`);
      res.status(200).send("ok");
      return;
    }

    res.status(200).send("ok");
  } catch (e) {
    res.status(200).send("ok");
  }
}
