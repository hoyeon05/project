const express = require("express");
const cors = require("cors");
const app = express();

app.use(express.json());

// CORS 설정
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5000",
    "https://everybus4.onrender.com"   // 프론트 주소
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200
}));
app.options("*", cors());   // 프리플라이트 대응

const port = process.env.PORT || 5000;

// /bus-info
app.get("/bus-info", (req, res) => {
  res.json([
    { id: 1, name: "상록수역", lat: 37.303611793223766, lng: 126.8668823 },
    { id: 2, name: "안산대학교", lat: 37.309534355054419, lng: 126.873 }
  ]);
});

// /stops (프론트 호환용)
app.get("/stops", (req, res) => {
  res.json([
    { id: 1, name: "상록수역", lat: 37.303611793223766, lng: 126.8668823, nextArrivals: [] },
    { id: 2, name: "안산대학교", lat: 37.309534355054419, lng: 126.873, nextArrivals: [] }
  ]);
});

app.listen(port, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${port}`);
});
