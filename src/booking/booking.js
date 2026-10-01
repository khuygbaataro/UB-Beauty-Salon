// ─────────────────────────────────────────────────────────────
//  Цаг захиалгын логик.
//
//  Урсгал: үйлчлүүлэгчээс (1) утасны дугаар, (2) үйлчилгээ, (3) цаг/өдөр
//  тодруулж авна → урьдчилгаа төлбөрийн заавар өгнө. Гүйлгээний утга дээр
//  `цаг, өдөр, утасны дугаар` бичих зарчимтай (банкны гүйлгээг захиалгатай
//  тааруулахад ашиглана).
// ─────────────────────────────────────────────────────────────

import { repository } from "../db/repository.js";
import { formatMnt } from "../customer/greeting.js";

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

  // Урьдчилгаа дүнг тодорхойлох
  const variant = p.variantId ? service.variants?.find((v) => v.id === p.variantId) : null;
  const basePrice = variant ? variant.price : service.price;
  const prepayment = service.prepayment ?? null; // тодорхойгүй бол null

  // Захиалгын эхлэх/дуусах ISO цаг (цагийн бүс: Asia/Ulaanbaatar, +08:00)
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
    `📅 Захиалгын мэдээлэл:`,
    `• Үйлчилгээ: ${booking.serviceName}${booking.variantName ? ` (${booking.variantName})` : ""}`,
    `• Огноо: ${booking.date}`,
    `• Цаг: ${booking.time}`,
    `• Утас: ${booking.phone}`,
  ];
  if (booking.price != null) lines.push(`• Үнэ: ${formatMnt(booking.price)}`);
  if (booking.prepayment != null) lines.push(`• Урьдчилгаа: ${formatMnt(booking.prepayment)}`);
  lines.push(``, `Гүйлгээний утга: ${booking.paymentMemo}`);
  return lines.join("\n");
}
