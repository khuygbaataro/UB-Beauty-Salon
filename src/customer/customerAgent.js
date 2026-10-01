// ─────────────────────────────────────────────────────────────
//  Үйлчлүүлэгчийн AI — Messenger дээр хэрэглэгчтэй харилцана.
//
//  Чадвар:
//   • Үйлчилгээний талаар тайлбарлах (мэдээллийн сангаас)
//   • Цаг захиалга авах (утас + үйлчилгээ + цаг тодруулж, урьдчилгааны заавар өгөх)
//   • Цаг цуцлах (4 цагийн дүрмийн дагуу)
//
//  AI tool-use (функц дуудлага)-аар дээрх үйлдлүүдийг гүйцэтгэнэ.
//
//  ⚠️ Яриа түр санах ой (conversations Map) нь энэ process-д л хадгалагдана.
//     Vercel serverless дээр invocation бүр cold эхлэх тул ярианы түүхийг
//     production-д repository (DB) руу зөөх шаардлагатай. (TODO)
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";
import { createMessage, extractText, extractToolUses } from "../ai/anthropic.js";
import { priceSummary } from "./greeting.js";
import { createBooking, bookingSummary } from "../booking/booking.js";
import { cancelBooking, cancellationMessage } from "../booking/cancellation.js";
import { getPaymentProvider } from "../payment/index.js";

const conversations = new Map(); // psid -> Anthropic.MessageParam[]  (TODO: DB рүү зөөх)
const MAX_HISTORY = 20;

// ───────── AI tool-ууд ─────────
const tools = [
  {
    name: "list_services",
    description: "Салоны бүх идэвхтэй үйлчилгээний жагсаалт, үнэ, тайлбарыг авах.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_booking",
    description:
      "Үйлчлүүлэгчид цаг захиалга үүсгэх. Утасны дугаар, үйлчилгээ, огноо, цагийг заавал тодруулж авсны дараа л дуудна.",
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "8 оронтой утасны дугаар" },
        serviceId: { type: "string", description: "Үйлчилгээний id (list_services-ээс)" },
        variantId: { type: "string", description: "Хувилбарын id (лазерын хэсэг гэх мэт). Байхгүй бол хоосон." },
        date: { type: "string", description: "Огноо YYYY-MM-DD хэлбэрээр" },
        time: { type: "string", description: "Цаг HH:mm хэлбэрээр" },
      },
      required: ["phone", "serviceId", "date", "time"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_booking",
    description: "Захиалгыг цуцлах. Утасны дугаараар сүүлийн идэвхтэй захиалгыг олж цуцална.",
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Захиалга хийсэн утасны дугаар" },
      },
      required: ["phone"],
      additionalProperties: false,
    },
  },
];

// ───────── Системийн промт ─────────
async function buildSystemPrompt() {
  const services = await repository.listServices({ activeOnly: true });
  const catalog = services
    .map((s) => {
      const price = priceSummary(s).replace(/\n/g, " ");
      return `- [${s.id}] ${s.name}: ${s.description} (${price})`;
    })
    .join("\n");

  return (
    `Чи бол ${config.salonName} гоо сайхны салоны найрсаг туслах AI. Зөвхөн монгол хэлээр, ` +
    `эелдэг, товч, дулаан өнгөөр харилц. Emoji дунд зэрэг хэрэглэ.\n\n` +
    `Үүрэг:\n` +
    `1) Үйлчилгээний талаар доорх мэдээллийн сан дээр ҮНДЭСЛЭН тайлбарла. Мэдээлэлгүй зүйлийг зохиож болохгүй — ` +
    `"манай ажилтан тодруулж өгнө" гэж хэл.\n` +
    `2) Цаг захиалахдаа ЗААВАЛ эдгээрийг тодруул: утасны дугаар, аль үйлчилгээ (шаардлагатай бол хувилбар), огноо, цаг. ` +
    `Бүгд тодорхой болсон үед л create_booking tool-ийг дууд.\n` +
    `3) Захиалга үүссэний дараа урьдчилгаа төлбөрийн заавар болон гүйлгээний утгыг (цаг, өдөр, утас) хэлнэ.\n` +
    `4) Цуцлах хүсэлт ирвэл cancel_booking tool-ийг дууд. Цагаас ${config.cancelRefundHours}+ цагийн өмнө цуцалбал ` +
    `урьдчилгаа буцаана гэдгийг тайлбарла.\n\n` +
    `Үйлчилгээний сан:\n${catalog}`
  );
}

// ───────── Tool гүйцэтгэл ─────────
async function runTool(name, input, ctx) {
  switch (name) {
    case "list_services": {
      const services = await repository.listServices({ activeOnly: true });
      return services.map((s) => ({
        id: s.id,
        name: s.name,
        price: s.price,
        variants: s.variants,
        addons: s.addons,
      }));
    }
    case "create_booking": {
      const { booking } = await createBooking({ ...input, psid: ctx.psid });
      const invoice = await getPaymentProvider().createInvoice(booking);
      return {
        ok: true,
        summary: bookingSummary(booking),
        payment: invoice.instructions,
        bookingId: booking.id,
      };
    }
    case "cancel_booking": {
      const active = (await repository.listBookings({ phone: input.phone })).filter(
        (b) => b.status !== "cancelled",
      );
      if (!active.length) return { ok: false, error: "Идэвхтэй захиалга олдсонгүй." };
      const latest = active.sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt))[0];
      const result = await cancelBooking(latest.id);
      return { ok: true, message: cancellationMessage(result) };
    }
    default:
      return { ok: false, error: `Үл мэдэгдэх tool: ${name}` };
  }
}

/**
 * Үйлчлүүлэгчийн нэг мессежийг боловсруулж, хариу текст буцаана.
 * @param {object} p
 * @param {string} p.psid — Messenger хэрэглэгчийн ID
 * @param {string} p.text — хэрэглэгчийн мессеж
 * @returns {Promise<string>} хариу текст
 */
export async function handleCustomerMessage({ psid, text }) {
  const history = conversations.get(psid) || [];
  history.push({ role: "user", content: text });

  const system = await buildSystemPrompt();
  const ctx = { psid };

  // Tool-use loop (хамгийн ихдээ 5 эргэлт)
  let reply = "";
  for (let i = 0; i < 5; i++) {
    const message = await createMessage({ system, messages: history, tools, maxTokens: 1500 });
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
        output = await runTool(tu.name, tu.input, ctx);
      } catch (err) {
        output = { ok: false, error: String(err.message || err) };
      }
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(output),
      });
    }
    history.push({ role: "user", content: results });
  }

  // Түүхийг хэмжээнд барих
  conversations.set(psid, history.slice(-MAX_HISTORY));
  return reply || "Уучлаарай, дахин оролдоно уу.";
}

/** Шинэ хэрэглэгчийн ярианы түүхийг урьдчилсан мэндчилгээгээр эхлүүлэх. */
export function seedGreeting(psid, greetingText) {
  const history = conversations.get(psid) || [];
  history.push({ role: "assistant", content: greetingText });
  conversations.set(psid, history.slice(-MAX_HISTORY));
}
