// server.js — EveryBus 통합 서버 완성본
// MongoDB + /stops + /bus/location + /routes + /bus/active + /wait/toggle + /vehicles

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 5000;

// ---------------------- 미들웨어 ----------------------
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ---------------------- MongoDB 연결 ----------------------
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://master:ULUoh16HeSO0m0RJ@cluster0.rpczfaj.mongodb.net/busdb?appName=Cluster0";

// ---------------------- 스키마 정의 ----------------------
const VehicleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    route: String,
    lat: Number,
    lng: Number,
    heading: Number,
    updatedAt: Number,
  },
  { collection: "bus", timestamps: false }
);
const Vehicle = mongoose.model("Vehicle", VehicleSchema);

const ActiveBusSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    stopId: String,
    time: String,
    driver: String,
    route: String,
    active: Boolean,
    serviceWindow: {
      start: Date,
      end: Date,
    },
    updatedAt: Date,
  },
  { collection: "ActiveBus", timestamps: false }
);
const ActiveBus = mongoose.model("ActiveBus", ActiveBusSchema);

const RouteSchema = new mongoose.Schema(
  {
    name: String,
    points: [{ lat: Number, lng: Number }],
    createdAt: Date,
  },
  { collection: "routes", timestamps: false }
);
const Route = mongoose.model("Route", RouteSchema);

// ---------------------- 기본 ----------------------
app.get("/", (_req, res) => res.send("EVERYBUS API OK ✅"));
app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    ts: Date.now(),
    db: mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED",
  })
);

// ---------------------- 정류장 ----------------------
app.get("/stops", async (_req, res) => {
  try {
    const fallback = [
      { id: "1", name: "안산대학교", lat: 37.3308, lng: 126.8398 },
      { id: "2", name: "상록수역", lat: 37.3175, lng: 126.866 },
      { id: "3", name: "안산대2", lat: 37.327, lng: 126.847 },
    ];
    res.json(fallback);
  } catch (e) {
    console.error("/stops 오류:", e);
    res.status(500).json({ error: "정류장 조회 실패" });
  }
});

// ---------------------- 차량 위치 ----------------------
app.get("/bus/location", async (_req, res) => {
  try {
    const docs = await Vehicle.find({}).lean();
    res.json(
      docs.length
        ? docs
        : [
            {
              id: "bus1",
              lat: 37.324,
              lng: 126.845,
              heading: 0,
              route: "테스트",
            },
          ]
    );
  } catch (e) {
    console.error("/bus/location 오류:", e);
    res.status(500).json({ error: "버스 위치 조회 실패" });
  }
});

// 위치 업데이트 (기사 앱)
app.post("/bus/location/:imei", async (req, res) => {
  const { imei } = req.params;
  const { lat, lng, heading } = req.body || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return res.status(400).json({ error: "위도/경도는 숫자여야 함" });
  try {
    const result = await Vehicle.findOneAndUpdate(
      { id: imei },
      {
        $set: { lat, lng, heading, updatedAt: Date.now() },
        $setOnInsert: { id: imei, route: "미정" },
      },
      { new: true, upsert: true }
    );
    console.log(`[GPS] ${imei}: ${lat}, ${lng}`);
    res.json({ ok: true, id: result.id });
  } catch (e) {
    console.error("/bus/location POST 오류:", e);
    res.status(500).json({ error: "위치 업데이트 실패" });
  }
});

// ---------------------- 노선 ----------------------
app.get("/routes", async (_req, res) => {
  try {
    const rows = await Route.find({}).lean();
    if (rows.length > 0) return res.json(rows);
    res.json([
      {
        id: "R1",
        name: "상록수역 → 안산대",
        points: [
          { lat: 37.3175, lng: 126.866 },
          { lat: 37.323, lng: 126.85 },
          { lat: 37.3308, lng: 126.8398 },
        ],
      },
    ]);
  } catch (e) {
    console.error("/routes 오류:", e);
    res.status(500).json({ error: "노선 조회 실패" });
  }
});

// ---------------------- 운행중 메타 ----------------------
app.get("/bus/active", async (_req, res) => {
  try {
    const active = await ActiveBus.find({ active: true }).lean();
    res.json(active || []);
  } catch (e) {
    console.error("/bus/active 오류:", e);
    res.status(500).json({ error: "active 조회 실패" });
  }
});

app.put("/bus/active", async (req, res) => {
  try {
    const { id, stopId, time, driver, route, active, serviceWindow } =
      req.body || {};
    if (!id || !stopId || !time)
      return res.status(400).json({ error: "id, stopId, time 필수" });

    await ActiveBus.updateOne(
      { id: String(id) },
      {
        $set: {
          stopId,
          time,
          driver,
          route,
          active: active !== false,
          serviceWindow,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("/bus/active PUT 오류:", e);
    res.status(500).json({ error: "active 업서트 실패" });
  }
});

// ---------------------- 대기 토글 ----------------------
app.post("/wait/toggle", (req, res) => {
  const { busId, stopId, time } = req.body;
  console.log(`🕓 대기 토글: bus=${busId}, stop=${stopId}, time=${time}`);
  res.json({ ok: true });
});

// ---------------------- 서버 시작 ----------------------
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("🟢 MongoDB 연결 성공");
    app.listen(PORT, () =>
      console.log(`✅ 서버 실행 중: http://localhost:${PORT}`)
    );
  })
  .catch((err) => {
    console.error("❌ MongoDB 연결 실패:", err.message);
    process.exit(1);
  });
