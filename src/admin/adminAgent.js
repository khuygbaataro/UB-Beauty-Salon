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
    description: "Байгаа үйлчилгээний талбарыг шинэчлэх (үнэ, урьдчилгаа, тайлбар гэх мэт).",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        price: { type: ["number", "null"], description: "Үнэ төгрөгөөр" },
        prepayment: { type: ["number", "null"], description: "Урьдчилгаа төгрөгөөр" },
        description: { type: "string" },
        active: { type: "boolean" },
      },
      required: ["serviceId"],
      additionalProperties: false,
    },
  },
  {
    name: "create_service",
    description: "Шинэ үйлчилгээ нэмэх.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        category: { type: "string" },
        price: { type: ["number", "null"] },
        prepayment: { type: ["number", "null"] },
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
];

function buildSystemPrompt() {
  return (
    `Чи бол ${config.salonName}-ийн АЖИЛЧДАД зориулсан Admin туслах AI. Монгол хэлээр товч, ` +
    `тодорхой харилц. Үүрэг: ажилчдад мэдээллийн сан (үйлчилгээ, үнэ)-г шинэчлэх, гараар ирсэн ` +
    `цаг захиалгыг бүртгэхэд туслах.\n\n` +
    `Дүрэм:\n` +
    `• Өөрчлөлт хийхээс өмнө ойлгомжгүй зүйлийг тодруул (жишээ: аль үйлчилгээ, яг ямар үнэ).\n` +
    `• Үнэ/урьдчилгааг төгрөгөөр тоогоор оруул.\n` +
    `• Захиалга бүртгэхэд утас, үйлчилгээ (list_services-ийн id), огноо, цаг заавал хэрэгтэй.\n` +
    `• Үйлдэл бүрийн дараа юу өөрчлөгдсөнийг товч баталгаажуулж хэл.`
  );
}

async function runTool(name, input) {
  switch (name) {
    case "list_services": {
      const services = await repository.listServices({ activeOnly: false });
      return services.map((s) => ({
        id: s.id,
        name: s.name,
        price: s.price,
        prepayment: s.prepayment,
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
