// /api/telegram  — сюди Telegram присилає всі події бота.
// Обробляємо дві: натискання Start (перехід зі сторінки) і заявку на вступ.
import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const TG = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

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

// читаємо збережені дані (захист на випадок, якщо вони лежать рядком)
function asObject(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

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

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [event] }),
  });
}

export default async function handler(req, res) {
  // Telegram звертається методом POST. На все інше просто кажемо "ok".
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

      // дістаємо мітку кліку за токеном і прив'язуємо її до користувача
      let data = {};
      if (startToken) data = asObject(await redis.get(`s:${startToken}`));
      await redis.set(`u:${userId}`, data, { ex: 604800 }); // тримаємо 7 днів

      // створюємо посилання-заявку на канал
      const link = await tg("createChatInviteLink", {
        chat_id: process.env.CHANNEL_ID,
        creates_join_request: true,
        name: `u${userId}`.slice(0, 32),
      });
      const inviteUrl = link.result && link.result.invite_link;

      await tg("sendMessage", {
        chat_id: chatId,
        text: "Натисни кнопку нижче, щоб вступити в канал 👇\nПісля заявки тебе впустять автоматично.",
        reply_markup: {
          inline_keyboard: [[{ text: "🚀 Вступити в канал", url: inviteUrl }]],
        },
      });

      res.status(200).send("ok");
      return;
    }

    // 2) Людина подала заявку на вступ — це і є реальна підписка
    if (update.chat_join_request) {
      const userId = update.chat_join_request.from.id;
      const data = asObject(await redis.get(`u:${userId}`));

      // впускаємо людину в канал
      await tg("approveChatJoinRequest", {
        chat_id: process.env.CHANNEL_ID,
        user_id: userId,
      });

      // шлемо подію в Meta — вона сама зіставить її з креативом
      await sendCapi(data, userId);

      // рахуємо для власної статистики (по конкретному оголошенню)
      const adKey = data.ad_id || data.ad_name || "unknown";
      await redis.hincrby("stats:subs", adKey, 1);

      await redis.del(`u:${userId}`);
      res.status(200).send("ok");
      return;
    }

    res.status(200).send("ok");
  } catch (e) {
    // завжди відповідаємо 200, інакше Telegram засипле повторами
    res.status(200).send("ok");
  }
}
