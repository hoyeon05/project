// server.js
// EveryBus 백엔드 — MongoDB Atlas(busdb) + CORS + 시간표/차량 API
// + 운행중 메타(/bus/active) + 노선(/routes) + 대기(/wait) + QR 체크인(/qr/checkin)
//
// - Vehicle(bus 컬렉션): 셔틀(호차) 목록 + GPS 위치
// - ActiveBus: "한 번의 운행" 정보 (몇호차, 몇시, 어디→어디, 좌석/탑승)
// - 기사앱: /vehicles, /stops, /bus/active 사용
// - Termux: /bus/location/:id 로 GPS만 계속 업로드
// - 승객앱: /stops, /bus/location, /bus/active, /qr/checkin 사용

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

/* ---------------------- 사용할 버스 ID 제한(선택) ---------------------- */
// 예) .env 에 ALLOWED_BUS_IDS=350599638756152,shuttle-02
const ALLOWED_BUS_IDS = process.env.ALLOWED_BUS_IDS
  ? process.env.ALLOWED_BUS_IDS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

function filterByAllowedBusIds(query = {}) {
  if (ALLOWED_BUS_IDS && ALLOWED_BUS_IDS.length > 0) {
    return { ...query, id: { $in: ALLOWED_BUS_IDS } };
  }
  return query;
}

/* ---------------------- 스키마 ---------------------- */

// 버스(GPS) — 셔틀 목록 + 실시간 위치
const VehicleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // 셔틀 ID (IMEI, 커스텀ID 등)
    route: { type: String, default: "미정" },           // "1호차" 같은 표시용 이름
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    heading: { type: Number, default: 0 },
    updatedAt: { type: Number, default: null },
  },
  { collection: "bus", timestamps: false }
);
const Vehicle = mongoose.model("Vehicle", VehicleSchema);

// 정류장
const BusStopSchema = new mongoose.Schema(
  {
    정류장명: { type: String, required: true },
    위치: {
      type: Object,
      required: true,
      default: { type: "Point", coordinates: [0, 0] }, // [lng, lat]
    },
  },
  { collection: "BusStop", timestamps: false }
);
const BusStop = mongoose.model("BusStop", BusStopSchema);

// 시간표 (지금은 안 써도 됨)
const TimebusSchema = new mongoose.Schema(
  {
    routeId: String,
    direction: String,
    origin: String,
    destination: String,
    days: [String],
    daysHash: String,
    times: [String],
    updatedAt: Date,
  },
  { collection: "timebus", timestamps: false }
);
const Timebus = mongoose.model("Timebus", TimebusSchema);

// 실시간 운행 메타 — "한 번의 운행" 정보
const ActiveBusSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // Vehicle.id / 기사앱 ID

    // 현재 기준 정류장(출발/경유/도착 중 하나)
    stopId: { type: String, required: true },

    // 출발 시각 "HH:MM"
    time: { type: String, required: true },

    // 사용자에게 보여줄 호차 이름 (예: "1호차")
    routeLabel: { type: String, default: null },

    // 출발/도착 정류장 정보
    fromStopId: { type: String, default: null },
    fromStopName: { type: String, default: null },
    toStopId: { type: String, default: null },
    toStopName: { type: String, default: null },

    driver: { type: String, default: null },
    route: { type: String, default: null }, // 노선 이름 (예: "안산대 셔틀")
    active: { type: Boolean, default: true },

    // ✅ QR 체크인용 좌석/탑승 정보
    capacity: { type: Number, default: 45 }, // 기본 좌석 수
    onboard: { type: Number, default: 0 },   // 현재 탑승 인원

    serviceWindow: {
      start: { type: Date, default: null },
      end: { type: Date, default: null },
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "ActiveBus", timestamps: false }
);
const ActiveBus = mongoose.model("ActiveBus", ActiveBusSchema);

// 노선(지도상의 polyline)
const RouteSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
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

// 대기 토큰(간단 버전)
const WaitSchema = new mongoose.Schema(
  {
    busId: { type: String, required: true },
    stopId: { type: String, required: false },
    time: { type: String, required: false }, // "HH:MM"
    token: { type: String, required: true, unique: true },
    canceled: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    canceledAt: { type: Date, default: null },
  },
  { collection: "Wait", timestamps: false }
);
const Wait = mongoose.model("Wait", WaitSchema);

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
          id: String(i + 1), // /stops 응답용 id
          name: s?.정류장명 ?? "(이름없음)",
          lng: Number(lng),
          lat: Number(lat),
        };
      })
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));

    if (out.length === 0) {
      // DB 비었을 때 기본 3개
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
    res
      .status(500)
      .json({ error: "정류장 데이터를 불러올 수 없습니다." });
  }
});

/* ---------------------- 차량 위치 ---------------------- */

