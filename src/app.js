// ─────────────────────────────────────────────────────────────
//  Express апп — бүх HTTP route энд. Vercel дээр api/index.js-ээр
//  экспортлогдож, локал дээр local-dev.js-ээр ажиллана.
//
//  Routes:
//    GET  /                  — эрүүл мэндийн шалгалт
//    GET  /webhook           — Facebook webhook баталгаажуулалт
//    POST /webhook           — Facebook Messenger эвент (үйлчлүүлэгчийн AI)
//    GET  /webhook-artist    — Facebook webhook баталгаажуулалт (артистын хуудас)
//    POST /webhook-artist    — Facebook Messenger эвент (артистын AI)
//    POST /admin/telegram    — Telegram webhook (Admin AI; зураг → Cloudinary)
//    GET  /privacy           — Нууцлалын бодлого (Facebook App-д)
//    GET  /cron/reminders    — Vercel Cron → сануулга илгээх
// ─────────────────────────────────────────────────────────────

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, warnMissingConfig } from "./config.js";
import { repository } from "./db/repository.js";
import { resolveReferral, buildGreeting } from "./customer/greeting.js";
import { presentMainServices, presentOneService } from "./customer/present.js";
import { handleCustomerMessage, seedGreeting, setReferredService, isNewConversation } from "./customer/customerAgent.js";
import { handleAdminMessage, isAllowedAdmin, adminHomeText, adminSubmenu } from "./admin/adminAgent.js";
import { handleArtistMessage } from "./artist/artistAgent.js";
import { sendTelegram } from "./admin/telegramSend.js";
import { getTelegramFileUrl } from "./admin/telegramFile.js";
import { uploadServiceImage, isCloudinaryConfigured } from "./media/cloudinary.js";
import { answerQuestion, parseQid } from "./escalation.js";
import { sendText, sendArtistText } from "./messenger/sendApi.js";
import { runReminders } from "./reminders/reminders.js";
import { privacyPageHtml } from "./legal/privacyPage.js";

warnMissingConfig();

const VERSION = "2026-10-23-7"; // deploy-ийг ялгах тэмдэг (/ эсвэл /status дээр харагдана)

export const app = express();
app.use(express.json());

// ───────── Статик зураг (/img) — үйлчилгээний зураг зэрэг repo доторх файлыг үзүүлнэ ─────────
// assets/ хавтас нь src-ийн хажууд (төслийн үндэс). Vercel дээр vercel.json-ийн
// functions.includeFiles-ээр lambda-д багтдаг.
const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets");
app.use("/img", express.static(ASSETS_DIR, { maxAge: "1d" }));

// publicBaseUrl тохируулаагүй (env байхгүй) бол ирж буй хүсэлтээс автоматаар барьж авна.
// Webhook нь зураг илгээхээс өмнө ирдэг тул энэ нь найдвартай ажиллана.
app.use((req, _res, next) => {
  if (!config.publicBaseUrl) {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    if (host) config.publicBaseUrl = `${proto}://${String(host).split(",")[0].trim()}`;
  }
  next();
});

// ───────── Health ─────────
function healthPayload() {
  let store = "unknown";
  try {
    store = repository.kind;
  } catch (err) {
    console.error("[health] repository.kind алдаа:", err);
  }
  return { ok: true, service: config.salonName, version: VERSION, store };
}

app.get("/", (_req, res) => res.json(healthPayload()));
app.get("/status", (_req, res) => res.json(healthPayload()));

// favicon хүсэлтийг чимээгүй өнгөрөөх (log дээр 404 гарахгүй)
app.get(["/favicon.ico", "/favicon.png"], (_req, res) => res.sendStatus(204));

// ───────── Нууцлалын бодлого (Facebook App-д шаардлагатай) ─────────
app.get(["/privacy", "/privacy-policy"], (_req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8").send(privacyPageHtml());
});

// ───────── Facebook webhook баталгаажуулалт ─────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.fbVerifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ───────── Facebook Messenger эвент (үйлчлүүлэгч) ─────────
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);

  // ⚠️ Vercel serverless дээр хариу буцаасны дараа функц царцдаг тул
  //    мессежээ ЭХЛЭЭД боловсруулж (AI дуудлага + хариу илгээх), ДАРАА нь 200 буцаана.
  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      try {
        await handleMessagingEvent(event);
      } catch (err) {
        console.error("[webhook] эвент боловсруулах алдаа:", err);
      }
    }
  }

  res.sendStatus(200);
});

