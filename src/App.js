// DriverApp.js — EveryBus 기사님용
// 패치: 운행 시작 직후 즉시 GPS 1회 업로드 + (옵션) 좌표 reset

import React, { useState, useEffect, useMemo } from "react";
import "./App.css";

const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";

const GPS_POLL_MS = 8000;
const PASSENGER_POLL_MS = 5000;
const SERVICE_WINDOW_MINUTES = 120;

let cachedBase = null;
async function getBase() {
  if (cachedBase) return cachedBase;
  for (const b of [PROD_SERVER_URL, LOCAL_SERVER_URL]) {
    try { const r = await fetch(`${b}/health`); if (r.ok) { cachedBase = b; return b; } } catch {}
  }
  cachedBase = PROD_SERVER_URL;
  return cachedBase;
}

function extractSeatInfo(raw, busId) {
  const list = Array.isArray(raw) ? raw : [raw];
  const item = list.find((v) => v && String(v.id) === String(busId));
  if (!item) return null;
  const capacity = Number(item.capacity ?? item.seatCapacity ?? item.maxSeats ?? item.totalSeats ?? 24);
  const onboard = Number(item.onboard ?? item.passengers ?? item.currentPassengers ?? 0);
  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  const safeOnboard = Number.isFinite(onboard) && onboard >= 0 ? onboard : 0;
  return { capacity, onboard: safeOnboard, left: Math.max(0, capacity - safeOnboard) };
}

