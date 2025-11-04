// server.js
// EveryBus 백엔드 — MongoDB Atlas(busdb) + CORS + 시간표/차량 API (+ 운행 상태 API)

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

/* === [NEW] 운행 상태 === */
/* 기사앱이 운행 시작/종료를 전송하면 저장되는 컬렉션 */
const ActiveSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // 차량/디바이스 ID
    active: { type: Boolean, default: false },
    stopId: { type: String },       // 표시할 정류장 ID
    driver: { type: String },
    time: { type: String },         // "HH:MM"
    route: { type: String },        // 옵션
    serviceWindow: {
      start: { type: Date },
      end: { type: Date },
    },
    updatedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
  },
  { collection: "bus_active", timestamps: false }
);
ActiveSchema.index({ id: 1 }, { unique: true });
const Active = mongoose.model("Active", ActiveSchema);

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
        { id: "1", name: "안산대1", lat: 37.30927735109936, lng: 126.87543411783554 },
        { id: "2", name: "상록수역", lat: 37.303611793223766, lng: 126.8668823 },
        { id: "3", name: "안산대2", lat: 37.30758465221897, lng: 126.87662413801725 },
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
      {
        $set: { lat, lng, updatedAt: Date.now(), ...(Number.isFinite(heading) ? { heading } : {}) },
        $setOnInsert: { id: imei, route: "미정" },
      },
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
app.get("/timebus", async (req, res) => {
  try {
    const { routeId, direction, origin, destination } = req.query;
    const q = {};
    if (routeId) q.routeId = routeId;
    if (direction) q.direction = direction;
    if (origin) q.origin = origin;
    if (destination) q.destination = destination;

    const rows = await Timebus.find(Object.keys(q).length ? q : {}).lean();
    const normalized = rows.map((d) => ({
      routeId: d.routeId,
      direction: d.direction,
      origin: d.origin,
      destination: d.destination,
      daysHash: d.daysHash,
      times: Array.isArray(d.times) ? d.times : [],
      updatedAt: d.updatedAt || null,
    }));

    if (normalized.length === 0) return res.status(404).json([]);
    res.json(normalized);
  } catch (e) {
    console.error("❌ /timebus:", e);
    res.status(500).json({ error: "timebus 조회 실패" });
  }
});

/* ====================== [NEW] 운행 상태 API ====================== */
/** GET /bus/active
 *  승객앱이 읽어가는 엔드포인트. active=true 인 것만 반환.
 *  프론트는 id/stopId/active/serviceWindow/route/time/driver 를 사용.
 */
app.get("/bus/active", async (_req, res) => {
  try {
    const docs = await Active.find({ active: true }).lean();
    const out = docs.map((d) => ({
      id: d.id,
      stopId: String(d.stopId || ""),
      active: true,
      serviceWindow: d.serviceWindow || null,
      route: d.route || null,
      time: d.time || null,
      driver: d.driver || null,
      updatedAt: d.updatedAt || null,
    }));
    res.json(out);
  } catch (e) {
    console.error("❌ /bus/active GET:", e);
    res.status(500).json({ error: "활성 운행 조회 실패" });
  }
});

/** PUT /bus/active
 *  업서트 표준. body.active 가 true면 시작/갱신, false면 종료.
 */
app.put("/bus/active", async (req, res) => {
  try {
    const { id, active, stopId, time, driver, route, serviceWindow, end } = req.body || {};
    if (!id) return res.status(400).json({ error: "id는 필수입니다." });

    if (active === false) {
      const doc = await Active.findOneAndUpdate(
        { id },
        { $set: { active: false, endedAt: end ? new Date(end) : new Date(), updatedAt: new Date() } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      return res.json({ ok: true, id: doc.id, active: false });
    }

    const doc = await Active.findOneAndUpdate(
      { id },
      {
        $set: {
          active: true,
          stopId: stopId ?? null,
          time: time ?? null,
          driver: driver ?? null,
          route: route ?? null,
          serviceWindow: serviceWindow ?? null,
          updatedAt: new Date(),
          endedAt: null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true, id: doc.id, active: true });
  } catch (e) {
    console.error("❌ /bus/active PUT:", e);
    res.status(500).json({ error: "운행 상태 저장 실패" });
  }
});

/** POST /bus/active/start  (폴백용) */
app.post("/bus/active/start", async (req, res) => {
  try {
    const { id, stopId, time, driver, route, serviceWindow } = req.body || {};
    if (!id) return res.status(400).json({ error: "id는 필수입니다." });
    await Active.findOneAndUpdate(
      { id },
      {
        $set: {
          active: true,
          stopId: stopId ?? null,
          time: time ?? null,
          driver: driver ?? null,
          route: route ?? null,
          serviceWindow: serviceWindow ?? null,
          updatedAt: new Date(),
          endedAt: null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("❌ /bus/active/start:", e);
    res.status(500).json({ error: "운행 시작 저장 실패" });
  }
});

/** POST /bus/active/stop (폴백용) */
app.post("/bus/active/stop", async (req, res) => {
  try {
    const { id, end } = req.body || {};
    if (!id) return res.status(400).json({ error: "id는 필수입니다." });
    await Active.findOneAndUpdate(
      { id },
      { $set: { active: false, endedAt: end ? new Date(end) : new Date(), updatedAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("❌ /bus/active/stop:", e);
    res.status(500).json({ error: "운행 종료 저장 실패" });
  }
});
/* ==================== [NEW] /bus/active 끝 ==================== */

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
