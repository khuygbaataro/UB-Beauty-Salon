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
import { suggestSlots, ubDate, ubClock, dateRange } from "../booking/schedule.js";
import { suggestServiceSlots, artistsForService } from "../booking/assignment.js";
import { presentOneService, presentProduct, absImageUrl } from "./present.js";
import { sendImage, sendText } from "../messenger/sendApi.js";
import { escalateQuestion, searchKnowledge } from "../escalation.js";
import { getSalonLocation, getSalonPhone } from "../salonInfo.js";

const MAX_HISTORY = 20;

/** Хэрэглэгч аль үйлчилгээний контентоос орж ирснийг тэмдэглэх. */
export async function setReferredService(psid, serviceId) {
  if (psid && serviceId) await repository.setReferred(psid, serviceId);
}

/** Энэ хэрэглэгчтэй анх удаа харилцаж байна уу (ярианы түүх хоосон эсэх). */
export async function isNewConversation(psid) {
  const h = await repository.getConversation(psid);
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
    name: "list_products",
    description:
      "Дэлгүүрт зарагддаг бараа бүтээгдэхүүнийг (тос, маск г.м. — үйлчилгээ БИШ) жагсаах. Хэрэглэгч " +
      "'ямар бараа зардаг вэ', 'тос байна уу' гэх мэт асуувал ашигла.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "present_product",
    description: "Нэг бараа бүтээгдэхүүнийг зурагт картаар үзүүлэх (хэрэглэгч сонирхсон үед).",
    input_schema: {
      type: "object",
      properties: { productId: { type: "string", description: "Барааны id (list_products-ээс)" } },
      required: ["productId"],
      additionalProperties: false,
    },
  },
  {
    name: "check_availability",
    description:
      "Тодорхой өдрийн сул цагуудыг авах. serviceId өгвөл тухайн үйлчилгээг хийдэг артистуудын сул цагийг тооцно. Эхэнд өглөөний (10:00–13:00) сул цаг, дараа нь үлдсэн сул цаг эрэмбэлэгдэж ирнэ. Цаг санал болгохоосоо өмнө ЗААВАЛ энэ tool-ээр сул цагийг шалга.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Огноо YYYY-MM-DD хэлбэрээр" },
        serviceId: { type: "string", description: "Үйлчилгээний id (list_services-ээс). Боломжтой бол заавал өг." },
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
export async function buildSystemPrompt(psid) {
  const services = await repository.listServices({ activeOnly: true });

  // Хаяг/утас — settings дэх override, эс бол config/env.
  const salonLocation = await getSalonLocation();
  const salonPhone = await getSalonPhone();

  // Админ тохируулсан нэмэлт өнгө аяс/хэв маягийн заавар (байвал). Энэ нь дээрх анхдагч
  // ХЭВ МАЯГИЙН (emoji, өнгө аяс, урт/богино) дүрмийг ДАВАМГАЙЛНА — ингэснээр админ
  // Telegram-аас "ингэж бай" гэж засахад бот үнэхээр тэр дагуу өөрчлөгдөнө.
  const tone = await repository.getSetting("tone");
  const toneNote = tone
    ? `\n\n⭐⭐ АДМИНААС ИРСЭН ЗАН ТӨЛӨВИЙН ЗААВАР — ХАМГИЙН ДЭЭД ТЭРГҮҮЛЭХ. Хэрэв дээрх анхдагч ХЭВ МАЯГИЙН ` +
      `дүрэмтэй (emoji ашиглах эсэх, дулаан/албан өнгө, урт/богино байдал) ЗӨРЧИЛДВӨЛ — ЭНЭ ЗААВРЫГ ДАГА, ` +
      `анхдагчийг БҮҮ дага. (Гэхдээ үнэ/цаг/баримтыг зохиохгүй, байхгүйг мэдэхгүй гэх ФАКТЫН дүрэм хэвээр.)\n` +
      `Заавар: ${tone}`
    : "";

  // Мэндчилгээнд ашиглах цэвэр нэрсийн жагсаалт (үнэгүй).
  const menuList = services.map((s) => `• ${s.name}`).join("\n");

  // Үндсэн дараалал (seed-ийн дараалал): GREEN PEEL → La Vie → Хүчирхэг багц → Лазер → Сормуус
  const catalog = services
    .map((s, i) => {
      const price = priceSummary(s).replace(/\n/g, " ");
      // promo (бэлэг/урамшуулал) байвал каталогт оруулна — AI үнэтэй хамт ЗААВАЛ хэлнэ.
      const promo = s.promo ? ` | 🎁 Бэлэг/урамшуулал: ${s.promo}` : "";
      return `${i + 1}. [${s.id}] ${s.name}: ${s.description} (${price})${promo}`;
    })
    .join("\n");

  // Хэрэглэгч аль контентоос орж ирсэн бэ
  const referredId = psid ? await repository.getReferred(psid) : null;
  const referred = referredId ? services.find((s) => s.id === referredId) : null;
  const referredNote = referred
    ? `\n\n⭐ ЭНЭ ХЭРЭГЛЭГЧ «${referred.name}» үйлчилгээний зараас орж ирсэн. ` +
      `«${referred.name}»-г ЗӨВХӨН дараах үед онцол: (а) хамгийн ЭХНИЙ танилцуулга, эсвэл ` +
      `(б) хэрэглэгч "ямар үйлчилгээ байдаг вэ" гэх ЕРӨНХИЙ асуулт асуусан, эсвэл юу сонирхохоо мэдэхгүй үед.\n` +
      `⛔ ХЭРЭГЛЭГЧ ӨӨР ТОДОРХОЙ үйлчилгээ (жишээ лазер, сормуус, La Vie) асуувал ЗӨВХӨН ТЭР үйлчилгээнийх нь ` +
      `талаар ярь — «${referred.name}» руу БҮҮ эргүүл, түүнийг дахин дахин зар шиг БҮҮ түлх.`
    : `\n\n(Хэрэглэгч тодорхой контентоос ирээгүй — үйлчилгээг доорх үндсэн дарааллаар танилцуул.)`;

  return (
    `Чи бол ${config.salonName}-ны үйлчлүүлэгчтэй харилцах чатбот. Туршлагатай, найрсаг МАРКЕТИНГИЙН ` +
    `мэргэжилтэн шиг — энгийн, цөөн үгээр, сонирхол төрүүлэн ярина. Зөвхөн монгол хэлээр.\n\n` +
    `━━ 4 ГОЛ ДҮРЭМ (бусдаас чухал) ━━\n` +
    `1) ШУУД, ИТГЭЛТЭЙ ХАРИУЛ — ЗУГТАХГҮЙ: Үйлчилгээ, үнэ, бэлэг, benefits, үргэлжлэх хугацаа, хаяг, утас, ажиллах/сул ` +
    `цаг — БҮГД tool/санд БАЙГАА. Асуумагц list_services / check_availability / search_knowledge-ээ дуудаад шууд хэл. ` +
    `"Мэдэхгүй / тодруулъя / залгаарай / ажилтанд дамжууллаа" гэж БАРАГ ХЭЗЭЭ Ч бүү хэл — яг тэр зүйл байхгүй ч ойролцоо, ` +
    `холбоотой зүйлээр эерэгээр хариул. Утсыг зөвхөн хэрэглэгч ӨӨРӨӨ асуувал өг. escalate_to_staff-ийг зөвхөн эмнэлгийн ` +
    `онцлог асуулт/гомдолд л хэрэглэ.\n` +
    `2) ҮРГЭЛЖ ЗАХИАЛГА РУУ ТАТ: Чи бол мэдээлэл өгөгч биш — БОРЛУУЛАГЧ, зорилго нь ЦАГ ЗАХИАЛГА ХААХ. Асуултад ` +
    `хариулсныхаа ДАРАА үргэлж "Тэгвэл цаг захиалъя — хэзээ ирэх вэ?" гэж асуу эсвэл check_availability-ээр цаг санал болго. ` +
    `"Өөр асуух зүйл байна уу?" гэх ПАССИВ үгээр бүү төгсгө. Шахахгүй, гэхдээ үргэлж чиглүүлсэн бай.\n` +
    `3) ЗОХИОХГҮЙ, АМЛААД ЗОГСОХГҮЙ: Үнэ/цаг/бэлэг — зөвхөн tool-оос, таамаглахгүй; null үнийг бүү таа. Тайлбарын дутуу ` +
    `тэмдэглэл ("(…нэмэгдэнэ)", "(...)" г.м.)-ийг хэрэглэгчид бүү харуул. "Мэдээлэл өгье/харуулъя" гэж бичээд бүү зогс — ` +
    `үйлчилгээ үзүүлэх бол present_service-ийг ЯГ тэр хариунд дууд. Сул цаг available-д байгааг л зөвшөөр.\n` +
    `4) ТАЙВАН, ХҮНЛЭГ, ЭРҮҮЛ УХААНТАЙ: Туршлагатай зөвлөх хүн шиг тайван, дулаан, тогтвортой НЭГ өнгөтэй, богино ` +
    `(1–3 өгүүлбэр). Илэрхий зүйлд ухаалаг хариул (ж: "цэвэрлүүлээд хөдөө явж болох уу?" → "Мэдээж, мэс засал биш шүү дээ 😊 ` +
    `Хэвийн явж болно. Тэгвэл цаг захиалъя уу?"). Арчилгаа/туршлагын асуулт (улайх/хавдах/өвдөх/дараа нь) → тайвшруул ` +
    `(гоо сайхны үйлчилгээ, онцгой амрал шаардахгүй), тоо/эмнэлгийн баталгаа зохихгүй, "нарийныг ажилтан өдөр нь өгнө" гэ. ` +
    `Чимэглэлийн emoji (🌸✨💫) бүү хэрэглэ; ✅🎁😊-г ховор.\n` +
    `⏰ ОДОО: ${ubDate(0)}, ${ubClock()} (Улаанбаатар). Огноо/цаг асуувал үүнийг хэл. Өнгөрсөн цаг санал болгохгүй.\n\n` +
    `━━ УРСГАЛ ━━\n` +
    `1. Мэндчилбэл / "ямар үйлчилгээ байна" гэвэл → богино асуугаад нэрсийг (зөвхөн нэр) жагсаа:\n${menuList}\n` +
    `2. Үйлчилгээ сонгоход → present_service дууд (зураг явна). Хэрэв тухайн үйлчилгээнд дэлгэрэнгүй танилцуулга ` +
    `байвал СИСТЕМ өөрөө илгээгээд асуулт тавина — чи ДАХИН бичихгүй. Эс бол description-оос 1–2 өгүүлбэр ТОВЧ бичээд ` +
    `(үнийг энд хэлэхгүй) "Та энэ үйлчилгээг сонирхож байна уу?" гэж асуу.\n` +
    `3. Сонирхвол → ЯГ ТЭР ДАРУЙ ҮНЭ (list_services-ийн price/variants). Каталогт 🎁 promo байвал үнэтэй НЭГ мессежид ` +
    `хамт хэл (promo-г алгасахгүй). Тэгээд ШУУД "Та хэзээ ирж үйлчлүүлэх боломжтой вэ?"\n` +
    `4. Өдөр мэдмэгц → check_availability (serviceId-тай). Тухайн өдөр дүүрсэн бол систем ДАРААГИЙН боломжтой өдрийг ` +
    `(shifted) буцаана — "[өдөр]-д [цагууд] боломжтой, аль нь тохирох вэ?" гэж эерэг санал болго. Хэрэглэгч тодорхой ` +
    `цаг нэрлэвэл available-д байвал зөвшөөр.\n` +
    `5. Цаг тохирч, утас (8 орон) өгмөгц → create_booking ШУУД дууд. Баталгаажуулалт, хаяг, байршлын зургийг СИСТЕМ ` +
    `автоматаар илгээнэ — чи ДАХИН бичихгүй.\n\n` +
    `━━ ТУСГАЙ ━━\n` +
    `• Асуусан үйлчилгээг л ярь — асуугаагүйг (ялангуяа GREEN PEEL) зар шиг дахин дахин бүү түлх.\n` +
    `• hasArtist=false үйлчилгээ → цаг захиалахгүй: "одоогоор боломжгүй, ажилтан тодруулна" + escalate_to_staff.\n` +
    `• Бараа (тос/маск) → list_products / present_product; авах бол салонд ирэхийг хэл (цаг захиалга зөвхөн үйлчилгээнд).\n` +
    `• Цаг өөрчлөх/хойшлуулах → ЭХЛЭЭД cancel_booking, ДАРАА create_booking (давхардуулахгүй). Цуцлах → cancel_booking.\n` +
    `• notes талбарт тухайн үйлчилгээний админ заавар байвал дага. "за/баярлалаа" гэвэл богино эелдэг хариулаад юм бүү түлх.\n` +
    `• Хаяг/орчин асуувал: 📍 ${salonLocation} — "Их дэлгүүр, UB Town орчим, төвд, хүрэхэд ойрхон" гэж эерэг хэл. ` +
    `☎ ${salonPhone}. Ажиллах цаг ${config.salonOpenHour}:00–${config.salonCloseHour}:00, 30 мин тутмын слот.` +
    referredNote +
    toneNote +
    `\n\nҮйлчилгээний сан:\n${catalog}`
  );
}

