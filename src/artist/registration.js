// ─────────────────────────────────────────────────────────────
//  Артист бүртгэл — нэг удаагийн баталгаажуулах код.
//
//  Урсгал:
//   1) Manager (эсвэл Admin AI) шинэ артистын нэр, хийдэг үйлчилгээ, role-ийг өгч
//      УРИЛГА үүсгэнэ → систем 6 оронтой нэг удаагийн код буцаана.
//   2) Артист энэ кодыг артистын Facebook хуудас руу илгээхэд өөрийн Messenger ID
//      (psid) нь тухайн бүртгэлд холбогдож, код цуцлагдана (нэг удаа л ажиллана).
// ─────────────────────────────────────────────────────────────

import { repository } from "../db/repository.js";

/** 6 оронтой давтагдахгүй код үүсгэх (одоо байгаа кодуудтай давхцахгүй). */
async function genUniqueCode() {
  for (let i = 0; i < 20; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const exists = await repository.getArtistByCode(code);
    if (!exists) return code;
  }
  // Маш ховор тохиолдол — цаг хугацаанаас гаргана.
  return String(Date.now()).slice(-6);
}

/**
 * Шинэ артист/менежерийн урилга (нэг удаагийн код) үүсгэх.
 * @param {object} p
 * @param {string} p.name
 * @param {string[]} [p.serviceIds]
 * @param {"artist"|"manager"} [p.role]
 * @param {string} [p.phone]
 * @returns {Promise<{artist:object, code:string}>}
 */
export async function createArtistInvite({ name, serviceIds = [], role = "artist", phone = null }) {
  const code = await genUniqueCode();
  const artist = await repository.createArtist({
    name,
    serviceIds,
    role,
    phone,
    psid: null,
    regCode: code,
    active: true,
  });
  return { artist, code };
}

/**
 * Артист кодоо илгээхэд psid-г бүртгэлд холбох (нэг удаа).
 * @returns {Promise<object|null>} холбогдсон артист, эсвэл null (код буруу/ашиглагдсан).
 */
export async function claimArtistByCode(psid, code) {
  const pending = await repository.getArtistByCode(code);
  if (!pending || pending.psid) return null; // код буруу эсвэл аль хэдийн ашиглагдсан
  return repository.updateArtist(pending.id, { psid, regCode: null });
}

/** Текстээс 6 оронтой код олох. */
export function extractCode(text) {
  const m = String(text || "").match(/\b(\d{6})\b/);
  return m ? m[1] : null;
}
