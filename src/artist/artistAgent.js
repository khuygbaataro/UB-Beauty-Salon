// ─────────────────────────────────────────────────────────────
//  Артистын AI — артист/менежертэй Messenger (тусдаа хуудас) дээр харилцана.
//
//  Хоёр role:
//   • artist  — зөвхөн ӨӨРИЙН хуваарь/амралт/захиалгатай ажиллана
//   • manager — дээрхээс гадна БҮХ артистыг хянах, шинэ код (урилга) үүсгэх,
//               артистыг идэвхгүй болгох эрхтэй
//
//  Бүртгэл: хүн нэг удаагийн 6 оронтой кодоо (manager/Admin AI-аас авсан) энэ хуудас руу
//  илгээхэд psid нь бүртгэлд холбогдоно. Бүртгэлгүй psid-д кодоо асууна.
//
//  ⚠️ Яриа түр санах ой (artistConversations Map) нь энэ process-д л байна. (TODO: DB)
// ─────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { repository } from "../db/repository.js";
import { createMessage, extractText, extractToolUses } from "../ai/anthropic.js";
import {
  artistDaySlots,
  artistAvailableSlots,
  ubDate,
  dayKeyOf,
  dateRange,
} from "../booking/schedule.js";
import { createArtistInvite, claimArtistByCode, extractCode } from "./registration.js";
import { notifyAdmins } from "../admin/telegramSend.js";
import { syncScheduleSafe } from "../sheets/googleSheets.js";
import { createBooking, bookingSummary } from "../booking/booking.js";
import { buildWeekData, weekTelegramText } from "../schedule/weekView.js";

/** Telegram HTML escape. */
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const artistConversations = new Map(); // psid -> messages[]  (TODO: DB)
const MAX_HISTORY = 20;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL = {
  mon: "Да",
  tue: "Мя",
  wed: "Лх",
  thu: "Пү",
  fri: "Ба",
  sat: "Бя",
  sun: "Ня",
};

// ───────── Tool тодорхойлолтууд ─────────

// Хувийн tool-ууд (artist ба manager хоёуланд) — өөрийн хуваарь/захиалга.
const PERSONAL_TOOLS = [
  {
    name: "get_my_profile",
    description: "Өөрийн профайл, хийдэг үйлчилгээ, одоогийн ажиллах хуваарь, амралтын өдрүүдийг харах.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "set_working_hours",
    description:
      "Өгсөн гаригуудад ажиллах цаг тохируулах. Жишээ: 'Да–Ба 10–18' → days:[mon,tue,wed,thu,fri], start:'10:00', end:'18:00'.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "array", items: { type: "string", enum: DAY_KEYS }, description: "mon,tue,wed,thu,fri,sat,sun" },
        start: { type: "string", description: "Эхлэх цаг HH:mm" },
        end: { type: "string", description: "Дуусах цаг HH:mm" },
      },
      required: ["days", "start", "end"],
      additionalProperties: false,
    },
  },
  {
    name: "clear_working_day",
    description: "Өгсөн гаригуудад ажиллахгүй гэж тэмдэглэх (хуваарийг устгана).",
    input_schema: {
      type: "object",
      properties: { days: { type: "array", items: { type: "string", enum: DAY_KEYS } } },
      required: ["days"],
      additionalProperties: false,
    },
  },
  {
    name: "request_time_off",
    description:
      "Амралт авах хүсэлт (нэг буюу хэд хэдэн өдөр). dates (жагсаалт) ЭСВЭЛ startDate+days-ээр өг. " +
      "1–3 хоног бол шууд батлагдана. 3-аас ДЭЭШ хоног бол үндсэн админы зөвшөөрөл шаардана.",
    input_schema: {
      type: "object",
      properties: {
        dates: { type: "array", items: { type: "string" }, description: "YYYY-MM-DD өдрүүд" },
        startDate: { type: "string", description: "Эхлэх өдөр YYYY-MM-DD" },
        days: { type: "number", description: "startDate-аас хэдэн хоног дараалан" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "clear_day_off",
    description: "Өмнө тэмдэглэсэн амралтын өдрийг цуцлах. Огноо YYYY-MM-DD.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD" } },
      required: ["date"],
      additionalProperties: false,
    },
  },
  {
    name: "list_my_bookings",
    description: "Өөрийн захиалгуудыг харах. when: 'today' | 'tomorrow' | 'YYYY-MM-DD'. Default today.",
    input_schema: {
      type: "object",
      properties: { when: { type: "string", description: "today | tomorrow | YYYY-MM-DD" } },
      additionalProperties: false,
    },
  },
];

