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

// ⭐ DUMMY_VEHICLES를 동적으로 생성하여 더미 사용자 기기(IMEI)가 버스 역할을 하도록 합니다.
// 서버가 재시작될 때 초기 위치를 설정합니다.
const INITIAL_VEHICLES = [
    // v101 (셔틀A): 상록수역에서 안산대로 이동 중인 버스 역할
    { id: 'v101', route: '셔틀A', lat: 37.3045, lng: 126.8675, heading: 45 },
    // v102 (셔틀A): 안산대에서 상록수역으로 이동 중인 버스 역할
    { id: 'v102', route: '셔틀A', lat: 37.3085, lng: 126.8725, heading: 225 },
    // v201 (순환): 안산대 근처 순환 중인 버스 역할
    { id: 'v201', route: '순환', lat: 37.3090, lng: 126.8732, heading: 180 },
];

// 🚌 버스 위치를 저장할 메모리 저장소 (IMEI가 버스 ID 역할을 합니다.)
const BUS_LOCATIONS = {};
INITIAL_VEHICLES.forEach(v => {
    // 임시로 v101, v102, v201을 IMEI와 매칭시킨다고 가정
    BUS_LOCATIONS[v.id] = { ...v, updatedAt: Date.now() };
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
      // 버스 위치를 더 가까이 조정했으므로 다음 도착 시간 정보도 임의로 추가
      b.id === '1' ? '5분 후' : '1분 후',
      b.id === '2' ? '2분 후' : '7분 후'
    ],
  }));
  res.json(stops);
});


// ⭐ 변경된 엔드포인트: 프론트엔드에서 `/user/data/:imei`를 호출하면
// 해당 IMEI(버스 ID)를 가진 버스 목록을 응답하고, 내부적으로는 버스 위치를 시뮬레이션하여 업데이트합니다.
app.get('/user/data/:imei', (req, res) => {
    const imei = req.params.imei;
    
    // 💡 실제 시뮬레이션: 시간을 기반으로 버스 위치를 조금씩 움직입니다.
    const vehicles = Object.values(BUS_LOCATIONS).map(v => {
        const timeFactor = (Date.now() % 60000) / 60000; // 0 ~ 1 사이의 값
        let newLat = v.lat;
        let newLng = v.lng;

        // 노선에 따라 움직이는 방향을 다르게 설정하여 움직이는 것처럼 보이게 함
        if (v.route === '셔틀A') {
            // 상록수역(37.303) <-> 안산대(37.309) 사이를 왕복 시뮬레이션
            newLat = 37.303 + (37.309 - 37.303) * (Math.sin(timeFactor * 2 * Math.PI) * 0.5 + 0.5);
            newLng = 126.867 + (126.873 - 126.867) * (Math.cos(timeFactor * 2 * Math.PI) * 0.5 + 0.5);
            v.heading = (v.heading + 5) % 360; // 헤딩도 조금씩 변경
        } else if (v.route === '순환') {
            // 안산대 주변을 작은 원형으로 순환 시뮬레이션
            newLat = 37.3090 + Math.sin(timeFactor * 2 * Math.PI) * 0.0005;
            newLng = 126.8732 + Math.cos(timeFactor * 2 * Math.PI) * 0.0005;
            v.heading = (v.heading + 10) % 360;
        }

        // 새 위치를 메모리에 저장
        v.lat = newLat;
        v.lng = newLng;
        v.updatedAt = Date.now();
        
        return {
            id: v.id,
            route: v.route,
            lat: v.lat,
            lng: v.lng,
            heading: v.heading,
            updatedAt: v.updatedAt
        };
    });

    const responseData = {
        // user 정보는 버스 ID를 통해 임시로 생성하여 반환 (프론트엔드에서 필요할 경우 대비)
        user: { device_id: imei, model: `Bus ${imei}`, status: "BUS" },
        vehicles: vehicles // 동적으로 변경된 버스 위치 전송
    };
    
    res.json(responseData);
});

app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
