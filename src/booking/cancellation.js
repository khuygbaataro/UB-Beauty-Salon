// ─────────────────────────────────────────────────────────────
//  Цаг цуцлах бодлого.
//
//  Үйлчлүүлэгч захиалгаа цуцлах үед: захиалгатай цаг хүртэл
//  CANCEL_REFUND_HOURS (default 4) цаг буюу түүнээс их хугацаа үлдсэн бол
//  урьдчилгаа төлбөрийг БУЦААНА. Үгүй бол буцаахгүй.
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";

/**
 * Цуцлалтад урьдчилгаа буцаах эсэхийг тооцох.
 * @param {object} booking — startsAt (ISO) талбартай байх
 * @param {Date}   [now]   — одоогийн цаг (тест хийхэд дамжуулж болно)
 * @returns {{refundEligible: boolean, hoursUntil: number, thresholdHours: number}}
 */
export function evaluateCancellation(booking, now = new Date()) {
  const thresholdHours = config.cancelRefundHours;
  const start = new Date(booking.startsAt);
  const hoursUntil = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
  return {
    refundEligible: hoursUntil >= thresholdHours,
    hoursUntil: Math.round(hoursUntil * 10) / 10,
    thresholdHours,
  };
}

/**
 * Захиалгыг цуцлах.
 * @returns {Promise<{booking: object, refundEligible: boolean, hoursUntil: number, thresholdHours: number}>}
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
    refundEligible: evaln.refundEligible,
    refundIssued: false, // бодит буцаалтыг ажилтан/төлбөрийн систем хийнэ
  });

  return { booking: updated, ...evaln };
}

/** Цуцлалтын хариу мессеж үүсгэх. */
export function cancellationMessage(evaln) {
  if (evaln.refundEligible) {
    return (
      `Таны захиалга цуцлагдлаа. Захиалгатай цаг хүртэл ${evaln.hoursUntil} цаг үлдсэн ` +
      `(≥ ${evaln.thresholdHours} цаг) тул урьдчилгаа төлбөрийг буцаан олгоно. ` +
      `Манай ажилтан тантай холбогдож буцаалтыг хийнэ.`
    );
  }
  return (
    `Таны захиалга цуцлагдлаа. Гэвч захиалгатай цаг хүртэл ${evaln.hoursUntil} цаг л үлдсэн ` +
    `(${evaln.thresholdHours} цагаас бага) тул урьдчилгаа төлбөрийг буцаах боломжгүй байна. ` +
    `Ойлгосонд баярлалаа.`
  );
}
