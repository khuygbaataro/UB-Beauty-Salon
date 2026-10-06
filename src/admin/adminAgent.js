// ─────────────────────────────────────────────────────────────
//  Admin AI — ажилчидтай харилцаж, мэдээллийн санг хөгжүүлнэ.
//
//  Чадвар:
//   • Үйлчилгээний мэдээлэл шинэчлэх (үнэ, урьдчилгаа, тайлбар нэмэх/засах)
//   • Шинэ үйлчилгээ нэмэх
//   • Гараар цаг захиалга бүртгэх (утсаар/биечлэн ирсэн захиалгыг оруулах)
//   • Захиалгуудыг харах
//
//  Энэ нь үйлчлүүлэгчийн AI-аас ТУСДАА. Зөвхөн зөвшөөрөгдсөн ажилчид
//  (ADMIN_ALLOWED_IDS) хандана — зөвшөөрлийг webhook давхаргад шалгана.
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";
import { createMessage, extractText, extractToolUses } from "../ai/anthropic.js";
import { createBooking, confirmBooking } from "../booking/booking.js";
import { cancelBooking } from "../booking/cancellation.js";
import { answerQuestion } from "../escalation.js";
import { createArtistInvite } from "../artist/registration.js";
import { sendArtistText } from "../messenger/sendApi.js";
import { syncScheduleSafe, syncScheduleToSheet, isSheetsConfigured } from "../sheets/googleSheets.js";
import { sendTelegram } from "./telegramSend.js";
import { buildWeekData, weekTelegramText } from "../schedule/weekView.js";

const adminConversations = new Map(); // adminId -> messages[]  (TODO: DB)
const MAX_HISTORY = 20;

