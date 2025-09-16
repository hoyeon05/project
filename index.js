const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:5000", "https://everybus3.onrender.com"]
}));

const port = process.env.PORT || 5000;

app.get('/bus-info', (req, res) => {
  res.json([
    { name: "상록수역", lat: 37.303611793223766, lng: 126.86688233780662 },
    { name: "안산대학교", "lat": 37.30953435504419, "lng": 126.87350757149399, }
  ]);
});

app.listen(port, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${port}`);
});
