// server.js
// EveryBus 백엔드 — MongoDB 연동 버전 (Mongoose 사용)
// - 정류장 목록: GET /stops, /bus-info (메모리 사용)
// - 모든 버스 최신 위치: GET /bus/location (DB 조회)
// - GPS 디바이스 위치 업로드: POST /bus/location/:imei (DB 업데이트/등록)
// - 헬스체크: GET /health

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose"); // 1. Mongoose 추가

const app = express();
const PORT = process.env.PORT || 5000;

// ---------------------- MongoDB 설정 ----------------------
// 💡 중요: 실제 사용 시에는 환경 변수(process.env.MONGO_URI)로 관리해야 합니다.
// 'hyeo0522?'의 물음표(?)가 연결 문자열 쿼리 구분자와 충돌할 수 있어 URL 인코딩 필요
// 하지만 Mongoose는 connect 시 인코딩을 자동으로 처리해 줄 때가 많으므로,
// DB 이름만 추가하고 형식대로 넣어두겠습니다.
// **경고: 실제 비밀번호를 여기에 직접 넣는 것은 보안상 매우 위험합니다.**
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://master:ULUoh16HeSO0m0RJ@cluster0.rpczfaj.mongodb.net/everybus_db?appName=Cluster0";

// ---------------------- Mongoose 스키마 및 모델 ----------------------
// 2. 버스 위치/차량 정보 스키마 정의
const VehicleSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // 버스 ID (IMEI)
  route: { type: String, default: "미정" }, // 노선 정보
  lat: { type: Number, default: null }, // 위도 (처음엔 null 가능)
  lng: { type: Number, default: null }, // 경도 (처음엔 null 가능)
  heading: { type: Number, default: 0 }, // 방향
  updatedAt: { type: Number, default: null }, // 마지막 업데이트 타임스탬프
}, {
  // MongoDB의 기본 _id는 사용하지만, API 응답에는 포함하지 않도록 처리할 예정
  timestamps: false, // 기본 createdAt, updatedAt 대신 사용자 정의 필드 사용
});

// 인덱스 설정 (조회 및 업데이트 속도 향상)
VehicleSchema.index({ id: 1 });
VehicleSchema.index({ lat: 1, lng: 1 }); // 위치 기반 조회에 대비

// 모델 생성
const Vehicle = mongoose.model("Vehicle", VehicleSchema);

// ---------------------- 초기 데이터(메모리 유지 데이터) ----------------------
// 3. 정류장 데이터 (DB에 넣을 필요 없이 메모리에 유지)
const BUS_POINTS = [
  { id: "1", name: "상록수역", lat: 37.303611793223766, lng: 126.8668823 },
  { id: "2", name: "안산대학교", lat: 37.309534355054419, lng: 126.873 },
];

// 초기 버스 목록 (DB에 한 번 삽입할 데이터)
const INITIAL_VEHICLES_DATA = [
  { id: "350599638756152", route: "셔틀A" }, // 실제 GPS 디바이스 ID (IMEI)
  { id: "v102", route: "셔틀A" },
  { id: "v201", route: "순환" },
];

/**
 * DB에 초기 차량 데이터가 없는 경우 삽입
 */
async function seedInitialData() {
  try {
    const count = await Vehicle.countDocuments({ id: { $in: INITIAL_VEHICLES_DATA.map(v => v.id) } });
    if (count === 0) {
      console.log("🛠️ 초기 버스 데이터가 없어 삽입을 시작합니다.");
      const vehiclesToInsert = INITIAL_VEHICLES_DATA.map(v => ({
        ...v,
        lat: null,
        lng: null,
        heading: 0,
        updatedAt: null,
      }));
      await Vehicle.insertMany(vehiclesToInsert, { ordered: false });
      console.log(`✅ 초기 버스 ${vehiclesToInsert.length}대 등록 완료.`);
    } else {
      console.log(`🚌 DB에 ${count}개의 버스 데이터가 이미 존재합니다.`);
    }
  } catch (error) {
    console.error("❌ 초기 데이터 삽입 중 오류 발생:", error.message);
  }
}

// ---------------------- 미들웨어 ----------------------
app.use(express.json());

// CORS 설정
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:5000",
      "https://everybus4.onrender.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 200,
  })
);

// ---------------------- 라우트 ----------------------

// 헬스 체크 및 DB 연결 상태 표시
app.get("/health", (req, res) => {
  res.status(200).json({ 
    ok: true, 
    ts: Date.now(),
    dbStatus: mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED"
  });
});

