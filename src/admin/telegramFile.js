// Telegram файлын татах URL авах (getFile).

import { config } from "../config.js";

/**
 * file_id-аас татаж авах боломжтой URL гаргах.
 * @param {string} fileId
 * @returns {Promise<string|null>}
 */
export async function getTelegramFileUrl(fileId) {
  const token = config.telegramBotToken;
  if (!token || !fileId) return null;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    );
    const data = await res.json();
    if (!data.ok || !data.result?.file_path) return null;
    return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
  } catch (err) {
    console.error("[telegram] getFile алдаа:", err);
    return null;
  }
}
