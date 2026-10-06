// ─────────────────────────────────────────────────────────────
//  Цаг цуцлах журам (зөөлөн, хүндэтгэлтэй).
//
//  Одоогоор урьдчилгаа төлбөргүй тул цаг цуцлахад мөнгө буцаах асуудал гарахгүй.
//  Зөвхөн эелдэг хүсэлт: боломжтой бол цагаасаа config.cancelNoticeHours (default 4)
//  цагийн өмнө мэдэгдвэл бид тэр цагийг өөр хүнд санал болгож чадна.
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";
import { syncScheduleSafe } from "../sheets/googleSheets.js";

/**
 * Цуцлалтын цагийг үнэлэх (эрт мэдэгдсэн эсэх).
 * @param {object} booking — startsAt (ISO) талбартай
 * @param {Date}   [now]
 * @returns {{earlyNotice: boolean, hoursUntil: number, noticeHours: number}}
 */
export function evaluateCancellation(booking, now = new Date()) {
  const noticeHours = config.cancelNoticeHours;
  const start = new Date(booking.startsAt);
  const hoursUntil = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
  return {
    earlyNotice: hoursUntil >= noticeHours,
    hoursUntil: Math.round(hoursUntil * 10) / 10,
    noticeHours,
  };
}

/**
 * Захиалгыг цуцлах (цагийг сул болгоно).
 * @returns {Promise<{booking, earlyNotice, hoursUntil, noticeHours}>}
 */
export async function cancelBooking(bookingId, now = new Date()) {
  const booking = await repository.getBooking(bookingId);
  if (!booking) throw new Error("Захиалга олдсонгүй.");
  if (booking.status === "cancelled") {
    throw new Error("Энэ захиалга аль хэдийн цуцлагдсан байна.");
  }

  const evaln = evaluateCancellation(booking, now);
  const updated = await repository.updateBooking(bookingId, {
    status: "cancelled",
    cancelledAt: now.toISOString(),
  });

  // Google Sheet-ийн "Захиалга" табыг шинэчлэх (цаг сул болсон).
  await syncScheduleSafe();

  return { booking: updated, ...evaln };
}

/** Цуцлалтын хариу мессеж — зөөлөн, хүндэтгэлтэй. */
export function cancellationMessage(evaln) {
  if (evaln.earlyNotice) {
    return (
      `Таны цаг цуцлагдлаа, ойлголттойгоор хүлээж авлаа 🌸 ` +
      `Эрт мэдэгдсэнд баярлалаа. Дараа дахин үйлчлүүлэхээр цагаа захиалаарай 💫`
    );
  }
  return (
    `Таны цаг цуцлагдлаа 🌸 Ямар ч асуудалгүй. ` +
    `Зүгээр л дараагийн удаа боломжтой бол цагаасаа ${evaln.noticeHours} цагийн өмнөхөн ` +
    `мэдэгдээрэй — ингэвэл бид тэр цагийг өөр хүнд санал болгож амжина. Ойлгосонд баярлалаа 💫`
  );
}
