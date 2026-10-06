// ─────────────────────────────────────────────────────────────
//  Цаг сануулагч.
//
//  Vercel Cron (vercel.json доторх /cron/reminders) тодорхой давтамжтайгаар
//  энэ функцийг дуудна. Баталгаажсан захиалгуудаас сануулах цаг нь болсон,
//  сануулга хараахан илгээгээгүй захиалгуудыг олж, Messenger-ээр сануулга
//  илгээнэ.
//
//  Сануулах цаг = startsAt - REMINDER_LEAD_HOURS (default 24 цаг = өмнөх өдөр).
//  Тохиргоог захиалга тус бүр дээр booking.reminderLeadHours-оор дарж болно.
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";
import { sendText } from "../messenger/sendApi.js";

/** Нэг захиалгын сануулга илгээх цаг болсон эсэх. */
export function isDueForReminder(booking, now = new Date()) {
  if (booking.status !== "confirmed") return false;
  if (booking.reminderSentAt) return false;
  if (!booking.startsAt) return false;

  const leadHours = booking.reminderLeadHours ?? config.reminderLeadHours;
  const start = new Date(booking.startsAt).getTime();
  const remindAt = start - leadHours * 60 * 60 * 1000;

  // Сануулах цаг нь болсон (remindAt өнгөрсөн) бөгөөд захиалга хараахан болоогүй.
  return now.getTime() >= remindAt && now.getTime() < start;
}

function buildReminderText(booking) {
  const leadHours = booking.reminderLeadHours ?? config.reminderLeadHours;
  return (
    `⏰ Сануулга — ${config.salonName}\n\n` +
    `${leadHours} цагийн дараа таны «${booking.serviceName}» үйлчилгээний цаг ирнэ шүү:\n` +
    `• Огноо: ${booking.date}\n` +
    `• Цаг: ${booking.time}\n\n` +
    `Уулзахаа тэсэн ядан хүлээж байна. Хэрэв ирэх боломжгүй бол эртнээс мэдэгдээрэй.`
  );
}

/**
 * Сануулга илгээх гол функц (cron-оор дуудагдана).
 * @returns {Promise<{checked:number, sent:number, errors:number}>}
 */
export async function runReminders(now = new Date()) {
  const confirmed = await repository.listBookings({ status: "confirmed" });
  let sent = 0;
  let errors = 0;

  for (const booking of confirmed) {
    if (!isDueForReminder(booking, now)) continue;
    if (!booking.psid) continue; // Messenger-ээр хариу өгөх ID байхгүй бол алгасна

    // UPDATE: 24 цагийн дотор идэвхтэй мессеж (tag/App Review шаардахгүй).
    // ⚠️ Хэрэв захиалга хэрэглэгчийн сүүлийн мессежээс 24 цагийн ГАДНА бол энэ хүрэхгүй.
    //    Тэр тохиолдолд ирээдүйд "MESSAGE_TAG" + "CONFIRMED_EVENT_UPDATE" болгож (App Review-ийн дараа) шилжүүлнэ.
    const result = await sendText(booking.psid, buildReminderText(booking), "UPDATE");
    if (result.ok || result.skipped) {
      await repository.updateBooking(booking.id, {
        status: "reminded",
        reminderSentAt: now.toISOString(),
      });
      sent += 1;
    } else {
      errors += 1;
    }
  }

  return { checked: confirmed.length, sent, errors };
}
