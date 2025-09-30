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

// ⭐ [수정] 초기 버스 목록 (위치 좌표 제거)
const INITIAL_VEHICLES_DATA = [
    // 🔑 '350599638756152' 디바이스가 셔틀A 버스의 GPS 역할을 수행합니다.
    { id: '350599638756152', route: '셔틀A' }, 
    // v102 (셔틀A): 다른 버스
    { id: 'v102', route: '셔틀A' },
    // v201 (순환): 다른 버스
    { id: 'v201', route: '순환' },
];

// 🚌 버스 위치를 저장할 메모리 저장소. 
// key: 버스 ID (IMEI 역할), value: { lat, lng, route, heading, updatedAt }
const BUS_LOCATIONS = {};
INITIAL_VEHICLES_DATA.forEach(v => {
    // 🔑 [수정] 초기 위치를 안산대 근처 유효한 좌표로 설정합니다. 
    // 이렇게 하면 POST API로 위치를 보내기 전에도 App.js에서 TypeError가 발생하는 것을 방지할 수 있습니다.
    BUS_LOCATIONS[v.id] = { 
        ...v, 
        lat: 37.3070, // 초기 기본 위도
        lng: 126.8700, // 초기 기본 경도
        heading: 0, 
        updatedAt: Date.now() 
    };
});

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
      b.id === '1' ? '5분 후' : '1분 후',
      b.id === '2' ? '2분 후' : '7분 후'
    ],
  }));
  res.json(stops);
});

// 버스 GPS 디바이스가 위치를 서버에 전송하는 API (POST)
// 이 API를 통해 실제 버스의 위치가 업데이트됩니다.
app.post('/bus/location/:imei', (req, res) => {
    const busId = req.params.imei;
    const { lat, lng, heading } = req.body;

    // 필수 위치 정보 누락 확인
    if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ error: "위도(lat)와 경도(lng)는 필수입니다." });
    }

    // 해당 버스 ID가 존재하는지 확인
    if (!BUS_LOCATIONS[busId]) {
        console.warn(`[GPS ERROR] 알 수 없는 버스 ID로 위치 전송 시도: ${busId}`);
        // 임시로 노선 정보가 없는 새 버스로 등록
        BUS_LOCATIONS[busId] = { id: busId, route: '미정', lat, lng, heading: heading || 0, updatedAt: Date.now() };
        return res.status(202).json({ message: `새 버스(${busId}) 위치 기록 시작` });
    }

    // 버스 위치 정보 업데이트
    BUS_LOCATIONS[busId].lat = lat;
    BUS_LOCATIONS[busId].lng = lng;
    BUS_LOCATIONS[busId].heading = heading; // 헤딩 정보가 있다면 업데이트
    BUS_LOCATIONS[busId].updatedAt = Date.now();

    console.log(`[GPS UPDATE] 버스 ${busId} 위치 업데이트: lat=${lat.toFixed(5)}, lng=${lng.toFixed(5)}`);
    
    res.status(200).json({ status: "OK", updatedId: busId });
});

// 프론트엔드가 모든 버스의 최신 위치를 조회하는 API (GET)
// POST로 받은 실제 위치 정보를 반환합니다.
app.get('/user/data/:imei', (req, res) => {
    const imei = req.params.imei; // 이 imei는 프론트엔드를 사용하는 사용자의 ID
    
    // 프론트엔드는 모든 버스 위치를 받아 지도에 표시해야 하므로, 저장소의 모든 데이터를 반환합니다.
    const vehicles = Object.values(BUS_LOCATIONS)
        // 유효한 위치 정보(null이 아님)를 가진 버스만 전송
        .filter(v => v.lat !== null && v.lng !== null)
        .map(v => ({
            id: v.id,
            route: v.route,
            lat: v.lat,
            lng: v.lng,
            heading: v.heading,
            updatedAt: v.updatedAt
        }));

    const responseData = {
        // user 정보는 사용자 앱의 디바이스 ID를 통해 임시로 생성하여 반환 
        user: { device_id: imei, model: `User Device ${imei}`, status: "ACTIVE" },
        vehicles: vehicles // POST로 업데이트된 실제 위치 데이터 전송
    };
    
    res.json(responseData);
});

app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
