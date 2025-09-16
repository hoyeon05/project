// index.js
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// CORS (프리플라이트 포함)
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5000",
      "https://everybus4.onrender.com", // 프론트 도메인
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 200,
  })
);
app.options("*", cors());

// 헬스 체크
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// 샘플 데이터 (원하는 형식으로 교체 가능)
const BUS_POINTS = [
  { id: "1", name: "상록수역", lat: 37.303611793223766, lng: 126.8668823 },
  { id: "2", name: "안산대학교", lat: 37.309534355054419, lng: 126.873 },
];

// /bus-info: 원본(임의) 데이터 예시
app.get("/bus-info", (req, res) => {
  // 필요하면 여기서 ETA 등 추가 가공
  res.json(BUS_POINTS);
});

// /stops: 프론트 호환용 스키마(id/name/lat/lng/nextArrivals)
app.get("/stops", (req, res) => {
  const stops = BUS_POINTS.map((b) => ({
    id: String(b.id),
    name: b.name,
    lat: b.lat,
    lng: b.lng,
    nextArrivals: [], // 필요 시 ETA 문자열 배열로 채우기
  }));
  res.json(stops);
});

app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
