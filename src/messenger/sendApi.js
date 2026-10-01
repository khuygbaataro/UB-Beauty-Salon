// Facebook Messenger Send API — үйлчлүүлэгч рүү мессеж илгээх.

import { config } from "../config.js";

const GRAPH_URL = "https://graph.facebook.com/v21.0/me/messages";

/**
 * Messenger-ээр текст мессеж илгээх.
 * @param {string} psid — хүлээн авагчийн Page-Scoped ID
 * @param {string} text — мессежийн текст
 * @param {string} [messagingType] — RESPONSE (default) | MESSAGE_TAG | UPDATE
 */
export async function sendText(psid, text, messagingType = "RESPONSE") {
  if (!config.fbPageAccessToken) {
    console.warn("[messenger] FB_PAGE_ACCESS_TOKEN алга — мессеж илгээгдсэнгүй:", text);
    return { ok: false, skipped: true };
  }

  const body = {
    messaging_type: messagingType,
    recipient: { id: psid },
    message: { text },
  };

  try {
    const res = await fetch(`${GRAPH_URL}?access_token=${config.fbPageAccessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("[messenger] Илгээх алдаа:", res.status, errText);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    console.error("[messenger] Сүлжээний алдаа:", err);
    return { ok: false, error: String(err) };
  }
}

/** "Бичиж байна…" индикатор асаах/унтраах. */
export async function sendTypingOn(psid) {
  if (!config.fbPageAccessToken) return;
  try {
    await fetch(`${GRAPH_URL}?access_token=${config.fbPageAccessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: psid }, sender_action: "typing_on" }),
    });
  } catch {
    /* чимээгүй өнгөрөөнө */
  }
}
