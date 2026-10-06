// ─────────────────────────────────────────────────────────────
//  In-memory / JSON хадгалалт — ХӨГЖҮҮЛЭЛТИЙН ЗОРИУЛАЛТТАЙ.
//
//  ⚠️ Vercel бол serverless: файлын систем түр зуурынх учраас энэ store нь
//     process дахин эхлэх бүрт seed рүүгээ буцна (өгөгдөл ТОГТВОРТОЙ ХАДГАЛАГДАХГҮЙ).
//     Production дээр үүнийг hosted DB (Neon / Supabase / Vercel Postgres)-ийн
//     ижил интерфейстэй хэрэгжүүлэлтээр солино. repository.js-д зөвхөн нэг
//     мөр солиход хангалттай байхаар зохион байгуулсан.
// ─────────────────────────────────────────────────────────────

import { seedServices, serviceRank } from "../data/services.js";

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createJsonStore() {
  // seed-ээс хуулж авна (seed-ийг гэмтээхгүйн тулд)
  const services = clone(seedServices);
  const bookings = [];
  const artists = []; // артистууд (хуваарьтай ажилтан)
  const timeOffRequests = []; // артистын амралтын хүсэлт (зөвшөөрөл шаардсан)
  const questions = []; // escalation: ажилтанд дамжуулсан асуултууд
  const knowledge = []; // мэдлэгийн сан: хариулагдсан Q&A
  const conversations = new Map(); // psid -> messages[]
  const referred = new Map(); // psid -> serviceId
  const settings = new Map(); // ботын тохиргоо (greeting, tone г.м.)

  return {
    kind: "json-memory",

    // ───────── Үйлчилгээ (services) ─────────
    async listServices({ activeOnly = true } = {}) {
      return services
        .filter((s) => (activeOnly ? s.active : true))
        .map(clone)
        .sort((a, b) => serviceRank(a) - serviceRank(b) || String(a.name).localeCompare(String(b.name)));
    },

    async getService(id) {
      const s = services.find((x) => x.id === id);
      return s ? clone(s) : null;
    },

    async createService(data) {
      const svc = { id: data.id || genId("svc"), active: true, variants: [], addons: [], benefits: [], ...data };
      services.push(svc);
      return clone(svc);
    },

    async updateService(id, patch) {
      const i = services.findIndex((x) => x.id === id);
      if (i === -1) return null;
      services[i] = { ...services[i], ...patch, id };
      return clone(services[i]);
    },

    async deleteService(id) {
      const i = services.findIndex((x) => x.id === id);
      if (i === -1) return false;
      services.splice(i, 1);
      return true;
    },

    // ───────── Цаг захиалга (bookings) ─────────
    async createBooking(data) {
      const booking = {
        id: genId("bk"),
        status: "pending", // pending | confirmed | reminded | completed | cancelled
        createdAt: new Date().toISOString(),
        reminderSentAt: null,
        prepaymentPaid: false,
        ...data,
      };
      bookings.push(booking);
      return clone(booking);
    },

    async getBooking(id) {
      const b = bookings.find((x) => x.id === id);
      return b ? clone(b) : null;
    },

    async listBookings(filter = {}) {
      let result = bookings;
      if (filter.status) result = result.filter((b) => b.status === filter.status);
      if (filter.phone) result = result.filter((b) => b.phone === filter.phone);
      if (filter.psid) result = result.filter((b) => b.psid === filter.psid);
      if (filter.artistId) result = result.filter((b) => b.artistId === filter.artistId);
      if (filter.date) result = result.filter((b) => b.date === filter.date);
      return result.map(clone);
    },

    async updateBooking(id, patch) {
      const i = bookings.findIndex((x) => x.id === id);
      if (i === -1) return null;
      bookings[i] = { ...bookings[i], ...patch, id };
      return clone(bookings[i]);
    },

    // ───────── Артистууд (artists) ─────────
    async createArtist(data) {
      const artist = {
        id: data.id || genId("art"),
        psid: null,
        name: "",
        phone: null,
        role: "artist", // artist | manager
        regCode: null, // нэг удаагийн баталгаажуулах код (psid холбогдоход цэвэрлэгдэнэ)
        serviceIds: [], // хийдэг үйлчилгээний id-ууд
        weeklySchedule: {}, // { mon:{start:"10:00",end:"18:00"}, ... }
        timeOff: [], // амралтын тодорхой өдрүүд ["YYYY-MM-DD"]
        active: true,
        createdAt: new Date().toISOString(),
        ...data,
      };
      artists.push(artist);
      return clone(artist);
    },

    async getArtist(id) {
      const a = artists.find((x) => x.id === id);
      return a ? clone(a) : null;
    },

    async getArtistByPsid(psid) {
      const a = artists.find((x) => x.psid === psid);
      return a ? clone(a) : null;
    },

    async getArtistByCode(code) {
      const a = artists.find((x) => x.regCode && x.regCode === code);
      return a ? clone(a) : null;
    },

    async listArtists(filter = {}) {
      let result = artists;
      if (filter.active !== undefined) result = result.filter((a) => a.active === filter.active);
      if (filter.serviceId) result = result.filter((a) => (a.serviceIds || []).includes(filter.serviceId));
      return result.map(clone);
    },

    async updateArtist(id, patch) {
      const i = artists.findIndex((x) => x.id === id);
      if (i === -1) return null;
      artists[i] = { ...artists[i], ...patch, id };
      return clone(artists[i]);
    },

    // ───────── Амралтын хүсэлт (timeOffRequests) ─────────
    async createTimeOffRequest(data) {
      const req = {
        id: genId("tor"),
        status: "pending", // pending | approved | rejected
        createdAt: new Date().toISOString(),
        decidedAt: null,
        decidedBy: null,
        ...data,
      };
      timeOffRequests.push(req);
      return clone(req);
    },
    async getTimeOffRequest(id) {
      const r = timeOffRequests.find((x) => x.id === id);
      return r ? clone(r) : null;
    },
    async listTimeOffRequests(filter = {}) {
      let result = timeOffRequests;
      if (filter.status) result = result.filter((r) => r.status === filter.status);
      if (filter.artistId) result = result.filter((r) => r.artistId === filter.artistId);
      return result.map(clone);
    },
    async updateTimeOffRequest(id, patch) {
      const i = timeOffRequests.findIndex((x) => x.id === id);
      if (i === -1) return null;
      timeOffRequests[i] = { ...timeOffRequests[i], ...patch, id };
      return clone(timeOffRequests[i]);
    },

    // ───────── Escalation асуултууд (questions) ─────────
    async createQuestion(data) {
      const q = {
        id: genId("q"),
        status: "open", // open | answered
        createdAt: new Date().toISOString(),
        answer: null,
        answeredAt: null,
        answeredBy: null,
        ...data,
      };
      questions.push(q);
      return clone(q);
    },

    async getQuestion(id) {
      const q = questions.find((x) => x.id === id);
      return q ? clone(q) : null;
    },

    async listQuestions(filter = {}) {
      let result = questions;
      if (filter.status) result = result.filter((q) => q.status === filter.status);
      return result.map(clone);
    },

    async updateQuestion(id, patch) {
      const i = questions.findIndex((x) => x.id === id);
      if (i === -1) return null;
      questions[i] = { ...questions[i], ...patch, id };
      return clone(questions[i]);
    },

    // ───────── Мэдлэгийн сан (knowledge Q&A) ─────────
    async addKnowledge(data) {
      const k = { id: genId("kb"), createdAt: new Date().toISOString(), ...data };
      knowledge.push(k);
      return clone(k);
    },

    async listKnowledge() {
      return knowledge.map(clone);
    },

    async updateKnowledge(id, patch) {
      const i = knowledge.findIndex((x) => x.id === id);
      if (i === -1) return null;
      knowledge[i] = { ...knowledge[i], ...patch, id };
      return clone(knowledge[i]);
    },

    async deleteKnowledge(id) {
      const i = knowledge.findIndex((x) => x.id === id);
      if (i === -1) return false;
      knowledge.splice(i, 1);
      return true;
    },

    // ───────── Ярианы түүх / referred (хэрэглэгч тус бүр) ─────────
    async getConversation(psid) {
      return clone(conversations.get(psid) || []);
    },
    async setConversation(psid, arr) {
      conversations.set(psid, clone(arr));
    },
    async getReferred(psid) {
      return referred.get(psid) || null;
    },
    async setReferred(psid, serviceId) {
      if (psid && serviceId) referred.set(psid, serviceId);
    },

    // ───────── Тохиргоо (ботын текст/өнгө аяс) ─────────
    async getSetting(key) {
      return settings.has(key) ? settings.get(key) : null;
    },
    async setSetting(key, value) {
      settings.set(key, value);
    },
    async listSettings() {
      return Object.fromEntries(settings);
    },
  };
}
