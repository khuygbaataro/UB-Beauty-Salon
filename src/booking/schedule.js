// ─────────────────────────────────────────────────────────────
//  Цагийн хуваарь / слотын систем.
//
//  Салон өдөр бүр config.salonOpenHour–config.salonCloseHour (default 10:00–19:00)
//  ажиллана. Нэг слот config.slotMinutes (default 60 мин) урттай. Нэг хүний
//  үйлчилгээ ойролцоогоор 30мин–1цаг тул слот бүр нэг захиалга багтаана.
//
//  Цаг санал болгохдоо эхлээд priority цонх (default 10:00–13:00)-ны сул цагийг
//  санал болгоно; тэнд сул цаг байхгүй бол үлдсэн цагийг санал болгоно.
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";

const toMin = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Тухайн өдрийн БҮХ боломжит слотыг (сул эсэхээс үл хамаарч) үүсгэх. */
export function generateDaySlots() {
  const slots = [];
  const start = config.salonOpenHour * 60;
  const end = config.salonCloseHour * 60;
  for (let m = start; m + config.slotMinutes <= end; m += config.slotMinutes) {
    slots.push(toHHMM(m));
  }
  return slots;
}

/** Өгсөн цаг нь хүчинтэй слот (ажиллах цагийн дотор) эсэх. */
export function isValidSlot(time) {
  return generateDaySlots().includes(time);
}

/** Тухайн өдөр аль хэдийн захиалагдсан (цуцлагдаагүй) цагууд. */
export async function getBookedTimes(date) {
  const all = await repository.listBookings({});
  return all
    .filter((b) => b.date === date && b.status !== "cancelled")
    .map((b) => b.time);
}

/** Тухайн өдрийн сул слотууд. */
export async function getAvailableSlots(date) {
  const booked = new Set(await getBookedTimes(date));
  return generateDaySlots().filter((t) => !booked.has(t));
}

/** Тодорхой цаг сул эсэх. */
export async function isSlotAvailable(date, time) {
  if (!isValidSlot(time)) return false;
  const booked = new Set(await getBookedTimes(date));
  return !booked.has(time);
}

/**
 * Санал болгох цагуудыг эрэмбэлж буцаах.
 * Эхэнд priority цонх (10:00–13:00)-ны сул цаг, дараа нь үлдсэн сул цаг.
 * @returns {Promise<{morning: string[], later: string[], ordered: string[]}>}
 */
export async function suggestSlots(date, limit = 6) {
  const avail = await getAvailableSlots(date);
  const pStart = config.priorityStartHour * 60;
  const pEnd = config.priorityEndHour * 60;

  const morning = avail.filter((t) => toMin(t) >= pStart && toMin(t) < pEnd);
  const later = avail.filter((t) => toMin(t) < pStart || toMin(t) >= pEnd);

  // Эхэлж өглөөний цонх, дараа нь үлдсэн — хугацааны дарааллаар
  const ordered = [...morning, ...later].slice(0, limit);
  return { morning, later, ordered };
}
