// Төвлөрсөн тохиргоо. Бүх орчны хувьсагчийг энд уншиж, бусад модуль үүгээр хэрэглэнэ.

export const config = {
  // --- AI ---
  // Anthropic (Admin AI-д хэрэглэнэ)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  aiModel: process.env.AI_MODEL || "claude-opus-5", // нийтлэг Claude fallback
  adminModel: process.env.ADMIN_MODEL || process.env.AI_MODEL || "claude-opus-5",

  // OpenAI (Customer AI-д хэрэглэнэ)
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  customerModel: process.env.CUSTOMER_MODEL || "gpt-5.6-luna",
  // Reasoning түвшин (minimal горимд function tools дэмжигддэггүй тул "low").
  customerReasoningEffort: process.env.CUSTOMER_REASONING_EFFORT || "low",

  // --- Facebook Messenger (үйлчлүүлэгчийн AI) ---
  fbVerifyToken: process.env.FB_VERIFY_TOKEN || "",
  fbPageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN || "",
  fbAppSecret: process.env.FB_APP_SECRET || "",

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
  reminderLeadHours: Number(process.env.REMINDER_LEAD_HOURS || 24),

  // --- Cron ---
  cronSecret: process.env.CRON_SECRET || "",

  // --- Цагийн бүс ---
  timezone: process.env.TZ || "Asia/Ulaanbaatar",

  // Байгууллагын нэр (мессежид хэрэглэнэ)
  salonName: "UB Beauty Salon",
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
