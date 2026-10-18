// ─────────────────────────────────────────────────────────────
//  Салоны хаяг/утас — Telegram админаас засдаг (settings), эс бол env (config).
//  Цаг (open/close) нь schedule.js-ийн sync тооцоонд хэрэглэгддэг тул env-д үлдэнэ.
// ─────────────────────────────────────────────────────────────

import { config } from "./config.js";
import { repository } from "./db/repository.js";

/** Салоны хаяг: settings дэх override, эс бол config/env-ийн утга. */
export async function getSalonLocation() {
  return (await repository.getSetting("salon_location")) || config.salonLocation;
}

/** Салоны холбоо барих утас: settings дэх override, эс бол config/env. */
export async function getSalonPhone() {
  return (await repository.getSetting("salon_phone")) || config.salonPhone;
}
