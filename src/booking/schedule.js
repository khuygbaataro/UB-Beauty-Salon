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

export const toMin = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
};
export const toHHMM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// Долоо хоногийн өдрийн түлхүүр (weeklySchedule-д хэрэглэнэ).
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "YYYY-MM-DD" огнооны долоо хоногийн өдрийн түлхүүр (Улаанбаатарын цагаар). */
export function dayKeyOf(date) {
  // Тухайн өдрийн 12:00 (+08:00)-г авч UTC өдрөөр тооцоход орон нутгийн өдөр таарна.
  const d = new Date(`${date}T12:00:00+08:00`);
  return DAY_KEYS[d.getUTCDay()];
}

/** Улаанбаатарын өнөөдрийн (эсвэл offset хоногийн дараах) огноо "YYYY-MM-DD". */
export function ubDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  // +08:00 цагийн бүс рүү шилжүүлж огноог гаргана.
  const ub = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return ub.toISOString().slice(0, 10);
}

/** Тухайн долоо хоногийн (Даваагаар эхэлсэн) 7 огноо. offsetWeeks=1 → дараа 7 хоног. */
export function weekDates(offsetWeeks = 0) {
  const base = ubDate(offsetWeeks * 7);
  const d = new Date(`${base}T12:00:00+08:00`);
  const dow = d.getUTCDay(); // 0=Ня ... 6=Бя
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d.getTime() + diffToMon * 24 * 60 * 60 * 1000);
  return dateRange(monday.toISOString().slice(0, 10), 7);
}

/** startDate-аас эхлэн дараалсан N хоногийн огноонуудыг буцаах. */
export function dateRange(startDate, days) {
  const out = [];
  const base = new Date(`${startDate}T12:00:00+08:00`);
  const n = Math.max(1, Number(days) || 1);
  for (let i = 0; i < n; i++) {
    const d = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

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

// ─────────────────────────────────────────────────────────────
//  Артист тус бүрийн хуваарь / сул цаг
// ─────────────────────────────────────────────────────────────

/**
 * Тухайн артистын өгсөн өдрийн БҮХ ажиллах слот (сул эсэхээс үл хамаарч).
 * weeklySchedule доторх тухайн гаригийн start–end-ээс слот үүсгэнэ.
 * Идэвхгүй артист эсвэл амралтын өдөр бол хоосон.
 */
export function artistDaySlots(artist, date) {
  if (!artist || !artist.active) return [];
  if ((artist.timeOff || []).includes(date)) return [];

  const sched = (artist.weeklySchedule || {})[dayKeyOf(date)];
  if (!sched || !sched.start || !sched.end) return [];

  const slots = [];
  const start = toMin(sched.start);
  const end = toMin(sched.end);
  for (let m = start; m + config.slotMinutes <= end; m += config.slotMinutes) {
    slots.push(toHHMM(m));
  }
  return slots;
}

/** Тухайн артистын өгсөн өдөр захиалагдсан (цуцлагдаагүй) цагууд. */
export async function artistBookedTimes(artistId, date) {
  const arr = await repository.listBookings({ artistId, date });
  return arr.filter((b) => b.status !== "cancelled").map((b) => b.time);
}

/** Тухайн артистын өгсөн өдрийн сул слотууд. */
export async function artistAvailableSlots(artist, date) {
  const booked = new Set(await artistBookedTimes(artist.id, date));
  return artistDaySlots(artist, date).filter((t) => !booked.has(t));
}
