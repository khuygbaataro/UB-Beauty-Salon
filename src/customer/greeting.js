// ─────────────────────────────────────────────────────────────
//  Контентоос хамаарсан мэндчилгээ.
//
//  Хэрэглэгч Facebook дээр тодорхой үйлчилгээний пост/зараас орж ирэхэд
//  Messenger "referral" эсвэл "postback" эвентэд ref утга дамжуулдаг.
//  (жишээ: m.me/<page>?ref=green-peel, эсвэл зарын ad referral).
//
//  Энэ ref-ээр аль үйлчилгээнээс ирснийг тогтоож, тухайн үйлчилгээг
//  онцолсон мэндчилгээ үүсгэнэ. ref олдохгүй бол ерөнхий мэндчилгээ өгнө.
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";

/** Төгрөгийн форматлалт: 60000 → "60,000₮" */
export function formatMnt(amount) {
  if (amount == null) return "үнэ тодорхойгүй";
  return `${Number(amount).toLocaleString("en-US")}₮`;
}

/** Үйлчилгээний үнийн мөрийг эвхэх (variants/addons-ийг тооцно). */
export function priceSummary(service) {
  if (service.variants?.length) {
    return service.variants
      .map((v) => `• ${v.name}${v.sessions ? ` (${v.sessions} удаа)` : ""}: ${formatMnt(v.price)}`)
      .join("\n");
  }
  if (service.price != null) {
    let base = `Үнэ: ${formatMnt(service.price)}`;
    if (service.addons?.length) {
      base +=
        "\nНэмэлт сонголт:\n" +
        service.addons.map((a) => `• ${a.name}: +${formatMnt(a.price)}`).join("\n");
    }
    return base;
  }
  return "Үнийн мэдээлэл тодорхой болоогүй байна — манай ажилтан тодруулж өгнө.";
}

/**
 * ref-ээс таарсан үйлчилгээг олох.
 * @returns {Promise<{service: object|null}>}
 */
export async function resolveReferral(ref) {
  const service = await repository.findServiceByRef(ref);
  return { service };
}

/**
 * Мэндчилгээний текст үүсгэх.
 * @param {object|null} service — ирсэн үйлчилгээ (ref-ээс тогтоосон)
 */
export function buildGreeting(service) {
  if (!service) {
    return (
      `Сайн байна уу?\n\n${config.salonName}-ны чатботод тавтай морилно уу.\n\n` +
      `Ямар үйлчилгээний талаар дэлгэрэнгүй мэдээлэл авахыг хүсэж байна вэ?`
    );
  }

  // Контентоос ирсэн — үйлчилгээг товч танилцуулаад, сонирхлыг нь батлах (funnel).
  // ⚠️ Үнийг энд хэлэхгүй — хэрэглэгч сонирхсоноо батласны дараа AI үнэ+бэлгийг хэлнэ.
  return (
    `Сайн байна уу?\n\n` +
    `«${service.name}» үйлчилгээг сонирхсон танд баярлалаа.\n\n` +
    `${service.description}\n\n` +
    `Та энэ үйлчилгээг сонирхож байна уу?`
  );
}