const tools = [
  {
    name: "list_services",
    description: "Бүх үйлчилгээг (идэвхгүйг нь оруулаад) id-тэй нь жагсаах.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "update_service",
    description: "Байгаа үйлчилгээний талбарыг шинэчлэх (нэр, үнэ, зураг, хугацаа, тайлбар гэх мэт).",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        name: { type: "string" },
        category: { type: "string" },
        price: { type: ["number", "null"], description: "Үнэ төгрөгөөр" },
        prepayment: { type: ["number", "null"], description: "Урьдчилгаа төгрөгөөр" },
        durationMinutes: { type: ["number", "null"], description: "Үргэлжлэх хугацаа минутаар" },
        image: { type: "string", description: "Зургийн ХОЛБООС (https://...)" },
        tagline: { type: "string" },
        promo: { type: "string", description: "Бэлэг/урамшуулал" },
        description: { type: "string" },
        active: { type: "boolean" },
      },
      required: ["serviceId"],
      additionalProperties: false,
    },
  },
  {
    name: "create_service",
    description:
      "Шинэ үйлчилгээ нэмэх. Нэр, ангилал, үнэ, зураг (URL), үргэлжлэх хугацаа (минут)-ыг цуглуулж оруул.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        category: { type: "string", description: "жишээ: peeling, laser, lashes, nails, facial" },
        price: { type: ["number", "null"], description: "Үнэ төгрөгөөр" },
        prepayment: { type: ["number", "null"], description: "Урьдчилгаа төгрөгөөр" },
        durationMinutes: { type: ["number", "null"], description: "Үргэлжлэх хугацаа минутаар (жишээ 60)" },
        image: { type: "string", description: "Зургийн ХОЛБООС (https://...). Байнгын host байх ёстой." },
        tagline: { type: "string", description: "Богино онцлох мөр (1 өгүүлбэр)" },
        promo: { type: "string", description: "Бэлэг/урамшуулал (жишээ: '190,000₮-ний нөхөн төлжүүлэх үнэгүй')" },
        description: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "add_booking",
    description:
      "Гараар цаг захиалга бүртгэх (утсаар/биечлэн ирсэн). confirmed=true бол баталгаажсан гэж тэмдэглэнэ.",
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string" },
        serviceId: { type: "string" },
        variantId: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:mm" },
        confirmed: { type: "boolean", description: "Урьдчилгаа төлсөн эсэх" },
      },
      required: ["phone", "serviceId", "date", "time"],
      additionalProperties: false,
    },
  },
  {
    name: "list_open_questions",
    description: "Үйлчлүүлэгчдээс ирсэн, хариулаагүй (open) асуултуудыг жагсаах.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "answer_question",
    description:
      "Үйлчлүүлэгчийн асуултад хариулах. Хариултыг тухайн үйлчлүүлэгч рүү чатаар буцаана, мэдлэгийн санд хадгална.",
    input_schema: {
      type: "object",
      properties: {
        questionId: { type: "string", description: "Асуултын id (q_...)" },
        answer: { type: "string", description: "Ажилтны хариулт" },
      },
      required: ["questionId", "answer"],
      additionalProperties: false,
    },
  },
  {
    name: "list_bookings",
    description: "Захиалгуудыг харах. status (pending|confirmed|reminded|completed|cancelled) эсвэл phone-оор шүүж болно.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        phone: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "cancel_booking",
    description:
      "Захиалгыг bookingId-аар цуцлах (цаг сул болно, үйлчлүүлэгч рүү мессеж илгээхгүй). " +
      "Олон захиалга цуцлах бол бүрийг нь дараалан дууд. ID-г list_bookings-ээс ав.",
    input_schema: {
      type: "object",
      properties: { bookingId: { type: "string", description: "Захиалгын id (bk_...)" } },
      required: ["bookingId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_knowledge",
    description: "Мэдлэгийн сан (хадгалсан асуулт-хариултууд)-г бүгдийг нь харах. Customer AI эдгээрийг хайж хариулдаг.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "add_knowledge",
    description:
      "Мэдлэгийн санд асуулт-хариулт ГАРААР нэмэх (FAQ урьдчилан бэлдэх). Customer AI үүнийг хайж олоод үйлчлүүлэгчид шууд хариулна.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Асуулт (жишээ: 'Жирэмсэн үед лазер хийж болох уу?')" },
        answer: { type: "string", description: "Хариулт" },
      },
      required: ["question", "answer"],
      additionalProperties: false,
    },
  },
  {
    name: "update_knowledge",
    description: "Мэдлэгийн сан дахь нэг бичлэгийн асуулт эсвэл хариултыг засах.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Бичлэгийн id (kb_...)" },
        question: { type: "string" },
        answer: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_knowledge",
    description: "Мэдлэгийн сан дахь бичлэгийг устгах.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Бичлэгийн id (kb_...)" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_artist",
    description:
      "Шинэ артист эсвэл менежерийн УРИЛГА үүсгэх. Систем нэг удаагийн 6 оронтой код буцаана — " +
      "тэр кодыг хүнд өг. Тэр хүн артистын Facebook хуудас руу кодоо илгээхэд бүртгэл идэвхжинэ. " +
      "role='manager' бол хянах/удирдах эрхтэй болно. serviceIds нь хийдэг үйлчилгээний id-ууд (list_services-ээс).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string", enum: ["artist", "manager"], description: "artist (default) | manager" },
        serviceIds: { type: "array", items: { type: "string" }, description: "Хийдэг үйлчилгээний id-ууд" },
        phone: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "list_artists",
    description: "Бүртгэлтэй артистуудыг (хуваарь, хийдэг үйлчилгээтэй нь) жагсаах.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "update_artist",
    description: "Артистын мэдээлэл шинэчлэх (нэр, psid, хийдэг үйлчилгээ, идэвхтэй эсэх).",
    input_schema: {
      type: "object",
      properties: {
        artistId: { type: "string" },
        name: { type: "string" },
        psid: { type: "string" },
        serviceIds: { type: "array", items: { type: "string" } },
        active: { type: "boolean" },
      },
      required: ["artistId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_timeoff_requests",
    description: "Артистуудын зөвшөөрөл хүлээж буй (pending) амралтын хүсэлтүүдийг харах.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "sync_schedule_sheet",
    description: "Артистуудын ажиллах хуваарийг Google Sheet руу гараар шинэчлэх (ихэвчлэн автоматаар шинэчлэгддэг).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "show_week_schedule",
    description:
      "Энэ долоо хоногт ажиллах артистуудын хуваарийг цэвэрхэн хүснэгтээр Telegram-д илгээх. " +
      "'энэ долоо хоног', 'хэн ажиллаж байна', '7 хоногийн хуваарь' гэх мэт асуувал дууд.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "decide_timeoff",
    description:
      "Артистын амралтын хүсэлтийг батлах эсвэл татгалзах. Батлавал тухайн өдрүүд артистын амралтанд нэмэгдэж, артист руу мэдэгдэнэ.",
    input_schema: {
      type: "object",
      properties: {
        requestId: { type: "string", description: "Хүсэлтийн id (tor_...)" },
        approve: { type: "boolean", description: "true=батлах, false=татгалзах" },
      },
      required: ["requestId", "approve"],
      additionalProperties: false,
    },
  },
];

