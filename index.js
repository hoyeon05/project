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
      "https://everybus4.onrender.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 200,
  })
);

// 임시 정류장 데이터 (안산대 근처 좌표)
const BUS_POINTS = [
  { id: "1", name: "상록수역", lat: 37.303611793223766, lng: 126.8668823 },
  { id: "2", name: "안산대학교", lat: 37.309534355054419, lng: 126.873 },
];

// ⭐ 수정된 임시 버스 위치 데이터 (vehicles)
// 셔틀 A (v101, v102)는 상록수역과 안산대 사이 경로 근처에 위치하도록 조정
// 순환 (v201)은 안산대 근처에 위치하도록 조정
const DUMMY_VEHICLES = [
    // v101: 상록수역에서 출발하여 안산대로 가는 길목 (상록수역 근처)
    { id: 'v101', lat: 37.3045, lng: 126.8675, route: '셔틀A', heading: 45, updatedAt: Date.now() - 30000 },
    // v102: 안산대에서 상록수역으로 가는 길목 (안산대 근처)
    { id: 'v102', lat: 37.3085, lng: 126.8725, route: '셔틀A', heading: 225, updatedAt: Date.now() - 10000 },
    // v201: 안산대 캠퍼스 근처 순환 중
    { id: 'v201', lat: 37.3090, lng: 126.8732, route: '순환', heading: 180, updatedAt: Date.now() - 5000 },
];

// 임시 사용자 데이터 (DB 역할을 대신)
const DUMMY_USERS = {
    // IMEI 1: 350599638756152
    "350599638756152": { 
        device_id: "350599638756152", 
        model: "Galaxy S25", 
        status: "ACTIVE" 
    },
};

// 헬스 체크
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/bus-info", (req, res) => {
  res.json(BUS_POINTS);
});

app.get("/stops", (req, res) => {
  const stops = BUS_POINTS.map((b) => ({
    id: String(b.id),
    name: b.name,
    lat: b.lat,
    lng: b.lng,
    nextArrivals: [
      // 버스 위치를 더 가까이 조정했으므로 다음 도착 시간 정보도 임의로 추가
      b.id === '1' ? '5분 후' : '1분 후',
      b.id === '2' ? '2분 후' : '7분 후'
    ],
  }));
  res.json(stops);
});

// ⭐ 수정된 엔드포인트: 버스 위치가 정류장 근처에 있도록 조정된 DUMMY_VEHICLES 사용
app.get('/user/data/:imei', (req, res) => {
    const imei = req.params.imei;
    const user = DUMMY_USERS[imei] || null;
    
    // 버스 위치 데이터 사용 (위경도 조정됨)
    const vehicles = DUMMY_VEHICLES;

    const responseData = {
        user: user,
        vehicles: vehicles
    };
    
    res.json(responseData);
});

app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