async function handleMessagingEvent(event) {
  // 0a) ECHO — хуудаснаас гарсан мессеж (бот эсвэл хүн). Хүн (ажилтан) Facebook
  //     inbox-д гараар хариулсан бол → тэр чатад ботыг түр зогсооно (human takeover).
  if (event.message?.is_echo) {
    const customerPsid = event.recipient?.id;
    const appId = event.message.app_id;
    // app_id байхгүй (эсвэл манай апп биш) = ХҮН гараар бичсэн. Ботын илгээлт app_id-тай → алгасна.
    const isHuman = !appId || (config.fbAppId && String(appId) !== config.fbAppId);
    if (customerPsid && isHuman) {
      await handleHumanTakeover(customerPsid);
    }
    return;
  }

  const psid = event.sender?.id;
  if (!psid) return;

  // 0b) Бот түр зогссон (ажилтан гар аргаар авсан) бол — чимээгүй өнгөрүүлнэ.
  if (await repository.getPaused(psid)) {
    console.log("[webhook] бот зогссон (human takeover) — алгаслаа:", psid);
    return;
  }

  // 0c) 👍 LIKE/STICKER (текстгүй) — "Тийм/зөвшөөрлөө" гэж үзэж AI-д дамжуулна.
  //     (Бот "сонирхож байна уу?" гэж асуухад хэрэглэгч лайк дарвал үргэлжлүүлнэ.)
  if (event.message && !event.message.text && !event.message.quick_reply) {
    const isSticker =
      Boolean(event.message.sticker_id) ||
      (event.message.attachments || []).some((a) => a?.payload?.sticker_id);
    if (isSticker) {
      const reply = await handleCustomerMessage({ psid, text: "Тийм 👍" });
      if (reply && reply.trim()) await sendText(psid, reply);
      return;
    }
  }

  // 1) Referral / postback / quick-reply (боост зарын товчлуур) — аль үйлчилгээ вэ
  const ref =
    event.referral?.ref ||
    event.postback?.referral?.ref ||
    event.postback?.payload ||
    event.message?.quick_reply?.payload ||
    event.message?.referral?.ref ||
    null;

  // 🔎 Диагностик: зар/referral эвент ирж буй эсэх, ямар ref ирснийг Vercel log-д тэмдэглэнэ.
  //    (Зар дарахад бот хариулахгүй бол энэ log-оос эвент ирж буй эсэхийг шалгана.)
  if (event.referral || event.postback || event.message?.referral) {
    console.log(
      "[webhook] referral/postback эвент:",
      JSON.stringify({
        source: event.referral?.source || event.message?.referral?.source || event.postback?.referral?.source || null,
        ref,
        hasText: Boolean(event.message?.text),
        quickReply: event.message?.quick_reply?.payload || null,
      }),
    );
  }

  // Товчлуур/контент → тухайн үйлчилгээг таних (ref, эс бол товчны гарчиг текстээр)
  if (ref || event.postback) {
    let service = (await resolveReferral(ref)).service;
    if (!service && event.message?.text) {
      service = await repository.findServiceByRef(event.message.text);
    }
    if (service) {
      // Товчлуур/контент/ад → АНХНЫ холбоо тул мэндчилгээтэй (greet=true) танилцуулна.
      await presentServiceDirect(psid, service, await isNewConversation(psid));
      return; // ✅ үйлчилгээний мэдээлэл шууд өглөө — AI-гаар дахин боловсруулахгүй
    }
    // Контент тодорхойгүй / Get Started → НЭГ богино мессежээр үйлчилгээний цэс
    const names = await presentMainServices(psid);
    await seedGreeting(
      psid,
      `[Богино мэндчилгээ + үйлчилгээний нэрсийн жагсаалтыг (${names.join(", ")}) НЭГ мессежээр ` +
        `илгээлээ. Хэрэглэгч сонгоход тухайн үйлчилгээг present_service-ээр зурагтайгаар үзүүлнэ. ` +
        `Хариултаа БОГИНО байлга.]`,
    );
    // Хэрэв зэрэг текст мессеж ирээгүй бол энд дуусна
    if (!event.message?.text) return;
  }

  // 2) Энгийн текст мессеж
  if (event.message?.text) {
    const rawText = event.message.text;
    // "reset" — ярианы түүхийг цэвэрлэж, шинээр мэндчилнэ (туршилтад хялбар)
    const t = rawText.trim().toLowerCase();
    if (t === "reset" || t === "/reset") {
      await repository.setConversation(psid, []);
      const names = await presentMainServices(psid);
      await seedGreeting(
        psid,
        `[Reset — шинээр эхэллээ. Мэндчилгээ + жагсаалт илгээв: ${names.join(", ")}. ` +
          `Хэрэглэгчийн хариуг хүлээнэ.]`,
      );
      return;
    }

    // Контентоос ирээгүй үед (ref/postback-гүй энгийн текст):
    if (!ref && !event.postback) {
      // (a) Мессеж нь ТОДОРХОЙ нэг үйлчилгээг нэрлэсэн бол — AI-д найдалгүй ШУУД зурагтайгаар үзүүлнэ.
      //     (Зар руу хариулахад referral эвент тусдаа ирдэг тул үйлчилгээний нэр нь "хуучин яриа"
      //      болоод AI руу очиж, AI tool дуудалгүй "мэдээлэл өгье" гээд зогсдог алдааг арилгана.)
      if (isServicePickText(rawText)) {
        const svc = await repository.findServiceByRef(rawText);
        if (svc) {
          // Яриа дундуур нэр бичсэн бол мэндлэхгүй; анхны мессеж бол л мэндэлнэ.
          await presentServiceDirect(psid, svc, await isNewConversation(psid));
          return;
        }
      }
      // (b) Анх холбогдсон үед: ЗӨВХӨН мэндчилгээ/ерөнхий хүсэлт бол богино мэндчилгээ + цэс.
      //     Тодорхой асуулт (хаяг хаана, үнэ хэд, цаг гэх мэт) бол AI-д шилжүүлж БАЙГАЛИЙН хариу өгнө
      //     (цэс рүү бүү түлх — хүнтэй ярьж байгаа мэт).
      if ((await isNewConversation(psid)) && isGreetingOrVague(rawText)) {
        const names = await presentMainServices(psid);
        await seedGreeting(
          psid,
          `[Анх холбогдлоо. Богино мэндчилгээ + үйлчилгээний нэрсийг (${names.join(", ")}) НЭГ мессежээр ` +
            `илгээлээ. Хэрэглэгчийн хариуг хүлээнэ. Сонгосон үйлчилгээг present_service-ээр зурагтайгаар ` +
            `үзүүлнэ. Хариултаа БОГИНО байлга.]`,
        );
        return; // анхны мэндчилгээ — AI-г дараагийн мессежээс эхлүүлнэ
      }
    }

    const reply = await handleCustomerMessage({ psid, text: rawText });
    // Хоосон хариу (жишээ захиалга баталгаажуулалтыг tool бүрэн илгээчихсэн) бол дахин бичихгүй.
    if (reply && reply.trim()) await sendText(psid, reply);
  }
}