// ───────── Tool гүйцэтгэл ─────────
async function runTool(name, input, ctx) {
  switch (name) {
    case "list_services": {
      const services = await repository.listServices({ activeOnly: true });
      // Аль үйлчилгээнд идэвхтэй артист байгааг тодорхойлно (захиалга авах боломжтой эсэх).
      const activeArtists = await repository.listArtists({ active: true });
      const servedIds = new Set(activeArtists.flatMap((a) => a.serviceIds || []));
      // Бүрэн дэлгэрэнгүйг (benefits/description г.м.) буцаана — AI эдгээр баримт дээр хариулна.
      return services.map((s) => ({
        hasArtist: servedIds.has(s.id), // артистгүй бол цаг захиалах боломжгүй
        id: s.id,
        name: s.name,
        subtitle: s.subtitle,
        description: s.description,
        benefits: s.benefits, // жишээ: багцад багтсан бүх үйлчилгээ
        price: s.price,
        prepayment: s.prepayment,
        durationMinutes: s.durationMinutes ?? null, // үргэлжлэх хугацаа (минут) — админ тохируулсан бол
        promo: s.promo ?? null, // бэлэг/урамшуулал (байвал)
        notes: s.notes ?? null, // админы тусгай заавар — энэ үйлчилгээг ярихад дагана
        variants: s.variants,
        addons: s.addons,
      }));
    }
    case "present_service": {
      const svc = await repository.getService(input.serviceId);
      if (!svc) return { ok: false, error: "Үйлчилгээ олдсонгүй." };
      await presentOneService(ctx.psid, svc);
      // Админ дэлгэрэнгүй танилцуулга (introText) оруулсан бол (ж: Хүчирхэг багц, Green Peel) —
      // түүнийг БҮТНЭЭР нь илгээнэ (description-оос ДЭЭГҮҮР). AI дахин бичихгүйн тулд энд төгсгөнө.
      if (svc.introText && svc.introText.trim()) {
        await sendText(ctx.psid, `${svc.introText.trim()}\n\nТа энэ үйлчилгээг сонирхож байна уу? 😊`);
        ctx.fullyHandled = true;
        return { ok: true, presented: svc.name, note: "Танилцуулга + асуулт бүтнээр илгээгдлээ. Дахин бүү бич." };
      }
      return {
        ok: true,
        presented: svc.name,
        description: svc.description ?? null,
        note:
          "Зурагт карт илгээгдлээ. ОДОО энэ мессежид үйлчилгээний товч тайлбарыг (description-оос 1–2 " +
          "өгүүлбэр) бичээд, дараа нь 'Та энэ үйлчилгээг сонирхож байна уу?' гэж асуу. Хоосон хариу БҮҮ үлдээ.",
      };
    }
    case "list_products": {
      const prods = await repository.listProducts({ activeOnly: true });
      return prods.map((p) => ({ id: p.id, name: p.name, price: p.price, description: p.description ?? null }));
    }
    case "present_product": {
      const prod = await repository.getProduct(input.productId);
      if (!prod) return { ok: false, error: "Бараа олдсонгүй." };
      await presentProduct(ctx.psid, prod);
      return { ok: true, presented: prod.name };
    }
    case "check_availability": {
      // Үйлчилгээг хийдэг артист бүртгэлтэй бол артистын сул цагаар тооцно,
      // эс бол (артист байхгүй/үйлчилгээ зааж өгөөгүй) хуучин салон түвшний цагаар.
      const artists = input.serviceId ? await artistsForService(input.serviceId) : [];
      // ⛔ ХАТУУ ДҮРЭМ: үйлчилгээнд артист байхгүй бол цаг БҮҮ санал болго.
      if (input.serviceId && !artists.length) {
        return {
          date: input.date,
          available: [],
          suggested: [],
          bookable: false,
          note: "Энэ үйлчилгээнд одоогоор артист бүртгэгдээгүй тул цаг захиалах БОЛОМЖГҮЙ. " +
            "Цаг БҮҮ санал болго. Эелдэгээр боломжгүйг хэлээд escalate_to_staff-аар ажилтанд холбо.",
        };
      }
      const getSlots = async (d) =>
        input.serviceId && artists.length ? await suggestServiceSlots(input.serviceId, d) : await suggestSlots(d);

      // Хүссэн өдрөөс эхлэн ойрын 14 хоногоос ДАРААГИЙН боломжтой (сул цагтай) өдрийг автоматаар олно.
      // Ингэснээр "сул цаг алга" гэж хэлэхгүй, шууд боломжтой цагийг эерэгээр санал болгоно.
      const startDate = input.date || ubDate(0);
      let picked = null;
      for (const d of dateRange(startDate, 14)) {
        const { all, ordered } = await getSlots(d);
        if (all.length) {
          picked = { date: d, all, ordered };
          break;
        }
      }
      if (!picked) {
        return {
          date: startDate,
          available: [],
          suggested: [],
          bookable: false,
          note: "Ойрын 2 долоо хоногт сул цаг алга байна. Эелдэгээр хэлээд escalate_to_staff-аар ажилтанд холбо.",
        };
      }
      const shifted = picked.date !== startDate;
      return {
        date: picked.date, // ⬅ боломжтой цагтай ӨДӨР (хүссэн өдөр дүүрсэн бол дараагийн нь)
        requestedDate: startDate,
        shifted,
        available: picked.all, // тухайн өдрийн БҮХ сул цаг
        suggested: picked.ordered, // проактив санал болгоход (өглөө эхэндээ)
        bookable: true,
        note: shifted
          ? `Хүссэн өдөр (${startDate}) сул цаг дүүрсэн тул ДАРААГИЙН боломжтой өдөр (${picked.date})-ийг буцаалаа. ` +
            `"Сул цаг алга" гэж БҮҮ эхэл. Шууд эерэгээр: "${picked.date}-нд [suggested цагууд] боломжтой байна, аль нь тохирох вэ?" гэж санал болго.`
          : "Хэрэглэгч тодорхой цаг нэрлэвэл available дотор байгаа эсэхийг шалгаад зөвшөөр. Эс бол suggested-ээс эерэгээр санал болго. available-д БАЙХГҮЙ цагийг БҮҮ зөвшөөр.",
      };
    }
    case "create_booking": {
      const { booking } = await createBooking({ ...input, psid: ctx.psid });

      // ⬇️ Баталгаажуулалтыг DETERMINISTIC-ээр илгээнэ (AI-ийн алхам алгасахаас сэргийлж):
      //    1) Баталгаажсан текст + огноо/цаг + ХАЯГ
      //    2) Байршлын 3 зураг
      //    3) "Хаягаа зурган хэлбэрээр явууллаа" төгсгөлийн мессеж
      const confirmText =
        `Таны «${booking.serviceName}» цаг захиалга амжилттай баталгаажлаа.✅\n\n` +
        `📅 ${booking.date}, ${booking.time}\n\n` +
        `Өөртөө цаг гаргаж, гоо сайхандаа анхаарал тавихаар шийдсэн танд баяр хүргэе.\n\n` +
        `📍 Манай хаяг: ${await getSalonLocation()}`;
      await sendText(ctx.psid, confirmText);

      const locUrls = (config.salonLocationImages || []).map(absImageUrl).filter(Boolean);
      for (const url of locUrls) await sendImage(ctx.psid, url).catch(() => {});

      if (locUrls.length) {
        await sendText(ctx.psid, "📍 Хаягаа зурган хэлбэрээр бас явууллаа. Удахгүй уулзацгаая 😊");
      } else {
        await sendText(ctx.psid, "Удахгүй уулзацгаая 😊");
      }

      // Бот бүгдийг илгээчихсэн тул AI дахин хариу бичихгүй.
      ctx.fullyHandled = true;
      return {
        ok: true,
        bookingId: booking.id,
        note: "Баталгаажуулалт, хаяг, байршлын зургийг системээс БҮРЭН илгээчихсэн. Чи ДАХИН юу ч БҮҮ бич.",
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
      // Хэрэв хариултад зураг байвал үйлчлүүлэгч рүү шууд илгээнэ.
      const withImg = results.find((r) => r.image);
      if (withImg) await sendImage(ctx.psid, withImg.image).catch(() => {});
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
  const history = await repository.getConversation(psid);
  history.push({ role: "user", content: text });

  const system = await buildSystemPrompt(psid);
  const ctx = { psid };

  // Tool-calling loop (хамгийн ихдээ 5 эргэлт)
  let reply = "";
  let usedTool = false;
  try {
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
      usedTool = true;
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

      // Tool бүх хариуг deterministic-ээр илгээчихсэн бол (жишээ create_booking) —
      // AI-аар дахин бичихгүй, loop-оос гарна.
      if (ctx.fullyHandled) break;
    }
  } catch (err) {
    // AI/API алдаа → эвдэрсэн түүхийг ХАДГАЛАХГҮЙ, дараагийн мессеж цэвэр эхэлнэ.
    console.error("[customer] AI алдаа:", err?.message || err);
    return "Уучлаарай, түр алдаа гарлаа. Дахин бичнэ үү 🌸";
  }

  await repository.setConversation(psid, trimHistory(history));
  // Баталгаажуулалтыг (эсвэл бусад deterministic хариуг) tool бүрэн илгээчихсэн бол
  // нэмэлт текст буцаахгүй (давхардуулахгүй).
  if (ctx.fullyHandled) return "";
  // Tool ажилласан ч бот текст өгөөгүй бол (жишээ зөвхөн карт илгээсэн) эелдэг үргэлжлэл.
  if (reply) return reply;
  return usedTool
    ? "Та цаг захиалах уу? Хэзээ ирэх вэ? 😊"
    : "Уучлаарай, дахин бичнэ үү.";
}

/** Шинэ хэрэглэгчийн ярианы түүхийг урьдчилсан мэндчилгээгээр эхлүүлэх. */
export async function seedGreeting(psid, greetingText) {
  const history = await repository.getConversation(psid);
  history.push({ role: "assistant", content: greetingText });
  await repository.setConversation(psid, trimHistory(history));
}
