// DriverApp.js — EveryBus 기사님용 (Render 서버 연동 완성본)
// 서버: https://project-1-ek9j.onrender.com
// 기능: 운행 시작/종료, 실시간 위치 전송, 탑승자 수 확인, QR코드 발급
// 수정: 버스 선택 시 DB(/vehicles)에 등록된 실시간 셔틀 목록 사용

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

export default function DriverApp() {
  const [busId, setBusId] = useState("");
  const [driver, setDriver] = useState("");
  const [stopName, setStopName] = useState("");
  const [stopId, setStopId] = useState("");
  const [time, setTime] = useState("");
  const [isDriving, setIsDriving] = useState(false);
  const [passengers] = useState(0);
  const [showQR, setShowQR] = useState(false);

  // busOptions: [{ id, label }]
  const [busOptions, setBusOptions] = useState([]);
  const [stops, setStops] = useState([]);

  const driverOptions = ["김기사", "박기사", "이기사", "최기사"];

  /* 🚌 서버에서 차량 / 정류장 불러오기
     1순위: /vehicles -> {id,label}
     2순위: /bus/location -> id 목록 (label=id)
  */
  useEffect(() => {
    (async () => {
      const base = await getBase();

      // 1) /vehicles 시도
      let vehicles = [];
      try {
        const r = await fetch(`${base}/vehicles`);
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data) && data.length > 0) {
            vehicles = data
              .map((v) => ({
                id: String(v.id),
                label: v.label ? String(v.label) : String(v.id),
              }))
              .filter((v) => v.id);
            console.log("🚍 vehicles(from /vehicles):", vehicles);
          }
        }
      } catch (e) {
        console.warn("❌ /vehicles 오류:", e);
      }

      // 2) 비어 있으면 /bus/location 기반 폴백
      if (!vehicles.length) {
        try {
          const r2 = await fetch(`${base}/bus/location`);
          if (r2.ok) {
            const arr = await r2.json();
            const uniqIds = Array.from(
              new Set(
                (Array.isArray(arr) ? arr : [])
                  .map((v) => v && v.id && String(v.id))
                  .filter(Boolean)
              )
            );
            vehicles = uniqIds.map((id) => ({
              id,
              label: id,
            }));
            console.log("🚍 vehicles(from /bus/location fallback):", vehicles);
          }
        } catch (e) {
          console.warn("❌ /bus/location 오류:", e);
        }
      }

      setBusOptions(vehicles);

      // 정류장 목록
      try {
        const r = await fetch(`${base}/stops`);
        if (r.ok) {
          const arr = await r.json();
          setStops(Array.isArray(arr) ? arr : []);
        }
      } catch (e) {
        console.warn("❌ /stops 오류:", e);
      }
    })();
  }, []);

  const stopIdByName = useMemo(() => {
    const m = new Map();
    stops.forEach((s) => m.set(s.name, String(s.id)));
    return m;
  }, [stops]);

  /* 🛰️ GPS 자동 전송: 운행 중 + busId 선택 시에만 */
  useEffect(() => {
    if (!isDriving || !busId) return;
    let timer;

    const loop = async () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(async (pos) => {
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
            `📡 위치 전송(${busId}): ${pos.coords.latitude}, ${pos.coords.longitude}`
          );
        } catch (err) {
          console.warn("❌ 위치 전송 실패", err);
        }
      });
      timer = setTimeout(loop, GPS_POLL_MS);
    };

    loop();
    return () => clearTimeout(timer);
  }, [isDriving, busId]);

  async function sendActiveToServer(payload) {
    const base = await getBase();
    try {
      const res = await fetch(`${base}/bus/active`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok && data && data.ok !== false;
    } catch (e) {
      console.warn("❌ /bus/active 통신 실패", e);
      return false;
    }
  }

  /* 🚦 운행 시작 / 종료 */
  const handleToggle = async () => {
    // 운행 종료
    if (isDriving) {
      if (!window.confirm("운행을 종료하시겠습니까?")) return;
      await sendActiveToServer({
        id: busId,
        active: false, // server.js에서 종료 처리
      });
      setIsDriving(false);
      return;
    }

    // 운행 시작
    if (!busId || !driver || !stopName || !time) {
      alert("버스, 기사, 정류장, 시간을 모두 입력해주세요.");
      return;
    }

    const now = Date.now();
    const start = new Date(now).toISOString();
    const end = new Date(
      now + SERVICE_WINDOW_MINUTES * 60 * 1000
    ).toISOString();
    const sid = stopIdByName.get(stopName) || stopId || stopName;

    const ok = await sendActiveToServer({
      id: busId, // 실제 DB vehicle id
      stopId: sid,
      time,
      driver,
      route: "안산대 셔틀", // 필요하면 /vehicles에서 라벨 사용하도록 바꿔도 됨
      active: true,
      serviceWindow: { start, end },
    });

    if (!ok) {
      alert("운행 시작 실패! (네트워크 또는 서버 오류)");
      return;
    }

    setIsDriving(true);
    console.log(`✅ 운행 시작: ${busId}, ${driver}, ${stopName}, ${time}`);
  };

  const handleNowTime = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    setTime(`${hh}:${mm}`);
  };

  /* 🧾 QR URL 자동 생성 */
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => {
    (async () => {
      const base = await getBase();
      if (busId && time) {
        const encoded = encodeURIComponent(`EVERYBUS_${busId}_${time}`);
        setQrUrl(
          `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encoded}`
        );
      } else setQrUrl("");
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
                <b>버스:</b>{" "}
                {
                  (busOptions.find((b) => b.id === busId) || {})
                    .label || busId
                }
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
            {/* 1️⃣ 버스 선택 */}
            <div className="card">
              <div className="card-subtitle">1️⃣ 버스 선택</div>
              {busOptions.length === 0 ? (
                <div className="info-text">
                  등록된 실시간 셔틀이 없습니다. (관리자에게 차량 등록 요청)
                </div>
              ) : (
                busOptions.map((b) => (
                  <label
                    key={b.id}
                    style={{ display: "block", margin: "4px 0" }}
                  >
                    <input
                      type="radio"
                      name="bus"
                      value={b.id}
                      checked={busId === b.id}
                      onChange={() => setBusId(b.id)}
                    />{" "}
                    {b.label}
                  </label>
                ))
              )}
            </div>

            {/* 2️⃣ 기사 선택 */}
            <div className="card">
              <div className="card-subtitle">2️⃣ 기사 선택</div>
              {driverOptions.map((d) => (
                <label
                  key={d}
                  style={{ display: "block", margin: "4px 0" }}
                >
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

            {/* 3️⃣ 정류장 선택 */}
            <div className="card">
              <div className="card-subtitle">3️⃣ 정류장 선택</div>
              {stops.map((s) => (
                <label
                  key={s.id}
                  style={{ display: "block", margin: "4px 0" }}
                >
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

            {/* 4️⃣ 출발 시간 설정 */}
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
        <div
          className="qr-modal-overlay"
          onClick={() => setShowQR(false)}
        >
          <div
            className="qr-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            {qrUrl ? (
              <img src={qrUrl} alt="QR" />
            ) : (
              <div>QR 생성 중...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
