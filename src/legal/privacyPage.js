// ─────────────────────────────────────────────────────────────
//  Нууцлалын бодлого (Privacy Policy) — Facebook App-д шаардлагатай.
//  /privacy, /privacy-policy маршрутаар HTML хэлбэрээр үйлчилнэ.
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";

const LAST_UPDATED = "2026-10-04";

/** Нууцлалын бодлогын HTML хуудас буцаана. */
export function privacyPageHtml() {
  const salon = config.salonName;
  const phone = config.salonPhone || "—";
  const location = config.salonLocation || "—";

  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Нууцлалын бодлого — ${salon}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    line-height: 1.7; max-width: 760px; margin: 0 auto; padding: 24px 18px 60px; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #eee; } a { color: #8ab4f8; } }
  h1 { font-size: 1.6rem; }
  h2 { font-size: 1.15rem; margin-top: 1.8rem; }
  .muted { color: #777; font-size: .9rem; }
  ul { padding-left: 1.2rem; }
</style>
</head>
<body>
  <h1>Нууцлалын бодлого</h1>
  <p class="muted">${salon} · Сүүлд шинэчилсэн: ${LAST_UPDATED}</p>

  <p>Энэхүү бодлого нь ${salon}-ийн Facebook Messenger чатбот болон түүнтэй холбоотой
  үйлчилгээг ашиглахад таны мэдээллийг хэрхэн цуглуулж, ашиглаж, хамгаалдгийг тайлбарлана.</p>

  <h2>1. Бид ямар мэдээлэл цуглуулдаг вэ</h2>
  <ul>
    <li>Facebook/Messenger-ийн таны хэрэглэгчийн дугаар (Page-Scoped ID)</li>
    <li>Таны өгсөн нэр, утасны дугаар</li>
    <li>Цаг захиалгын мэдээлэл (үйлчилгээ, огноо, цаг)</li>
    <li>Чатботтой харилцсан мессежийн түүх</li>
  </ul>

  <h2>2. Мэдээллийг юунд ашигладаг вэ</h2>
  <ul>
    <li>Цаг захиалга авах, баталгаажуулах, сануулга илгээх</li>
    <li>Таны асуултад хариулах, үйлчилгээ санал болгох</li>
    <li>Үйлчилгээний чанарыг сайжруулах</li>
  </ul>

  <h2>3. Хиймэл оюун (AI) боловсруулалт</h2>
  <p>Хариу үүсгэхийн тулд таны мессежийг AI үйлчилгээ үзүүлэгчид (жишээ нь Anthropic, OpenAI)-ийн
  системээр боловсруулдаг. Эдгээр нь зөвхөн хариу гаргах зорилгоор ашиглагдана.</p>

  <h2>4. Хадгалалт ба хамгаалалт</h2>
  <p>Таны мэдээллийг найдвартай сервер (хостлогдсон мэдээллийн сан)-д хадгална. Ярианы түүхийг
  хязгаарлагдмал хугацаанд (ойролцоогоор 14 хоног) хадгалж, автоматаар устгана.</p>

  <h2>5. Гуравдагч талтай хуваалцах</h2>
  <p>Бид таны хувийн мэдээллийг худалддаггүй. Зөвхөн үйлчилгээг ажиллуулахад шаардлагатай
  (мессеж дамжуулах, AI боловсруулалт, зураг хадгалалт зэрэг) үйлчилгээ үзүүлэгчидтэй, тэдний
  зориулалтын хүрээнд л хуваалцана.</p>

  <h2>6. Таны эрх</h2>
  <p>Та өөрийн мэдээллийг устгах, засах хүсэлт гаргах эрхтэй. Доорх хаягаар холбогдоно уу.</p>

  <h2>7. Холбоо барих</h2>
  <p>${salon}<br>Утас: ${phone}<br>Хаяг: ${location}</p>

  <p class="muted">Энэхүү бодлогыг шинэчилж болох бөгөөд өөрчлөлтийг энэ хуудсанд нийтэлнэ.</p>
</body>
</html>`;
}
