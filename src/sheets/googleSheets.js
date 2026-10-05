// ─────────────────────────────────────────────────────────────
//  Google Sheets — артистуудын ажиллах хуваарийг ойлгомжтой хүснэгтээр гаргах.
//
//  Service account-аар баталгаажиж, тохируулсан хуудас (GOOGLE_SHEET_ID) руу
//  артист бүрийн 7 хоногийн цаг, амралт, хийдэг үйлчилгээг бичнэ.
//  Хуваарь өөрчлөгдөх бүрт автоматаар шинэчилнэ (тохируулаагүй бол чимээгүй алгасна).
// ─────────────────────────────────────────────────────────────

import { google } from "googleapis";
import { config } from "../config.js";
import { repository } from "../db/repository.js";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL = { mon: "Да", tue: "Мя", wed: "Лх", thu: "Пү", fri: "Ба", sat: "Бя", sun: "Ня" };

/** Google Sheets тохируулагдсан эсэх. */
export function isSheetsConfigured() {
  return Boolean(config.googleServiceAccountEmail && config.googlePrivateKey && config.googleSheetId);
}

function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: config.googleServiceAccountEmail,
    key: config.googlePrivateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/** Улаанбаатарын цагаар "YYYY-MM-DD HH:mm". */
function ubNow() {
  const ub = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return ub.toISOString().slice(0, 16).replace("T", " ");
}

/** Артистуудын хуваарийг хүснэгтийн мөрүүд болгон бэлдэх. */
async function buildValues() {
  const [artists, services] = await Promise.all([
    repository.listArtists({}),
    repository.listServices({ activeOnly: false }),
  ]);
  const nameById = new Map(services.map((s) => [s.id, s.name]));

  const header = [
    "Артист",
    "Эрх",
    ...DAY_KEYS.map((d) => DAY_LABEL[d]),
    "Амралтын өдрүүд",
    "Хийдэг үйлчилгээ",
    "Идэвхтэй",
  ];

  const rows = artists
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((a) => {
      const sched = a.weeklySchedule || {};
      const dayCells = DAY_KEYS.map((d) => (sched[d]?.start ? `${sched[d].start}–${sched[d].end}` : "—"));
      const svc = (a.serviceIds || []).map((id) => nameById.get(id) || id).join(", ") || "—";
      return [
        a.name || "—",
        a.role === "manager" ? "Менежер" : "Артист",
        ...dayCells,
        (a.timeOff || []).join(", ") || "—",
        svc,
        a.active ? "Тийм" : "Үгүй",
      ];
    });

  return [[`Артистын ажиллах хуваарь — шинэчилсэн: ${ubNow()}`], header, ...rows];
}

/** Эхний хуудсыг (gid) бага зэрэг гоёх: толгой мөр тод, хөлдөөх. Алдвал чимээгүй алгасна. */
async function tryFormat(sheets) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: config.googleSheetId });
    const sheetId = meta.data.sheets?.[0]?.properties?.sheetId ?? 0;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.googleSheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 1, endRowIndex: 2 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: "userEnteredFormat.textFormat.bold",
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 } },
              fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
            },
          },
        ],
      },
    });
  } catch {
    /* гоёл заавал биш — алгасна */
  }
}

/**
 * Артистуудын хуваарийг Google Sheet руу бичих.
 * @returns {Promise<{ok:boolean, rows?:number, skipped?:boolean, error?:string}>}
 */
export async function syncScheduleToSheet() {
  if (!isSheetsConfigured()) return { ok: false, skipped: true };
  try {
    const sheets = getSheetsClient();
    const values = await buildValues();

    await sheets.spreadsheets.values.clear({
      spreadsheetId: config.googleSheetId,
      range: "A1:Z1000",
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.googleSheetId,
      range: "A1",
      valueInputOption: "RAW",
      requestBody: { values },
    });
    await tryFormat(sheets);

    return { ok: true, rows: values.length - 2 };
  } catch (err) {
    console.error("[sheets] sync алдаа:", err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Хаана ч await хүлээхгүйгээр хуваарийг чимээгүй шинэчлэх (fire-and-forget). */
export function syncScheduleSafe() {
  return syncScheduleToSheet().catch(() => {});
}
