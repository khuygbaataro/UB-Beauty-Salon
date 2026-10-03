// ─────────────────────────────────────────────────────────────
//  Цаг захиалгын логик.
//
//  Урсгал: үйлчлүүлэгчээс (1) утасны дугаар, (2) үйлчилгээ, (3) цаг/өдөр
//  тодруулж авна → слот сул эсэхийг шалгаад захиалга бүртгэнэ.
//
//  ⚠️ Одоогоор урьдчилгаа төлбөргүй (config.prepaymentEnabled=false) тул
//     захиалга шууд "confirmed" болж, сануулга ажиллана. (Дараа төлбөр нэмж болно.)
//  paymentMemo (цаг, өдөр, утас) нь дотоод лавлагаа болж хадгалагдана.
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";
import { formatMnt } from "../customer/greeting.js";
import { isValidSlot, isSlotAvailable } from "./schedule.js";

/** Монгол утасны дугаар эсэхийг шалгах (8 оронтой, 6/7/8/9-өөр эхэлнэ). */
export function isValidPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return /^[6-9]\d{7}$/.test(digits);
}

export function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Гүйлгээний утга үүсгэх: "цаг, өдөр, утасны дугаар".
 * Жишээ: "14:00, 2026-10-05, 99112233"
 */
export function buildPaymentMemo({ time, date, phone }) {
  return [time, date, normalizePhone(phone)].filter(Boolean).join(", ");
}

/**
 * Захиалга үүсгэх (төлбөр хийгдэхээс өмнөх pending төлөв).
 * @param {object} p
 * @param {string} p.psid       — Messenger хэрэглэгчийн ID (сануулга илгээхэд)
 * @param {string} p.phone      — утасны дугаар
 * @param {string} p.serviceId  — үйлчилгээний id
 * @param {string} [p.variantId]— хувилбар (лазерын хэсэг гэх мэт)
 * @param {string} p.date       — "YYYY-MM-DD"
 * @param {string} p.time       — "HH:mm"
 */
export async function createBooking(p) {
  if (!isValidPhone(p.phone)) {
    throw new Error("Утасны дугаар буруу байна (8 оронтой байх ёстой).");
  }
  const service = await repository.getService(p.serviceId);
  if (!service) throw new Error("Сонгосон үйлчилгээ олдсонгүй.");

  // Слот шалгах (admin override=true үед алгасна)
  if (!p.override) {
    if (!isValidSlot(p.time)) {
      throw new Error(
        `Сонгосон цаг ажиллах цагийн гадна байна. Бид ${config.salonOpenHour}:00–${config.salonCloseHour}:00 цагт ажилладаг.`,
      );
    }
    if (!(await isSlotAvailable(p.date, p.time))) {
      throw new Error("Энэ цаг аль хэдийн захиалагдсан байна. Өөр цаг сонгоно уу.");
    }
  }

  // Үнэ/урьдчилгаа (одоогоор урьдчилгаагүй тул prepayment=null)
  const variant = p.variantId ? service.variants?.find((v) => v.id === p.variantId) : null;
  const basePrice = variant ? variant.price : service.price;
  const prepayment = config.prepaymentEnabled ? (service.prepayment ?? null) : null;

  // Захиалгын эхлэх ISO цаг (цагийн бүс: Asia/Ulaanbaatar, +08:00)
  const startsAt = `${p.date}T${p.time}:00+08:00`;
  const memo = buildPaymentMemo({ time: p.time, date: p.date, phone: p.phone });

  const booking = await repository.createBooking({
    psid: p.psid || null,
    phone: normalizePhone(p.phone),
    serviceId: service.id,
    serviceName: service.name,
    variantId: p.variantId || null,
    variantName: variant?.name || null,
    date: p.date,
    time: p.time,
    startsAt,
    price: basePrice ?? null,
    prepayment,
    paymentMemo: memo,
    // Урьдчилгаагүй бол шууд баталгаажсан (сануулга ажиллана)
    status: config.prepaymentEnabled ? "pending" : "confirmed",
  });

  return { booking, service, variant };
}

/** Захиалга баталгаажсан (урьдчилгаа төлсөн) гэж тэмдэглэх. */
export async function confirmBooking(bookingId) {
  return repository.updateBooking(bookingId, {
    status: "confirmed",
    prepaymentPaid: true,
    confirmedAt: new Date().toISOString(),
  });
}

/** Үйлчлүүлэгчид харуулах захиалгын хураангуй. */
export function bookingSummary(booking) {
  const lines = [
    `📅 Таны захиалга бүртгэгдлээ:`,
    `• Үйлчилгээ: ${booking.serviceName}${booking.variantName ? ` (${booking.variantName})` : ""}`,
    `• Огноо: ${booking.date}`,
    `• Цаг: ${booking.time}`,
    `• Утас: ${booking.phone}`,
  ];
  if (booking.price != null) lines.push(`• Үнэ: ${formatMnt(booking.price)}`);
  if (booking.prepayment != null) lines.push(`• Урьдчилгаа: ${formatMnt(booking.prepayment)}`);
  return lines.join("\n");
}