// Зөвхөн менежерийн tool-ууд — бусад артистыг хянах/удирдах.
const MANAGER_TOOLS = [
  {
    name: "list_all_artists",
    description: "Бүх артист/менежерийг (role, хийдэг үйлчилгээ, хуваарь, бүртгэгдсэн эсэх, идэвхтэй эсэхтэй нь) жагсаах.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_artist_invite",
    description:
      "Шинэ артист/менежерт нэг удаагийн 6 оронтой код үүсгэх. Кодыг тухайн хүнд өг — тэр кодоо энэ хуудас руу илгээхэд бүртгэл идэвхжинэ.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string", enum: ["artist", "manager"], description: "artist (default) | manager" },
        serviceIds: { type: "array", items: { type: "string" }, description: "Хийдэг үйлчилгээний id-ууд" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "day_overview",
    description:
      "Өгсөн өдрийн бүх артистын ачааллын тойм: артист тус бүрийн захиалгын тоо, сул цагийн тоо. when: today|tomorrow|YYYY-MM-DD.",
    input_schema: {
      type: "object",
      properties: { when: { type: "string", description: "today | tomorrow | YYYY-MM-DD" } },
      additionalProperties: false,
    },
  },
  {
    name: "set_artist_active",
    description: "Артистыг идэвхтэй/идэвхгүй болгох (идэвхгүй бол захиалга оногдохгүй). artistId шаардлагатай.",
    input_schema: {
      type: "object",
      properties: {
        artistId: { type: "string" },
        active: { type: "boolean" },
      },
      required: ["artistId", "active"],
      additionalProperties: false,
    },
  },
  {
    name: "list_services",
    description: "Бүх үйлчилгээг id-тэй нь жагсаах (гараар захиалга бүртгэхэд үйлчилгээний id авахад).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "add_booking",
    description:
      "Утсаар/биечлэн ирсэн захиалгыг ГАРААР бүртгэх. Утас, үйлчилгээ (serviceId), огноо (YYYY-MM-DD), цаг (HH:mm) " +
      "заавал. artistId өгвөл тэр артистад оноогдоно (list_all_artists-ээс ав). Оноосон артист + менежер рүү мэдэгдэнэ.",
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "8 оронтой утас" },
        serviceId: { type: "string", description: "Үйлчилгээний id (list_services-ээс)" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:mm" },
        artistId: { type: "string", description: "Аль артистад оноох (сонголт)" },
      },
      required: ["phone", "serviceId", "date", "time"],
      additionalProperties: false,
    },
  },
];

// ───────── Туслахууд ─────────

/** when → YYYY-MM-DD. */
function resolveWhen(when) {
  if (!when || when === "today") return ubDate(0);
  if (when === "tomorrow") return ubDate(1);
  return when;
}

