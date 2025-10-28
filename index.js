// server.js
// EveryBus 백엔드 — MongoDB Atlas (busdb.BusStop) 대응 + 강제 CORS

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 5000;

/* ---------------------- CORS (전면 허용 + 프리플라이트) ---------------------- */
// 운영에서는 "*" 대신 정확한 도메인만 허용 권장: "https://everybus4.onrender.com"
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
/* -------------------------------------------------------------------------- */

app.use(express.json());
app.use(cors()); // 있어도 됨(위 강제 헤더가 우선)

/* ---------------------- MongoDB 연결 ---------------------- */
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://master:ULUoh16HeSO0m0RJ@cluster0.rpczfaj.mongodb.net/busdb?appName=Cluster0";

/* ---------------------- 스키마 정의 ---------------------- */
// 🚌 차량
const VehicleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    route: { type: String, default: "미정" },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    heading: { type: Number, default: 0 },
    updatedAt: { type: Number, default: null },
  },
  { collection: "bus", timestamps: false }
);
const Vehicle = mongoose.model("Vehicle", VehicleSchema);

// 🚏 정류장 (busdb.BusStop)
const BusStopSchema = new mongoose.Schema(
  {
    정류장명: { type: String, required: true },
    위치: {
      type: Object, // GeoJSON: { type: "Point", coordinates: [lng, lat] }
      required: true,
      default: { type: "Point", coordinates: [0, 0] },
    },
  },
  { collection: "BusStop", timestamps: false }
);
const BusStop = mongoose.model("BusStop", BusStopSchema);

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
    console.log("[/stops] raw count:", raw.length, "sample:", raw[0]);

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

    console.log("[/stops] formatted count:", formatted.length);

    if (formatted.length === 0) {
      console.warn("[/stops] no valid docs → sending fallback");
      return res.json([
        { id: "1", name: "안산대1", lat: 37.30927735109936, lng: 126.87543411783554 },
        { id: "2", name: "상록수역",   lat: 37.303611793223766, lng: 126.8668823, 
          id: "3", name: "안산대2",   lat: 126.87662413801725, lng: 126.87662413801725
        },
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
// GET: 현재 위치 목록
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

// POST: GPS 기기 업로드
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
