// Төвлөрсөн тохиргоо. Бүх орчны хувьсагчийг энд уншиж, бусад модуль үүгээр хэрэглэнэ.

export const config = {
  // --- AI ---
  // Anthropic (Admin AI-д хэрэглэнэ)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  aiModel: process.env.AI_MODEL || "claude-sonnet-5-5", // нийтлэг Claude fallback
  // Admin AI + Артист AI (хоёулаа) — default Sonnet 5.5
  adminModel: process.env.ADMIN_MODEL || process.env.AI_MODEL || "claude-sonnet-5-5",

  // --- Redis хадгалалт (Upstash / Vercel KV) ---
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "",
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "",

  // OpenAI (Customer AI-д хэрэглэнэ)
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  customerModel: process.env.CUSTOMER_MODEL || "gpt-5.6-luna",
  // chat/completions дээр function tools хэрэглэхэд reasoning_effort="none" байх ёстой
  // (gpt-5.6-luna: tools + reasoning нь зөвхөн /v1/responses дээр дэмжигддэг).
  customerReasoningEffort: process.env.CUSTOMER_REASONING_EFFORT || "none",

  // --- Facebook Messenger (үйлчлүүлэгчийн AI) ---
  fbVerifyToken: process.env.FB_VERIFY_TOKEN || "",
  fbPageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN || "",
  fbAppSecret: process.env.FB_APP_SECRET || "",

  // --- Facebook Messenger (АРТИСТын AI — тусдаа хуудас) ---
  // Артистуудад зориулсан тусдаа Facebook Page-ийн токен/verify. Тохируулаагүй бол
  // (dev) үйлчлүүлэгчийн хуудасныхыг түр ашиглана.
  artistPageAccessToken: process.env.ARTIST_PAGE_ACCESS_TOKEN || "",
  artistFbVerifyToken: process.env.ARTIST_FB_VERIFY_TOKEN || process.env.FB_VERIFY_TOKEN || "",

  // --- Cloudinary (зураг байршуулах) ---
  // CLOUDINARY_URL (cloudinary://key:secret@cloud) эсвэл тус тусад нь өгч болно.
  cloudinaryUrl: process.env.CLOUDINARY_URL || "",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || "",

  // --- Admin AI (ажилчдын суваг) ---
  adminChannel: process.env.ADMIN_CHANNEL || "telegram", // telegram | messenger
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  adminAllowedIds: (process.env.ADMIN_ALLOWED_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // --- Ажиллах цаг / цагийн хуваарь ---
  salonOpenHour: Number(process.env.SALON_OPEN_HOUR || 10), // өдөр бүр 10:00
  salonCloseHour: Number(process.env.SALON_CLOSE_HOUR || 19), // 19:00 хүртэл
  slotMinutes: Number(process.env.SLOT_MINUTES || 60), // нэг слотын урт (30мин–1цаг)
  priorityStartHour: Number(process.env.PRIORITY_START_HOUR || 10), // эхэлж санал болгох цонх
  priorityEndHour: Number(process.env.PRIORITY_END_HOUR || 13), // (10:00–13:00)

  // --- Төлбөр ---
  prepaymentEnabled: (process.env.PREPAYMENT_ENABLED || "false") === "true", // одоогоор урьдчилгаагүй

  // --- Захиалга / цуцлах бодлого ---
  // Цаг цуцлахдаа хэдэн цагийн өмнө мэдэгдэх нь зүйтэй (зөөлөн сануулга)
  cancelNoticeHours: Number(process.env.CANCEL_NOTICE_HOURS || 4),
  reminderLeadHours: Number(process.env.REMINDER_LEAD_HOURS || 2),

  // --- Cron ---
  cronSecret: process.env.CRON_SECRET || "",

  // --- Цагийн бүс ---
  timezone: process.env.TZ || "Asia/Ulaanbaatar",

  // Байгууллагын мэдээлэл (мессежид хэрэглэнэ)
  salonName: "UB Beauty Salon",
  salonPhone: process.env.SALON_PHONE || "7777-6062", // холбоо барих утас
  salonLocation:
    process.env.SALON_LOCATION || "Улаанбаатар дэлгүүрийн зүүн талын 37-р байр", // байршил/хаяг
};

// Хөгжүүлэлтийн үед дутуу тохиргоог анхааруулах (production дээр алдаа заахгүй, зөвхөн log).
export function warnMissingConfig() {
  const missing = [];
  if (!config.anthropicApiKey) missing.push("ANTHROPIC_API_KEY");
  if (!config.fbPageAccessToken) missing.push("FB_PAGE_ACCESS_TOKEN");
  if (missing.length) {
    console.warn(
      `[config] Дараах орчны хувьсагчид тохируулагдаагүй байна: ${missing.join(", ")}`,
    );
  }
}