/**
 * Нэг үйлчилгээг ШУУД (AI-гүйгээр) үзүүлэх: зураг + товч тайлбар + "сонирхож байна уу?".
 * Referral, товчлуур, эсвэл үйлчилгээний нэр шууд бичсэн бүх тохиолдолд ашиглана.
 */
async function presentServiceDirect(psid, service, greet = false) {
  await setReferredService(psid, service.id);
  await presentOneService(psid, service);
  // greet=true зөвхөн АНХНЫ холбоонд (ад/анхны мессеж) — яриа дундуур "Сайн байна уу?" гэж мэндлэхгүй.
  await sendText(psid, buildGreeting(service, greet));
  await seedGreeting(
    psid,
    `[«${service.name}»-г зураг + товч тайлбар + "сонирхож байна уу?"-гаар танилцууллаа. ` +
      `Хэрэглэгч тийм гэвэл УРСГАЛЫН дагуу үнэ (+ promo байвал 🎁) хэлээд дараагийн алхам руу шилж. ` +
      `Богино бич.]`,
  );
}

/**
 * Мессеж нь зөвхөн нэг үйлчилгээг СОНГОСОН (нэрлэсэн) мэт үү?
 * Богино, тоогүй (утас/цаггүй), асуулт/захиалга/цуцлалтын дохиогүй бол тийм —
 * тэр тохиолдолд картыг AI-гүйгээр шууд үзүүлнэ. Эс бол (асуулт, захиалгын урсгал) AI рүү.
 */
function isServicePickText(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 40) return false; // урт өгүүлбэр → AI
  if (/\d/.test(t)) return false; // утас/цаг оролцсон → захиалгын урсгал → AI
  // үнэ/захиалга/хаяг/цуцлал зэрэг санаа агуулсан бол AI боловсруулна (карт биш)
  if (/(үнэ|хэд|захиал|цаг|сул|хаяг|утас|байршил|хямд|бэлэг|цуцл|болих|амралт)/i.test(t)) return false;
  return true;
}

