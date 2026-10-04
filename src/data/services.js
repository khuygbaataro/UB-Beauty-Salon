// ─────────────────────────────────────────────────────────────
//  Одоогийн 5 үйлчилгээний seed өгөгдөл.
//
//  Талбаруудын тайлбар:
//   id          — дотоод давтагдашгүй түлхүүр
//   name        — үйлчилгээний нэр (үйлчлүүлэгчид харагдана)
//   subtitle    — дэд гарчиг / бренд нэр
//   category    — ангилал (peeling | lifting | package | laser | lashes)
//   price       — үнэ (төгрөг). Хараахан мэдэгдээгүй бол null.
//   prepayment  — урьдчилгаа төлбөр (төгрөг). Тодорхойгүй бол null.
//   durationMinutes — үргэлжлэх хугацаа минутаар (v1-д мэдээллийн зориулалттай;
//                     дараагийн version-д слот тооцоонд ашиглана). Тодорхойгүй бол null.
//   variants    — үнийн хувилбарууд (жишээ: лазер — биеийн хэсэг тус бүр)
//   addons      — нэмэлт сонголт (жишээ: Laser/Carboxy/Oxygen)
//   description — товч танилцуулга
//   benefits    — үр дүн / онцлогуудын жагсаалт
//   refKeys     — Facebook контентоос ялгаж таних түлхүүр үгс (postback ref / ad referral / текст тааруулахад)
//   active      — идэвхтэй эсэх
//
//  ⚠️ GREEN PEEL ба La Vie-ийн үнэ одоогоор null (дараа Admin AI-аар оруулна).
// ─────────────────────────────────────────────────────────────

