// ─────────────────────────────────────────────────────────────
//  Redis (Upstash / Vercel KV) хадгалалт — PRODUCTION.
//
//  jsonStore-той ИЖИЛ интерфейстэй. Өгөгдөл Redis дээр тогтвортой
//  хадгалагдана (Vercel serverless дээр cold start-д ч устахгүй).
//
//  Түлхүүрүүд:
//    hash  svc        — үйлчилгээ (id -> object)
//    hash  bk         — захиалга
//    hash  art        — артистууд (хуваарьтай ажилтан)
//    hash  q          — escalation асуултууд
//    hash  kb         — мэдлэгийн сан (Q&A)
//    str   conv:<psid>— ярианы түүх (JSON array), TTL
//    str   ref:<psid> — контентоос ирсэн үйлчилгээний id, TTL
// ─────────────────────────────────────────────────────────────

import { Redis } from "@upstash/redis";
import { seedServices } from "../data/services.js";
import { config } from "../config.js";

const CONV_TTL = 60 * 60 * 24 * 14; // 14 хоног

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function valuesOf(hash) {
  return hash ? Object.values(hash) : [];
}

export function createRedisStore() {
  const redis = new Redis({ url: config.redisUrl, token: config.redisToken });
  let seeded = false;

  // Үйлчилгээний seed-ийг нэг удаа оруулах (хоосон бол)
  async function ensureSeeded() {
    if (seeded) return;
    const count = await redis.hlen("svc");
    if (!count) {
      const entries = {};
      for (const s of seedServices) entries[s.id] = s;
      await redis.hset("svc", entries);
    }
    seeded = true;
  }

  return {
    kind: "redis",

    // ───────── Services ─────────
    async listServices({ activeOnly = true } = {}) {
      await ensureSeeded();
      const arr = valuesOf(await redis.hgetall("svc"));
      return arr.filter((s) => (activeOnly ? s.active : true));
    },
    async getService(id) {
      await ensureSeeded();
      return (await redis.hget("svc", id)) || null;
    },
    async createService(data) {
      const svc = {
        id: data.id || genId("svc"),
        active: true,
        variants: [],
        addons: [],
        benefits: [],
        ...data,
      };
      await redis.hset("svc", { [svc.id]: svc });
      return svc;
    },
    async updateService(id, patch) {
      const cur = await redis.hget("svc", id);
      if (!cur) return null;
      const upd = { ...cur, ...patch, id };
      await redis.hset("svc", { [id]: upd });
      return upd;
    },
    async deleteService(id) {
      return (await redis.hdel("svc", id)) > 0;
    },

    // ───────── Bookings ─────────
    async createBooking(data) {
      const booking = {
        id: genId("bk"),
        status: "pending",
        createdAt: new Date().toISOString(),
        reminderSentAt: null,
        prepaymentPaid: false,
        ...data,
      };
      await redis.hset("bk", { [booking.id]: booking });
      return booking;
    },
    async getBooking(id) {
      return (await redis.hget("bk", id)) || null;
    },
    async listBookings(filter = {}) {
      let arr = valuesOf(await redis.hgetall("bk"));
      if (filter.status) arr = arr.filter((b) => b.status === filter.status);
      if (filter.phone) arr = arr.filter((b) => b.phone === filter.phone);
      if (filter.psid) arr = arr.filter((b) => b.psid === filter.psid);
      if (filter.artistId) arr = arr.filter((b) => b.artistId === filter.artistId);
      if (filter.date) arr = arr.filter((b) => b.date === filter.date);
      return arr;
    },
    async updateBooking(id, patch) {
      const cur = await redis.hget("bk", id);
      if (!cur) return null;
      const upd = { ...cur, ...patch, id };
      await redis.hset("bk", { [id]: upd });
      return upd;
    },

    // ───────── Артистууд ─────────
    async createArtist(data) {
      const artist = {
        id: data.id || genId("art"),
        psid: null,
        name: "",
        phone: null,
        role: "artist", // artist | manager
        regCode: null, // нэг удаагийн баталгаажуулах код
        serviceIds: [],
        weeklySchedule: {},
        timeOff: [],
        active: true,
        createdAt: new Date().toISOString(),
        ...data,
      };
      await redis.hset("art", { [artist.id]: artist });
      return artist;
    },
    async getArtist(id) {
      return (await redis.hget("art", id)) || null;
    },
    async getArtistByPsid(psid) {
      const arr = valuesOf(await redis.hgetall("art"));
      return arr.find((a) => a.psid === psid) || null;
    },
    async getArtistByCode(code) {
      const arr = valuesOf(await redis.hgetall("art"));
      return arr.find((a) => a.regCode && a.regCode === code) || null;
    },
    async listArtists(filter = {}) {
      let arr = valuesOf(await redis.hgetall("art"));
      if (filter.active !== undefined) arr = arr.filter((a) => a.active === filter.active);
      if (filter.serviceId) arr = arr.filter((a) => (a.serviceIds || []).includes(filter.serviceId));
      return arr;
    },
    async updateArtist(id, patch) {
      const cur = await redis.hget("art", id);
      if (!cur) return null;
      const upd = { ...cur, ...patch, id };
      await redis.hset("art", { [id]: upd });
      return upd;
    },

    // ───────── Questions (escalation) ─────────
    async createQuestion(data) {
      const q = {
        id: genId("q"),
        status: "open",
        createdAt: new Date().toISOString(),
        answer: null,
        answeredAt: null,
        answeredBy: null,
        ...data,
      };
      await redis.hset("q", { [q.id]: q });
      return q;
    },
    async getQuestion(id) {
      return (await redis.hget("q", id)) || null;
    },
    async listQuestions(filter = {}) {
      let arr = valuesOf(await redis.hgetall("q"));
      if (filter.status) arr = arr.filter((x) => x.status === filter.status);
      return arr;
    },
    async updateQuestion(id, patch) {
      const cur = await redis.hget("q", id);
      if (!cur) return null;
      const upd = { ...cur, ...patch, id };
      await redis.hset("q", { [id]: upd });
      return upd;
    },

    // ───────── Knowledge ─────────
    async addKnowledge(data) {
      const k = { id: genId("kb"), createdAt: new Date().toISOString(), ...data };
      await redis.hset("kb", { [k.id]: k });
      return k;
    },
    async listKnowledge() {
      return valuesOf(await redis.hgetall("kb"));
    },

    // ───────── Conversations / referred ─────────
    async getConversation(psid) {
      return (await redis.get(`conv:${psid}`)) || [];
    },
    async setConversation(psid, arr) {
      await redis.set(`conv:${psid}`, arr, { ex: CONV_TTL });
    },
    async getReferred(psid) {
      return (await redis.get(`ref:${psid}`)) || null;
    },
    async setReferred(psid, serviceId) {
      if (psid && serviceId) await redis.set(`ref:${psid}`, serviceId, { ex: CONV_TTL });
    },
  };
}
