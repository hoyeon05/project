// server.js
// EveryBus 백엔드 — MongoDB Atlas(busdb) + CORS + 시간표/차량 API (프론트 계약 맞춤본)

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 5000;

/* ---------------------- CORS (전면 허용 + 프리플라이트) ---------------------- */
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json());
app.use(cors());

/* ---------------------- MongoDB 연결 ---------------------- */
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://master:ULUoh16HeSO0m0RJ@cluster0.rpczfaj.mongodb.net/busdb?appName=Cluster0";

/* ---------------------- 스키마 ---------------------- */
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

const BusStopSchema = new mongoose.Schema(
  {
    정류장명: { type: String, required: true },
    위치: { type: Object, required: true, default: { type: "Point", coordinates: [0, 0] } },
  },
  { collection: "BusStop", timestamps: false }
);
const BusStop = mongoose.model("BusStop", BusStopSchema);

const TimebusSchema = new mongoose.Schema(
  {
    routeId: String,
    direction: String,      // "상록수역→대학" | "대학→상록수역"
    origin: String,
    destination: String,
    days: [String],
    daysHash: String,       // "Mon|Tue|Wed|Thu|Fri"
    times: [String],
    updatedAt: Date,
  },
  { collection: "timebus", timestamps: false }
);
const Timebus = mongoose.model("Timebus", TimebusSchema);

/* ---------------------- 기본 ---------------------- */
app.get("/", (_req, res) => res.type("text/plain").send("EVERYBUS API OK"));
app.get("/health", (_req, res) =>
  res.json({ ok: true, ts: Date.now(), dbStatus: mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED" })
);

/* ---------------------- 정류장 ---------------------- */
app.get("/stops", async (_req, res) => {
  try {
    const raw = await BusStop.find({}).select("정류장명 위치 -_id").lean();
    const out = raw
      .map((s, i) => {
        const [lng, lat] = Array.isArray(s?.위치?.coordinates) ? s.위치.coordinates : [NaN, NaN];
        return { id: String(i + 1), name: s?.정류장명 ?? "(이름없음)", lng: Number(lng), lat: Number(lat) };
      })
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));

    if (out.length === 0) {
      return res.json([
        { id: "1", name: "안산대학교", lat: 37.3308, lng: 126.8398 },
        { id: "2", name: "상록수역", lat: 37.3175, lng: 126.866 },
      ]);
    }
    res.json(out);
  } catch (e) {
    console.error("❌ /stops:", e);
    res.status(500).json({ error: "정류장 데이터를 불러올 수 없습니다." });
  }
});

/* ---------------------- 차량 위치 ---------------------- */
app.get("/bus/location", async (_req, res) => {
  try {
    const vehicles = await Vehicle.find({ lat: { $ne: null }, lng: { $ne: null } })
      .select("id route lat lng heading updatedAt -_id")
      .lean();
    res.json(vehicles);
  } catch (e) {
    console.error("❌ /bus/location:", e);
    res.status(500).json({ error: "버스 위치를 조회할 수 없습니다." });
  }
});

app.post("/bus/location/:imei", async (req, res) => {
  const { imei } = req.params;
  const { lat, lng, heading } = req.body || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "위도(lat), 경도(lng)는 숫자여야 합니다." });
  }
  try {
    const result = await Vehicle.findOneAndUpdate(
      { id: imei },
      { $set: { lat, lng, updatedAt: Date.now(), ...(Number.isFinite(heading) ? { heading } : {}) },
        $setOnInsert: { id: imei, route: "미정" } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    console.log(`[GPS UPDATE] ${result.id} → ${lat}, ${lng}`);
    res.json({ status: "OK", updatedId: imei });
  } catch (e) {
    console.error("❌ /bus/location POST:", e);
    res.status(500).json({ error: "위치 업데이트 실패" });
  }
});

/* ---------------------- (프론트 계약) /vehicles ---------------------- */
// 프론트는 [{ id, label }] 을 기대함.
app.get("/vehicles", async (_req, res) => {
  try {
    const docs = await Timebus.find({}).select("routeId direction -_id").lean();
    const rawIds = docs.map((d) => d.routeId || d.direction).filter(Boolean);
    const uniqIds = [...new Set(rawIds)];

    const labelMap = {
      "ansan-line-1": "안산대1",
      "ansan-line-2": "안산대2",
      "상록수역→대학": "셔틀A",
      "대학→상록수역": "셔틀B",
    };

    const list = uniqIds.map((id) => ({ id, label: labelMap[id] || id }));
    res.json(list);
  } catch (e) {
    console.error("❌ /vehicles:", e);
    res.status(500).json({ error: "vehicles 조회 실패" });
  }
});

/* ---------------------- (프론트 계약) /timebus ---------------------- */
// 프론트는 배열을 기대함: rows?.[0]?.times
// 예: /timebus?direction=상록수역→대학  또는 /timebus?routeId=ansan-line-1
app.get("/timebus", async (req, res) => {
  try {
    const { routeId, direction, origin, destination } = req.query;
    const q = {};
    if (routeId) q.routeId = routeId;
    if (direction) q.direction = direction;
    if (origin) q.origin = origin;
    if (destination) q.destination = destination;

    // 항상 배열로 반환
    const rows = await Timebus.find(Object.keys(q).length ? q : {}).lean();

    // times 없는 문서 방지용 정규화
    const normalized = rows.map((d) => ({
      routeId: d.routeId,
      direction: d.direction,
      origin: d.origin,
      destination: d.destination,
      daysHash: d.daysHash,
      times: Array.isArray(d.times) ? d.times : [],
      updatedAt: d.updatedAt || null,
    }));

    if (normalized.length === 0) {
      return res.status(404).json([]);
    }
    res.json(normalized);
  } catch (e) {
    console.error("❌ /timebus:", e);
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