/** "home" цэс — артист/менежер юу хийж чадахыг товч танилцуулна. */
function artistHomeText(artist) {
  const isStaff = artist.role === "manager" || artist.role === "reception";
  if (isStaff) {
    // Менежер/хүлээн авагч — үйлчилгээ хийхгүй, захиалга/удирдлагад туслана.
    return (
      `Сайн уу, ${artist.name}!\n\n` +
      `Би дараах зүйлд туслана:\n` +
      `Захиалга бүртгэх — "99112233 маргааш 14:00 лазер"\n` +
      `Өнөөдөр хэн ажиллаж байна — "өнөөдөр хэн ажиллаж байна"\n` +
      `Бүх артист — "артистууд"\n` +
      `Шинэ артист/код — "код үүсгэ"\n\n` +
      `Юу хийх вэ?`
    );
  }
  // Артист — өөрийн хуваарь, захиалга.
  return (
    `Сайн уу, ${artist.name}!\n\n` +
    `Би чамд дараах зүйлд туслана:\n` +
    `Ажлын цаг — "Да–Ба 10–20"\n` +
    `Амрах — "маргааш амарна" / "10–14 амарна"\n` +
    `Захиалга — "өнөөдрийн захиалга"\n` +
    `Профайл — "миний мэдээлэл"\n\n` +
    `Юу хийх вэ?`
  );
}

/** Хуваарийг ойлгомжтой текст болгох. */
function scheduleText(artist) {
  const sched = artist.weeklySchedule || {};
  const parts = DAY_KEYS.filter((d) => sched[d]?.start).map(
    (d) => `${DAY_LABEL[d]} ${sched[d].start}–${sched[d].end}`,
  );
  return parts.length ? parts.join(", ") : "(хуваарь тохируулаагүй)";
}

function buildSystemPrompt(artist) {
  // Одоохондоо менежер өөрөө ресепшн хийдэг тул хоёуланд ижил эрх.
  const isManager = artist.role === "manager" || artist.role === "reception";
  const services = (artist.serviceIds || []).join(", ") || "(хуваарилаагүй)";
  const roleLine = isManager
    ? `Энэ хэрэглэгч бол МЕНЕЖЕР — бусад артистыг хянах, шинэ код үүсгэх, артист идэвхгүй болгох эрхтэй. ` +
      `Мөн өөрөө артист хийвэл өөрийн хуваараа тохируулж болно.`
    : `Энэ хэрэглэгч бол АРТИСТ — зөвхөн өөрийн хуваарь, амралт, захиалгатай ажиллана.`;

  return (
    `Чи бол ${config.salonName}-ийн артистуудад зориулсан туслах AI. Монгол хэлээр товч, найрсаг харилц. ` +
    `Хэрэглэгчийн нэр: ${artist.name || "(нэргүй)"}, role: ${artist.role}.\n${roleLine}\n\n` +
    `Дүрэм:\n` +
    `• Ажиллах цаг: "Да–Ба 10–18" гэх мэт хэлвэл set_working_hours-оор хадгал. Гаригийг mon,tue,wed,` +
    `thu,fri,sat,sun болгон хөрвүүл (Да=mon, Мя=tue, Лх=wed, Пү=thu, Ба=fri, Бя=sat, Ня=sun). ` +
    `Цагийг HH:mm (жишээ "10"→"10:00").\n` +
    `• Амралт: "маргааш амарна", "10–14-нд амарна", "дараа 7 хоног амарна" гэвэл request_time_off ` +
    `ашигла (dates эсвэл startDate+days). 1–3 хоног ШУУД батлагдана; 3-аас ДЭЭШ хоног бол үндсэн ` +
    `админы зөвшөөрөл шаардагдах тул "зөвшөөрөл хүлээж байна" гэдгийг эелдэг хэл.\n` +
    `• Захиалга асуувал list_my_bookings-оор хараад товч жагсаа.\n` +
    (isManager
      ? `• Менежер "бүх артист", "өнөөдөр хэн ачаалалтай вэ", "шинэ артист нэм/код үүсгэ" гэвэл ` +
        `list_all_artists / day_overview / create_artist_invite-ийг ашигла. Код үүсгэвэл кодыг тодорхой хэл.\n` +
        `• УТСААР/ГАРААР ирсэн захиалга бүртгэх: list_services-ээр id аваад add_booking-оор бүртгэ ` +
        `(утас, serviceId, огноо YYYY-MM-DD, цаг HH:mm; артистыг зааж өгвөл list_all_artists-ээс artistId ав). ` +
        `Оноосон артист + бусад менежер рүү мэдэгдэнэ.\n`
      : "") +
    `• ⛔ Зохиож болохгүй: зөвхөн tool-оос ирсэн бодит өгөгдөл дээр тулгуурла.\n` +
    `• Үйлдэл бүрийн дараа юу өөрчлөгдсөнийг товч баталгаажуулж хэл.\n\n` +
    `Хийдэг үйлчилгээ: ${services}.\n` +
    `Өнөөдөр: ${ubDate(0)} (${DAY_LABEL[dayKeyOf(ubDate(0))]}).`
  );
}

