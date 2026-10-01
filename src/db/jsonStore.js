// ─────────────────────────────────────────────────────────────
//  In-memory / JSON хадгалалт — ХӨГЖҮҮЛЭЛТИЙН ЗОРИУЛАЛТТАЙ.
//
//  ⚠️ Vercel бол serverless: файлын систем түр зуурынх учраас энэ store нь
//     process дахин эхлэх бүрт seed рүүгээ буцна (өгөгдөл ТОГТВОРТОЙ ХАДГАЛАГДАХГҮЙ).
//     Production дээр үүнийг hosted DB (Neon / Supabase / Vercel Postgres)-ийн
//     ижил интерфейстэй хэрэгжүүлэлтээр солино. repository.js-д зөвхөн нэг
//     мөр солиход хангалттай байхаар зохион байгуулсан.
// ─────────────────────────────────────────────────────────────

import { seedServices } from "../data/services.js";

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

  return {
    kind: "json-memory",

    // ───────── Үйлчилгээ (services) ─────────
    async listServices({ activeOnly = true } = {}) {
      return services.filter((s) => (activeOnly ? s.active : true)).map(clone);
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
      return result.map(clone);
    },

    async updateBooking(id, patch) {
      const i = bookings.findIndex((x) => x.id === id);
      if (i === -1) return null;
      bookings[i] = { ...bookings[i], ...patch, id };
      return clone(bookings[i]);
    },
  };
}
