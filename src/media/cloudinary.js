// ─────────────────────────────────────────────────────────────
//  Cloudinary — зураг байршуулах.
//
//  Алсын URL (жишээ Telegram файлын URL)-ийг Cloudinary руу шууд дамжуулж,
//  БАЙРШУУЛАХ үедээ жижигрүүлнэ (width хязгаар + quality auto). Үүний үр дүнд
//  хадгалагдсан зураг жижиг, хурдан ачаалагддаг secure URL буцаана.
// ─────────────────────────────────────────────────────────────

import { v2 as cloudinary } from "cloudinary";
import { config } from "../config.js";

let configured = false;

/** Cloudinary тохируулагдсан эсэх. */
export function isCloudinaryConfigured() {
  return Boolean(
    config.cloudinaryUrl ||
      (config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret),
  );
}

function ensureConfig() {
  if (configured) return;
  if (config.cloudinaryUrl) {
    // SDK нь CLOUDINARY_URL орчны хувьсагчийг автоматаар уншина.
    cloudinary.config({ secure: true });
  } else {
    cloudinary.config({
      cloud_name: config.cloudinaryCloudName,
      api_key: config.cloudinaryApiKey,
      api_secret: config.cloudinaryApiSecret,
      secure: true,
    });
  }
  configured = true;
}

/**
 * Алсын зургийг Cloudinary руу жижигрүүлж байршуулах.
 * @param {string} remoteUrl — татаж авах эх URL (жишээ Telegram файл)
 * @param {object} [opts]
 * @param {string} [opts.folder] — Cloudinary хавтас
 * @param {number} [opts.maxWidth] — хамгийн их өргөн (px), default 1080
 * @returns {Promise<{ok:boolean, url?:string, error?:string, skipped?:boolean}>}
 */
export async function uploadServiceImage(remoteUrl, opts = {}) {
  if (!isCloudinaryConfigured()) {
    return { ok: false, skipped: true, error: "Cloudinary тохируулаагүй байна." };
  }
  ensureConfig();

  const maxWidth = opts.maxWidth || 1080;
  try {
    const res = await cloudinary.uploader.upload(remoteUrl, {
      folder: opts.folder || "ub-beauty/services",
      // БАЙРШУУЛАХ үед жижигрүүлнэ (incoming transformation): өргөнийг хязгаарлаж, чанарыг оновчилно.
      transformation: [{ width: maxWidth, crop: "limit", quality: "auto:eco" }],
    });
    return { ok: true, url: res.secure_url };
  } catch (err) {
    console.error("[cloudinary] байршуулах алдаа:", err);
    return { ok: false, error: String(err?.message || err) };
  }
}
