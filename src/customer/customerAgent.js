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
import { createChatCompletion } from "../ai/openai.js";
import { priceSummary } from "./greeting.js";
import { createBooking, bookingSummary } from "../booking/booking.js";
import { cancelBooking, cancellationMessage } from "../booking/cancellation.js";
import { suggestSlots } from "../booking/schedule.js";
import { presentOneService } from "./present.js";
import { escalateQuestion, searchKnowledge } from "../escalation.js";

const conversations = new Map(); // psid -> Anthropic.MessageParam[]  (TODO: DB рүү зөөх)
const referredServices = new Map(); // psid -> serviceId (аль контентоос орж ирсэн)
const MAX_HISTORY = 20;

/** Хэрэглэгч аль үйлчилгээний контентоос орж ирснийг тэмдэглэх. */
export function setReferredService(psid, serviceId) {
  if (psid && serviceId) referredServices.set(psid, serviceId);
}

/** Энэ хэрэглэгчтэй анх удаа харилцаж байна уу (ярианы түүх хоосон эсэх). */
export function isNewConversation(psid) {
  const h = conversations.get(psid);
  return !h || h.length === 0;
}

// ───────── AI tool-ууд ─────────
const tools = [
  {
    name: "list_services",
    description: "Салоны бүх идэвхтэй үйлчилгээний жагсаалт, үнэ, тайлбарыг авах.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "present_service",
    description:
      "Тодорхой нэг үйлчилгээг ЗУРАГТ КАРТААР үйлчлүүлэгчид илгээх (1 үйлчилгээ = 1 карт). Хэрэглэгч тухайн үйлчилгээг сонирхсон эсвэл түүнийг үзүүлэх шаардлагатай үед дууд.",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "Үйлчилгээний id (list_services-ээс)" },
      },
      required: ["serviceId"],
      additionalProperties: false,
    },
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
    name: "search_knowledge",
    description:
      "Өмнө ажилтны өгсөн хариултуудын мэдлэгийн сангаас хайх. Үйлчилгээний сан дээр байхгүй зүйлийг асуувал ЭХЛЭЭД үүгээр хай.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Хайх асуулт/түлхүүр үг" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate_to_staff",
    description:
      "Үйлчилгээний сан болон мэдлэгийн санд ҮНЭХЭЭР байхгүй асуултыг ажилтанд дамжуулах. Ажилтан хариулахад үйлчлүүлэгч рүү буцаж очно. Асуултыг тодорхой, бүтэн бич.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string", description: "Үйлчлүүлэгчийн асуулт (бүтэн)" } },
      required: ["question"],
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

  // Холбоо барих / байршил (үнэхээр мэдэхгүй үед санал болгоно)
  const contactParts = [];
  if (config.salonPhone) contactParts.push(`утас: ${config.salonPhone}`);
  if (config.salonLocation) contactParts.push(`байршил: ${config.salonLocation}`);
  const contactLine = contactParts.length
    ? `Холбоо барих — ${contactParts.join(", ")}.`
    : `(Холбоо барих утас/байршил тохируулагдаагүй — байгаа бол санал болго.)`;

  return (
    `Чи бол ${config.salonName} гоо сайхны салоны дотно, халуун дулаан, бага зэрэг гоёмсог ` +
    `өнгө аястай туслах AI. Зөвхөн монгол хэлээр харилц. Найрсаг, халамжтай, цэвэрхэн өнгөөр ярь — ` +
    `хэт албан биш, дотно. ЭНГИЙН, ойлгомжтой, өдөр тутмын үг сонголт ашигла — хэт хүнд, уран яруу, ` +
    `номын маягийн үг (жишээ нь «морилсон», «толилуулах», «эрхэмлэн», «угтах») БҮҮ хэрэглэ. ` +
    `Богино, цэвэрхэн өгүүлбэр. Emoji-г цөөхөн, гоёмсгоор (жишээ: 🌸 ✨ 💫) хэрэглэ.\n\n` +
    `⛔ ХАМГИЙН ЧУХАЛ ДҮРЭМ — ЗОХИОЖ БОЛОХГҮЙ: Зөвхөн мэдээллийн сан болон tool-оос ирсэн БОДИТ ` +
    `өгөгдөлд тулгуурла. Үнэ, сул цаг, бодлого — баримтыг өөрөө зохиож, таамаглаж БОЛОХГҮЙ.\n` +
    `📌 ЧУХАЛ: Үйлчилгээний ДЭЛГЭРЭНГҮЙ (жишээ: багцад багтсан бүх үйлчилгээ, онцлог, үр дүн) нь ` +
    `list_services-ийн 'benefits' ба 'description' талбарт БАЙГАА. Эдгээр нь бодит өгөгдөл — тэндээс ` +
    `БҮРЭН хариул. "Санд байхгүй" гэж бүү хэл, эхлээд list_services-ийг шалга.\n` +
    `Өгөгдөлд шууд байхгүй зүйл асуувал ДАРААЛЛААР ажилла: (1) ЭХЛЭЭД search_knowledge tool-ээр ` +
    `хай. (2) Тэндээс олдвол түүгээр хариул. (3) Үнэхээр олдохгүй бол escalate_to_staff tool-оор ` +
    `асуултыг ажилтанд дамжуул, дараа нь үйлчлүүлэгчид "Таны асуултыг ажилтанд дамжууллаа, удахгүй ` +
    `хариу өгнө 🌸" гэж эелдэг хэл. Хүсвэл шууд холбогдож болохыг нэм: ${contactLine} ` +
    `Баримтыг БҮҮ зохио, үнэ тодорхойгүй (null) үйлчилгээний үнийг БҮҮ таа.\n\n` +
    `ҮЙЛЧИЛГЭЭ ТАНИЛЦУУЛАХ ДҮРЭМ (чандлан баримтал):\n` +
    `• Үйлчилгээг present_service tool-ээр ЗУРАГТ КАРТААР танилцуул. НЭГ үйлчилгээ = НЭГ карт. ` +
    `Хэд хэдэн үйлчилгээг нэг текст мессежид БҮҮ жагсаа.\n` +
    `• Контентоос ирээгүй хэрэглэгчид үндсэн эхний 3 үйлчилгээг систем аль хэдийн зурагтайгаар ` +
    `үзүүлсэн — тэдгээрийг дахин БҮҮ танилцуул. Хэрэглэгч үлдсэн үйлчилгээ (лазер, сормуус) эсвэл ` +
    `өөр үйлчилгээ сонирхвол тухайн үйлчилгээг present_service-ээр үзүүл.\n` +
    `• Хэрэглэгч тодорхой үйлчилгээ асуувал эхлээд present_service-ээр үзүүлээд, дараа нь дэлгэрэнгүйг ` +
    `(зөвхөн сан дээр байгаагаар) товч тайлбарла.\n\n` +
    `АЖИЛЛАХ ЦАГ: Салон өдөр бүр ${config.salonOpenHour}:00–${config.salonCloseHour}:00 ажиллана.\n` +
    `⚠️ Үйлчилгээ бүрийн үргэлжлэх хугацаа ялгаатай бөгөөд энд өгөгдөөгүй. Тиймээс үйлчилгээ ` +
    `хэр удах талаар ТОО/ХУГАЦАА зохиож хэлж БОЛОХГҮЙ. Асуувал "Үйлчилгээнээс хамаарч ялгаатай, ` +
    `манай ажилтан тодруулж өгнө 🌸" гэж хэл.\n\n` +
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
      // Бүрэн дэлгэрэнгүйг (benefits/description г.м.) буцаана — AI эдгээр баримт дээр хариулна.
      return services.map((s) => ({
        id: s.id,
        name: s.name,
        subtitle: s.subtitle,
        description: s.description,
        benefits: s.benefits, // жишээ: багцад багтсан бүх үйлчилгээ
        price: s.price,
        prepayment: s.prepayment,
        variants: s.variants,
        addons: s.addons,
      }));
    }
    case "present_service": {
      const svc = await repository.getService(input.serviceId);
      if (!svc) return { ok: false, error: "Үйлчилгээ олдсонгүй." };
      await presentOneService(ctx.psid, svc);
      return { ok: true, presented: svc.name };
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
    case "search_knowledge": {
      const results = await searchKnowledge(input.query);
      return { found: results.length, results };
    }
    case "escalate_to_staff": {
      const q = await escalateQuestion({ psid: ctx.psid, question: input.question });
      return {
        ok: true,
        questionId: q.id,
        note: "Асуултыг ажилтанд дамжууллаа. Үйлчлүүлэгчид удахгүй хариулна гэдгийг эелдэг хэл.",
      };
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
/** Түүхийг хэмжээнд барих + эхэнд орфан "tool" мессеж үлдвэл цэвэрлэх. */
function trimHistory(history) {
  let h = history.slice(-MAX_HISTORY);
  // OpenAI: "tool" мессеж нь tool_calls-тай assistant мессежийг заавал дагана.
  while (h.length && h[0].role === "tool") h = h.slice(1);
  return h;
}

export async function handleCustomerMessage({ psid, text }) {
  const history = conversations.get(psid) || [];
  history.push({ role: "user", content: text });

  const system = await buildSystemPrompt(psid);
  const ctx = { psid };

  // Tool-calling loop (хамгийн ихдээ 5 эргэлт)
  let reply = "";
  for (let i = 0; i < 5; i++) {
    const messages = [{ role: "system", content: system }, ...history];
    const completion = await createChatCompletion({
      messages,
      tools,
      maxTokens: 1500,
      model: config.customerModel,
    });
    const msg = completion.choices?.[0]?.message;
    if (!msg) break;

    // assistant мессежийг түүхэд нэмэх (tool_calls агуулж болно)
    const assistantMsg = { role: "assistant", content: msg.content ?? "" };
    if (msg.tool_calls?.length) assistantMsg.tool_calls = msg.tool_calls;
    history.push(assistantMsg);

    if (!msg.tool_calls?.length) {
      reply = msg.content || "";
      break;
    }

    // tool дуудлага бүрийг гүйцэтгэж, хариуг нэмэх
    for (const call of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        /* буруу JSON — хоосон аргументтэй үргэлжилнэ */
      }
      let output;
      try {
        output = await runTool(call.function?.name, args, ctx);
      } catch (err) {
        output = { ok: false, error: String(err.message || err) };
      }
      history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }

  conversations.set(psid, trimHistory(history));
  return reply || "Уучлаарай, дахин оролдоно уу.";
}

/** Шинэ хэрэглэгчийн ярианы түүхийг урьдчилсан мэндчилгээгээр эхлүүлэх. */
export function seedGreeting(psid, greetingText) {
  const history = conversations.get(psid) || [];
  history.push({ role: "assistant", content: greetingText });
  conversations.set(psid, trimHistory(history));
}