// GET: 사용자/앱용 현재 차량 위치 목록
app.get("/bus/location", async (_req, res) => {
  try {
    const query = filterByAllowedBusIds({
      lat: { $ne: null },
      lng: { $ne: null },
    });

    const vehicles = await Vehicle.find(query)
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

// POST: Termux/기사앱/디바이스에서 GPS 업로드
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

// (옵션) 위치 리셋 API — 필요하면 쓰고, 안 써도 됨
app.post("/bus/location/reset/:imei", async (req, res) => {
  const { imei } = req.params;
  try {
    await Vehicle.updateOne(
      { id: imei },
      { $set: { lat: null, lng: null, heading: 0 } }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("❌ /bus/location/reset:", e);
    res.status(500).json({ ok: false, error: "reset 실패" });
  }
});

/* ---------------------- /vehicles (기사앱용 셔틀 목록) ---------------------- */

app.get("/vehicles", async (_req, res) => {
  try {
    const vQuery =
      ALLOWED_BUS_IDS && ALLOWED_BUS_IDS.length
        ? { id: { $in: ALLOWED_BUS_IDS } }
        : {};

    let list = await Vehicle.find(vQuery)
      .select("id route -_id")
      .lean();

    list = (list || [])
      .filter((v) => v.id)
      .map((v) => ({
        id: String(v.id),
        label: v.route ? String(v.route) : String(v.id), // "1호차" 이런 이름
      }));

    // Vehicle 비어있으면 timebus 기반 fallback (필요 없으면 삭제해도 됨)
    if (!list.length) {
      const docs = await Timebus.find({})
        .select("routeId direction -_id")
        .lean();
      const rawIds = (docs || [])
        .map((d) => d.routeId || d.direction)
        .filter(Boolean);
      const uniqIds = [...new Set(rawIds)];

      const labelMap = {
        "ansan-line-1": "1호차",
        "ansan-line-2": "2호차",
        "상록수역→대학": "셔틀A",
        "대학→상록수역": "셔틀B",
      };

      list = uniqIds.map((id) => ({
        id,
        label: labelMap[id] || id,
      }));
    }

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

// GET /bus/active : 사용자 앱에서 "현재 운행 중 셔틀 리스트" 표시용
app.get("/bus/active", async (_req, res) => {
  try {
    const now = Date.now();
    const ACTIVE_MS = 30 * 60 * 1000; // 최근 30분 내

    const q = {
      active: true,
      updatedAt: { $gte: new Date(now - ACTIVE_MS) },
    };

    if (ALLOWED_BUS_IDS && ALLOWED_BUS_IDS.length) {
      q.id = { $in: ALLOWED_BUS_IDS };
    }

    const list = await ActiveBus.find(q).lean();
    res.json(list);
  } catch (e) {
    console.error("❌ /bus/active GET:", e);
    res.status(500).json({ error: "active 조회 실패" });
  }
});

// PUT /bus/active : 기사앱이 "운행 시작/갱신/종료" 업서트하는 곳
app.put("/bus/active", async (req, res) => {
  try {
    const {
      id,
      stopId,
      time,
      driver,
      route,
      routeLabel,
      active,
      serviceWindow,
      fromStopId,
      fromStopName,
      toStopId,
      toStopName,
    } = req.body || {};

    if (!id) {
      return res.status(400).json({ error: "id 필수" });
    }

    // 운행 종료
    if (active === false) {
      const doc = await ActiveBus.findOneAndUpdate(
        { id: String(id) },
        { $set: { active: false, updatedAt: new Date() } },
        { new: true }
      );
      return res.json({
        ok: true,
        id: doc ? doc.id : String(id),
        stopped: true,
      });
    }

    // 운행 시작/갱신
    if (!stopId || !time) {
      return res
        .status(400)
        .json({ error: "stopId, time 필수 (active=true일 때)" });
    }

    const doc = await ActiveBus.findOneAndUpdate(
      { id: String(id) },
      {
        $set: {
          stopId: String(stopId),
          time: String(time),
          driver: driver ?? null,
          route: route ?? null,
          routeLabel: routeLabel ?? null,
          fromStopId: fromStopId ? String(fromStopId) : null,
          fromStopName: fromStopName ?? null,
          toStopId: toStopId ? String(toStopId) : null,
          toStopName: toStopName ?? null,
          active: true,
          serviceWindow: serviceWindow || null,
          updatedAt: new Date(),
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true, // ✅ capacity/onboard 기본값 적용
      }
    );

    return res.json({ ok: true, id: doc.id });
  } catch (e) {
    console.error("❌ /bus/active PUT:", e);
    return res.status(500).json({ error: "active 업서트 실패" });
  }
});

/* ---------------------- QR 체크인 ---------------------- */
// QR 코드 포맷: EVERBUS_{busId}_{time}
// 예: EVERBUS_350599638756152_08:30
app.post("/qr/checkin", async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ ok: false, error: "code 필수" });
    }

    const raw = String(code);
    const PREFIX = "EVERYBUS_";
    if (!raw.startsWith(PREFIX)) {
      return res
        .status(400)
        .json({ ok: false, error: "유효하지 않은 QR 형식입니다." });
    }

    const payload = raw.slice(PREFIX.length); // "<busId>_<time>"
    const lastIdx = payload.lastIndexOf("_");
    if (lastIdx === -1) {
      return res
        .status(400)
        .json({ ok: false, error: "QR에서 busId/time 파싱 실패" });
    }

    const busId = payload.slice(0, lastIdx);
    const time = payload.slice(lastIdx + 1);

    if (!busId || !time) {
      return res
        .status(400)
        .json({ ok: false, error: "busId 또는 time 정보가 비어 있습니다." });
    }

    // ALLOWED_BUS_IDS 체크 (설정된 경우만)
    if (
      ALLOWED_BUS_IDS &&
      ALLOWED_BUS_IDS.length &&
      !ALLOWED_BUS_IDS.includes(String(busId))
    ) {
      return res
        .status(403)
        .json({ ok: false, error: "허용되지 않은 버스 ID" });
    }

    // 현재 운행 중인 해당 셔틀 찾기 (id + time + active=true)
    const doc = await ActiveBus.findOneAndUpdate(
      {
        id: String(busId),
        time: String(time),
        active: true,
      },
      {
        $inc: { onboard: 1 },
        $set: { updatedAt: new Date() },
      },
      { new: true }
    );

    if (!doc) {
      return res.status(404).json({
        ok: false,
        error:
          "해당 QR에 맞는 운행 정보를 찾을 수 없습니다. (운행 시작 전일 수도 있음)",
      });
    }

    return res.json({
      ok: true,
      id: doc.id,
      time: doc.time,
      onboard: doc.onboard ?? 0,
      capacity: doc.capacity ?? null,
    });
  } catch (e) {
    console.error("❌ /qr/checkin:", e);
    res.status(500).json({ ok: false, error: "QR 체크인 처리 실패" });
  }
});

/* ---------------------- 대기 시스템 (/wait) ---------------------- */

// 대기 등록
app.post("/wait", async (req, res) => {
  try {
    const { busId, stopId, time } = req.body || {};
    if (!busId) {
      return res.status(400).json({ ok: false, error: "busId 필수" });
    }

    const token =
      `${busId}-${Date.now().toString(36)}-` +
      Math.random().toString(36).slice(2, 8);

    await Wait.create({
      busId: String(busId),
      stopId: stopId ? String(stopId) : null,
      time: time ? String(time) : null,
      token,
    });

    const q = { busId: String(busId), canceled: false };
    if (stopId) q.stopId = String(stopId);
    if (time) q.time = String(time);

    const waiting = await Wait.countDocuments(q);

    res.json({
      ok: true,
      token,
      waiting,
      capacity: null,
      seatsLeft: null,
      full: false,
    });
  } catch (e) {
    console.error("❌ /wait POST:", e);
    res.status(500).json({ ok: false, error: "wait 등록 실패" });
  }
});

// 대기 취소
app.post("/wait/cancel", async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ ok: false, error: "token 필수" });
    }

    const doc = await Wait.findOneAndUpdate(
      { token },
      { $set: { canceled: true, canceledAt: new Date() } },
      { new: true }
    );

    if (!doc) {
      return res.json({ ok: false, error: "해당 토큰 없음" });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ /wait/cancel:", e);
    res.status(500).json({ ok: false, error: "wait 취소 실패" });
  }
});

