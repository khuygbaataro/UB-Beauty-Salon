// ─────────────────────────────────────────────────────────────
//  Долоо хоногийн хуваарийн нэгдсэн өгөгдөл.
//
//  Энэ долоо хоногийн жинхэнэ огноогоор артист бүрийн ажиллах цагийг гаргана.
//  Хоёр хэрэглээ:
//   • Google Sheet — бүрэн хүснэгт (цаг + хийдэг үйлчилгээ)
//   • Telegram — жижиг, цэвэрхэн монопэйс хүснэгт (утсанд багтах)
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";
import { weekDates, dayKeyOf } from "../booking/schedule.js";

const DAY_LABEL = { mon: "Да", tue: "Мя", wed: "Лх", thu: "Пү", fri: "Ба", sat: "Бя", sun: "Ня" };

function mmdd(date) {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** Цагийг богиносгох: 10:00–18:00 → 10-18, 10:30–18:00 → 10:30-18 */
function shortHours(h) {
  const s = h.start.endsWith(":00") ? h.start.slice(0, -3) : h.start;
  const e = h.end.endsWith(":00") ? h.end.slice(0, -3) : h.end;
  return `${s}-${e}`;
}

/** Энэ долоо хоногийн бүтэцлэсэн өгөгдөл цуглуулах. */
export async function buildWeekData() {
  const dates = weekDates();
  const [artists, services] = await Promise.all([
    repository.listArtists({ active: true }),
    repository.listServices({ activeOnly: false }),
  ]);
  const nameById = new Map(services.map((s) => [s.id, s.name]));

  const list = artists
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((a) => ({
      name: a.name || "—",
      services: (a.serviceIds || []).map((id) => nameById.get(id) || id),
      days: dates.map((d) => ({
        date: d,
        off: (a.timeOff || []).includes(d),
        hours: (a.weeklySchedule || {})[dayKeyOf(d)] || null,
      })),
    }));

  return { dates, artists: list, title: `${mmdd(dates[0])}–${mmdd(dates[6])}` };
}

// ───────── Google Sheet (бүрэн) ─────────
export function weekSheetValues(data, updatedAt) {
  const header = [
    "Артист",
    ...data.dates.map((d) => `${DAY_LABEL[dayKeyOf(d)]} ${mmdd(d)}`),
    "Хийдэг үйлчилгээ",
  ];
  const rows = data.artists.map((a) => [
    a.name,
    ...a.days.map((dc) => (dc.off ? "Амарна" : dc.hours ? `${dc.hours.start}–${dc.hours.end}` : "—")),
    a.services.join(", ") || "—",
  ]);
  const titleRow = [`Энэ долоо хоног: ${data.title}${updatedAt ? ` — шинэчилсэн ${updatedAt}` : ""}`];
  return [titleRow, header, ...rows];
}

// ───────── Захиалгын календарь (цаг × өдөр) ─────────
/** Энэ долоо хоногт захиалагдсан цагуудыг цаг × өдрийн хүснэгтээр. */
export async function buildBookingsGrid() {
  const dates = weekDates();
  const bookings = (await repository.listBookings({})).filter(
    (b) => b.status !== "cancelled" && dates.includes(b.date),
  );

  // Цагийн мөрүүд (салоны ажиллах цагаар, цаг тутам).
  const slots = [];
  for (let h = config.salonOpenHour; h < config.salonCloseHour; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
  }

  // Огноо+цагаар индекслэх.
  const byKey = new Map();
  for (const b of bookings) {
    const key = `${b.date} ${b.time}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(b);
  }

  const header = ["Цаг", ...dates.map((d) => `${DAY_LABEL[dayKeyOf(d)]} ${mmdd(d)}`)];

  const rows = [];
  const cellServiceIds = []; // [rowIdx][dayIdx] = serviceId | null (нүдний өнгө онооход)
  const nameById = new Map(); // serviceId -> serviceName (legend-д)

  for (const t of slots) {
    const textRow = [t];
    const svcRow = [];
    for (const d of dates) {
      const arr = byKey.get(`${d} ${t}`) || [];
      textRow.push(
        arr
          .map((b) => `${b.phone} · ${b.serviceName}${b.artistName ? ` (${b.artistName})` : ""}`)
          .join("\n"),
      );
      svcRow.push(arr.length ? arr[0].serviceId : null);
      for (const b of arr) if (b.serviceId) nameById.set(b.serviceId, b.serviceName);
    }
    rows.push(textRow);
    cellServiceIds.push(svcRow);
  }

  // Энэ долоо хоногт тохиолдсон үйлчилгээнүүд (тогтвортой дараалал — өнгө онооход).
  const orderedServiceIds = [...nameById.keys()].sort();

  return {
    dates,
    header,
    rows,
    cellServiceIds,
    orderedServiceIds,
    serviceNameById: Object.fromEntries(nameById),
    title: `${mmdd(dates[0])}–${mmdd(dates[6])}`,
  };
}

// ───────── Telegram (жижиг, монопэйс) ─────────
function dayShort(date) {
  const [, , d] = date.split("-");
  return `${DAY_LABEL[dayKeyOf(date)]}${Number(d)}`;
}

/** Баганаа жигдэлсэн монопэйс хүснэгт. */
function formatTable(header, rows) {
  const cols = header.length;
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(header[i].length, ...rows.map((r) => String(r[i] ?? "").length)),
  );
  const line = (cells) => cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
  return [line(header), ...rows.map(line)].join("\n");
}

/** Telegram-д илгээх цэвэрхэн текст (монопэйс хүснэгт). */
export function weekTelegramText(data) {
  if (!data.artists.length) {
    return `📅 Энэ долоо хоног (${data.title})\n\nАжиллах артист алга байна.`;
  }
  const header = ["Артист", ...data.dates.map(dayShort)];
  const rows = data.artists.map((a) => [
    a.name,
    ...a.days.map((dc) => (dc.off ? "Амар" : dc.hours ? shortHours(dc.hours) : "·")),
  ]);
  return `📅 Энэ долоо хоног (${data.title})\n\n${formatTable(header, rows)}`;
}