/**
 * Мессеж нь зүгээр мэндчилгээ / ерөнхий "ямар үйлчилгээ байна" хүсэлт үү?
 * Тийм бол анх холбогдоход цэс үзүүлнэ. Үгүй бол (тодорхой асуулт — хаяг/үнэ г.м.)
 * AI-д шилжүүлж байгалийн хариу өгнө (цэс рүү түлэхгүй).
 */
function isGreetingOrVague(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t || t.length <= 3) return true; // "уу", "hi", "за", "sain"
  if (/(сайн ?байна ?уу|сайн ?уу|сайнуу|байна ?уу|мэнд|өглөөний мэнд|hello|^hi\b|^hey\b|^sain)/i.test(t)) return true;
  // Ерөнхий үйлчилгээ/мэдээлэл хүсэлт
  if (/(ямар.{0,4}(үйлчилгээ|уйлчилгээ|service)|үйлчилгээ.{0,4}байна|мэдээлэл ав|юу байдаг|what.{0,6}service)/i.test(t))
    return true;
  return false;
}

/**
 * Хүн (ажилтан) Facebook inbox-д гараар хариулсныг мэдээд, тэр чатад ботыг
 * config.handoffPauseMinutes минутын турш зогсооно. Ажилтан бичих бүрт хугацаа
 * шинэчлэгдэнэ (сүүлийн мессежээс хойш тоолно). Анх зогсоход л үйлчлүүлэгчид
 * "ажилтан нэгдлээ" гэж нэг удаа мэдэгдэнэ.
 */
async function handleHumanTakeover(psid) {
  const already = await repository.getPaused(psid);
  await repository.setPaused(psid, config.handoffPauseMinutes * 60);
  if (!already) {
    // "Ажилтан нэгдлээ" мэдэгдлийн тохиргоо (admin-аас set_bot_text key='handoff_notice'):
    //  • тохируулаагүй (null) → анхдагч мессеж  • "off"/хоосон → ЧИМЭЭГҮЙ  • бусад → тэр текст
    const notice = resolveHandoffNotice(await repository.getSetting("handoff_notice"));
    if (notice) await sendText(psid, notice).catch(() => {});
  }
}

/** Human takeover үед илгээх мэдэгдлийг тодорхойлох. null буцвал чимээгүй (илгээхгүй). */
export function resolveHandoffNotice(setting) {
  const DEFAULT = "Таны чатад манай ажилтан нэгдлээ 😊 Та үргэлжлүүлэн асууж болно, шууд хариулж тусална.";
  if (setting == null) return DEFAULT; // тохируулаагүй → анхдагч
  const t = String(setting).trim();
  if (!t || t.toLowerCase() === "off" || /болиул|унтраа|чимээгүй|бүү/i.test(t)) return null; // чимээгүй
  return t; // админы өгсөн текст
}

// ───────── Facebook webhook баталгаажуулалт (АРТИСТын хуудас) ─────────
app.get("/webhook-artist", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.artistFbVerifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ───────── Facebook Messenger эвент (АРТИСТ) ─────────
app.post("/webhook-artist", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);

  // ⚠️ Vercel дээр хариу буцаахаас ӨМНӨ боловсруулна.
  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      try {
        const psid = event.sender?.id;
        const text = event.message?.text;
        if (!psid || !text) continue;
        const reply = await handleArtistMessage({ psid, text });
        await sendArtistText(psid, reply);
      } catch (err) {
        console.error("[webhook-artist] эвент боловсруулах алдаа:", err);
      }
    }
  }

  res.sendStatus(200);
});

