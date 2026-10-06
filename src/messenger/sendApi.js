// Facebook Messenger Send API — үйлчлүүлэгч рүү мессеж илгээх.

import { config } from "../config.js";

const GRAPH_URL = "https://graph.facebook.com/v21.0/me/messages";

/** Дотоод: өгсөн page токеноор текст мессеж илгээх.
 *  tag өгвөл (жишээ CONFIRMED_EVENT_UPDATE) 24 цагийн цонхны ГАДНА ч илгээнэ. */
async function postText(token, psid, text, messagingType, tag) {
  if (!token) {
    console.warn("[messenger] Page токен алга — мессеж илгээгдсэнгүй:", text);
    return { ok: false, skipped: true };
  }

  const body = {
    messaging_type: messagingType,
    recipient: { id: psid },
    message: { text },
  };
  // MESSAGE_TAG үед Facebook яг аль tag болохыг ЗААВАЛ шаарддаг.
  if (tag) body.tag = tag;

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
 * @param {string} [tag] — MESSAGE_TAG үеийн tag (жишээ CONFIRMED_EVENT_UPDATE)
 */
export async function sendText(psid, text, messagingType = "RESPONSE", tag) {
  return postText(config.fbPageAccessToken, psid, text, messagingType, tag);
}

/**
 * Messenger-ээр АРТИСТ руу текст мессеж илгээх (артистын тусдаа хуудас).
 * Артистын токен тохируулаагүй бол (dev) үйлчлүүлэгчийн хуудасныхыг түр ашиглана.
 */
export async function sendArtistText(psid, text, messagingType = "RESPONSE", tag) {
  const token = config.artistPageAccessToken || config.fbPageAccessToken;
  return postText(token, psid, text, messagingType, tag);
}

/** Картын дэд гарчиг — ҮНЭ болон чимэглэлийн emoji-гүй, цэвэрхэн богино тайлбар.
 *  (Үнийг зөвхөн funnel-ийн 5-р алхамд хэлнэ — картан дээр давхардуулахгүй.) */
function cardSubtitle(service) {
  let s = service.subtitle || service.description || service.tagline || "";
  s = s
    .replace(/[\d.,\s]*₮/g, "") // "68,000₮" гэх мэт үнэ хасах
    .replace(/[—–-]\s*$/g, "") // үлдсэн "—" хасах
    .replace(/[🌸✨💫🌿🎁🌷🌼]/g, "") // чимэглэлийн emoji хасах
    .replace(/\s{2,}/g, " ")
    .trim();
  return s.slice(0, 80);
}

/**
 * Нэг үйлчилгээг зурагт карт (generic template)-аар илгээх = 1 chat.
 * Зураг (service.image) байхгүй бол текстээр (нэр + товч) илгээнэ.
 */
export async function sendServiceCard(psid, service) {
  const subtitle = cardSubtitle(service);

  // Зураггүй бол текст fallback (цэцэггүй, үнэгүй)
  if (!service.image) {
    return sendText(psid, subtitle ? `${service.name}\n${subtitle}` : service.name);
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
      // зураг алдаатай бол текстээр нөхөж илгээе (цэцэггүй, үнэгүй)
      return sendText(psid, subtitle ? `${service.name}\n${subtitle}` : service.name);
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
