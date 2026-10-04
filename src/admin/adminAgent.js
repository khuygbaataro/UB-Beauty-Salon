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
import { answerQuestion } from "../escalation.js";
import { createArtistInvite } from "../artist/registration.js";

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
];

function buildSystemPrompt() {
  return (
    `Чи бол ${config.salonName}-ийн АЖИЛЧДАД зориулсан Admin туслах AI. Монгол хэлээр товч, ` +
    `тодорхой харилц. Үүрэг: ажилчдад мэдээллийн сан (үйлчилгээ, үнэ)-г шинэчлэх, гараар ирсэн ` +
    `цаг захиалгыг бүртгэхэд туслах.\n\n` +
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

async function runTool(name, input) {
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
    case "answer_question": {
      return answerQuestion(input.questionId, input.answer, input.answeredBy);
    }
    case "create_artist": {
      const { valid, invalid } = await resolveServiceIds(input.serviceIds || []);
      const { artist, code } = await createArtistInvite({ ...input, serviceIds: valid.map((v) => v.id) });
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
      return {
        ok: true,
        artist: { id: updated.id, name: updated.name, role: updated.role, serviceIds: updated.serviceIds, active: updated.active },
        invalidServiceIds: invalid,
      };
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
        output = await runTool(tu.name, tu.input);
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