// 정류장 간단 정보 (메모리 데이터 사용)
app.get("/bus-info", (req, res) => {
  res.json(BUS_POINTS);
});

// 정류장(+가짜 도착예정) 포맷 (메모리 데이터 사용)
app.get("/stops", (req, res) => {
  const stops = BUS_POINTS.map((b) => ({
    id: String(b.id),
    name: b.name,
    lat: b.lat,
    lng: b.lng,
    nextArrivals: [
      b.id === "1" ? "5분 후" : "1분 후",
      b.id === "2" ? "2분 후" : "7분 후",
    ],
  }));
  res.json(stops);
});

// ✅ DB 조회: 프론트가 폴링하는 엔드포인트: 모든 버스의 최신 위치 배열로 반환
app.get("/bus/location", async (req, res) => {
  try {
    // 위도(lat)와 경도(lng)가 null이 아닌 (위치가 보고된) 버스만 조회
    const vehicles = await Vehicle.find({ 
      lat: { $ne: null },
      lng: { $ne: null },
    })
    // 필요한 필드만 선택하고 MongoDB 내부 _id는 제외
    .select('id route lat lng heading updatedAt -_id') 
    .lean(); // 일반 JS 객체로 반환하여 더 빠름

    res.json(vehicles);
  } catch (error) {
    console.error("❌ 버스 위치 조회 중 오류 발생:", error.message);
    res.status(500).json({ error: "버스 위치를 조회할 수 없습니다." });
  }
});

// ✅ DB 업데이트: GPS 디바이스가 위치를 업로드 (버스 실제 위치 업데이트)
app.post("/bus/location/:imei", async (req, res) => {
  const busId = req.params.imei;
  const { lat, lng, heading } = req.body;

  // 유효성 체크
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res
      .status(400)
      .json({ error: "위도(lat)와 경도(lng)는 숫자(Number)여야 합니다." });
  }

  const updateFields = {
    lat: lat,
    lng: lng,
    updatedAt: Date.now(),
  };

  if (Number.isFinite(heading)) {
    updateFields.heading = heading;
  }
  
  try {
    // ID가 busId인 문서를 찾아 업데이트하거나, 없으면 새로 생성 (upsert: true)
    const result = await Vehicle.findOneAndUpdate(
      { id: busId }, 
      { 
        $set: updateFields,
        // 새로운 문서 생성 시 route 필드를 "미정"으로 초기화
        $setOnInsert: { id: busId, route: "미정" }
      },
      { 
        new: true, // 업데이트된 문서 반환
        upsert: true, // 없으면 생성
        setDefaultsOnInsert: true // 새로운 문서 생성 시 기본값 적용
      }
    );

    console.log(
      `[GPS UPDATE] ${result.id} (${result.route}) → lat=${lat.toFixed(5)}, lng=${lng.toFixed(5)}`
    );

    // 새 문서를 생성한 경우 (isNew를 Mongoose가 직접 제공하지 않으므로 결과 비교로 확인)
    if (result.route === "미정" && result.lat === lat) { 
        return res.status(202).json({ message: `새 버스(${busId}) 위치 기록 시작`, updatedId: busId });
    }

    res.status(200).json({ status: "OK", updatedId: busId });

  } catch (error) {
    console.error("❌ 버스 위치 업데이트 중 오류 발생:", error.message);
    res.status(500).json({ error: "위치 업데이트에 실패했습니다." });
  }
});

// (선택) 사용자 데이터 포맷 — 이 엔드포인트는 /bus/location을 재사용하여 DB에서 데이터 조회
app.get("/user/data/:imei", async (req, res) => {
  const imei = req.params.imei;
  
  try {
    const vehicles = await Vehicle.find({ 
      lat: { $ne: null },
      lng: { $ne: null },
    })
    .select('id route lat lng heading updatedAt -_id') 
    .lean();

    res.json({
      user: { device_id: imei, model: `User Device ${imei}`, status: "ACTIVE" },
      vehicles,
    });
  } catch (error) {
    console.error("❌ 사용자 데이터 조회 중 오류 발생:", error.message);
    res.status(500).json({ error: "데이터를 조회할 수 없습니다." });
  }
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// ---------------------- 서버 시작 ----------------------

// 4. MongoDB 연결 및 서버 시작
mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log("🟢 MongoDB에 성공적으로 연결되었습니다.");
    await seedInitialData(); // 초기 데이터 시딩 실행

    // DB 연결 성공 후 Express 서버 시작
    app.listen(PORT, () => {
      console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB 연결 실패:", err.message);
    process.exit(1); // 연결 실패 시 앱 종료
  });

