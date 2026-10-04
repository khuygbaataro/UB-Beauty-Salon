// ─────────────────────────────────────────────────────────────
//  Үйлчилгээ танилцуулах.
//
//  Дүрэм: ЦӨӨН мессеж, богино. Дараалан олон текст/карт БҮҮ явуул.
//   • Cold хэрэглэгчид → НЭГ богино мэндчилгээ + үйлчилгээний нэрсийн жагсаалт.
//   • Зураг/дэлгэрэнгүйг хэрэглэгч тухайн үйлчилгээг сонгож байж л үзүүлнэ.
//   • Контентоос ирсэн бол тэр нэг үйлчилгээг картаар.
// ─────────────────────────────────────────────────────────────

import { repository } from "../db/repository.js";
import { sendText, sendServiceCard } from "../messenger/sendApi.js";

/** Cold хэрэглэгчид НЭГ богино мессежээр үйлчилгээний цэсийг санал болгох. */
export async function presentMainServices(psid) {
  const services = await repository.listServices({ activeOnly: true });
  const menu = services.map((s) => `• ${s.name}`).join("\n");

  await sendText(psid, `Сайн байна уу 🌸 Юу сонирхож байна вэ?\n${menu}`);

  return services.map((s) => s.name);
}

/** Нэг үйлчилгээг картаар танилцуулах (контентоос ирсэн эсвэл сонирхсон үед). */
export async function presentOneService(psid, service) {
  await sendServiceCard(psid, service);
}