// 대기 요약
app.get("/wait/summary", async (req, res) => {
  try {
    const { busId, stopId, time } = req.query || {};
    if (!busId && !stopId) {
      return res.json({
        ok: true,
        waiting: 0,
        capacity: null,
        seatsLeft: null,
        full: false,
      });
    }

    const q = { canceled: false };
    if (busId) q.busId = String(busId);
    if (stopId) q.stopId = String(stopId);
    if (time) q.time = String(time);

    const waiting = await Wait.countDocuments(q);

    res.json({
      ok: true,
      busId: busId || null,
      stopId: stopId || null,
      time: time || null,
      waiting,
      capacity: null,
      seatsLeft: null,
      full: false,
    });
  } catch (e) {
    console.error("❌ /wait/summary:", e);
    res.status(500).json({ ok: false, error: "wait summary 실패" });
  }
});

/* ---------------------- 노선(Route) ---------------------- */

// 노선 저장
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

// 노선 조회
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
    if (ALLOWED_BUS_IDS && ALLOWED_BUS_IDS.length) {
      console.log("🚍 ALLOWED_BUS_IDS:", ALLOWED_BUS_IDS.join(", "));
    } else {
      console.log("🚍 ALLOWED_BUS_IDS 미설정 — 모든 버스 ID 사용");
    }
    app.listen(PORT, () =>
      console.log(`✅ 서버 실행 중: http://localhost:${PORT}`)
    );
  })
  .catch((err) => {
    console.error("❌ MongoDB 연결 실패:", err.message);
    process.exit(1);
  });
