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
import { suggestSlots, ubDate, ubClock } from "../booking/schedule.js";
import { suggestServiceSlots, artistsForService } from "../booking/assignment.js";
import { presentOneService } from "./present.js";
import { sendImage } from "../messenger/sendApi.js";
import { escalateQuestion, searchKnowledge } from "../escalation.js";

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
async function buildSystemPrompt(psid) {
  const services = await repository.listServices({ activeOnly: true });

  // Мэндчилгээнд ашиглах цэвэр нэрсийн жагсаалт (үнэгүй).
  const menuList = services.map((s) => `• ${s.name}`).join("\n");

  // Үндсэн дараалал (seed-ийн дараалал): GREEN PEEL → La Vie → Хүчирхэг багц → Лазер → Сормуус
  const catalog = services
    .map((s, i) => {
      const price = priceSummary(s).replace(/\n/g, " ");
      return `${i + 1}. [${s.id}] ${s.name}: ${s.description} (${price})`;
    })
    .join("\n");

  // Хэрэглэгч аль контентоос орж ирсэн бэ
  const referredId = psid ? await repository.getReferred(psid) : null;
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
    `Чи бол ${config.salonName}-ны үйлчлүүлэгчтэй харилцах чатбот. Туршлагатай, найрсаг МАРКЕТИНГИЙН ` +
    `мэргэжилтэн шиг — энгийн, цөөн үгээр, сонирхол төрүүлэн ярина. Зөвхөн монгол хэлээр.\n\n` +
    `ХЭВ МАЯГ (маш чухал):\n` +
    `• Найрсаг, дулаан, итгэл төрүүлэм — гэхдээ ЦӨӨН ҮГ. Нэг удаад богино 1–3 өгүүлбэр.\n` +
    `• Энгийн өдөр тутмын үг. Хэт хүнд, номын үг («толилуулах», «эрхэмлэн») БҮҮ хэрэглэ.\n` +
    `• ❌ Чимэглэлийн emoji (цэцэг 🌸, оч ✨, 💫 гэх мэт) ЕРӨӨСӨӨ БҮҮ хэрэглэ. ` +
    `Зөвхөн утга бүхий тэмдгийг ховорхон хэрэглэж болно: ✅ (баталгаажуулалт), 🎁 (бэлэг), 💬.\n` +
    `• Урт текст, олон мессеж дараалан БҮҮ явуул — хэрэглэгч залхана.\n\n` +
    `⛔ ЗОХИОЖ БОЛОХГҮЙ: үнэ, сул цаг, бэлэг, бодлого — зөвхөн tool/сангаас ирсэн БОДИТ өгөгдөл. ` +
    `Таамаглаж, зохиож БОЛОХГҮЙ. Үнэ тодорхойгүй (null) үйлчилгээний үнийг БҮҮ таа.\n` +
    `⛔ ХАТУУ: Мэдэхгүй, боломжгүй зүйлийг худлаа БҮҮ хэл. check_availability-д bookable:false эсвэл ` +
    `available хоосон бол — цаг БҮҮ санал болго, захиалга БҮҮ хий. available-д БАЙГАА цагийг л зөвшөөр. ` +
    `Артист байхгүй үйлчилгээнд цаг өгөхгүй.\n` +
    `⏰ ОДОО: ${ubDate(0)}, цаг ${ubClock()} (Улаанбаатар). "Хэдэн цаг болж байна" гэвэл үүнийг хэл. ` +
    `Өнгөрсөн цагийг (одоогийн цагаас өмнө) БҮҮ санал болго — систем автоматаар хасдаг.\n\n` +
    `════ ЗААВАЛ БАРИХ УРСГАЛ (дарааллыг чандлан баримтал) ════\n` +
    `1) МЭНДЧИЛГЭЭ + ЖАГСААЛТ: Хэрэглэгч мэндчилбэл эсвэл "ямар үйлчилгээ байгаа вэ" гэвэл — товчхон ` +
    `"Та ямар үйлчилгээ сонирхож байна вэ?" гэж асуугаад ЯГ ДОР нь үйлчилгээний нэрсийг (зөвхөн нэр, ` +
    `үнэгүй) жагсаа. ⚠️ Жагсаалтгүйгээр зөвхөн асуулт БҮҮ тавь — нэрсийг үргэлж хамт явуул. ` +
    `(Системийн анхны мэндчилгээ яг саяхан үүнийг үзүүлсэн бол л дахин бүү давт.) Жагсаалт яг ийм:\n` +
    `${menuList}\n` +
    `2) СОНИРХОЛ ТАНИХ: Хэрэглэгч АЛЬ үйлчилгээг сонгосныг ойлго. Тодорхойгүй бол эелдэг тодруул.\n` +
    `3) ҮЙЛЧИЛГЭЭНИЙ МЭДЭЭЛЭЛ: Сонгосон үйлчилгээг present_service-ээр зурагтайгаар үзүүлээд, ` +
    `description-оос 1–2 өгүүлбэр ТОВЧ тайлбар өг. ⚠️ Үнийг ЭНД БҮҮ хэл.\n` +
    `4) СОНИРХОЛ БАТЛАХ: "Та энэ үйлчилгээг сонирхож байна уу?" гэж асуу.\n` +
    `5) ҮНЭ + БЭЛЭГ (ШУУД): Хэрэглэгч сонирхож байна гэвэл ЯГ ТЭР ДАРУЙ үнийг (list_services-ийн ` +
    `price/variants) хэл. БЭЛЭГ/УРАМШУУЛАЛ: эхлээд service-ийн promo талбарыг хар; хэрэв promo хоосон бол ` +
    `search_knowledge-ээр тухайн үйлчилгээний "бэлэг/урамшуулал/нөхөн төлжүүлэх/хямдрал"-ыг хай — олдвол ` +
    `🎁-тэй хамт ЗААВАЛ хэл. Үнийг картан дээр давхар бичихгүй, зөвхөн энд нэг л удаа хэл. ` +
    `⚠️ "Цаг захиалах уу?" гэж БҮҮ асуу — шууд дараагийн алхам руу шилж.\n` +
    `6) ХЭЗЭЭ ИРЭХ: Үнэ хэлсэн мөрөндөө "Та хэзээ ирж үйлчлүүлэх боломжтой вэ?" гэж асуу.\n` +
    `7) ЦАГ ИДЭВХТЭЙ САНАЛ БОЛГОХ: Өдрийг мэдмэгц check_availability-ээр (serviceId-тай) сул цаг ав. ` +
    `Хэрэглэгч ТОДОРХОЙ цаг нэрлэвэл (жишээ "17:00") — тэр цаг 'available' жагсаалтад байвал ТЭР цагийг ` +
    `зөвшөөрч захиал. Байхгүй бол л өөр цаг санал болго. Хэрэглэгч цаг нэрлээгүй бол 'suggested'-ээс ` +
    `(өглөө 10:00–13:00 эхэндээ) идэвхтэй санал болго: "[Өдөр] [цаг]-д танд санал болгож байна, тохирох уу?".\n` +
    `8) ЗАХИАЛАХ (ХУРДАН): Хэрэглэгч тохирно гэмэгц, утсаа (8 оронтой) өгмөгц ТҮРГЭН create_booking дууд. ` +
    `Шаардлагагүй нэмэлт асуулт бүү тавь — хурдан баталгаажуул.\n` +
    `9) БАТАЛГААЖУУЛАЛТ: Амжилттай бол яг ийм маягаар хэл (үйлчилгээний нэрийг тохируулж):\n` +
    `"Таны цаг захиалга амжилттай баталгаажлаа.✅\n\nӨөртөө цаг гаргаж, гоо сайхандаа анхаарал ` +
    `тавихаар шийдсэн танд баяр хүргэе.\n\nУдахгүй уулзацгаая."\n` +
    `════════════════════════════════════════\n\n` +
    `НЭМЭЛТ ДҮРЭМ:\n` +
    `• ХАЯГ/БАЙРШИЛ/УТАС: Хэрэглэгч асуувал ШУУД, байгалийн хэлбэрээр хэл (escalate хийхгүй, ` +
    `нэмж юм зохихгүй):\n` +
    `  📍 Хаяг: ${config.salonLocation}\n` +
    `  ☎ Утас: ${config.salonPhone}\n` +
    `• ТУСГАЙ ЗААВАР: list_services-ийн 'notes' талбарт тухайн үйлчилгээний админы заавар байж болно. ` +
    `Тэр үйлчилгээг ярих/танилцуулахдаа notes-ийг ЗААВАЛ дага (жишээ "эмзэг арьсанд тохиромжтой гэж онцол").\n` +
    `• ⛔ АРТИСТГҮЙ ҮЙЛЧИЛГЭЭ: list_services-ийн hasArtist=false бол тэр үйлчилгээнд цаг захиалах ` +
    `БОЛОМЖГҮЙ. Мэдээлэл/үнийг хэлж болно, ГЭХДЭЭ "хэзээ ирэх вэ" гэж БҮҮ асуу, захиалга руу БҮҮ ор. ` +
    `"Одоогоор энэ үйлчилгээний цаг захиалга боломжгүй байна, ажилтан тодруулж өгнө" гэж эелдэг хэлээд ` +
    `escalate_to_staff-аар холбо.\n` +
    `• Үйлчилгээний ДЭЛГЭРЭНГҮЙ (benefits, description) нь list_services-д БАЙГАА — бодит өгөгдөл. ` +
    `"Санд байхгүй" гэж бүү хэл, эхлээд list_services-ийг шалга. Бүх benefits-ийг БҮҮ жагса, товч хэл.\n` +
    `• Present_service: НЭГ үйлчилгээ = НЭГ карт. Нэг дор олон карт БҮҮ явуул.\n` +
    `• Урьдчилгаа одоогоор БАЙХГҮЙ — төлбөрийн тухай БҮҮ яри. Захиалга шууд баталгаажна.\n` +
    `• Цуцлах хүсэлт → cancel_booking. Торгуульгүй; боломжтой бол ${config.cancelNoticeHours} цагийн ` +
    `өмнө мэдэгдэхийг зөөлөн хүс.\n` +
    `• Санд болон мэдлэгт байхгүй асуулт: (1) search_knowledge → (2) олдвол хариул → ` +
    `(3) олдохгүй бол escalate_to_staff, дараа нь "Таны асуултыг ажилтанд дамжууллаа, удахгүй ` +
    `хариу өгье" гэж эелдэг хэл. ${contactLine}\n` +
    `• Үйлчилгээ хэр удах талаар ТОО/ХУГАЦАА зохиож БҮҮ хэл.\n` +
    `АЖИЛЛАХ ЦАГ (хатуу дүрэм): артистууд өдөр бүр ${config.salonOpenHour}:00–${config.salonCloseHour}:00 ` +
    `ажиллана. Сүүлийн захиалгын цаг ${config.salonCloseHour - 1}:00. Ажиллах цагийн гаднах цаг БҮҮ санал болго.` +
    referredNote +
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
      return { ok: true, presented: svc.name };
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
      let all, ordered;
      if (input.serviceId && artists.length) {
        ({ all, ordered } = await suggestServiceSlots(input.serviceId, input.date));
      } else {
        ({ all, ordered } = await suggestSlots(input.date));
      }
      return {
        date: input.date,
        available: all, // ⬅ тухайн өдрийн БҮХ сул цаг (тодорхой цаг шалгахад таслагдахгүй)
        suggested: ordered, // проактив санал болгоход (өглөө эхэндээ)
        bookable: all.length > 0,
        note: all.length
          ? "Хэрэглэгч тодорхой цаг нэрлэвэл available дотор байгаа эсэхийг шалгаад тэр цагийг зөвшөөр. Эс бол suggested-ээс санал болго. available-д БАЙХГҮЙ цагийг БҮҮ зөвшөөр."
          : "Энэ өдөр сул цаг алга. Цаг БҮҮ санал болго — өөр өдөр санал болго эсвэл ажилтанд холбо.",
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

  await repository.setConversation(psid, trimHistory(history));
  return reply || "Уучлаарай, дахин оролдоно уу.";
}

/** Шинэ хэрэглэгчийн ярианы түүхийг урьдчилсан мэндчилгээгээр эхлүүлэх. */
export async function seedGreeting(psid, greetingText) {
  const history = await repository.getConversation(psid);
  history.push({ role: "assistant", content: greetingText });
  await repository.setConversation(psid, trimHistory(history));
}
