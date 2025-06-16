const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const port = process.env.PORT || 5000;  // ✅ 이게 핵심!!

app.get('/bus-info', (req, res) => {
  res.json([
    { name: "상록수역", lat: 37.3025, lng: 126.8667 },
    { name: "안산대학교", lat: 37.3100, lng: 126.8235 }
  ]);
});

app.listen(port, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${port}`);
});