export default function DriverApp() {
  const [busId, setBusId] = useState("");
  const [driver, setDriver] = useState("");
  const [stopName, setStopName] = useState("");
  const [stopId, setStopId] = useState("");
  const [time, setTime] = useState("");
  const [isDriving, setIsDriving] = useState(false);

  const [capacity, setCapacity] = useState(null);
  const [onboard, setOnboard] = useState(0);
  const [showQR, setShowQR] = useState(false);

  const [busOptions, setBusOptions] = useState([]);
  const [stops, setStops] = useState([]);
  const driverOptions = ["김기사", "박기사", "이기사", "최기사"];

  useEffect(() => {
    (async () => {
      const base = await getBase();
      // 1) /vehicles
      let vehicles = [];
      try {
        const r = await fetch(`${base}/vehicles`);
        if (r.ok) {
          const data = await r.json();
          vehicles = (Array.isArray(data) ? data : []).map((v) => ({
            id: String(v.id), label: v.label ? String(v.label) : String(v.id)
          })).filter(v => v.id);
        }
      } catch {}
      // 2) fallback: /bus/location
      if (!vehicles.length) {
        try {
          const r2 = await fetch(`${base}/bus/location`, { cache: "no-store" });
          if (r2.ok) {
            const arr = await r2.json();
            const uniqIds = Array.from(new Set((arr || []).map(v => v && v.id && String(v.id)).filter(Boolean)));
            vehicles = uniqIds.map((id) => ({ id, label: id }));
          }
        } catch {}
      }
      setBusOptions(vehicles);

      // stops
      try {
        const r = await fetch(`${base}/stops`); if (r.ok) setStops(await r.json());
      } catch {}
    })();
  }, []);

  const stopIdByName = useMemo(() => {
    const m = new Map(); stops.forEach((s) => m.set(s.name, String(s.id))); return m;
  }, [stops]);

  // GPS 주기 업로드
  useEffect(() => {
    if (!isDriving || !busId) return;
    let timer;
    const loop = async () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const base = await getBase();
          try {
            await fetch(`${base}/bus/location/${busId}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, heading: 0 }),
            });
            console.log(`📡 위치 전송(${busId}): ${pos.coords.latitude}, ${pos.coords.longitude}`);
          } catch (err) { console.warn("❌ 위치 전송 실패", err); }
        },
        (err) => console.warn("❌ 위치 가져오기 실패", err),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
      timer = setTimeout(loop, GPS_POLL_MS);
    };
    loop();
    return () => clearTimeout(timer);
  }, [isDriving, busId]);

  // 승객/좌석 폴링
  useEffect(() => {
    if (!isDriving || !busId) { setOnboard(0); return; }
    let timer;
    const poll = async () => {
      try {
        const base = await getBase();
        const r = await fetch(`${base}/bus/active`, { cache: "no-store" });
        if (r.ok) {
          const data = await r.json();
          const seat = extractSeatInfo(data, busId);
          if (seat) { setCapacity(seat.capacity); setOnboard(seat.onboard); }
        }
      } catch {}
      timer = setTimeout(poll, PASSENGER_POLL_MS);
    };
    poll();
    return () => clearTimeout(timer);
  }, [isDriving, busId]);

  async function sendActiveToServer(payload) {
    const base = await getBase();
    try {
      const res = await fetch(`${base}/bus/active`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok && data && data.ok !== false;
    } catch { return false; }
  }

  // (추가) 즉시 GPS 1회 업로드
  async function pushImmediateGPS() {
    if (!navigator.geolocation) return;
    await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const base = await getBase();
            await fetch(`${base}/bus/location/${busId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : 0,
              }),
            });
            console.log("📍 운행시작 즉시 좌표 업로드 완료");
          } catch {}
          resolve();
        },
        () => resolve(),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    });
  }

  const handleToggle = async () => {
    if (isDriving) {
      if (!window.confirm("운행을 종료하시겠습니까?")) return;
      await sendActiveToServer({ id: busId, active: false });
      setIsDriving(false); setShowQR(false); return;
    }

    if (!busId || !driver || !stopName || !time) {
      alert("버스, 기사, 정류장, 시간을 모두 입력해주세요."); return;
    }

    // (옵션) 지난 좌표 리셋 — 원하지 않으면 주석
    try {
      const base = await getBase();
      await fetch(`${base}/bus/location/reset/${busId}`, { method: "POST" });
    } catch {}

    const now = Date.now();
    const start = new Date(now).toISOString();
    const end = new Date(now + SERVICE_WINDOW_MINUTES * 60 * 1000).toISOString();
    const sid = stopIdByName.get(stopName) || stopId || stopName;

    const ok = await sendActiveToServer({
      id: busId, stopId: sid, time, driver,
      route: "안산대 셔틀", active: true,
      serviceWindow: { start, end },
    });
    if (!ok) { alert("운행 시작 실패!"); return; }

    await pushImmediateGPS();     // ⬅️ 즉시 업로드
    setIsDriving(true);
    setShowQR(true);
    console.log(`✅ 운행 시작: ${busId}, ${driver}, ${stopName}, ${time}`);
  };

  const handleNowTime = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    setTime(`${hh}:${mm}`);
  };

  const leftSeats = capacity != null ? Math.max(0, capacity - onboard) : null;

  return (
    <div className="page-container">
      <header className="page-header"><h1 className="page-title">{isDriving ? "🟢 운행 중" : "🚍 EveryBus 운행 관리"}</h1></header>
      <div className="page-content" style={{ marginTop: 20 }}>
        {isDriving ? (
          <>
            <div className="card">
              <div className="card-subtitle">현재 운행 정보</div>
              <div className="info-item"><b>버스:</b> {(busOptions.find((b) => b.id === busId) || {}).label || busId}</div>
              <div className="info-item"><b>기사:</b> {driver}</div>
              <div className="info-item"><b>정류장:</b> {stopName}</div>
              <div className="info-item"><b>출발 시간:</b> {time}</div>
              <div className="divider" />
              <div className="info-item"><b>탑승 인원:</b> {onboard} 명</div>
              <div className="info-item"><b>남은 좌석:</b> {leftSeats != null ? `${leftSeats} 석` : "좌석 정보 없음"}</div>
              {capacity != null && <div className="info-text" style={{ marginTop: 4 }}>(총 좌석수: {capacity}석)</div>}
            </div>
            <div className="card">
              <div className="card-subtitle">승객 QR 코드</div>
              {/* ... 기존 QR 생성 로직 유지 ... */}
            </div>
            <button className="button-primary stop" onClick={handleToggle}>운행 종료</button>
          </>
        ) : (
          <>
            <div className="card"><div className="card-subtitle">1️⃣ 버스 선택</div>
              {busOptions.length === 0 ? <div className="info-text">등록된 실시간 셔틀이 없습니다.</div> :
                busOptions.map((b) => (
                  <label key={b.id} style={{ display: "block", margin: "4px 0" }}>
                    <input type="radio" name="bus" value={b.id} checked={busId === b.id} onChange={() => setBusId(b.id)} /> {b.label}
                  </label>))}
            </div>

            <div className="card"><div className="card-subtitle">2️⃣ 기사 선택</div>
              {driverOptions.map((d) => (
                <label key={d} style={{ display: "block", margin: "4px 0" }}>
                  <input type="radio" name="driver" value={d} checked={driver === d} onChange={() => setDriver(d)} /> {d}
                </label>))}
            </div>

            <div className="card"><div className="card-subtitle">3️⃣ 정류장 선택</div>
              {stops.map((s) => (
                <label key={s.id} style={{ display: "block", margin: "4px 0" }}>
                  <input type="radio" name="stop" value={s.name}
                    checked={stopName === s.name}
                    onChange={() => { setStopName(s.name); setStopId(String(s.id)); }} /> {s.name}
                </label>))}
            </div>

            <div className="card"><div className="card-subtitle">4️⃣ 출발 시간 설정</div>
              <input type="time" className="text-input" value={time} onChange={(e) => setTime(e.target.value)} />
              <button className="button-primary start" onClick={handleNowTime} style={{ marginTop: 8 }}>현재 시간으로 설정</button>
            </div>

            <button className="button-primary start" onClick={handleToggle}>운행 시작</button>
          </>
        )}
      </div>
    </div>
  );
}
