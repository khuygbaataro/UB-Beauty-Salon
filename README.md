# UB Beauty Salon — Chatbot (суурь бүтэц)

Facebook Messenger дээр ажилладаг гоо сайхны салоны чатбот. **2 тусдаа AI**-тай:

1. **Үйлчлүүлэгчийн AI** — Facebook-ийн контент (пост/зар)-оос орж ирсэн хэрэглэгчтэй харилцана. Аль үйлчилгээнээс ирснийг ялгаж, тухайн үйлчилгээг онцолсон мэндчилгээ өгч, цаг захиалга авна.
2. **Admin AI** — ажилчидтай (Telegram/Messenger) харилцаж, мэдээллийн санг хөгжүүлэх (үнэ/тайлбар нэмэх) болон гараар ирсэн цаг захиалгыг бүртгэнэ.

> Технологи: **Node.js + Express**, **Vercel** (serverless) дээр ажиллана. AI тархи: **Anthropic Claude** (`@anthropic-ai/sdk`).

---

## Боломжууд (энэ үе шатанд бэлэн)

- ✅ Контентоос хамаарсан ухаалаг мэндчилгээ (FB `ref`/postback → үйлчилгээ таних)
- ✅ 5 үйлчилгээний мэдээллийн сан (нэмэлт сонголт, хэсгийн үнэ зэргийг дэмжсэн бүтэц)
- ✅ Цаг захиалга — утас + үйлчилгээ + огноо/цаг тодруулж, **гүйлгээний утга = `цаг, өдөр, утас`**
- ✅ Цаг цуцлах бодлого — **4+ цагийн өмнө** мэдэгдвэл урьдчилгаа буцаана
- ✅ Цаг сануулагч — Vercel Cron-оор захиалгатай цагаас өмнө (default 24 цаг) сануулна
- ✅ Admin AI — үйлчилгээ засах/нэмэх, гараар захиалга бүртгэх
- 🔧 Төлбөр — одоогоор **stub** (гар шилжүүлгийн заавар). QPay зэргийг дараа залгахад бэлэн

---

## Файлын бүтэц

```
api/index.js              Vercel serverless entry (Express апп-ыг экспортлоно)
local-dev.js              Локал хөгжүүлэлтийн сервер
vercel.json               Vercel route + Cron тохиргоо
.env.example              Орчны хувьсагчдын жишээ

src/
  app.js                  Express route-ууд (webhook, admin, cron)
  config.js               Төвлөрсөн тохиргоо
  ai/anthropic.js         Anthropic SDK wrapper
  data/services.js        5 үйлчилгээний seed өгөгдөл
  db/
    repository.js         Өгөгдлийн давхаргын цорын ганц хандах цэг (DB солихоор)
    jsonStore.js          Одоогийн хэрэгжүүлэлт (in-memory — dev зориулалттай)
  customer/
    greeting.js           Контентоос хамаарсан мэндчилгээ
    customerAgent.js      Үйлчлүүлэгчийн AI (tool-use)
  admin/
    adminAgent.js         Admin AI (tool-use)
  booking/
    booking.js            Захиалга үүсгэх, гүйлгээний утга
    cancellation.js       4 цагийн цуцлалтын дүрэм
  reminders/reminders.js  Сануулга илгээх (cron-оор)
  messenger/sendApi.js    Messenger Send API
  payment/index.js        Төлбөрийн интерфейс (stub)
```

---

## ⚠️ Чухал: Vercel + мэдээллийн сан

Vercel бол serverless — **файлын систем түр зуурынх**. Одоогийн `jsonStore` нь in-memory тул
process дахин эхлэх бүрт өгөгдөл устана. **Production-д заавал hosted DB** (Neon / Supabase /
Vercel Postgres) руу шилжүүлнэ. Үүний тулд `src/db/jsonStore.js`-тэй ижил интерфейстэй
`createPostgresStore()` бичээд `src/db/repository.js` доторх нэг мөрийг солиход хангалттай.
Бусад код өөрчлөгдөхгүй.

Мөн ярианы түүх (conversation history) одоогоор in-memory Map-д хадгалагдаж байгаа тул үүнийг
ч DB рүү зөөх шаардлагатай (код дотор `TODO` гэж тэмдэглэсэн).

---

## Локал ажиллуулах

```bash
npm install
cp .env.example .env    # дараа нь .env-ээ бөглөнө (ANTHROPIC_API_KEY г.м.)
npm run dev
```

Шалгах: `http://localhost:3000/` → `{ "ok": true, ... }`

---

## Vercel дээр deploy хийх

1. Git repo-той холбоод Vercel дээр import хийнэ.
2. **Environment Variables** дотор `.env.example`-ийн утгуудыг оруулна.
3. Facebook App → Messenger → Webhook URL: `https://<domain>/webhook`, Verify Token: `FB_VERIFY_TOKEN`.
4. Telegram bot webhook: `https://<domain>/admin/telegram` (setWebhook).
5. Cron нь `vercel.json`-д тохируулагдсан (`/cron/reminders`, 15 минут тутам).

---

## Үйлчилгээ таних (FB контент → мэндчилгээ)

Facebook пост/зарын **m.me** холбоос эсвэл ad referral дээр `ref` утга дамжуулна. Жишээ:

```
m.me/<page-username>?ref=green-peel
```

`src/data/services.js` доторх `refKeys` жагсаалтаар `ref`-ийг үйлчилгээтэй тааруулна.
Таарвал тухайн үйлчилгээг онцолсон мэндчилгээ, таараагүй бол ерөнхий мэндчилгээ өгнө.

---

## Дараагийн алхмууд (дараа нэмэх)

- [ ] GREEN PEEL, La Vie-ийн үнэ/дэлгэрэнгүйг оруулах (Admin AI-аар)
- [ ] hosted DB (Postgres) холбох
- [ ] Төлбөрийн систем (QPay г.м.) залгах
- [ ] Ярианы түүхийг DB-д хадгалах
- [ ] Нэмэлт мэдээллүүдийг оруулах (та өгнө)
