// DriverApp.js — EveryBus 기사님용 (Render 서버 연동 + 좌석 실시간 표시 + GPS 즉시 업로드 개선)
// 서버: https://project-1-ek9j.onrender.com

import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";

const GPS_POLL_MS = 8000;           // 위치 주기 업로드
const PASSENGER_POLL_MS = 5000;     // 좌석/탑승 인원 폴링
const SERVICE_WINDOW_MINUTES = 120; // 운행 윈도우

let cachedBase = null;
async function getBase() {
  if (cachedBase) return cachedBase;
  for (const b of [PROD_SERVER_URL, LOCAL_SERVER_URL]) {
    try {
      const r = await fetch(`${b}/health`, { cache: "no-store" });
      if (r.ok) {
        cachedBase = b;
        console.log("✅ 연결된 서버:", b);
        return b;
      }
    } catch {}
  }
  cachedBase = PROD_SERVER_URL;
  return cachedBase;
}

// /bus/active 응답에서 좌석/탑승 정보 꺼내기
function extractSeatInfo(raw, busId) {
  const list = Array.isArray(raw) ? raw : [raw];
  const item = list.find((v) => v && String(v.id) === String(busId));
  if (!item) return null;

  const capacity = Number(
    item.capacity ??
      item.seatCapacity ??
      item.maxSeats ??
      item.totalSeats ??
      45 // 기본 좌석 수(필요시 수정)
  );
  const onboard = Number(item.onboard ?? item.passengers ?? 0);

  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  const safeOnboard = Number.isFinite(onboard) && onboard >= 0 ? onboard : 0;
  const left = Math.max(0, capacity - safeOnboard);

  return { capacity, onboard: safeOnboard, left };
}