export const seedServices = [
  {
    id: "green-peel",
    name: "GREEN PEEL",
    subtitle: "S28 GREEN SPICULE PEELING",
    category: "peeling",
    // ⚠️ fbcdn холбоос — хугацаа дуусдаг (түр зуурынх). Байнгын host руу солих нь зүйтэй.
    image:
      "https://scontent.fuln6-3.fna.fbcdn.net/v/t39.30808-6/788815546_1442849281276512_4563988429454023377_n.jpg?stp=dst-jpg_tt6&cstp=mx1145x1374&ctp=s600x600&_nc_cat=107&_nc_map=urlgen_bucketless&ccb=1-7&_nc_sid=833d8c&_nc_ohc=8Ez3xNI4pukQ7kNvwELouNa&_nc_oc=Adp_3WQrrcThso4CfwCxRvQLvrIfW0jhOea_8ojx2uchtA-3ODW_uuZCMsmlw14Tmlc&_nc_zt=23&_nc_ht=scontent.fuln6-3.fna&_nc_gid=4OACv8kVZihAxnQxYvF6Ig&_nc_ss=7b2a8&oh=00_AQN20XCdWl5Mi-yuch6N3ItcSpf1Rs1FcIPqQiPRDOZa3g&oe=6AC643EE",
    tagline: "Байгалийн бичил зүүт найрлагатай арьс шинэчлэх арчилгаа 🌿",
    price: null,
    prepayment: null,
    variants: [],
    addons: [],
    description:
      "Байгалийн гаралтай бичил зүүт найрлагад суурилсан арьс шинэчлэх арчилгааны үйлчилгээ. Гундаж, өнгөө алдсан арьсыг цэвэрхэн, толигор, эрүүл харагдуулна.",
    benefits: [
      "Арьсны өнгөний жигд байдлыг дэмжинэ",
      "Арьсны шинэчлэгдэх үйл явцыг дэмжинэ",
      "Арьсны толигор, зөөлөн байдлыг сайжруулахад тусална",
      "Арьсны чийглэг байдлыг хадгалахад дэмжлэг үзүүлнэ",
      "Нүхжилт болон арьсны барзгар байдлыг багасгахад тусална",
    ],
    refKeys: ["green peel", "green-peel", "spicule", "peeling", "гуужуулалт", "арьс шинэчлэх"],
    active: true,
  },

  {
    id: "la-vie-lifting",
    name: "La Vie — Өргөх чангалах",
    subtitle: "La Vie lifting",
    category: "lifting",
    image: null, // зураг URL (https://...) — дараа нэмнэ
    tagline: "Арьс өргөж чангалах — залуужуулах үйлчилгээ ✨",
    price: null,
    prepayment: null,
    variants: [],
    addons: [],
    description:
      "La Vie өргөх чангалах (lifting) үйлчилгээ. Арьсыг татан чангалж, залуужуулахад чиглэнэ. (Дэлгэрэнгүй мэдээлэл нэмэгдэнэ.)",
    benefits: [],
    refKeys: ["la vie", "la-vie", "lifting", "өргөх", "чангалах"],
    active: true,
  },

  {
    id: "men-power-package",
    name: "Хүчирхэг багц (эрэгтэйчүүдэд)",
    subtitle: "Хар/цагаан батга цэвэрлэх + цайруулах, 16 үйлчилгээ",
    category: "package",
    image: null, // зураг URL (https://...) — дараа нэмнэ
    tagline: "Эрэгтэйчүүдэд: 16 үйлчилгээ багтсан багц — 60,000₮",
    price: 60000,
    prepayment: null,
    variants: [],
    addons: [
      {
        id: "laser",
        name: "Laser",
        price: 30000,
        note: "Сэвх задлах, үсний ургалт зогсоох, сорив бүдгэрүүлэх, батга хатаах, цайруулах",
      },
      {
        id: "carboxy",
        name: "Carboxy",
        price: 30000,
        note: "Нүх агшааж, нүүрний хаван буулгаж, сэвх нөсөө задлаж, жигд цайруулах",
      },
      {
        id: "oxygen",
        name: "Oxygen",
        price: 30000,
        note: "Арьсыг гүнээс чийгээр хангаж амьсгалуулах хүчилтөрөгчтэй усан массаж",
      },
    ],
    description:
      "Эрэгтэйчүүдэд зориулсан хар/цагаан батга цэвэрлэх, цайруулах 16 үйлчилгээг багтаасан багц — ердөө 60,000₮.",
    benefits: [
      "Толгой амраах бариа",
      "Нүүрний тосон цэвэрлэгээ",
      "Нүүрний үхэжсэн арьс гуужуулах",
      "Гүний хөөсөн цэвэрлэгээ",
      "Ultrasonic аппарат цэвэрлэгээ гуужуулалт",
      "Тоник цэвэрлэгээ",
      "Нүүрний цэгэн өргөлтөт массаж",
      "Халуун уур",
      "Хуян тараах хүзүү, цээжний массаж",
      "Арьс тайвшруулах халуун бигнүүр",
      "Батга шахалт",
      "Батга соруулах",
      "Арьсны халуун, хүйтэн индүү",
      "Чийгшүүлэх коллагентэй маск",
      "Арьсыг чийгшүүлэх эссенци",
      "Лед гэрлэн маск (арьсны онцлогоос хамааран хийгдэнэ)",
    ],
    refKeys: ["хүчирхэг багц", "эрэгтэй", "эрчүүд", "батга цэвэрлэх", "men package", "power"],
    active: true,
  },

  {
    id: "laser-hair-removal",
    name: "Илүүдэл үс арилгах лазер",
    subtitle: "Soprano Titanium 2026 (IPL)",
    category: "laser",
    image: null, // зураг URL (https://...) — дараа нэмнэ
    tagline: "Soprano Titanium — илүүдэл үс арилгах лазер (өвдөлтгүй)",
    price: null, // хэсэг бүрийн үнэ variants дотор
    prepayment: null,
    variants: [
      { id: "face", name: "Нүүр", sessions: 3, price: 150000 },
      { id: "beard", name: "Сахал", sessions: 3, price: 150000 },
      { id: "armpit", name: "Суга", sessions: 3, price: 150000 },
      { id: "bikini", name: "Бикини", sessions: 3, price: 200000 },
      { id: "arm", name: "Гар", sessions: 3, price: 200000 },
      { id: "leg", name: "Хөл", sessions: 3, price: 250000 },
      { id: "full-body", name: "Бүтэн бие", sessions: 3, price: 500000 },
    ],
    addons: [],
    description:
      "2026 оны шилдэг Soprano Titanium лазераар илүүдэл үсний ургалтыг зогсооно. 808нм долгионы урттай гэрэл үсний уутанцрыг агшааж, өвдөлтгүй, сөрөг нөлөөгүйгээр 99.9% үр дүн үзүүлнэ.",
    benefits: [
      "Илүүдэл үсний ургалтын 90-95% бүрэн зогсоно",
      "Оролт хоорондын давтамж: 7-14 хоног",
      "Курс (5-10 удаа)-ын дараа улиралд 1-2 удаа давтан хийж болно",
    ],
    refKeys: ["лазер", "laser", "soprano", "үс арилгах", "илүүдэл үс", "ipl"],
    active: true,
  },

  {
    id: "lash-extension",
    name: "Сормуус суулгалт",
    subtitle: "Бүх төрлийн сормуус суулгалт",
    category: "lashes",
    image: null, // зураг URL (https://...) — дараа нэмнэ
    tagline: "Бүх төрлийн сормуус суулгалт — 68,000₮",
    price: 68000,
    prepayment: null,
    variants: [],
    addons: [],
    description: "Бүх төрлийн сормуус суулгалт — үнэ 68,000₮.",
    benefits: [],
    refKeys: ["сормуус", "сормуус суулгалт", "lash", "lashes", "eyelash"],
    active: true,
  },
];
