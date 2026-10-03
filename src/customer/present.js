// ─────────────────────────────────────────────────────────────
//  Үйлчилгээ танилцуулах (зурагт карт).
//
//  Дүрэм: үйлчилгээ бүр = 1 chat (нэг зурагт карт).
//   • Контентоос ирээгүй (cold) хэрэглэгчид → эхний 3 үйлчилгээг тус бүр картаар.
//   • Үлдсэнийг хэрэглэгч өөр үйлчилгээ сонирхвол танилцуулна.
//   • Контентоос ирсэн бол тэр нэг үйлчилгээг картаар.
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";
import { sendText, sendServiceCard } from "../messenger/sendApi.js";

export const MAIN_COUNT = 3; // эхний N үйлчилгээ (үндсэн)

/** Cold хэрэглэгчид эхний 3 үйлчилгээг картаар танилцуулах. */
export async function presentMainServices(psid) {
  const services = await repository.listServices({ activeOnly: true });
  const main = services.slice(0, MAIN_COUNT);

  await sendText(
    psid,
    `Сайн байна уу 🌸 ${config.salonName}-д тавтай морилно уу. Та ямар үйлчилгээ сонирхож байна вэ? Манай онцлох 3 үйлчилгээг танилцуулъя ✨`,
  );
  for (const s of main) {
    await sendServiceCard(psid, s);
  }
  await sendText(
    psid,
    `Эдгээрийн аль нэгийг, эсвэл өөр үйлчилгээ (лазер, сормуус) сонирхож байвал хэлээрэй 💫`,
  );

  return main.map((s) => s.name);
}

/** Нэг үйлчилгээг картаар танилцуулах (контентоос ирсэн эсвэл сонирхсон үед). */
export async function presentOneService(psid, service) {
  await sendServiceCard(psid, service);
}
