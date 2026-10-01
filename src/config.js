// Төвлөрсөн тохиргоо. Бүх орчны хувьсагчийг энд уншиж, бусад модуль үүгээр хэрэглэнэ.

export const config = {
  // --- AI ---
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  // Анхдагчаар claude-opus-5. Хямд болгох бол AI_MODEL-аар claude-sonnet-5 / claude-haiku-4-5 болгоно.
  aiModel: process.env.AI_MODEL || "claude-opus-5",

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

  // --- Захиалга / цуцлах бодлого ---
  cancelRefundHours: Number(process.env.CANCEL_REFUND_HOURS || 4),
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
