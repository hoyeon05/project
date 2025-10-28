// server.js
// EveryBus 백엔드 — MongoDB Atlas + CORS 전면 허용 + GeoJSON 정식 스키마

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 5000;

// ---------------------- MongoDB 연결 ----------------------
// ⚠️ 실제 배포에서는 .env 로 분리하세요!
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://master:ULUoh16HeSO0m0RJ@cluster0.rpczfaj.mongodb.net/everybusdb?appName=Cluster0";

// ---------------------- 스키마 정의 ----------------------

// 🚌 버스 정보
const VehicleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // IMEI 등
    route: { type: String, default: "미정" },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    heading: { type: Number, default: 0 },
    // 날짜 타입으로 두는 게 검색·정렬 편함
    updatedAt: { type: Date, default: null },
  },
  { collection: "bus", timestamps: false }
);
const Vehicle = mongoose.model("Vehicle", VehicleSchema);

// 🚏 정류장 정보 (⚠️ GeoJSON: [lng, lat], 2dsphere 인덱스)
const BusStopSchema = new mongoose.Schema(
  {
    정류장명: { type: String, required: true, unique: true },
    위치: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
        validate: {
          validator: (arr) =>
            Array.isArray(arr) &&
            arr.length === 2 &&
            Number.isFinite(arr[lat]) &&
            Number.isFinite(arr[lng]),
          message: "위치.coordinates는 [lng, lat] 형식의 숫자 2개여야 합니다.",
        },
      },
    },
  },
  { collection: "busstop", timestamps: false }
);
// 지오스페이셜 쿼리를 위해 필수
BusStopSchema.index({ 위치: "2dsphere" });

const BusStop = mongoose.model("BusStop", BusStopSchema);

// ---------------------- 미들웨어 ----------------------
// ✅ CORS 완전 허용 (테스트/개발용)
app.use(
  cors({
    origin: true, // 모든 Origin 허용
    credentials: true,
  })
);

app.use(express.json());

// ---------------------- 라우트 ----------------------

// ✅ 헬스체크
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    ts: Date.now(),
    dbStatus:
      mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED",
  });
});

// ✅ 정류장 목록 (/bus-info)
app.get("/bus-info", async (req, res) => {
  try {
    const stops = await BusStop.find({})
      .select("정류장명 위치 -_id")
      .lean();

    const formatted = stops.map((s, i) => {
      const coords = s?.위치?.coordinates ?? [null, null]; // [lng, lat]
      return {
        id: String(i + 1),
        name: s.정류장명,
        lng: coords[0],
        lat: coords[1],
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error("❌ 정류장 정보 조회 오류:", error);
    res.status(500).json({ error: "정류장 정보를 불러올 수 없습니다." });
  }
});

// ✅ 정류장 + 도착 예정 시간 (/stops) — 데모용 더미 ETA
app.get("/stops", async (req, res) => {
  try {
    const stops = await BusStop.find({})
      .select("정류장명 위치 -_id")
      .lean();

    const formatted = stops
      .map((s, i) => {
        const coords = s?.위치?.coordinates ?? [null, null];
        const [lng, lat] = coords;
        return {
          id: String(i + 1),
          name: s?.정류장명 ?? "(이름없음)",
          lng: Number.isFinite(lng) ? lng : null,
          lat: Number.isFinite(lat) ? lat : null,
          nextArrivals: [
            s.정류장명 === "상록수역" ? "5분 후" : "1분 후",
            s.정류장명 === "안산대학교" ? "2분 후" : "7분 후",
          ],
        };
      })
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));

    res.json(formatted);
  } catch (error) {
    console.error("❌ 정류장 데이터 조회 오류:", error);
    res.status(500).json({ error: "정류장 데이터를 불러올 수 없습니다." });
  }
});

// ✅ 모든 버스의 현재 위치 (/bus/location)
app.get("/bus/location", async (req, res) => {
  try {
    const vehicles = await Vehicle.find({
      lat: { $ne: null },
      lng: { $ne: null },
    })
      .select("id route lat lng heading updatedAt -_id")
      .lean();

    res.json(vehicles);
  } catch (error) {
    console.error("❌ 버스 위치 조회 오류:", error);
    res.status(500).json({ error: "버스 위치를 조회할 수 없습니다." });
  }
});

// ✅ GPS 기기에서 버스 위치 업로드 (/bus/location/:imei)
app.post("/bus/location/:imei", async (req, res) => {
  const busId = req.params.imei;

  // 문자열로 와도 안전하게 숫자로 변환
  const lat = Number.parseFloat(req.body.lat);
  const lng = Number.parseFloat(req.body.lng);
  const heading = req.body.heading !== undefined ? Number.parseFloat(req.body.heading) : undefined;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res
      .status(400)
      .json({ error: "위도(lat)와 경도(lng)는 숫자(Number)여야 합니다." });
  }

  const updateFields = {
    lat,
    lng,
    updatedAt: new Date(),
  };
  if (Number.isFinite(heading)) updateFields.heading = heading;

  try {
    const result = await Vehicle.findOneAndUpdate(
      { id: busId },
      { $set: updateFields, $setOnInsert: { id: busId, route: "미정" } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    console.log(
      `[GPS UPDATE] ${busId} → lat=${lat.toFixed(5)}, lng=${lng.toFixed(5)}, heading=${Number.isFinite(heading) ? heading : "-"}`
    );

    res.status(200).json({ status: "OK", updatedId: busId });
  } catch (error) {
    console.error("❌ 버스 위치 업데이트 오류:", error);
    res.status(500).json({ error: "위치 업데이트에 실패했습니다." });
  }
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
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
