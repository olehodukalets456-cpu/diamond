// /api/setup?key=ТВІЙ_СЕКРЕТ
// Викликати один раз після деплою, щоб підключити бота до цього сервера.
export default async function handler(req, res) {
  if (req.query.key !== process.env.SETUP_SECRET) {
    res.status(403).send("forbidden");
    return;
  }

  const url = `https://${req.headers.host}/api/telegram`;

  const r = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        allowed_updates: ["message", "chat_join_request"],
      }),
    }
  );

  const tg = await r.json();
  res.status(200).json({ webhook_url: url, telegram_response: tg });
}
