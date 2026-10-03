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
import { suggestSlots } from "../booking/schedule.js";

const conversations = new Map(); // psid -> Anthropic.MessageParam[]  (TODO: DB рүү зөөх)
const referredServices = new Map(); // psid -> serviceId (аль контентоос орж ирсэн)
const MAX_HISTORY = 20;

/** Хэрэглэгч аль үйлчилгээний контентоос орж ирснийг тэмдэглэх. */
export function setReferredService(psid, serviceId) {
  if (psid && serviceId) referredServices.set(psid, serviceId);
}

// ───────── AI tool-ууд ─────────
const tools = [
  {
    name: "list_services",
    description: "Салоны бүх идэвхтэй үйлчилгээний жагсаалт, үнэ, тайлбарыг авах.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "check_availability",
    description:
      "Тодорхой өдрийн сул цагуудыг авах. Эхэнд өглөөний (10:00–13:00) сул цаг, дараа нь үлдсэн сул цаг эрэмбэлэгдэж ирнэ. Цаг санал болгохоосоо өмнө ЗААВАЛ энэ tool-ээр сул цагийг шалга.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Огноо YYYY-MM-DD хэлбэрээр" },
      },
      required: ["date"],
      additionalProperties: false,
    },
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
async function buildSystemPrompt(psid) {
  const services = await repository.listServices({ activeOnly: true });

  // Үндсэн дараалал (seed-ийн дараалал): GREEN PEEL → La Vie → Хүчирхэг багц → Лазер → Сормуус
  const catalog = services
    .map((s, i) => {
      const price = priceSummary(s).replace(/\n/g, " ");
      return `${i + 1}. [${s.id}] ${s.name}: ${s.description} (${price})`;
    })
    .join("\n");

  // Хэрэглэгч аль контентоос орж ирсэн бэ
  const referredId = psid ? referredServices.get(psid) : null;
  const referred = referredId ? services.find((s) => s.id === referredId) : null;
  const referredNote = referred
    ? `\n\n⭐ ЭНЭ ХЭРЭГЛЭГЧ «${referred.name}» үйлчилгээний контентоос орж ирсэн. ` +
      `Үйлчилгээ танилцуулахдаа ЭХЛЭЭД «${referred.name}»-г дэлгэрэнгүй, дотно танилцуулаад, ` +
      `дараа нь үлдсэн үйлчилгээг доорх үндсэн дарааллаар товч дурдаарай.`
    : `\n\n(Хэрэглэгч тодорхой контентоос ирээгүй — үйлчилгээг доорх үндсэн дарааллаар танилцуул.)`;

  return (
    `Чи бол ${config.salonName} гоо сайхны салоны дотно, халуун дулаан, бага зэрэг гоёмсог ` +
    `өнгө аястай туслах AI. Зөвхөн монгол хэлээр харилц. Найрсаг, халамжтай, цэвэрхэн өнгөөр ярь — ` +
    `хэт албан биш, дотно. ЭНГИЙН, ойлгомжтой, өдөр тутмын үг сонголт ашигла — хэт хүнд, уран яруу, ` +
    `номын маягийн үг (жишээ нь «морилсон», «толилуулах», «эрхэмлэн», «угтах») БҮҮ хэрэглэ. ` +
    `Богино, цэвэрхэн өгүүлбэр. Emoji-г цөөхөн, гоёмсгоор (жишээ: 🌸 ✨ 💫) хэрэглэ.\n\n` +
    `ҮЙЛЧИЛГЭЭ ТАНИЛЦУУЛАХ ДАРААЛАЛ (чандлан баримтал):\n` +
    `• Хэрэв хэрэглэгч тодорхой үйлчилгээний контентоос орж ирсэн бол ТЭР үйлчилгээг эхэлж ` +
    `дэлгэрэнгүй танилцуул, дараа нь үлдсэнийг доорх үндсэн дарааллаар товч дурд.\n` +
    `• Эс бол бүх үйлчилгээг доорх үндсэн дарааллаар танилцуул.\n\n` +
    `АЖИЛЛАХ ЦАГ: Салон өдөр бүр ${config.salonOpenHour}:00–${config.salonCloseHour}:00 ажиллана. ` +
    `Нэг үйлчилгээ ойролцоогоор 30 минут–1 цаг.\n\n` +
    `Үүрэг:\n` +
    `1) Үйлчилгээний талаар доорх мэдээллийн сан дээр ҮНДЭСЛЭН тайлбарла. Мэдээлэлгүй зүйлийг ` +
    `зохиож болохгүй — "манай ажилтан тодруулж өгнө" гэж эелдэг хэл.\n` +
    `2) Цаг захиалахдаа эхлээд утас, үйлчилгээ (шаардвал хувилбар), хүссэн ӨДРИЙГ тодруул. ` +
    `Дараа нь check_availability tool-ээр тэр өдрийн сул цагийг шалга.\n` +
    `3) ЦАГ САНАЛ БОЛГОХ ДҮРЭМ: эхлээд ӨГЛӨӨНИЙ (10:00–13:00) сул цагийг санал болго. ` +
    `Хэрэв тэр өдөр өглөөний сул цаг байхгүй бол л үлдсэн сул цагийг санал болго. ` +
    `Хэрэглэгч цаг сонгосны дараа л create_booking tool-ийг дууд.\n` +
    `4) ⚠️ Урьдчилгаа төлбөр ОДООГООР БАЙХГҮЙ. Захиалга үүсмэгц шууд баталгаажна — ` +
    `төлбөр/урьдчилгааны тухай БҮҮ яри. Зүгээр л захиалга баталгаажсаныг эелдэг мэдэгд.\n` +
    `5) Цуцлах хүсэлт ирвэл cancel_booking tool-ийг дууд. Цуцлахад ямар ч торгууль/төлбөргүй. ` +
    `Зүгээр л боломжтой бол цагаасаа ${config.cancelNoticeHours} цагийн өмнөхөн мэдэгдвэл ` +
    `тэр цагийг өөр хүнд санал болгож чаддаг гэдгийг ЗӨӨЛӨН, хүндэтгэлтэй хэлээрэй.` +
    referredNote +
    `\n\nҮйлчилгээний сан (үндсэн дараалал):\n${catalog}`
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
    case "check_availability": {
      const { ordered, morning, later } = await suggestSlots(input.date);
      return {
        date: input.date,
        available: ordered, // эрэмбэлсэн (өглөө эхэндээ)
        morning, // 10:00–13:00 сул цаг
        later, // үлдсэн сул цаг
        note: ordered.length ? "Өглөөний цагийг эхэлж санал болго." : "Энэ өдөр сул цаг алга.",
      };
    }
    case "create_booking": {
      const { booking } = await createBooking({ ...input, psid: ctx.psid });
      return {
        ok: true,
        summary: bookingSummary(booking),
        bookingId: booking.id,
        note: "Урьдчилгаа төлбөр одоогоор шаардлагагүй. Захиалга баталгаажлаа.",
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

  const system = await buildSystemPrompt(psid);
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
