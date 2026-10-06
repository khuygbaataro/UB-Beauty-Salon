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
import { sendText, sendServiceCard } from "../messenger/sendApi.js";

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

/** Нэг үйлчилгээг картаар танилцуулах (контентоос ирсэн эсвэл сонирхсон үед). */
export async function presentOneService(psid, service) {
  await sendServiceCard(psid, service);
}
