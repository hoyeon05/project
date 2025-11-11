// DriverApp.js — EveryBus 기사님용 (Render 서버 연동 완성본)
// 서버: https://project-1-ek9j.onrender.com
// 기능: 운행 시작/종료, 실시간 위치 전송, QR코드 발급

import React, { useState, useEffect, useMemo } from "react";
import "./App.css";

const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";
const GPS_POLL_MS = 8000; // 위치 갱신 주기 (8초)
const SERVICE_WINDOW_MINUTES = 120;

let cachedBase = null;
async function getBase() {
  if (cachedBase) return cachedBase;
  for (const b of [PROD_SERVER_URL, LOCAL_SERVER_URL]) {
    try {
      const r = await fetch(`${b}/health`);
      if (r.ok) {
        cachedBase = b;
        console.log(`✅ 연결된 서버: ${b}`);
        return b;
      }
    } catch {}
  }
  cachedBase = PROD_SERVER_URL;
  return cachedBase;
}

// /bus/active/start
async function startActiveOnServer(payload) {
  const base = await getBase();
  try {
    const res = await fetch(`${base}/bus/active/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// /bus/active/stop
async function stopActiveOnServer(id) {
  const base = await getBase();
  try {
    const res = await fetch(`${base}/bus/active/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: String(id) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default function DriverApp() {
  const [busId, setBusId] = useState("");
  const [driver, setDriver] = useState("");
  const [stopName, setStopName] = useState("");
  const [stopId, setStopId] = useState("");
  const [time, setTime] = useState("");
  const [isDriving, setIsDriving] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const [busOptions, setBusOptions] = useState([]);
  const [stops, setStops] = useState([]);

  const driverOptions = ["김기사", "박기사", "이기사", "최기사"];

  // 차량 / 정류장 불러오기
  useEffect(() => {
    (async () => {
      const base = await getBase();
      try {
        // 차량 목록은 /vehicles 사용 (id, label)
        const r = await fetch(`${base}/vehicles`);
        if (r.ok) {
          const arr = await r.json();
          const list = (Array.isArray(arr) ? arr : []).map((v) => ({
            id: String(v.id),
            label: v.label || String(v.id),
          }));
          setBusOptions(list);
        }
      } catch {}

      try {
        const r = await fetch(`${base}/stops`);
        if (r.ok) {
          const arr = await r.json();
          setStops(arr);
        }
      } catch {}
    })();
  }, []);

  const stopIdByName = useMemo(() => {
    const m = new Map();
    stops.forEach((s) => m.set(s.name, String(s.id)));
    return m;
  }, [stops]);

  // GPS 자동 전송
  useEffect(() => {
    if (!isDriving || !busId) return;
    let timerId;

    const loop = async () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const base = await getBase();
          try {
            await fetch(`${base}/bus/location/${busId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                heading: 0,
              }),
            });
            console.log(
              `📡 위치 전송: ${pos.coords.latitude}, ${pos.coords.longitude}`
            );
          } catch (err) {
            console.warn("❌ 위치 전송 실패", err);
          }
        },
        () => {},
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 5000 }
      );

      timerId = setTimeout(loop, GPS_POLL_MS);
    };

    loop();
    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [isDriving, busId]);

  const handleToggle = async () => {
    // 운행 종료
    if (isDriving) {
      if (!window.confirm("운행을 종료하시겠습니까?")) return;
      const ok = await stopActiveOnServer(busId);
      if (!ok) {
        alert("운행 종료 전송 실패(서버) — 다시 시도해주세요.");
        return;
      }
      setIsDriving(false);
      setShowQR(false);
      return;
    }

    // 운행 시작
    if (!busId || !driver || !stopName || !time) {
      alert("버스, 기사, 정류장, 시간을 모두 입력해주세요.");
      return;
    }

    const trimmedTime = String(time).trim();
    const now = Date.now();
    const start = new Date(now).toISOString();
    const end = new Date(now + SERVICE_WINDOW_MINUTES * 60 * 1000).toISOString();
    const sid = stopIdByName.get(stopName) || stopId || stopName;

    const ok = await startActiveOnServer({
      id: String(busId),
      stopId: String(sid),
      time: trimmedTime,
      driver,
      route: "안산대 셔틀",
      serviceWindow: { start, end },
    });

    if (!ok) {
      alert("운행 시작 실패(서버 통신 오류)");
      return;
    }

    console.log(`✅ 운행 시작: ${busId}, ${driver}, ${stopName}, ${trimmedTime}`);
    setIsDriving(true);
    setShowQR(true);
  };

  const handleNowTime = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    setTime(`${hh}:${mm}`);
  };

  // QR URL (EVERYBUS_busId_time)
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => {
    (async () => {
      if (busId && time) {
        const data = `EVERYBUS_${busId}_${String(time).trim()}`;
        const encoded = encodeURIComponent(data);
        setQrUrl(
          `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encoded}`
        );
      } else {
        setQrUrl("");
      }
    })();
  }, [busId, time]);

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">
          {isDriving ? "🟢 운행 중" : "🚍 EveryBus 운행 관리"}
        </h1>
      </header>

      <div className="page-content" style={{ marginTop: 20 }}>
        {isDriving ? (
          <>
            <div className="card">
              <div className="card-subtitle">현재 운행 정보</div>
              <div className="info-item">
                <b>버스:</b> {busId}
              </div>
              <div className="info-item">
                <b>기사:</b> {driver}
              </div>
              <div className="info-item">
                <b>정류장:</b> {stopName}
              </div>
              <div className="info-item">
                <b>출발 시간:</b> {time}
              </div>
            </div>

            <div className="card">
              <div className="card-subtitle">승객 QR 코드</div>
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt="QR"
                  style={{ width: 220, height: 220, margin: "auto" }}
                />
              ) : (
                <div className="info-text">QR 생성 중...</div>
              )}
            </div>

            <button className="button-primary stop" onClick={handleToggle}>
              운행 종료
            </button>
          </>
        ) : (
          <>
            <div className="card">
              <div className="card-subtitle">1️⃣ 버스 선택</div>
              {busOptions.map((b) => (
                <label key={b.id} style={{ display: "block", margin: "4px 0" }}>
                  <input
                    type="radio"
                    name="bus"
                    value={b.id}
                    checked={busId === b.id}
                    onChange={() => setBusId(b.id)}
                  />{" "}
                  {b.label}
                </label>
              ))}
            </div>

            <div className="card">
              <div className="card-subtitle">2️⃣ 기사 선택</div>
              {driverOptions.map((d) => (
                <label key={d} style={{ display: "block", margin: "4px 0" }}>
                  <input
                    type="radio"
                    name="driver"
                    value={d}
                    checked={driver === d}
                    onChange={() => setDriver(d)}
                  />{" "}
                  {d}
                </label>
              ))}
            </div>

            <div className="card">
              <div className="card-subtitle">3️⃣ 정류장 선택</div>
              {stops.map((s) => (
                <label key={s.id} style={{ display: "block", margin: "4px 0" }}>
                  <input
                    type="radio"
                    name="stop"
                    value={s.name}
                    checked={stopName === s.name}
                    onChange={() => {
                      setStopName(s.name);
                      setStopId(String(s.id));
                    }}
                  />{" "}
                  {s.name}
                </label>
              ))}
            </div>

            <div className="card">
              <div className="card-subtitle">4️⃣ 출발 시간 설정</div>
              <input
                type="time"
                className="text-input"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                style={{
                  fontSize: "1.1rem",
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #ccc",
                  background: "#fdfdfd",
                }}
              />
              <button
                className="button-primary start"
                onClick={handleNowTime}
                style={{ marginTop: 8 }}
              >
                현재 시간으로 설정
              </button>
            </div>

            <button className="button-primary start" onClick={handleToggle}>
              운행 시작
            </button>
          </>
        )}
      </div>

      {isDriving && showQR && (
        <div className="qr-modal-overlay" onClick={() => setShowQR(false)}>
          <div
            className="qr-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            {qrUrl ? <img src={qrUrl} alt="QR" /> : <div>QR 생성 중...</div>}
          </div>
        </div>
      )}
    </div>
  );
}
