// Vercel serverless entry. vercel.json доторх rewrite бүх хүсэлтийг энд чиглүүлнэ.
// Express апп нь (req, res) гарын үсэгтэй тул Vercel функц болон шууд ажиллана.

import { app } from "../src/app.js";

export default app;