async function runTool(name, input, ctx) {
  const artist = ctx.artist;
  const isManager = artist.role === "manager" || artist.role === "reception";

  switch (name) {
    // ───────── Хувийн ─────────
    case "get_my_profile": {
      const me = await repository.getArtist(artist.id);
      return {
        name: me.name,
        role: me.role,
        serviceIds: me.serviceIds || [],
        schedule: scheduleText(me),
        timeOff: me.timeOff || [],
        active: me.active,
      };
    }
    case "set_working_hours": {
      const me = await repository.getArtist(artist.id);
      const weeklySchedule = { ...(me.weeklySchedule || {}) };
      for (const d of input.days) weeklySchedule[d] = { start: input.start, end: input.end };
      const updated = await repository.updateArtist(artist.id, { weeklySchedule });
      await syncScheduleSafe();
      return { ok: true, schedule: scheduleText(updated) };
    }
    case "clear_working_day": {
      const me = await repository.getArtist(artist.id);
      const weeklySchedule = { ...(me.weeklySchedule || {}) };
      for (const d of input.days) delete weeklySchedule[d];
      const updated = await repository.updateArtist(artist.id, { weeklySchedule });
      await syncScheduleSafe();
      return { ok: true, schedule: scheduleText(updated) };
    }
    case "request_time_off": {
      // Огноонуудыг цуглуулах: dates эсвэл startDate+days
      let dates = Array.isArray(input.dates) ? input.dates.slice() : [];
      if (input.startDate && input.days) dates = dateRange(input.startDate, input.days);
      else if (input.startDate && !dates.length) dates = [input.startDate];
      dates = [...new Set(dates)].sort();
      if (!dates.length) return { ok: false, error: "Амрах өдрөө тодорхой хэлнэ үү." };

      // 1–3 хоног → шууд батлагдана
      if (dates.length <= config.maxSelfDayOff) {
        const me = await repository.getArtist(artist.id);
        const timeOff = [...new Set([...(me.timeOff || []), ...dates])];
        await repository.updateArtist(artist.id, { timeOff });
        await syncScheduleSafe();
        return { ok: true, approved: true, dates, note: `${dates.length} хоног амралт шууд батлагдлаа.` };
      }

      // 3-аас дээш → үндсэн админы зөвшөөрөл
      const req = await repository.createTimeOffRequest({
        artistId: artist.id,
        artistName: artist.name,
        dates,
      });

      // Админд: энэ долоо хоногийн хуваарь + хүсэлт + зөвшөөрөл асуух (HTML)
      const weekTable = weekTelegramText(await buildWeekData());
      const msg =
        `🏖️ <b>Амралтын хүсэлт</b>\n\n` +
        `<b>${escHtml(artist.name)}</b> артист <b>${dates.length} хоног</b> амрахыг хүсэж байна:\n` +
        `${escHtml(dates.join(", "))}\n\n` +
        `📅 Энэ долоо хоногийн хуваарь:\n<pre>${escHtml(weekTable)}</pre>\n` +
        `Зөвшөөрөх үү? Admin AI-д «батал ${req.id}» эсвэл «татгалз ${req.id}» гэж бичнэ үү.\n` +
        `🆔 ${req.id}`;
      await notifyAdmins(msg, "HTML");

      return {
        ok: true,
        approved: false,
        pending: true,
        dates,
        note: `${dates.length} хоног (3-аас дээш) тул үндсэн админы зөвшөөрөл хүлээж байна. Шийдэгдмэгц мэдэгдэнэ.`,
      };
    }
    case "clear_day_off": {
      const me = await repository.getArtist(artist.id);
      const timeOff = (me.timeOff || []).filter((d) => d !== input.date);
      await repository.updateArtist(artist.id, { timeOff });
      await syncScheduleSafe();
      return { ok: true, timeOff };
    }
    case "list_my_bookings": {
      const date = resolveWhen(input.when);
      const me = await repository.getArtist(artist.id);
      const bookings = (await repository.listBookings({ artistId: artist.id, date })).filter(
        (b) => b.status !== "cancelled",
      );
      const working = artistDaySlots(me, date).length > 0;
      const free = working ? await artistAvailableSlots(me, date) : [];
      return {
        date,
        working,
        bookings: bookings
          .sort((a, b) => a.time.localeCompare(b.time))
          .map((b) => ({ time: b.time, service: b.serviceName, phone: b.phone })),
        freeSlots: free,
      };
    }

    // ───────── Менежерийн ─────────
    case "list_all_artists": {
      if (!isManager) return { ok: false, error: "Энэ үйлдэлд менежерийн эрх шаардлагатай." };
      const artists = await repository.listArtists({});
      return artists.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        serviceIds: a.serviceIds || [],
        registered: Boolean(a.psid),
        pendingCode: a.regCode || null,
        schedule: scheduleText(a),
        active: a.active,
      }));
    }
    case "create_artist_invite": {
      if (!isManager) return { ok: false, error: "Энэ үйлдэлд менежерийн эрх шаардлагатай." };
      const { artist: created, code } = await createArtistInvite(input);
      return {
        ok: true,
        artistId: created.id,
        name: created.name,
        role: created.role,
        code,
        note: `Энэ кодыг (${code}) тухайн хүнд өг. Артистын хуудас руу илгээхэд бүртгэл идэвхжинэ.`,
      };
    }
    case "day_overview": {
      if (!isManager) return { ok: false, error: "Энэ үйлдэлд менежерийн эрх шаардлагатай." };
      const date = resolveWhen(input.when);
      const artists = await repository.listArtists({ active: true });
      const rows = [];
      for (const a of artists) {
        const booked = (await repository.listBookings({ artistId: a.id, date })).filter(
          (b) => b.status !== "cancelled",
        );
        const working = artistDaySlots(a, date).length > 0;
        const free = working ? (await artistAvailableSlots(a, date)).length : 0;
        rows.push({ name: a.name, booked: booked.length, free, working });
      }
      rows.sort((x, y) => y.booked - x.booked);
      return { date, artists: rows };
    }
    case "set_artist_active": {
      if (!isManager) return { ok: false, error: "Энэ үйлдэлд менежерийн эрх шаардлагатай." };
      const updated = await repository.updateArtist(input.artistId, { active: input.active });
      return updated
        ? { ok: true, name: updated.name, active: updated.active }
        : { ok: false, error: "Артист олдсонгүй." };
    }
    case "list_services": {
      if (!isManager) return { ok: false, error: "Энэ үйлдэлд менежерийн эрх шаардлагатай." };
      const services = await repository.listServices({ activeOnly: false });
      return services.map((s) => ({ id: s.id, name: s.name, price: s.price, active: s.active }));
    }
    case "add_booking": {
      if (!isManager) return { ok: false, error: "Энэ үйлдэлд менежерийн эрх шаардлагатай." };
      try {
        const { booking } = await createBooking({
          phone: input.phone,
          serviceId: input.serviceId,
          date: input.date,
          time: input.time,
          artistId: input.artistId,
          override: true, // гараар бүртгэх тул слот шалгалтыг алгасна
        });
        return { ok: true, summary: bookingSummary(booking), bookingId: booking.id };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    }

    default:
      return { ok: false, error: `Үл мэдэгдэх tool: ${name}` };
  }
}

