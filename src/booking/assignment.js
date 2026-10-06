// ─────────────────────────────────────────────────────────────
//  Артист хуваарилалт / үйлчилгээний түвшний сул цаг.
//
//  Нэг үйлчилгээг хэд хэдэн артист хийж болно. Үйлчлүүлэгч цаг
//  захиалахад тухайн үйлчилгээг хийдэг, тэр цагт сул артистуудаас
//  ХАМГИЙН БАГА АЧААЛАЛТАЙГ нь автоматаар сонгоно (ачаалал тэнцвэржүүлнэ).
//
//  v1: нэг үйлчилгээ = нэг слот (1 цаг), нэг артист нэг цагт нэг хүн.
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";
import {
  toMin,
  artistAvailableSlots,
  artistBookedTimes,
} from "./schedule.js";

/** Тухайн үйлчилгээг хийдэг идэвхтэй артистууд. */
export async function artistsForService(serviceId) {
  return repository.listArtists({ active: true, serviceId });
}

/** Систем артистаар ажиллаж эхэлсэн эсэх (ядаж 1 идэвхтэй артист бүртгэлтэй). */
export async function hasActiveArtists() {
  const arr = await repository.listArtists({ active: true });
  return arr.length > 0;
}

/**
 * Тухайн үйлчилгээний өгсөн өдрийн сул цагууд (аль ч артист сул байвал сул гэж үзнэ).
 * @returns {Promise<{times:string[], freeByTime:Map<string,string[]>, artistCount:number}>}
 */
export async function serviceAvailability(serviceId, date) {
  const artists = await artistsForService(serviceId);
  const freeByTime = new Map(); // time -> artistId[]

  for (const a of artists) {
    const slots = await artistAvailableSlots(a, date);
    for (const t of slots) {
      if (!freeByTime.has(t)) freeByTime.set(t, []);
      freeByTime.get(t).push(a.id);
    }
  }

  const times = [...freeByTime.keys()].sort((x, y) => toMin(x) - toMin(y));
  return { times, freeByTime, artistCount: artists.length };
}

/**
 * Үйлчилгээний сул цагуудыг санал болгох дараалал.
 * Эхэнд priority цонх (10:00–13:00)-ны сул цаг, дараа нь үлдсэн.
 */
export async function suggestServiceSlots(serviceId, date, limit = 6) {
  const { times, artistCount } = await serviceAvailability(serviceId, date);
  const pStart = config.priorityStartHour * 60;
  const pEnd = config.priorityEndHour * 60;

  const morning = times.filter((t) => toMin(t) >= pStart && toMin(t) < pEnd);
  const later = times.filter((t) => toMin(t) < pStart || toMin(t) >= pEnd);
  const ordered = [...morning, ...later].slice(0, limit);
  // all: тухайн өдрийн БҮХ сул цаг (тодорхой цаг шалгахад; таслагдахгүй).
  return { all: times, morning, later, ordered, artistCount };
}

/**
 * Өгсөн үйлчилгээ/өдөр/цагт сул, хамгийн бага ачаалалтай артистыг сонгох.
 * Тухайн өдөр хамгийн цөөн захиалгатай артистад оноож ачааллыг тэнцвэржүүлнэ.
 * @returns {Promise<object|null>} сонгосон артист эсвэл null (сул артист алга).
 */
export async function pickArtist(serviceId, date, time) {
  const artists = await artistsForService(serviceId);
  const candidates = [];

  for (const a of artists) {
    const slots = await artistAvailableSlots(a, date);
    if (slots.includes(time)) {
      const load = (await artistBookedTimes(a.id, date)).length;
      candidates.push({ artist: a, load });
    }
  }

  if (!candidates.length) return null;
  // Хамгийн бага ачаалалтай нь түрүүнд (тэнцвэл эхнийх).
  candidates.sort((x, y) => x.load - y.load);
  return candidates[0].artist;
}
