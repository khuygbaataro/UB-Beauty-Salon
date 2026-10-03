// ─────────────────────────────────────────────────────────────
//  Express апп — бүх HTTP route энд. Vercel дээр api/index.js-ээр
//  экспортлогдож, локал дээр local-dev.js-ээр ажиллана.
//
//  Routes:
//    GET  /                  — эрүүл мэндийн шалгалт
//    GET  /webhook           — Facebook webhook баталгаажуулалт
//    POST /webhook           — Facebook Messenger эвент (үйлчлүүлэгчийн AI)
//    POST /admin/telegram    — Telegram webhook (Admin AI)
//    GET  /cron/reminders    — Vercel Cron → сануулга илгээх
// ─────────────────────────────────────────────────────────────

import express from "express";
import { config, warnMissingConfig } from "./config.js";
import { repository } from "./db/repository.js";
import { resolveReferral, buildGreeting } from "./customer/greeting.js";
import { handleCustomerMessage, seedGreeting, setReferredService } from "./customer/customerAgent.js";
import { handleAdminMessage, isAllowedAdmin } from "./admin/adminAgent.js";
import { sendText } from "./messenger/sendApi.js";
import { runReminders } from "./reminders/reminders.js";

warnMissingConfig();

const VERSION = "2026-10-03-3"; // deploy-ийг ялгах тэмдэг

export const app = express();
app.use(express.json());

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
  const psid = event.sender?.id;
  if (!psid) return;

  // 1) Referral / postback — контентоос ирсэн (аль үйлчилгээ вэ)
  const ref =
    event.referral?.ref ||
    event.postback?.referral?.ref ||
    event.postback?.payload ||
    event.message?.referral?.ref ||
    null;

  // Шинэ орж ирсэн (postback/referral) эсвэл "get_started" → контентоос хамаарсан мэндчилгээ
  if (ref || event.postback) {
    const { service } = await resolveReferral(ref);
    if (service) setReferredService(psid, service.id); // аль контентоос ирснийг цээжил
    const greeting = buildGreeting(service);
    seedGreeting(psid, greeting);
    await sendText(psid, greeting);
    // Хэрэв зэрэг текст мессеж ирээгүй бол энд дуусна
    if (!event.message?.text) return;
  }

  // 2) Энгийн текст мессеж → AI-д боловсруулуулна
  if (event.message?.text) {
    const reply = await handleCustomerMessage({ psid, text: event.message.text });
    await sendText(psid, reply);
  }
}

// ───────── Telegram webhook (Admin AI) ─────────
app.post("/admin/telegram", async (req, res) => {
  const update = req.body;
  const msg = update.message || update.edited_message;
  const chatId = msg?.chat?.id;
  const text = msg?.text;
  if (!chatId || !text) return res.sendStatus(200);

  // ⚠️ Vercel дээр хариу буцаахаас ӨМНӨ боловсруулна (функц царцахаас сэргийлж).
  try {
    if (!isAllowedAdmin(chatId)) {
      await sendTelegram(chatId, "Уучлаарай, танд энэ ботыг ашиглах эрх алга.");
    } else {
      const reply = await handleAdminMessage({ adminId: chatId, text });
      await sendTelegram(chatId, reply);
    }
  } catch (err) {
    console.error("[admin/telegram] алдаа:", err);
    await sendTelegram(chatId, "Алдаа гарлаа. Дахин оролдоно уу.");
  }

  res.sendStatus(200);
});

async function sendTelegram(chatId, text) {
  if (!config.telegramBotToken) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN алга — илгээгдсэнгүй:", text);
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error("[telegram] илгээх алдаа:", err);
  }
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

// ───────── Global error handler ─────────
// Ямар ч route дотор шидэгдсэн алдааг барьж, FUNCTION_INVOCATION_FAILED-ийн
// оронд цэвэр JSON алдаа буцаана (ингэснээр жинхэнэ алдаа харагдана).
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[error]", err?.stack || err);
  if (res.headersSent) return;
  res.status(500).json({ ok: false, error: String(err?.message || err) });
});