/**
 * Артист/менежерийн нэг мессежийг боловсруулах.
 * @param {object} p
 * @param {string} p.psid — Messenger ID (артистын хуудас дээрх)
 * @param {string} p.text
 * @returns {Promise<string>}
 */
export async function handleArtistMessage({ psid, text }) {
  let artist = await repository.getArtistByPsid(psid);

  // Бүртгэлгүй → кодоор баталгаажуулах.
  if (!artist) {
    const code = extractCode(text);
    if (code) {
      const claimed = await claimArtistByCode(psid, code);
      if (claimed) {
        const roleWord =
          claimed.role === "manager" ? "менежер" : claimed.role === "reception" ? "хүлээн авагч" : "артист";
        return (
          `✅ Тавтай морил, ${claimed.name}! Та ${roleWord}аар амжилттай бүртгэгдлээ 🌸\n\n` +
          `Одоо надад ажиллах цагаа хэлээрэй. Жишээ нь: "Да–Ба 10–18 цагт ажиллана".`
        );
      }
      return "Код буруу эсвэл аль хэдийн ашиглагдсан байна. Менежерээсээ шинэ код аваарай.";
    }
    return (
      `Сайн байна уу! 🌸 Та бүртгэлгүй байна.\n\n` +
      `Менежерээс авсан 6 оронтой кодоо надад илгээнэ үү. Тэгвэл бүртгэл идэвхжинэ.`
    );
  }

  // Идэвхгүй болгосон бол
  if (!artist.active) {
    return "Таны бүртгэл идэвхгүй байна. Менежертэйгээ холбогдоно уу.";
  }

  // "home" → артист юу хийж чадахыг товч танилцуулна
  if (["home", "цэс"].includes(text.trim().toLowerCase())) {
    return artistHomeText(artist);
  }

  const isStaff = artist.role === "manager" || artist.role === "reception";
  const tools = isStaff ? [...PERSONAL_TOOLS, ...MANAGER_TOOLS] : PERSONAL_TOOLS;
  // ⚠️ Хадгалсан түүхийг ХУУЛЖ, эхнээс нь цэвэрлэнэ (reference-ээр эвдэхгүй).
  const history = sanitizeHistory([...(artistConversations.get(psid) || [])]);
  history.push({ role: "user", content: text });

  const system = buildSystemPrompt(artist);
  const ctx = { artist };
  let reply = "";

  try {
    for (let i = 0; i < 6; i++) {
      const message = await createMessage({
        system,
        messages: history,
        tools,
        maxTokens: 1500,
        model: config.adminModel,
      });
      history.push({ role: "assistant", content: message.content });

      const toolUses = extractToolUses(message);
      if (message.stop_reason !== "tool_use" || !toolUses.length) {
        reply = extractText(message);
        break;
      }

      const results = [];
      for (const tu of toolUses) {
        let output;
        try {
          output = await runTool(tu.name, tu.input, ctx);
        } catch (err) {
          output = { ok: false, error: String(err.message || err) };
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(output) });
      }
      history.push({ role: "user", content: results });
    }
  } catch (err) {
    console.error("[artist] AI алдаа:", err?.message || err);
    artistConversations.delete(psid);
    return "Түр алдаа гарлаа. Дахин бичнэ үү.";
  }

  if (reply) {
    artistConversations.set(psid, sanitizeHistory(history).slice(-MAX_HISTORY));
  } else {
    artistConversations.delete(psid);
  }
  return reply || "Ойлгосон.";
}

/** Түүхийг эхнээс нь цэвэрлэх: жинхэнэ хэрэглэгчийн (string) мессежээс эхлүүлнэ. */
function sanitizeHistory(h) {
  const arr = h.slice();
  while (arr.length && !(arr[0].role === "user" && typeof arr[0].content === "string")) {
    arr.shift();
  }
  return arr;
}