function buildSystemPrompt() {
  return (
    `Чи бол ${config.salonName}-ийн АЖИЛЧДАД зориулсан Admin туслах AI. Үүрэг: мэдээллийн сан ` +
    `(үйлчилгээ, үнэ, артист), захиалга удирдахад туслах.\n\n` +
    `ХЭВ МАЯГ (маш чухал):\n` +
    `• МАШ ТОВЧ, шулуун, эрэгтэй хүн шиг хүйтэн толгойтой бич. Илүү үг, эелдэг ярианы чимэг, ` +
    `зөвлөгөө, тайлбар БҮҮ нэм. Асуусанд нь л хариул.\n` +
    `• ❌ Markdown тэмдэглэгээ (**, *, #, ___) БҮҮ хэрэглэ — Telegram дээр тэдгээр нь олон од (*) ` +
    `болж харагдана. Зөвхөн энгийн текст.\n` +
    `• Зөвхөн ҮР ДҮНГ хэл. Урт текст бичихийг хориглоно. Зөвхөн жагсаалт/өгөгдөл (захиалга, артист, ` +
    `үйлчилгээ) урт байж болно — эргэн тойрны үг нэг богино мөр.\n` +
    `• Үйлдэл хийсний дараа нэг богино мөрөөр баталгаажуул (жишээ "Болов." / "Цуцаллаа.").\n\n` +
    `Дүрэм:\n` +
    `• ⛔ ЗОХИОЖ БОЛОХГҮЙ: Мэдэхгүй, баталгаагүй зүйлийг таамаглаж, зохиож хэлж болохгүй. ` +
    `Зөвхөн tool-оор авсан БОДИТ өгөгдөл (үйлчилгээ, үнэ, захиалга) дээр тулгуурла. ` +
    `Эргэлзвэл ажилтнаас дахин тодруул.\n` +
    `• Өөрчлөлт хийхээс өмнө ойлгомжгүй зүйлийг тодруул (жишээ: аль үйлчилгээ, яг ямар үнэ).\n` +
    `• Үнэ/урьдчилгааг төгрөгөөр тоогоор оруул.\n` +
    `• ШИНЭ ҮЙЛЧИЛГЭЭ нэмэх эсвэл засахдаа дараах 5 зүйлийг БҮРЭН цуглуул, дутууг нь ээлжлэн нэхэж асуу: ` +
    `(1) нэр, (2) ангилал, (3) үнэ (төгрөгөөр; лазер мэт хэсэг бүрийн үнэтэй бол түүнийг тодруул), ` +
    `(4) зураг — админ зургаа Telegram-аар ШУУД илгээж болно (систем Cloudinary-д байршуулаад URL-ийг ` +
    `өгнө), эсвэл https:// холбоос хэлж болно, (5) үргэлжлэх хугацаа минутаар. Бүгдийг авсны дараа create_service/` +
    `update_service-ийг дууд, дараа нь оруулсан утгуудыг эргэн баталгаажуулж хэл.\n` +
    `• Захиалга бүртгэхэд утас, үйлчилгээ (list_services-ийн id), огноо, цаг заавал хэрэгтэй.\n` +
    `• Захиалга ЦУЦЛАХ: list_bookings-ээр олоод, cancel_booking-оор bookingId-аар цуцал. Олныг ` +
    `дараалан цуцал. Цуцалсан цаг сул болно; үйлчлүүлэгч рүү мессеж илгээхгүй.\n` +
    `• Үйлчлүүлэгчийн асуулт (open questions) ирвэл list_open_questions-ээр хараад answer_question-аар ` +
    `хариул. Хариу автоматаар үйлчлүүлэгч рүү очиж, мэдлэгийн санд хадгалагдана. (Telegram дээр ` +
    `асуултын мэдэгдэл рүү шууд Reply хийж бичсэн ч болно.)\n` +
    `• АРТИСТ/МЕНЕЖЕР бүртгэх: Эхлээд list_services-ээр үйлчилгээнүүдийг id-тэй нь харуулж, ` +
    `тэр артист АЛЬ үйлчилгээнүүдийг хийдгийг ажилтнаас асуу (жишээ: "GREEN PEEL, лазер, сормуус"). ` +
    `Ажилтны хэлсэн нэрсийг тохирох id болгон хөрвүүлж create_artist-ийн serviceIds-д ОЛОН id өг ` +
    `(нэг артист хэд хэдэн үйлчилгээ хийж болно). Шаардлагатай үйлчилгээ санд байхгүй бол эхлээд ` +
    `create_service-ээр нэм. Бүртгэсний дараа сонгогдсон үйлчилгээг НЭРЭЭР нь болон 6 оронтой КОДыг ` +
    `тодорхой баталгаажуулж хэл — тэр кодыг тухайн хүнд дамжуулахыг сануул. ` +
    `Хүн артистын Facebook хуудас руу кодоо илгээхэд бүртгэл идэвхжиж, дараа нь өөрөө хуваараа тохируулна. ` +
    `Артистын хийдэг үйлчилгээг өөрчлөхдөө update_artist-ийн serviceIds-г ашигла. ` +
    `list_artists-ээр бүгдийг жагсаана. (invalidServiceIds буцвал тэр id буруу — засаж дахин оролд.)\n` +
    `• АМРАЛТЫН ЗӨВШӨӨРӨЛ: Артист 3-аас дээш хоног амрах хүсэл гаргавал энд долоо хоногийн хуваарь, ` +
    `хүсэлт, 🆔 (tor_...)-тай мэдэгдэл ирнэ. Админ «батал tor_xxx» гэвэл decide_timeoff(requestId=tor_xxx, ` +
    `approve=true), «татгалз tor_xxx» гэвэл approve=false-оор дууд. "амралтын хүсэлтүүд" гэвэл ` +
    `list_timeoff_requests-ээр жагсаа. Шийдвэр автоматаар артист руу (артистын AI-аар) очно.\n` +
    `• МЭДЛЭГИЙН САН: "мэдлэгийн сан харуул" гэвэл list_knowledge-ээр бүгдийг үзүүл. ` +
    `Гараар FAQ нэмэх add_knowledge, засах update_knowledge, устгах delete_knowledge. ` +
    `Энд хадгалсан асуулт-хариултыг Customer AI автоматаар хайж үйлчлүүлэгчид хариулдаг — ` +
    `тиймээс түгээмэл асуултуудыг урьдчилан нэмж болно.\n` +
    `• ХУВААРИЙН GOOGLE SHEET: Артистуудын ажиллах хуваарь өөрчлөгдөх бүрт Google Sheet автоматаар ` +
    `шинэчлэгддэг. "хуваарь шинэчил/гарга" гэвэл sync_schedule_sheet-ээр гараар шинэчилж болно.\n` +
    `• ЭНЭ ДОЛОО ХОНОГИЙН ХУВААРЬ: "энэ долоо хоног", "хэн ажиллаж байна", "7 хоногийн хуваарь" гэвэл ` +
    `show_week_schedule-ийг дууд — энэ нь цэвэрхэн хүснэгтийг шууд илгээнэ. Чи дараа нь зүгээр "илгээлээ" гэж товч хэл.\n` +
    `• Үйлдэл бүрийн дараа юу өөрчлөгдсөнийг товч баталгаажуулж хэл.`
  );
}

