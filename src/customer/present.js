// ─────────────────────────────────────────────────────────────
//  Үйлчилгээ танилцуулах.
//
//  Дүрэм: ЦӨӨН мессеж, богино. Дараалан олон текст/карт БҮҮ явуул.
//   • Cold хэрэглэгчид → НЭГ богино мэндчилгээ + үйлчилгээний нэрсийн жагсаалт.
//   • Зураг/дэлгэрэнгүйг хэрэглэгч тухайн үйлчилгээг сонгож байж л үзүүлнэ.
//   • Контентоос ирсэн бол тэр нэг үйлчилгээг картаар.
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";
import { sendText, sendServiceCard, sendImage } from "../messenger/sendApi.js";

/** Зургийн замыг absolute болгох (/img/... → https://.../img/...). */
function absImageUrl(rel) {
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;
  return config.publicBaseUrl ? `${config.publicBaseUrl}${rel}` : null;
}

/** Cold хэрэглэгчид НЭГ богино мессежээр үйлчилгээний цэсийг санал болгох. */
export async function presentMainServices(psid) {
  const services = await repository.listServices({ activeOnly: true });
  const menu = services.map((s) => `• ${s.name}`).join("\n");

  // Админ тохируулсан мэндчилгээ байвал түүнийг, эс бол default-ийг ашиглана.
  const custom = await repository.getSetting("greeting");
  const intro =
    custom ||
    `Сайн байна уу?\n\n${config.salonName}-ны чатботод тавтай морилно уу.\n\n` +
      `Ямар үйлчилгээний талаар дэлгэрэнгүй мэдээлэл авахыг хүсэж байна вэ?`;

  await sendText(psid, `${intro}\n\n${menu}`);

  return services.map((s) => s.name);
}

/** Нэг үйлчилгээг танилцуулах (контентоос ирсэн эсвэл сонирхсон үед).
 *  Хэрэв үйлчилгээнд images[] (олон зураг) байвал тэдгээрийг дараалан илгээнэ,
 *  эс бол нэг зурагт карт (service.image) илгээнэ. */
export async function presentOneService(psid, service) {
  const urls = (service.images || []).map(absImageUrl).filter(Boolean);
  if (urls.length) {
    for (const url of urls) await sendImage(psid, url);
    return;
  }
  await sendServiceCard(psid, service);
}

/** Нэг бараа бүтээгдэхүүнийг зурагт картаар танилцуулах. */
export async function presentProduct(psid, product) {
  await sendServiceCard(psid, product);
}
