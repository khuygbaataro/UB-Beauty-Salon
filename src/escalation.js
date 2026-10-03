// ─────────────────────────────────────────────────────────────
//  Escalation (хүн-AI хослол):
//   • Бот мэдэхгүй асуултыг ажилтанд (Telegram) дамжуулна
//   • Ажилтан хариулахад → тухайн үйлчлүүлэгч рүү чатаар буцаана
//   • Хариултыг мэдлэгийн санд (knowledge) хадгалж, бот цаашид өөрөө хариулна
// ─────────────────────────────────────────────────────────────

import { repository } from "./db/repository.js";
import { notifyAdmins } from "./admin/telegramSend.js";
import { sendText } from "./messenger/sendApi.js";

/** Мэдэгдлийн текст доторх асуултын ID-г таних marker. */
const QID_RE = /\b(q_[a-z0-9]+)\b/;

export function parseQid(text) {
  const m = String(text || "").match(QID_RE);
  return m ? m[1] : null;
}

function notificationText(q) {
  return (
    `🔔 Шинэ асуулт (үйлчлүүлэгчээс)\n\n` +
    `❓ ${q.question}\n\n` +
    `👉 Хариулахын тулд ЭНЭ мессеж рүү Reply хийж, хариугаа бичнэ үү.\n` +
    `🆔 ${q.id}`
  );
}

/**
 * Асуултыг ажилтанд дамжуулах.
 * @param {object} p
 * @param {string} p.psid     — үйлчлүүлэгчийн Messenger ID
 * @param {string} p.question — асуултын текст
 */
export async function escalateQuestion({ psid, question }) {
  const q = await repository.createQuestion({ psid, question });
  await notifyAdmins(notificationText(q));
  return q;
}

/**
 * Асуултад хариулах: үйлчлүүлэгч рүү буцааж, мэдлэгийн санд хадгална.
 * @param {string} questionId
 * @param {string} answer
 * @param {string|number} [answeredBy] — ажилтны Telegram ID
 * @returns {Promise<{ok:boolean, error?:string, psid?:string, question?:string}>}
 */
export async function answerQuestion(questionId, answer, answeredBy = null) {
  const q = await repository.getQuestion(questionId);
  if (!q) return { ok: false, error: "Асуулт олдсонгүй." };
  if (q.status === "answered") return { ok: false, error: "Энэ асуулт аль хэдийн хариулагдсан." };

  await repository.updateQuestion(questionId, {
    status: "answered",
    answer,
    answeredAt: new Date().toISOString(),
    answeredBy: answeredBy != null ? String(answeredBy) : null,
  });

  // Мэдлэгийн санд хадгалах (бот цаашид өөрөө хариулна)
  await repository.addKnowledge({ question: q.question, answer });

  // Үйлчлүүлэгч рүү чатаар буцаах
  if (q.psid) {
    await sendText(
      q.psid,
      `Таны асуултын хариу ирлээ 🌸\n\n❓ ${q.question}\n\n💬 ${answer}`,
    );
  }

  return { ok: true, psid: q.psid, question: q.question };
}

/**
 * Мэдлэгийн сангаас хайх (энгийн түлхүүр үгийн таарал).
 * @param {string} query
 * @returns {Promise<Array<{question:string, answer:string}>>}
 */
export async function searchKnowledge(query) {
  const kb = await repository.listKnowledge();
  if (!kb.length) return [];
  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (!words.length) return [];

  const scored = kb
    .map((k) => {
      const hay = `${k.question} ${k.answer}`.toLowerCase();
      const score = words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
      return { k, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scored.map((x) => ({ question: x.k.question, answer: x.k.answer }));
}
