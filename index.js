// server.js
// EveryBus 백엔드 — MongoDB Atlas(busdb) + CORS + 시간표/차량 API + 운행중 메타(/bus/active) + 노선(/routes)

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
    위치: {
      type: Object,
      required: true,
      default: { type: "Point", coordinates: [0, 0] },
    },
  },
  { collection: "BusStop", timestamps: false }
);
const BusStop = mongoose.model("BusStop", BusStopSchema);

const TimebusSchema = new mongoose.Schema(
  {
    routeId: String,
    direction: String, // "상록수역→대학" | "대학→상록수역"
    origin: String,
    destination: String,
    days: [String],
    daysHash: String, // "Mon|Tue|Wed|Thu|Fri"
    times: [String],
    updatedAt: Date,
  },
  { collection: "timebus", timestamps: false }
);
const Timebus = mongoose.model("Timebus", TimebusSchema);

/* === ActiveBus(운행중 메타) === */
const ActiveBusSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // Vehicle.id / 기사앱 ID
    stopId: { type: String, required: true },
    time: { type: String, required: true }, // "HH:MM"
    driver: { type: String, default: null },
    route: { type: String, default: null }, // "1호차" 등 표시용
    active: { type: Boolean, default: true },
    serviceWindow: {
      start: { type: Date, default: null },
      end: { type: Date, default: null },
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "ActiveBus", timestamps: false }
);
const ActiveBus = mongoose.model("ActiveBus", ActiveBusSchema);

/* === Route(노선) === */
const RouteSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // [{ lat, lng }]
    points: [
      {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
      },
    ],
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "routes", timestamps: false }
);
const Route = mongoose.model("Route", RouteSchema);

/* ---------------------- 기본 ---------------------- */
app.get("/", (_req, res) =>
  res.type("text/plain").send("EVERYBUS API OK")
);
app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    ts: Date.now(),
    dbStatus:
      mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED",
  })
);

