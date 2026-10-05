// Telegram руу мессеж илгээх (Admin суваг).

import { config } from "../config.js";

/** Нэг chat руу текст илгээх. parseMode: "HTML" | "MarkdownV2" (заавал биш). */
export async function sendTelegram(chatId, text, parseMode) {
  if (!config.telegramBotToken) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN алга — илгээгдсэнгүй:", text);
    return { ok: false, skipped: true };
  }
  try {
    const payload = { chat_id: chatId, text };
    if (parseMode) payload.parse_mode = parseMode;
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

/** Бүх зөвшөөрөгдсөн ажилчид руу мэдэгдэл илгээх. parseMode заавал биш. */
export async function notifyAdmins(text, parseMode) {
  const ids = config.adminAllowedIds;
  if (!ids.length) {
    console.warn("[telegram] ADMIN_ALLOWED_IDS хоосон — мэдэгдэл хэнд ч очсонгүй:", text);
    return { ok: false, skipped: true };
  }
  const results = await Promise.all(ids.map((id) => sendTelegram(id, text, parseMode)));
  return { ok: results.some((r) => r.ok), results };
}
