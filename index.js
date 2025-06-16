const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.get('/bus-info', (req, res) => {
  const stops = [
    { name: '상록수역', lat: 37.3021, lng: 126.8667 },
    { name: '한대앞역', lat: 37.3121, lng: 126.8535 },
    { name: '안산대학교', lat: 37.3094, lng: 126.8736 },
  ];
  res.json(stops);
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});
