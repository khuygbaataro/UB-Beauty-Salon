// Facebook Messenger Send API — үйлчлүүлэгч рүү мессеж илгээх.

import { config } from "../config.js";

const GRAPH_URL = "https://graph.facebook.com/v21.0/me/messages";

/** Дотоод: өгсөн page токеноор текст мессеж илгээх. */
async function postText(token, psid, text, messagingType) {
  if (!token) {
    console.warn("[messenger] Page токен алга — мессеж илгээгдсэнгүй:", text);
    return { ok: false, skipped: true };
  }

  const body = {
    messaging_type: messagingType,
    recipient: { id: psid },
    message: { text },
  };

  try {
    const res = await fetch(`${GRAPH_URL}?access_token=${token}`, {
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

/**
 * Messenger-ээр ҮЙЛЧЛҮҮЛЭГЧ рүү текст мессеж илгээх (үйлчлүүлэгчийн хуудас).
 * @param {string} psid — хүлээн авагчийн Page-Scoped ID
 * @param {string} text — мессежийн текст
 * @param {string} [messagingType] — RESPONSE (default) | MESSAGE_TAG | UPDATE
 */
export async function sendText(psid, text, messagingType = "RESPONSE") {
  return postText(config.fbPageAccessToken, psid, text, messagingType);
}

/**
 * Messenger-ээр АРТИСТ руу текст мессеж илгээх (артистын тусдаа хуудас).
 * Артистын токен тохируулаагүй бол (dev) үйлчлүүлэгчийн хуудасныхыг түр ашиглана.
 */
export async function sendArtistText(psid, text, messagingType = "RESPONSE") {
  const token = config.artistPageAccessToken || config.fbPageAccessToken;
  return postText(token, psid, text, messagingType);
}

/**
 * Нэг үйлчилгээг зурагт карт (generic template)-аар илгээх = 1 chat.
 * Зураг (service.image) байхгүй бол текстээр (нэр + товч) илгээнэ.
 */
export async function sendServiceCard(psid, service) {
  const subtitle = (service.tagline || service.description || "").slice(0, 80);

  // Зураггүй бол текст fallback
  if (!service.image) {
    return sendText(psid, `🌸 ${service.name}\n${service.tagline || subtitle}`);
  }

  if (!config.fbPageAccessToken) {
    console.warn("[messenger] FB_PAGE_ACCESS_TOKEN алга — карт илгээгдсэнгүй:", service.name);
    return { ok: false, skipped: true };
  }

  const body = {
    messaging_type: "RESPONSE",
    recipient: { id: psid },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [
            {
              title: service.name,
              subtitle,
              image_url: service.image,
            },
          ],
        },
      },
    },
  };

  try {
    const res = await fetch(`${GRAPH_URL}?access_token=${config.fbPageAccessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("[messenger] Карт илгээх алдаа:", res.status, errText);
      // зураг алдаатай бол текстээр нөхөж илгээе
      return sendText(psid, `🌸 ${service.name}\n${service.tagline || subtitle}`);
    }
    return { ok: true };
  } catch (err) {
    console.error("[messenger] Карт сүлжээний алдаа:", err);
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
