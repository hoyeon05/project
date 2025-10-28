// server.js
// EveryBus 백엔드 — MongoDB Atlas (busdb) + 강제 CORS + 시간표/차량 API

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 5000;

/* ---------------------- CORS (전면 허용 + 프리플라이트) ---------------------- */
// 운영 전환 시에는 "*" 대신 정확한 도메인만 열기 권장: "https://everybus4.onrender.com"
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json());
app.use(cors()); // 보조용

/* ---------------------- MongoDB 연결 ---------------------- */
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://master:ULUoh16HeSO0m0RJ@cluster0.rpczfaj.mongodb.net/busdb?appName=Cluster0";

/* ---------------------- 스키마 정의 ---------------------- */
// 🚌 실시간 차량 위치 (IMEI 기준)
const VehicleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // IMEI/디바이스 ID
    route: { type: String, default: "미정" },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    heading: { type: Number, default: 0 },
    updatedAt: { type: Number, default: null },
  },
  { collection: "bus", timestamps: false }
);
const Vehicle = mongoose.model("Vehicle", VehicleSchema);

// 🚏 정류장 (GeoJSON: { type: "Point", coordinates: [lng, lat] })
const BusStopSchema = new mongoose.Schema(
  {
    정류장명: { type: String, required: true },
    위치: {
      type: Object,
      required: true,
      default: { type: "Point", coordinates: [0, 0] },
    },
  },
  { collection: "BusStop", timestamps: false }
);
const BusStop = mongoose.model("BusStop", BusStopSchema);

// ⏰ 시간표 (기존 busdb.timebus 문서 구조 대응)
const TimebusSchema = new mongoose.Schema(
  {
    routeId: String,            // 예: "ansan-line-1"
    direction: String,          // 예: "상록수역→대학" 또는 "대학→상록수역"
    origin: String,             // 출발 정류장명
    destination: String,        // 도착 정류장명
    days: [String],
    daysHash: String,           // "Mon|Tue|Wed|Thu|Fri"
    times: [String],            // ["08:40","08:45", ...]
    updatedAt: Date
  },
  { collection: "timebus", timestamps: false }
);
const Timebus = mongoose.model("Timebus", TimebusSchema);

/* ---------------------- 기본 라우트 ---------------------- */
app.get("/", (_req, res) => res.type("text/plain").send("EVERYBUS API OK"));

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    ts: Date.now(),
    dbStatus: mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED",
  });
});

/* ---------------------- 정류장 API ---------------------- */
app.get("/stops", async (_req, res) => {
  try {
    const raw = await BusStop.find({}).select("정류장명 위치 -_id").lean();
    const formatted = raw
      .map((s, i) => {
        const coords = Array.isArray(s?.위치?.coordinates) ? s.위치.coordinates : [NaN, NaN];
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        return {
          id: String(i + 1),
          name: s?.정류장명 ?? "(이름없음)",
          lng,
          lat,
          nextArrivals: [
            s?.정류장명 === "상록수역" ? "5분 후" : "1분 후",
            s?.정류장명 === "안산대학교" ? "2분 후" : "7분 후",
          ],
        };
      })
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));

    if (formatted.length === 0) {
      return res.json([
        { id: "1", name: "안산대학교", lat: 37.3308, lng: 126.8398, nextArrivals: ["5분 후", "15분 후"] },
        { id: "2", name: "상록수역",   lat: 37.3175, lng: 126.8660, nextArrivals: ["8분 후", "18분 후"] },
      ]);
    }
    res.json(formatted);
  } catch (e) {
    console.error("❌ /stops error:", e);
    res.status(500).json({ error: "정류장 데이터를 불러올 수 없습니다." });
  }
});

// 디버그: 원본 문서 그대로 보기
app.get("/debug/stops-raw", async (_req, res) => {
  const docs = await BusStop.find({}).lean();
  res.json(docs);
});

