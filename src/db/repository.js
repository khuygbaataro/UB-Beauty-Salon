// ─────────────────────────────────────────────────────────────
//  Repository — өгөгдлийн давхаргын цорын ганц хандах цэг.
//
//  Бүх модуль өгөгдөлд ЗӨВХӨН энэ файлаар дамжин хандана. Ингэснээр
//  доорх store-ийг солиход (JSON → Postgres) бусад кодыг өөрчлөх
//  шаардлагагүй болно.
//
//  Хэрэгжүүлэлт солих: createJsonStore()-ийг ижил интерфейстэй
//  createPostgresStore() гэх мэтээр солино.
//
//  Интерфейс (бүх метод Promise буцаана):
//    listServices({activeOnly})      → Service[]
//    getService(id)                  → Service | null
//    createService(data)             → Service
//    updateService(id, patch)        → Service | null
//    deleteService(id)               → boolean
//    findServiceByRef(ref)           → Service | null   (FB контент тааруулах)
//    createBooking(data)             → Booking
//    getBooking(id)                  → Booking | null
//    listBookings(filter)            → Booking[]
//    updateBooking(id, patch)        → Booking | null
// ─────────────────────────────────────────────────────────────

import { createJsonStore } from "./jsonStore.js";

let store = null;

function getStore() {
  if (!store) {
    // TODO(production): энд createPostgresStore()-оор солино.
    store = createJsonStore();
  }
  return store;
}

/** FB постын ref / ad referral / чөлөөт текстээс үйлчилгээг таних. */
async function findServiceByRef(ref) {
  if (!ref) return null;
  const needle = String(ref).toLowerCase().trim();
  const services = await getStore().listServices({ activeOnly: true });

  // 1) id-аар шууд таарах
  const byId = services.find((s) => s.id.toLowerCase() === needle);
  if (byId) return byId;

  // 2) refKeys түлхүүрүүдээр хэсэгчилсэн таарал
  for (const s of services) {
    const keys = (s.refKeys || []).map((k) => k.toLowerCase());
    if (keys.some((k) => needle.includes(k) || k.includes(needle))) return s;
  }
  return null;
}

export const repository = {
  // Services
  listServices: (opts) => getStore().listServices(opts),
  getService: (id) => getStore().getService(id),
  createService: (data) => getStore().createService(data),
  updateService: (id, patch) => getStore().updateService(id, patch),
  deleteService: (id) => getStore().deleteService(id),
  findServiceByRef,

  // Bookings
  createBooking: (data) => getStore().createBooking(data),
  getBooking: (id) => getStore().getBooking(id),
  listBookings: (filter) => getStore().listBookings(filter),
  updateBooking: (id, patch) => getStore().updateBooking(id, patch),

  // Диагностик
  get kind() {
    return getStore().kind;
  },
};
