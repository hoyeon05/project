// server.js — EveryBus Backend (ActiveBus + Wait/Board + MongoDB Atlas)
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 5000;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json());
app.use(cors());

// === MongoDB 연결 ===
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://master:ULUoh16HeSO0m0RJ@cluster0.rpczfaj.mongodb.net/busdb?appName=Cluster0";

// === 스키마 ===
const ActiveBusSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    stopId: { type: String, required: true },
    time: { type: String, required: true },
    driver: { type: String, default: null },
    route: { type: String, default: null },
    active: { type: Boolean, default: true },
    serviceWindow: {
      start: { type: Date, default: null },
      end: { type: Date, default: null },
    },
    boardings: { type: Number, default: 0 }, // 탑승자
    waitings: { type: Number, default: 0 }, // 대기자
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "ActiveBus", timestamps: false }
);
const ActiveBus = mongoose.model("ActiveBus", ActiveBusSchema);

// === 기본 ===
app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    ts: Date.now(),
    db: mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED",
  })
);

// === 운행 정보 ===
app.get("/bus/active", async (_req, res) => {
  try {
    const rows = await ActiveBus.find({}).lean();
    res.json(
      rows.map((r) => ({
        id: r.id,
        stopId: r.stopId,
        time: r.time,
        driver: r.driver,
        route: r.route,
        active: r.active,
        serviceWindow: r.serviceWindow,
        boardings: r.boardings || 0,
        waitings: r.waitings || 0,
      }))
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === 기사앱에서 PUT ===
app.put("/bus/active", async (req, res) => {
  const body = req.body || {};
  try {
    const doc = await ActiveBus.findOneAndUpdate(
      { id: String(body.id) },
      {
        $set: {
          stopId: String(body.stopId),
          time: String(body.time),
          driver: body.driver,
          route: body.route,
          active: body.active !== false,
          serviceWindow: body.serviceWindow,
          updatedAt: new Date(),
        },
      },
      { new: true, upsert: true }
    );
    res.json({ ok: true, id: doc.id });
  } catch (e) {
    res.status(500).json({ error: "업서트 실패" });
  }
});

// ✅ 대기 추가/취소
app.post("/wait/toggle", async (req, res) => {
  try {
    const { busId, stopId, time, cancel } = req.body;
    if (!busId || !stopId || !time)
      return res.status(400).json({ error: "필수 값 누락" });

    const bus = await ActiveBus.findOne({ id: busId });
    if (!bus) return res.status(404).json({ error: "버스 없음" });

    let newWait = bus.waitings || 0;
    newWait = cancel ? Math.max(0, newWait - 1) : newWait + 1;

    await ActiveBus.updateOne({ id: busId }, { $set: { waitings: newWait } });
    console.log(`🕓 [대기] ${busId}: ${cancel ? "-1" : "+1"} → ${newWait}`);
    res.json({ ok: true, waitings: newWait });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "대기 처리 실패" });
  }
});

// ✅ QR 탑승 처리
app.post("/qr-board", async (req, res) => {
  try {
    const { busId, time } = req.body;
    if (!busId || !time)
      return res.status(400).json({ error: "busId, time 필요" });

    const bus = await ActiveBus.findOne({ id: busId });
    if (!bus) return res.status(404).json({ error: "버스 없음" });

    const newBoard = (bus.boardings || 0) + 1;
    const newWait = Math.max(0, (bus.waitings || 0) - 1);
    await ActiveBus.updateOne(
      { id: busId },
      { $set: { boardings: newBoard, waitings: newWait, updatedAt: new Date() } }
    );
    console.log(`🚍 [탑승] ${busId}: board=${newBoard}, wait=${newWait}`);
    res.json({ ok: true, boardings: newBoard, waitings: newWait });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "QR 탑승 처리 실패" });
  }
});

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB 연결 성공");
    app.listen(PORT, () => console.log(`🚀 서버 실행 중: ${PORT}`));
  })
  .catch((err) => console.error("❌ MongoDB 연결 실패:", err.message));