/** serviceIds-г бодит үйлчилгээтэй тулгаж шалгах (буруу id-г илрүүлнэ). */
async function resolveServiceIds(ids = []) {
  const services = await repository.listServices({ activeOnly: false });
  const byId = new Map(services.map((s) => [s.id, s.name]));
  const valid = [];
  const invalid = [];
  for (const id of ids) {
    if (byId.has(id)) valid.push({ id, name: byId.get(id) });
    else invalid.push(id);
  }
  return { valid, invalid };
}

/** Telegram HTML-д зориулж тусгай тэмдэгтийг escape хийх. */
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function runTool(name, input, ctx = {}) {
  switch (name) {
    case "list_services": {
      const services = await repository.listServices({ activeOnly: false });
      return services.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category ?? null,
        price: s.price,
        prepayment: s.prepayment,
        durationMinutes: s.durationMinutes ?? null,
        hasImage: Boolean(s.image),
        active: s.active,
      }));
    }
    case "update_service": {
      const { serviceId, ...patch } = input;
      const updated = await repository.updateService(serviceId, patch);
      return updated ? { ok: true, service: updated } : { ok: false, error: "Үйлчилгээ олдсонгүй." };
    }
    case "create_service": {
      const svc = await repository.createService(input);
      return { ok: true, service: svc };
    }
    case "add_booking": {
      // override:true — ажилтан гараар оруулах тул слот шалгалтыг алгасна
      const { booking } = await createBooking({ ...input, override: true });
      if (input.confirmed) await confirmBooking(booking.id);
      return { ok: true, bookingId: booking.id, date: booking.date, time: booking.time };
    }
    case "list_bookings": {
      const bookings = await repository.listBookings(input || {});
      return bookings.map((b) => ({
        id: b.id,
        phone: b.phone,
        service: b.serviceName,
        date: b.date,
        time: b.time,
        status: b.status,
      }));
    }
    case "list_open_questions": {
      const qs = await repository.listQuestions({ status: "open" });
      return qs.map((q) => ({ id: q.id, question: q.question, createdAt: q.createdAt }));
    }
    case "cancel_booking": {
      const result = await cancelBooking(input.bookingId);
      return {
        ok: true,
        bookingId: input.bookingId,
        service: result.booking.serviceName,
        date: result.booking.date,
        time: result.booking.time,
        note: "Захиалга цуцлагдлаа, цаг сул боллоо.",
      };
    }
    case "list_knowledge": {
      const kb = await repository.listKnowledge();
      return kb.map((k) => ({ id: k.id, question: k.question, answer: k.answer }));
    }
    case "add_knowledge": {
      const k = await repository.addKnowledge({ question: input.question, answer: input.answer });
      return { ok: true, id: k.id, note: "Мэдлэгийн санд нэмэгдлээ. Customer AI үүнийг хайж хариулна." };
    }
    case "update_knowledge": {
      const { id, ...patch } = input;
      const upd = await repository.updateKnowledge(id, patch);
      return upd
        ? { ok: true, knowledge: { id: upd.id, question: upd.question, answer: upd.answer } }
        : { ok: false, error: "Бичлэг олдсонгүй." };
    }
    case "delete_knowledge": {
      const ok = await repository.deleteKnowledge(input.id);
      return ok ? { ok: true, note: "Устгагдлаа." } : { ok: false, error: "Бичлэг олдсонгүй." };
    }
    case "answer_question": {
      return answerQuestion(input.questionId, input.answer, input.answeredBy);
    }
    case "create_artist": {
      const { valid, invalid } = await resolveServiceIds(input.serviceIds || []);
      const { artist, code } = await createArtistInvite({ ...input, serviceIds: valid.map((v) => v.id) });
      await syncScheduleSafe();
      return {
        ok: true,
        artistId: artist.id,
        name: artist.name,
        role: artist.role,
        services: valid.map((v) => v.name), // сонгосон үйлчилгээг нэрээр нь баталгаажуулах
        invalidServiceIds: invalid, // буруу/олдоогүй id байвал
        code,
        note: `Энэ 6 оронтой кодыг (${code}) тухайн хүнд өг. Тэр артистын хуудас руу кодоо илгээхэд бүртгэл идэвхжинэ.`,
      };
    }
    case "list_artists": {
      const artists = await repository.listArtists({});
      return artists.map((a) => ({
        id: a.id,
        name: a.name,
        serviceIds: a.serviceIds || [],
        hasPsid: Boolean(a.psid),
        weeklySchedule: a.weeklySchedule || {},
        timeOff: a.timeOff || [],
        active: a.active,
      }));
    }
    case "update_artist": {
      const { artistId, ...patch } = input;
      let invalid = [];
      if (patch.serviceIds) {
        const resolved = await resolveServiceIds(patch.serviceIds);
        patch.serviceIds = resolved.valid.map((v) => v.id);
        invalid = resolved.invalid;
      }
      const updated = await repository.updateArtist(artistId, patch);
      if (!updated) return { ok: false, error: "Артист олдсонгүй." };
      await syncScheduleSafe();
      return {
        ok: true,
        artist: { id: updated.id, name: updated.name, role: updated.role, serviceIds: updated.serviceIds, active: updated.active },
        invalidServiceIds: invalid,
      };
    }
    case "sync_schedule_sheet": {
      if (!isSheetsConfigured()) return { ok: false, error: "Google Sheet тохируулаагүй байна." };
      const r = await syncScheduleToSheet();
      return r.ok ? { ok: true, rows: r.rows, note: "Хуваарь Google Sheet-д шинэчлэгдлээ." } : { ok: false, error: r.error };
    }
    case "show_week_schedule": {
      const data = await buildWeekData();
      const text = weekTelegramText(data);
      // Монопэйс хүснэгтээр шууд Telegram-д илгээнэ (AI дахин бичихгүй).
      if (ctx.adminId) {
        await sendTelegram(ctx.adminId, `<pre>${escHtml(text)}</pre>`, "HTML").catch(() => {});
      }
      return { ok: true, sent: true, artists: data.artists.length, note: "Хуваарийг хүснэгтээр илгээлээ." };
    }
    case "list_timeoff_requests": {
      const reqs = await repository.listTimeOffRequests({ status: "pending" });
      return reqs.map((r) => ({
        id: r.id,
        artist: r.artistName,
        days: r.dates?.length || 0,
        dates: r.dates,
        createdAt: r.createdAt,
      }));
    }
    case "decide_timeoff": {
      const req = await repository.getTimeOffRequest(input.requestId);
      if (!req) return { ok: false, error: "Хүсэлт олдсонгүй." };
      if (req.status !== "pending") return { ok: false, error: "Энэ хүсэлт аль хэдийн шийдэгдсэн." };

      const nowIso = new Date().toISOString();
      if (input.approve) {
        const artist = await repository.getArtist(req.artistId);
        if (artist) {
          const timeOff = [...new Set([...(artist.timeOff || []), ...req.dates])];
          await repository.updateArtist(artist.id, { timeOff });
          if (artist.psid) {
            await sendArtistText(
              artist.psid,
              `✅ Таны амралтын хүсэлт зөвшөөрөгдлөө 🌸\n${req.dates.join(", ")}\nСайхан амраарай!`,
            ).catch(() => {});
          }
        }
        await repository.updateTimeOffRequest(req.id, { status: "approved", decidedAt: nowIso });
        await syncScheduleSafe();
        return { ok: true, decision: "approved", artist: req.artistName, dates: req.dates };
      } else {
        const artist = await repository.getArtist(req.artistId);
        if (artist?.psid) {
          await sendArtistText(
            artist.psid,
            `🙏 Уучлаарай, таны ${req.dates.join(", ")} өдрүүдийн амралтын хүсэлт одоогоор зөвшөөрөгдсөнгүй. ` +
              `Шалтгааныг менежертэйгээ тодруулаарай 🌸`,
          ).catch(() => {});
        }
        await repository.updateTimeOffRequest(req.id, { status: "rejected", decidedAt: nowIso });
        return { ok: true, decision: "rejected", artist: req.artistName, dates: req.dates };
      }
    }
    default:
      return { ok: false, error: `Үл мэдэгдэх tool: ${name}` };
  }
}

