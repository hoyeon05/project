const express = require("express");
const cors = require("cors");
const app = express();

app.use(express.json());

// 프리플라이트(OPTIONS) 포함해서 모두 허용
// 기존
app.get("/bus-info", (req, res) => {
  res.json([
    { name: "상록수역",  lat: 37.303611793223766, lng: 126.8668823 },
    { name: "안산대학교", lat: 37.309534355054419, lng: 126.873 }
  ]);
});

// 호환용 /stops (id, name, lat, lng로 맞춰줌)
app.get("/stops", (req, res) => {
  const busInfo = [
    { name: "상록수역",  lat: 37.303611793223766, lng: 126.8668823 },
    { name: "안산대학교", lat: 37.309534355054419, lng: 126.873 }
  ];
  const stops = busInfo.map((b, i) => ({
    id: String(i + 1),
    name: b.name,
    lat: b.lat,
    lng: b.lng,
    nextArrivals: []  // 필요하면 ETA 넣기
  }));
  res.json(stops);
});