export default function DriverApp() {
  const [busId, setBusId] = useState("");
  const [driver, setDriver] = useState("");
  const [stopName, setStopName] = useState("");
  const [stopId, setStopId] = useState("");
  const [time, setTime] = useState("");
  const [isDriving, setIsDriving] = useState(false);

  // 좌석 정보
  const [capacity, setCapacity] = useState(null);
  const [onboard, setOnboard] = useState(0);

  const [showQR, setShowQR] = useState(false);

  // 선택 목록
  const [busOptions, setBusOptions] = useState([]);
  const [stops, setStops] = useState([]);

  const driverOptions = ["김기사", "박기사", "이기사", "최기사"];

  // 초기 데이터 로딩 (vehicles, stops)
  useEffect(() => {
    (async () => {
      const base = await getBase();

      // 1) /vehicles
      let vehicles = [];
      try {
        const r = await fetch(`${base}/vehicles`, { cache: "no-store" });
        if (r.ok) {
          const data = await r.json();
          vehicles = (data || [])
            .map((v) => ({ id: String(v.id), label: v.label ? String(v.label) : String(v.id) }))
            .filter((v) => v.id);
          console.log("🚍 vehicles(from /vehicles):", vehicles);
        }
      } catch (e) {
        console.warn("❌ /vehicles 오류:", e);
      }

      // 2) fallback: /bus/location
      if (!vehicles.length) {
        try {
          const r2 = await fetch(`${base}/bus/location`, { cache: "no-store" });
          if (r2.ok) {
            const arr = await r2.json();
            const uniqIds = Array.from(
              new Set((Array.isArray(arr) ? arr : []).map((v) => v && v.id && String(v.id)).filter(Boolean))
            );
            vehicles = uniqIds.map((id) => ({ id, label: id }));
            console.log("🚍 vehicles(from /bus/location fallback):", vehicles);
          }
        } catch (e) {
          console.warn("❌ /bus/location 오류:", e);
        }
      }

      setBusOptions(vehicles);

      // 정류장 목록
      try {
        const r = await fetch(`${base}/stops`, { cache: "no-store" });
        if (r.ok) {
          const arr = await r.json();
          setStops(Array.isArray(arr) ? arr : []);
        }
      } catch (e) {
        console.warn("❌ /stops 오류:", e);
      }
    })();
  }, []);

  // 정류장 이름 → id
  const stopIdByName = useMemo(() => {
    const m = new Map();
    stops.forEach((s) => m.set(s.name, String(s.id)));
    return m;
  }, [stops]);

  // 주기 GPS 업로드(운행 중에만)
  useEffect(() => {
    if (!isDriving || !busId) return;
    let timer;

    const loop = async () => {
      if (!navigator.geolocation) {
        console.warn("이 기기는 위치 정보를 지원하지 않습니다.");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const base = await getBase();
          const body = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : 0,
          };
          try {
            await fetch(`${base}/bus/location/${busId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            console.log(`📡 위치 전송(${busId}): ${body.lat}, ${body.lng}`);
          } catch (err) {
            console.warn("❌ 위치 전송 실패", err);
          }
        },
        (err) => {
          console.warn("❌ 위치 가져오기 실패", err);
        },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
      );

      timer = setTimeout(loop, GPS_POLL_MS);
    };

    loop();
    return () => clearTimeout(timer);
  }, [isDriving, busId]);

  // 좌석/탑승 인원 폴링(운행 중일 때만)
  useEffect(() => {
    if (!isDriving || !busId) {
      setOnboard(0);
      return;
    }
    let timer;
    const poll = async () => {
      try {
        const base = await getBase();
        const r = await fetch(`${base}/bus/active`, { cache: "no-store" });
        if (r.ok) {
          const data = await r.json();
          const seat = extractSeatInfo(data, busId);
          if (seat) {
            setCapacity(seat.capacity);
            setOnboard(seat.onboard);
          }
        }
      } catch (e) {
        console.warn("❌ 좌석/탑승 폴링 실패", e);
      }
      timer = setTimeout(poll, PASSENGER_POLL_MS);
    };
    poll();
    return () => clearTimeout(timer);
  }, [isDriving, busId]);

  // 공용 함수: /bus/active 업서트
  async function upsertActive(payload) {
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

  // 운행 시작/종료
  const handleToggle = async () => {
    // 종료
    if (isDriving) {
      if (!window.confirm("운행을 종료하시겠습니까?")) return;
      await upsertActive({ id: busId, active: false });
      setIsDriving(false);
      setShowQR(false);
      return;
    }

    // 시작
    if (!busId || !driver || !stopName || !time) {
      alert("버스, 기사, 정류장, 시간을 모두 입력해주세요.");
      return;
    }
    const base = await getBase();

    const now = Date.now();
    const start = new Date(now).toISOString();
    const end = new Date(now + SERVICE_WINDOW_MINUTES * 60 * 1000).toISOString();
    const sid = stopIdByName.get(stopName) || stopId || stopName;

    // (선택) 이전 좌표 리셋 — 오래된 좌표가 남아있을 가능성 제거
    try {
      await fetch(`${base}/bus/location/reset/${busId}`, { method: "POST" });
    } catch {}

    // active 업서트
    const ok = await upsertActive({
      id: busId,
      stopId: sid,
      time,
      driver,
      route: "안산대 셔틀",
      active: true,
      serviceWindow: { start, end },
    });
    if (!ok) {
      alert("운행 시작 실패! (네트워크 또는 서버 오류)");
      return;
    }

    // ✅ 운행 시작 직후: 고정밀+캐시무효 1회 업로드 (이게 핵심!)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const body = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : 0,
          };
          try {
            await fetch(`${base}/bus/location/${busId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            console.log("📍 운행시작 즉시 좌표 업로드 완료", body);
          } catch (e) {
            console.warn("❌ 운행시작 즉시 업로드 실패", e);
          }
        },
        (err) => {
          console.warn("⚠️ GPS 초기 획득 실패:", err?.message || err);
        },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
      );
    }

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

  // QR 생성
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => {
    (async () => {
      if (busId && time) {
        const payload = `EVERYBUS_${busId}_${time}`;
        const encoded = encodeURIComponent(payload);
        setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encoded}`);
      } else {
        setQrUrl("");
      }
    })();
  }, [busId, time]);

  const leftSeats = capacity != null ? Math.max(0, capacity - onboard) : null;

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">{isDriving ? "🟢 운행 중" : "🚍 EveryBus 운행 관리"}</h1>
      </header>

      <div className="page-content" style={{ marginTop: 20 }}>
        {isDriving ? (
          <>
            {/* 현재 운행 정보 */}
            <div className="card">
              <div className="card-subtitle">현재 운행 정보</div>
              <div className="info-item">
                <b>버스:</b>{" "}
                {(busOptions.find((b) => b.id === busId) || {}).label || busId}
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

              <div className="divider" />

              <div className="info-item">
                <b>탑승 인원:</b> {onboard} 명
              </div>
              <div className="info-item">
                <b>남은 좌석:</b>{" "}
                {leftSeats != null ? `${leftSeats} 석` : "좌석 정보 없음"}
              </div>
              {capacity != null && (
                <div className="info-text" style={{ marginTop: 4 }}>
                  (총 좌석수: {capacity}석)
                </div>
              )}
              <div className="info-text" style={{ marginTop: 4 }}>
                ※ 승객이 QR 체크인할 때 서버의 onboard가 갱신되면 이 숫자도 자동 갱신됩니다.
              </div>
            </div>

            {/* QR 코드 */}
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
              <div className="info-text" style={{ marginTop: 6 }}>
                이 QR을 승객 앱에서 스캔하면 이 버스 탑승으로 기록되도록
                서버의 <code>/qr/checkin</code> 로직을 구현하세요.
                (코드: <code>EVERYBUS_{"{busId}_{time}"}</code>)
              </div>
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
                <div className="info-text">등록된 실시간 셔틀이 없습니다.</div>
              ) : (
                busOptions.map((b) => (
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
                ))
              )}
            </div>

            {/* 2️⃣ 기사 선택 */}
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

            {/* 3️⃣ 정류장 선택 */}
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

            {/* 4️⃣ 출발 시간 */}
            <div className="card">
              <div className="card-subtitle">4️⃣ 출발 시간</div>
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
              <button className="button-primary start" onClick={handleNowTime} style={{ marginTop: 8 }}>
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
          <div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
            {qrUrl ? <img src={qrUrl} alt="QR" /> : <div>QR 생성 중...</div>}
          </div>
        </div>
      )}
    </div>
  );
}
