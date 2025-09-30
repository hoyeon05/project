// server.js
// EveryBus 백엔드 — 수정본
// - 정류장 목록: GET /stops, /bus-info
// - 모든 버스 최신 위치: GET /bus/location  ← 프론트가 폴링
// - GPS 디바이스 위치 업로드: POST /bus/location/:imei
// - 헬스체크: GET /health

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

// ---------------------- 미들웨어 ----------------------
app.use(express.json());

// CORS (프리플라이트 포함) — 프론트 배포 도메인 허용
app.use(
  cors({
    origin: [
      "http://localhost:3000",            // CRA dev
      "http://localhost:5173",            // Vite dev
      "http://localhost:5000",            // (필요 시) 동일 포트 프론트
      "https://everybus4.onrender.com",   // ✅ 실제 프론트 배포 도메인
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 200,
  })
);

// ---------------------- 데이터(임시) ----------------------
// 임시 정류장 데이터 (안산대 근처 좌표)
const BUS_POINTS = [
  { id: "1", name: "상록수역",   lat: 37.303611793223766, lng: 126.8668823 },
  { id: "2", name: "안산대학교", lat: 37.309534355054419, lng: 126.873 },
];

// 초기 버스 목록 (위치 좌표 제거)
// '350599638756152' 디바이스가 실GPS 셔틀로 쓰이는 IMEI
const INITIAL_VEHICLES_DATA = [
  { id: "350599638756152", route: "셔틀A" }, // 실GPS
  { id: "v102", route: "셔틀A" },
  { id: "v201", route: "순환" },
];

// 메모리 저장소: key = 버스 ID(IMEI), value = { lat, lng, route, heading, updatedAt }
const BUS_LOCATIONS = {};
INITIAL_VEHICLES_DATA.forEach((v) => {
  BUS_LOCATIONS[v.id] = {
    ...v,
    lat: 37.3070,   // 초기 기본 위도 (안산대 근처)
    lng: 126.8700,  // 초기 기본 경도
    heading: 0,
    updatedAt: Date.now(),
  };
});

// ---------------------- 라우트 ----------------------
// 헬스 체크
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

// 정류장 간단 정보
app.get("/bus-info", (req, res) => {
  res.json(BUS_POINTS);
});

// 정류장(+가짜 도착예정) 포맷
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

// ✅ 프론트가 폴링하는 엔드포인트: 모든 버스의 최신 위치 배열로 반환
app.get("/bus/location", (req, res) => {
  const vehicles = Object.values(BUS_LOCATIONS)
    .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng))
    .map((v) => ({
      id: v.id,
      route: v.route,
      lat: v.lat,
      lng: v.lng,
      heading: v.heading,
      updatedAt: v.updatedAt,
    }));
  res.json(vehicles);
});

// GPS 디바이스가 위치를 업로드 (버스 실제 위치 업데이트)
app.post("/bus/location/:imei", (req, res) => {
  const busId = req.params.imei;
  const { lat, lng, heading } = req.body;

  // 유효성 체크
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res
      .status(400)
      .json({ error: "위도(lat)와 경도(lng)는 숫자(Number)여야 합니다." });
  }

  // 등록되지 않은 버스면 임시 등록
  if (!BUS_LOCATIONS[busId]) {
    console.warn(`[GPS WARN] 미등록 버스 ID 위치 업로드: ${busId}`);
    BUS_LOCATIONS[busId] = {
      id: busId,
      route: "미정",
      lat,
      lng,
      heading: Number.isFinite(heading) ? heading : 0,
      updatedAt: Date.now(),
    };
    return res.status(202).json({ message: `새 버스(${busId}) 위치 기록 시작` });
  }

  // 업데이트
  BUS_LOCATIONS[busId].lat = lat;
  BUS_LOCATIONS[busId].lng = lng;
  if (Number.isFinite(heading)) BUS_LOCATIONS[busId].heading = heading;
  BUS_LOCATIONS[busId].updatedAt = Date.now();

  console.log(
    `[GPS UPDATE] ${busId} → lat=${lat.toFixed(5)}, lng=${lng.toFixed(5)}`
  );
  res.status(200).json({ status: "OK", updatedId: busId });
});

// (선택) 사용자 데이터 포맷 — 필요 시 유지
app.get("/user/data/:imei", (req, res) => {
  const imei = req.params.imei;
  const vehicles = Object.values(BUS_LOCATIONS)
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => ({
      id: v.id,
      route: v.route,
      lat: v.lat,
      lng: v.lng,
      heading: v.heading,
      updatedAt: v.updatedAt,
    }));

  res.json({
    user: { device_id: imei, model: `User Device ${imei}`, status: "ACTIVE" },
    vehicles,
  });
});

// 404 핸들러(선택)
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// ---------------------- 서버 시작 ----------------------
app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