/**
 * Админы нэг мессежийг боловсруулах.
 * @param {object} p
 * @param {string} p.adminId — ажилчны ID (суваг дээрх)
 * @param {string} p.text
 * @returns {Promise<string>}
 */
export async function handleAdminMessage({ adminId, text }) {
  const history = adminConversations.get(adminId) || [];
  history.push({ role: "user", content: text });

  const system = buildSystemPrompt();
  let reply = "";

  for (let i = 0; i < 6; i++) {
    const message = await createMessage({ system, messages: history, tools, maxTokens: 1500, model: config.adminModel });
    history.push({ role: "assistant", content: message.content });

    const toolUses = extractToolUses(message);
    if (message.stop_reason !== "tool_use" || !toolUses.length) {
      reply = extractText(message);
      break;
    }

    const results = [];
    for (const tu of toolUses) {
      let output;
      try {
        output = await runTool(tu.name, tu.input, { adminId });
      } catch (err) {
        output = { ok: false, error: String(err.message || err) };
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(output) });
    }
    history.push({ role: "user", content: results });
  }

  adminConversations.set(adminId, history.slice(-MAX_HISTORY));
  return reply || "Ойлгосон.";
}

/** Ажилтан зөвшөөрөгдсөн эсэх. ADMIN_ALLOWED_IDS хоосон бол (dev) бүгдийг зөвшөөрнө. */
export function isAllowedAdmin(adminId) {
  if (!config.adminAllowedIds.length) return true;
  return config.adminAllowedIds.includes(String(adminId));
}