// ───────── Telegram webhook (Admin AI) ─────────
app.post("/admin/telegram", async (req, res) => {
  const update = req.body;
  const msg = update.message || update.edited_message;
  const chatId = msg?.chat?.id;
  const text = msg?.text;
  const photo = msg?.photo; // Telegram PhotoSize[] (сүүлийнх нь хамгийн том)
  if (!chatId || (!text && !(photo && photo.length))) return res.sendStatus(200);

  // ⚠️ Vercel дээр хариу буцаахаас ӨМНӨ боловсруулна (функц царцахаас сэргийлж).
  try {
    // 📋 Админ үйлдлийн лог: хэн (нэр), юу (текст), хэзээ — audit-д бичнэ (зөвшөөрөгдсөн админ).
    if (isAllowedAdmin(chatId) && text) {
      const name =
        [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
        msg.from?.username ||
        String(chatId);
      await repository.appendAdminAudit({ adminId: String(chatId), name, text }).catch(() => {});
    }
    if (!isAllowedAdmin(chatId)) {
      await sendTelegram(chatId, "Уучлаарай, танд энэ ботыг ашиглах эрх алга.");
    } else if (photo && photo.length) {
      // Зураг ирлээ → Cloudinary руу жижигрүүлж байршуулаад, URL-ийг Admin AI-д дамжуулна.
      await handleAdminPhoto(chatId, msg, photo);
    } else if (["home", "/home", "цэс"].includes((text || "").trim().toLowerCase())) {
      // "home" → Admin-ийн үндсэн цэс
      await sendTelegram(chatId, adminHomeText());
    } else if (adminSubmenu(text)) {
      // home доторх ангиллын нэр → дэд цэсний дэлгэрэнгүй
      await sendTelegram(chatId, adminSubmenu(text));
    } else {
      // Асуултын мэдэгдэл рүү Reply хийсэн бол → тухайн асуултад шууд хариулна
      const qid = parseQid(msg.reply_to_message?.text || "");
      if (qid) {
        const result = await answerQuestion(qid, text, chatId);
        await sendTelegram(
          chatId,
          result.ok
            ? "✅ Хариу үйлчлүүлэгч рүү илгээгдэж, мэдлэгийн санд хадгалагдлаа."
            : `⚠️ ${result.error}`,
        );
      } else {
        // Энгийн админ чат → Admin AI (мэдээллийн сан удирдах)
        const reply = await handleAdminMessage({ adminId: chatId, text });
        await sendTelegram(chatId, reply);
      }
    }
  } catch (err) {
    console.error("[admin/telegram] алдаа:", err);
    await sendTelegram(chatId, "Алдаа гарлаа. Дахин оролдоно уу.");
  }

  res.sendStatus(200);
});

/** Админаас ирсэн зургийг Cloudinary-д байршуулаад Admin AI-д URL-ийг дамжуулах. */
async function handleAdminPhoto(chatId, msg, photo) {
  if (!isCloudinaryConfigured()) {
    await sendTelegram(chatId, "Зураг байршуулахын тулд Cloudinary тохиргоо (CLOUDINARY_URL) хэрэгтэй.");
    return;
  }
  const fileId = photo[photo.length - 1].file_id; // хамгийн өндөр нягтралтай
  const fileUrl = await getTelegramFileUrl(fileId);
  const up = fileUrl ? await uploadServiceImage(fileUrl) : { ok: false };

  if (!up.ok) {
    await sendTelegram(chatId, "Зураг байршуулж чадсангүй. Дахин оролдоно уу.");
    return;
  }

  const caption = msg.caption ? `Зурагтай хамт бичсэн тайлбар: "${msg.caption}". ` : "";
  const note =
    `[Админ зураг илгээж, Cloudinary-д байршлаа. ${caption}` +
    `Энэ зургийн URL-ийг ярианы агуулгаас хамаарч ТОХИРОХ газар хэрэглэ: ` +
    `үйлчилгээний зураг бол create_service/update_service-ийн image талбарт, ` +
    `бараа бүтээгдэхүүний зураг бол create_product/update_product-ийн image талбарт, ` +
    `мэдлэгийн сангийн хариулт бол add_knowledge/update_knowledge-ийн image талбарт. URL: ${up.url}]`;
  const reply = await handleAdminMessage({ adminId: chatId, text: note });
  await sendTelegram(chatId, reply);
}

// ───────── Cron: сануулга илгээх ─────────
app.get("/cron/reminders", async (req, res) => {
  // Vercel Cron нь Authorization: Bearer <CRON_SECRET> header илгээдэг.
  const auth = req.headers.authorization || "";
  if (config.cronSecret && auth !== `Bearer ${config.cronSecret}`) {
    return res.sendStatus(401);
  }
  const result = await runReminders();
  console.log("[cron] reminders:", result);
  res.json({ ok: true, ...result });
});

// ───────── Дүн шинжилгээ: сүүлийн customer чатуудыг татах (secured) ─────────
// ?key=<CRON_SECRET> шаардана. CRON_SECRET тохируулаагүй бол татахгүй (нууцлал).
app.get("/admin/dump-chats", async (req, res) => {
  if (!config.cronSecret || req.query.key !== config.cronSecret) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 12));
  const perMsgs = Math.min(40, Math.max(4, Number(req.query.msgs) || 16));
  try {
    const chats = await repository.dumpCustomerConversations(limit, perMsgs);
    res.json({ ok: true, count: chats.length, chats });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// ───────── Global error handler ─────────
// Ямар ч route дотор шидэгдсэн алдааг барьж, FUNCTION_INVOCATION_FAILED-ийн
// оронд цэвэр JSON алдаа буцаана (ингэснээр жинхэнэ алдаа харагдана).
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[error]", err?.stack || err);
  if (res.headersSent) return;
  res.status(500).json({ ok: false, error: String(err?.message || err) });
});