/* ---------------------- 차량 위치 API ---------------------- */
// 현재 위치 목록
app.get("/bus/location", async (_req, res) => {
  try {
    const vehicles = await Vehicle.find({ lat: { $ne: null }, lng: { $ne: null } })
      .select("id route lat lng heading updatedAt -_id")
      .lean();
    res.json(vehicles);
  } catch (e) {
    console.error("❌ /bus/location error:", e.message);
    res.status(500).json({ error: "버스 위치를 조회할 수 없습니다." });
  }
});

// GPS 기기 업로드
app.post("/bus/location/:imei", async (req, res) => {
  const busId = req.params.imei;
  const { lat, lng, heading } = req.body;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "위도(lat), 경도(lng)는 숫자여야 합니다." });
  }

  const updateFields = { lat, lng, updatedAt: Date.now() };
  if (Number.isFinite(heading)) updateFields.heading = heading;

  try {
    const result = await Vehicle.findOneAndUpdate(
      { id: busId },
      { $set: updateFields, $setOnInsert: { id: busId, route: "미정" } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    console.log(`[GPS UPDATE] ${result.id} (${result.route}) → lat=${lat.toFixed(5)}, lng=${lng.toFixed(5)}`);
    res.status(200).json({ status: "OK", updatedId: busId });
  } catch (e) {
    console.error("❌ 위치 업데이트 오류:", e.message);
    res.status(500).json({ error: "위치 업데이트에 실패했습니다." });
  }
});

/* ---------------------- (신규) 선택용 버스 목록 API ---------------------- */
// 프론트의 /vehicles 호출 대응 (timebus에 존재하는 routeId를 기반으로 목록 생성)
app.get("/vehicles", async (_req, res) => {
  try {
    const docs = await Timebus.find({}).select("routeId -_id").lean();
    const uniq = [...new Set(docs.map(d => d.routeId).filter(Boolean))];

    // 표시명 매핑 (원하면 여기서 이름 바꾸기)
    const nameMap = {
      "ansan-line-1": "안산대1",
      "ansan-line-2": "안산대2",
    };

    const list = uniq.map((id, idx) => ({
      id,                              // 내부용 식별자
      name: nameMap[id] || id,         // 사용자 표시 이름
      order: idx
    }));

    res.json(list);
  } catch (e) {
    console.error("GET /vehicles error:", e);
    res.status(500).json({ error: "vehicles 조회 실패" });
  }
});

/* ---------------------- (신규) 시간표 조회 API ---------------------- */
// 쿼리 예시:
//   /timebus?routeId=ansan-line-1&direction=상록수역→대학
//   /timebus?direction=대학→상록수역
//   /timebus?origin=상록수역&destination=대학
app.get("/timebus", async (req, res) => {
  try {
    const { routeId, direction, origin, destination } = req.query;
    const q = {};
    if (routeId) q.routeId = routeId;
    if (direction) q.direction = direction;
    if (origin) q.origin = origin;
    if (destination) q.destination = destination;

    // 가장 구체적인 조건부터 탐색
    let doc = await Timebus.findOne(q).lean();

    // 보완 탐색: direction만으로도 시도
    if (!doc && direction && (q.routeId || q.origin || q.destination)) {
      doc = await Timebus.findOne({ direction }).lean();
    }

    if (!doc) {
      return res.status(404).json({ error: "timebus 문서를 찾지 못했습니다.", query: q });
    }

    res.json({
      routeId: doc.routeId,
      direction: doc.direction,
      origin: doc.origin,
      destination: doc.destination,
      daysHash: doc.daysHash,
      times: doc.times || [],
      updatedAt: doc.updatedAt || null,
    });
  } catch (e) {
    console.error("GET /timebus error:", e);
    res.status(500).json({ error: "timebus 조회 실패" });
  }
});

/* ---------------------- 404 ---------------------- */
app.use((_req, res) => res.status(404).json({ error: "Not Found" }));

/* ---------------------- 서버 시작 ---------------------- */
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("🟢 MongoDB 연결 성공");
    app.listen(PORT, () => console.log(`✅ 서버 실행 중: http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("❌ MongoDB 연결 실패:", err.message);
    process.exit(1);
  });