/* ---------------------- 정류장 ---------------------- */
app.get("/stops", async (_req, res) => {
  try {
    const raw = await BusStop.find({}).select("정류장명 위치 -_id").lean();
    const out = raw
      .map((s, i) => {
        const [lng, lat] = Array.isArray(s?.위치?.coordinates)
          ? s.위치.coordinates
          : [NaN, NaN];
        return {
          id: String(i + 1),
          name: s?.정류장명 ?? "(이름없음)",
          lng: Number(lng),
          lat: Number(lat),
        };
      })
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));

    if (out.length === 0) {
      return res.json([
        {
          id: "1",
          name: "안산대1",
          lat: 37.30927735109936,
          lng: 126.87543411783554,
        },
        {
          id: "2",
          name: "상록수역",
          lat: 37.303611793223766,
          lng: 126.8668823,
        },
        {
          id: "3",
          name: "안산대2",
          lat: 37.30758465221897,
          lng: 126.87662413801725,
        },
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
    const vehicles = await Vehicle.find({
      lat: { $ne: null },
      lng: { $ne: null },
    })
      .select("id route lat lng heading updatedAt -_id")
      .lean();
    res.json(vehicles);
  } catch (e) {
    console.error("❌ /bus/location:", e);
    res
      .status(500)
      .json({ error: "버스 위치를 조회할 수 없습니다." });
  }
});

app.post("/bus/location/:imei", async (req, res) => {
  const { imei } = req.params;
  const { lat, lng, heading } = req.body || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res
      .status(400)
      .json({ error: "위도(lat), 경도(lng)는 숫자여야 합니다." });
  }
  try {
    const result = await Vehicle.findOneAndUpdate(
      { id: imei },
      {
        $set: {
          lat,
          lng,
          updatedAt: Date.now(),
          ...(Number.isFinite(heading) ? { heading } : {}),
        },
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

/* ---------------------- /vehicles ---------------------- */
// 프론트(기사앱)는 [{ id, label }] 기대
app.get("/vehicles", async (_req, res) => {
  try {
    const docs = await Timebus.find({})
      .select("routeId direction -_id")
      .lean();
    const rawIds = docs
      .map((d) => d.routeId || d.direction)
      .filter(Boolean);
    const uniqIds = [...new Set(rawIds)];

    const labelMap = {
     
      "상록수역→대학": "셔틀A",
      "대학→상록수역": "셔틀B",
    };

    const list = uniqIds.map((id) => ({
      id,
      label: labelMap[id] || id,
    }));
    res.json(list);
  } catch (e) {
    console.error("❌ /vehicles:", e);
    res.status(500).json({ error: "vehicles 조회 실패" });
  }
});

/* ---------------------- /timebus ---------------------- */
app.get("/timebus", async (req, res) => {
  try {
    const { routeId, direction, origin, destination } = req.query;
    const q = {};
    if (routeId) q.routeId = routeId;
    if (direction) q.direction = direction;
    if (origin) q.origin = origin;
    if (destination) q.destination = destination;

    const rows = await Timebus.find(
      Object.keys(q).length ? q : {}
    ).lean();

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

/* ---------------------- /bus/active (운행중 메타) ---------------------- */
// GET: 사용자앱에서 사용
app.get("/bus/active", async (_req, res) => {
  try {
    const rows = await ActiveBus.find({ active: true }).lean();
    res.json(
      rows.map((r) => ({
        id: String(r.id),
        stopId: String(r.stopId),
        time: r.time,
        driver: r.driver || null,
        route: r.route || null,
        active: !!r.active,
        serviceWindow: r.serviceWindow || null,
        updatedAt: r.updatedAt || null,
      }))
    );
  } catch (e) {
    console.error("❌ /bus/active GET:", e);
    res.status(500).json({ error: "active 조회 실패" });
  }
});

// PUT: 기사앱 업서트
app.put("/bus/active", async (req, res) => {
  try {
    const {
      id,
      stopId,
      time,
      driver,
      route,
      active,
      serviceWindow,
    } = req.body || {};
    if (!id || !stopId || !time) {
      return res
        .status(400)
        .json({ error: "id, stopId, time 필수" });
    }

    const doc = await ActiveBus.findOneAndUpdate(
      { id: String(id) },
      {
        $set: {
          stopId: String(stopId),
          time: String(time),
          driver: driver ?? null,
          route: route ?? null,
          active: active !== false,
          serviceWindow: serviceWindow || null,
          updatedAt: new Date(),
        },
      },
      { new: true, upsert: true }
    );
    res.json({ ok: true, id: doc.id });
  } catch (e) {
    console.error("❌ /bus/active PUT:", e);
    res.status(500).json({ error: "active 업서트 실패" });
  }
});

// 호환용 시작
app.post("/bus/active/start", async (req, res) => {
  try {
    const { id, stopId, time, driver, route, serviceWindow } =
      req.body || {};
    if (!id || !stopId || !time)
      return res
        .status(400)
        .json({ error: "id, stopId, time 필수" });
    await ActiveBus.updateOne(
      { id: String(id) },
      {
        $set: {
          stopId: String(stopId),
          time: String(time),
          driver: driver ?? null,
          route: route ?? null,
          active: true,
          serviceWindow: serviceWindow || null,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("❌ /bus/active/start:", e);
    res.status(500).json({ error: "운행 시작 실패" });
  }
});

// 호환용 종료
app.post("/bus/active/stop", async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id)
      return res.status(400).json({ error: "id 필수" });
    await ActiveBus.updateOne(
      { id: String(id) },
      { $set: { active: false, updatedAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("❌ /bus/active/stop:", e);
    res.status(500).json({ error: "운행 종료 실패" });
  }
});

/* ---------------------- 노선(Route) ---------------------- */
// 저장
app.post("/routes", async (req, res) => {
  try {
    const { name, points } = req.body || {};
    if (!name || !Array.isArray(points) || points.length < 2) {
      return res
        .status(400)
        .json({ error: "name과 최소 2개 이상의 points가 필요합니다." });
    }

    const cleanPoints = points
      .map((p) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
      }))
      .filter(
        (p) =>
          Number.isFinite(p.lat) && Number.isFinite(p.lng)
      );

    if (cleanPoints.length < 2) {
      return res
        .status(400)
        .json({ error: "유효한 좌표가 부족합니다." });
    }

    const doc = await Route.create({
      name: String(name),
      points: cleanPoints,
      createdAt: new Date(),
    });

    res.json({
      ok: true,
      route: {
        id: String(doc._id),
        name: doc.name,
        points: doc.points,
      },
    });
  } catch (e) {
    console.error("❌ /routes POST:", e);
    res.status(500).json({ error: "노선 저장 실패" });
  }
});

// 조회 (사용자앱에서 폴리라인 표시용)
app.get("/routes", async (_req, res) => {
  try {
    const rows = await Route.find({}).lean();
    res.json(
      rows.map((r) => ({
        id: String(r._id),
        name: r.name,
        points: (r.points || []).map((p) => ({
          lat: Number(p.lat),
          lng: Number(p.lng),
        })),
      }))
    );
  } catch (e) {
    console.error("❌ /routes GET:", e);
    res.status(500).json({ error: "노선 조회 실패" });
  }
});

/* ---------------------- 404 ---------------------- */
app.use((_req, res) =>
  res.status(404).json({ error: "Not Found" })
);

/* ---------------------- 서버 시작 ---------------------- */
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
