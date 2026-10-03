// Telegram руу мессеж илгээх (Admin суваг).

import { config } from "../config.js";

/** Нэг chat руу текст илгээх. */
export async function sendTelegram(chatId, text) {
  if (!config.telegramBotToken) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN алга — илгээгдсэнгүй:", text);
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      },
    );
    if (!res.ok) {
      console.error("[telegram] илгээх алдаа:", res.status, await res.text());
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    console.error("[telegram] сүлжээний алдаа:", err);
    return { ok: false, error: String(err) };
  }
}

/** Бүх зөвшөөрөгдсөн ажилчид руу мэдэгдэл илгээх. */
export async function notifyAdmins(text) {
  const ids = config.adminAllowedIds;
  if (!ids.length) {
    console.warn("[telegram] ADMIN_ALLOWED_IDS хоосон — мэдэгдэл хэнд ч очсонгүй:", text);
    return { ok: false, skipped: true };
  }
  const results = await Promise.all(ids.map((id) => sendTelegram(id, text)));
  return { ok: results.some((r) => r.ok), results };
}
