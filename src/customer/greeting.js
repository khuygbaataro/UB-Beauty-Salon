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
      `Сайн байна уу! ${config.salonName}-д тавтай морилно уу 🌸\n\n` +
      `Бид дараах үйлчилгээг санал болгож байна:\n` +
      `• GREEN PEEL (арьс шинэчлэх)\n` +
      `• La Vie (өргөх чангалах)\n` +
      `• Эрэгтэйчүүдийн Хүчирхэг багц\n` +
      `• Илүүдэл үс арилгах лазер\n` +
      `• Сормуус суулгалт\n\n` +
      `Аль үйлчилгээг сонирхож байна вэ? Эсвэл шууд цаг захиалах уу?`
    );
  }

  // Үйлчилгээнээс хамаарсан мэндчилгээ
  let msg = `Сайн байна уу! «${service.name}» үйлчилгээг сонирхсон танд баярлалаа 🌸\n\n`;
  msg += `${service.description}\n`;

  if (service.benefits?.length) {
    msg += `\nОнцлог:\n` + service.benefits.slice(0, 6).map((b) => `• ${b}`).join("\n") + "\n";
  }

  msg += `\n${priceSummary(service)}\n`;
  msg += `\nЭнэ үйлчилгээгээр цаг захиалах уу? Эсвэл асуух зүйл байвал бичээрэй 😊`;
  return msg;
}
