// ─────────────────────────────────────────────────────────────
//  Төлбөрийн модуль — ОДООГООР STUB (идэвхгүй).
//
//  Зорилго: дараа нь QPay / банкны интеграцийг ЗАЛГАХАД БЭЛЭН интерфейс.
//  Доорх PaymentProvider интерфейсийг хэрэгжүүлсэн нэг файл нэмээд,
//  getPaymentProvider()-д сольж өгөхөд бусад кодыг өөрчлөх шаардлагагүй.
//
//  Интерфейс:
//    createInvoice(booking)  → { ok, provider, instructions, invoiceId?, qr? }
//    checkStatus(invoiceId)  → { paid: boolean }
//    refund(booking)         → { ok, refundId? }
// ─────────────────────────────────────────────────────────────

/**
 * Гар шилжүүлгийн provider — төлбөрийн API холбогдох хүртэлх түр шийдэл.
 * Үйлчлүүлэгчид дансны мэдээлэл + гүйлгээний утгыг заавар болгож өгнө.
 */
const manualTransferProvider = {
  name: "manual-transfer",

  async createInvoice(booking) {
    return {
      ok: true,
      provider: this.name,
      invoiceId: null,
      qr: null,
      // ⚠️ Дансны мэдээллийг дараа нь тохиргооноос авна. Одоогоор placeholder.
      instructions:
        `Урьдчилгаа төлбөрөө шилжүүлнэ үү.\n` +
        `Гүйлгээний утга: ${booking.paymentMemo}\n` +
        `(Дансны мэдээлэл нэмэгдэнэ.)`,
    };
  },

  async checkStatus(_invoiceId) {
    // Гар шилжүүлгийн үед ажилтан/Admin AI баталгаажуулна.
    return { paid: false, manual: true };
  },

  async refund(_booking) {
    return { ok: false, manual: true, note: "Буцаалтыг ажилтан гараар хийнэ." };
  },
};

/**
 * Идэвхтэй provider-ийг буцаана.
 * Ирээдүйд: process.env.PAYMENT_PROVIDER === "qpay" ? qpayProvider : manualTransferProvider
 */
export function getPaymentProvider() {
  return manualTransferProvider;
}
