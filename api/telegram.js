// /api/telegram  — сюди Telegram присилає всі події бота.
// Обробляємо дві: натискання Start (перехід зі сторінки) і заявку на вступ.
import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const TG = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

// Обкладинка, яку бот шле разом із кнопкою (файл лежить у корені репозиторію)
const BOT_PHOTO = "https://diamond-pi-ten.vercel.app/DMND1.jpg";

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

// Одне посилання = одна кампанія.
// Якщо для кампанії вже є посилання — беремо готове; якщо ні — створюємо одне й зберігаємо.
async function getCampaignLink(d) {
  const campKey = String(d.campaign_id || d.campaign_name || "default");

  const stored = await redis.get(`camp:${campKey}`);
  if (stored) return typeof stored === "string" ? stored : String(stored);

  // назва посилання, яку буде видно в аналітиці каналу
  const name = String(d.campaign_name || d.campaign_id || "Ads / DMND").slice(0, 32);

  const link = await tg("createChatInviteLink", {
    chat_id: process.env.CHANNEL_ID,
    creates_join_request: true,
    name,
  });
  const inviteUrl = link.result && link.result.invite_link;

  if (inviteUrl) {
    await redis.set(`camp:${campKey}`, inviteUrl); // зберігаємо для перевикористання
    await redis.sadd("links:mine", inviteUrl);     // позначаємо як "своє"
  }
  return inviteUrl;
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

      // беремо одне посилання-заявку на кампанію (створюється раз, далі перевикористовується)
      const inviteUrl = await getCampaignLink(data);

      const caption = "Нажми кнопку ниже, чтобы вступить в канал 👇\nПосле заявки тебя впустят автоматически.";
      const keyboard = { inline_keyboard: [[{ text: "🚀 Вступить в канал", url: inviteUrl }]] };

      // шлемо фото-обкладинку з підписом і кнопкою; якщо фото не завантажилось — просто текст
      const photo = await tg("sendPhoto", {
        chat_id: chatId,
        photo: BOT_PHOTO,
        caption,
        reply_markup: keyboard,
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

      // через яке посилання прийшла заявка
      const usedLink =
        update.chat_join_request.invite_link &&
        update.chat_join_request.invite_link.invite_link;

      // запобіжник: чіпаємо ТІЛЬКИ заявки з посилань, які бот створив сам.
      // Якщо посилання чуже (інше джерело) — бот мовчить і нічого не робить.
      const isOurs = usedLink && (await redis.sismember("links:mine", usedLink));
      if (!isOurs) {
        res.status(200).send("ok");
        return;
      }

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
