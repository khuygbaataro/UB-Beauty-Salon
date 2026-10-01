// Локал хөгжүүлэлтийн сервер. Vercel дээр энэ файл хэрэглэгддэггүй
// (тэнд api/index.js serverless хэлбэрээр ажиллана).
//
// Ажиллуулах: `npm run dev`  (эсвэл `node local-dev.js`)
// Орчны хувьсагчдыг .env файлаас уншина (Node 20.6+ --env-file дэмждэг).

import { app } from "./src/app.js";

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`UB Beauty Salon chatbot локалаар ажиллаж байна: http://localhost:${PORT}`);
});
