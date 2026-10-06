// ─────────────────────────────────────────────────────────────
//  Google Sheets — 2 таб:
//   1) Эхний таб: артистуудын 7 хоногийн ажиллах хуваарь
//   2) "Захиалга" таб: энэ долоо хоногт захиалагдсан цагууд (цаг × өдөр календарь)
//
//  Service account-аар баталгаажиж, GOOGLE_SHEET_ID руу бичнэ.
//  Хуваарь/захиалга өөрчлөгдөх бүрт автоматаар шинэчилнэ (тохируулаагүй бол алгасна).
// ─────────────────────────────────────────────────────────────

import { google } from "googleapis";
import { config } from "../config.js";
import { buildWeekData, weekSheetValues, buildBookingsGrid } from "../schedule/weekView.js";

const BOOKINGS_TAB = "Захиалга";

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

/** Нэртэй таб олох; байхгүй бол үүсгэж sheetId-г буцаах. */
async function ensureTab(sheets, title, meta) {
  const m = meta || (await sheets.spreadsheets.get({ spreadsheetId: config.googleSheetId }));
  const found = m.data.sheets.find((s) => s.properties.title === title);
  if (found) return found.properties.sheetId;
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.googleSheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

/** Нэг табыг цэвэрлэж, утга бичиж, толгой мөр тод + мөр/багана хөлдөөх. */
async function writeTab(sheets, title, sheetId, values) {
  const q = `'${title.replace(/'/g, "''")}'!`;
  await sheets.spreadsheets.values.clear({ spreadsheetId: config.googleSheetId, range: `${q}A1:Z1000` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheetId,
    range: `${q}A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  // Гоёл (заавал биш) — толгой мөр (2-р мөр) тод + эхний 2 мөр, 1-р багана хөлдөөх.
  await sheets.spreadsheets
    .batchUpdate({
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
    })
    .catch(() => {});
}

/**
 * Хуваарь (эхний таб) + захиалга ("Захиалга" таб)-г Google Sheet руу бичих.
 * @returns {Promise<{ok:boolean, rows?:number, bookings?:number, skipped?:boolean, error?:string}>}
 */
export async function syncScheduleToSheet() {
  if (!isSheetsConfigured()) return { ok: false, skipped: true };
  try {
    const sheets = getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: config.googleSheetId });
    const first = meta.data.sheets[0].properties;

    // 1) Хуваарь → эхний таб
    const schedValues = weekSheetValues(await buildWeekData(), ubNow());
    await writeTab(sheets, first.title, first.sheetId, schedValues);

    // 2) Захиалга → "Захиалга" таб
    const bk = await buildBookingsGrid();
    const bkValues = [
      [`Энэ долоо хоногийн захиалга: ${bk.title} — шинэчилсэн ${ubNow()}`],
      bk.header,
      ...bk.rows,
    ];
    const bkId = await ensureTab(sheets, BOOKINGS_TAB, meta);
    await writeTab(sheets, BOOKINGS_TAB, bkId, bkValues);

    return { ok: true, rows: schedValues.length - 2, bookings: bk.rows.length };
  } catch (err) {
    console.error("[sheets] sync алдаа:", err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Хаана ч await хүлээхгүйгээр чимээгүй шинэчлэх (fire-and-forget). */
export function syncScheduleSafe() {
  return syncScheduleToSheet().catch(() => {});
}
