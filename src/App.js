// DriverApp.js — EveryBus 기사님용 (호차 / 출발·도착 정류장 선택 + 좌석표시 + QR)
// 서버: https://project-1-ek9j.onrender.com
// 특징:
//  - 호차(셔틀) 목록: /vehicles  (더미든 실제든 서버에서 가져옴)
//  - 정류장 목록: /stops
//  - 운행 정보: /bus/active (출발/도착, 시간, 기사, routeLabel 등 저장)
//  - 좌석/탑승 인원: /bus/active 폴링
//  - QR 코드: EVERBUS_{busId}_{time}
//  - ⚠️ 위치(GPS)는 Termux에서만 서버로 전송. 기사 앱에서는 GPS 안 보냄!

import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";

const PASSENGER_POLL_MS = 5000;
const SERVICE_WINDOW_MINUTES = 120;

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

// /bus/active 에서 좌석/탑승 정보 꺼내기
function extractSeatInfo(raw, busId) {
  const list = Array.isArray(raw) ? raw : [raw];
  const item = list.find((v) => v && String(v.id) === String(busId));
  if (!item) return null;

  const capacity = Number(
    item.capacity ??
      item.seatCapacity ??
      item.maxSeats ??
      item.totalSeats ??
      45
  );
  const onboard = Number(item.onboard ?? item.passengers ?? 0);

  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  const safeOnboard = Number.isFinite(onboard) && onboard >= 0 ? onboard : 0;
  const left = Math.max(0, capacity - safeOnboard);

  return { capacity, onboard: safeOnboard, left };
}

export default function DriverApp() {
  const [busId, setBusId] = useState("");       // Vehicle.id (Termux와 동일)
  const [busLabel, setBusLabel] = useState(""); // "1호차" 같은 표시용 이름

  const [driver, setDriver] = useState("");
  const [time, setTime] = useState("");

  // 출발 / 도착 정류장
  const [fromStopName, setFromStopName] = useState("");
  const [fromStopId, setFromStopId] = useState("");
  const [toStopName, setToStopName] = useState("");
  const [toStopId, setToStopId] = useState("");

  const [isDriving, setIsDriving] = useState(false);

  // 좌석 정보
  const [capacity, setCapacity] = useState(null);
  const [onboard, setOnboard] = useState(0);

  const [showQR, setShowQR] = useState(false);

  // 선택 목록
  const [busOptions, setBusOptions] = useState([]);
  const [stops, setStops] = useState([]);

  const driverOptions = ["김기사", "박기사", "이기사", "최기사"];

  /* 초기 데이터 로딩: /vehicles, /stops */
  useEffect(() => {
    (async () => {
      const base = await getBase();

      // 1) /vehicles 로 호차 목록 받기 (더미 포함)
      let vehicles = [];
      try {
        const r = await fetch(`${base}/vehicles`, { cache: "no-store" });
        if (r.ok) {
          const data = await r.json();
          vehicles = (data || [])
            .map((v) => ({
              id: String(v.id),
              label: v.label ? String(v.label) : String(v.id),
            }))
            .filter((v) => v.id);
          console.log("🚍 vehicles:", vehicles);
        }
      } catch (e) {
        console.warn("❌ /vehicles 오류:", e);
      }
      setBusOptions(vehicles);

      // 2) 정류장 목록 (/stops)
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

  // 정류장 이름 -> id 매핑
  const stopIdByName = useMemo(() => {
    const m = new Map();
    stops.forEach((s) => m.set(s.name, String(s.id)));
    return m;
  }, [stops]);

  /* 좌석/탑승 인원 폴링 (운행 중에만) */
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

  /* /bus/active 공용 업서트 함수 */
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

  /* 운행 시작/종료 */
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
    if (
      !busId ||
      !driver ||
      !fromStopName ||
      !toStopName ||
      !time
    ) {
      alert("호차, 기사, 출발/도착 정류장, 시간을 모두 입력해주세요.");
      return;
    }

    const now = Date.now();
    const start = new Date(now).toISOString();
    const end = new Date(
      now + SERVICE_WINDOW_MINUTES * 60 * 1000
    ).toISOString();

    // 현재 기준 정류장은 "출발 정류장"으로 간주
    const sid =
      stopIdByName.get(fromStopName) || fromStopId || fromStopName;

    const ok = await upsertActive({
      id: busId,
      stopId: sid,
      time,
      driver,
      route: "안산대 셔틀",
      routeLabel: busLabel, // 1호차 / 2호차 등
      active: true,
      serviceWindow: { start, end },
      fromStopId,
      fromStopName,
      toStopId,
      toStopName,
    });

    if (!ok) {
      alert("운행 시작 실패! (네트워크 또는 서버 오류)");
      return;
    }

    setIsDriving(true);
    setShowQR(true);
    console.log(
      `✅ 운행 시작: [${busLabel}] ${busId}, ${driver}, ${fromStopName}→${toStopName}, ${time}`
    );
  };

  const handleNowTime = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    setTime(`${hh}:${mm}`);
  };

  /* QR 생성 */
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => {
    if (busId && time) {
      const payload = `EVERYBUS_${busId}_${time}`;
      const encoded = encodeURIComponent(payload);
      setQrUrl(
        `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encoded}`
      );
    } else {
      setQrUrl("");
    }
  }, [busId, time]);

  const leftSeats =
    capacity != null ? Math.max(0, capacity - onboard) : null;

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
            {/* 현재 운행 정보 */}
            <div className="card">
              <div className="card-subtitle">현재 운행 정보</div>
              <div className="info-item">
                <b>호차:</b>{" "}
                {(busOptions.find((b) => b.id === busId) || {}).label ||
                  busLabel ||
                  busId}
              </div>
              <div className="info-item">
                <b>기사:</b> {driver}
              </div>
              <div className="info-item">
                <b>노선:</b> {fromStopName} → {toStopName}
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
                {leftSeats != null
                  ? `${leftSeats} 석`
                  : "좌석 정보 없음"}
              </div>
              {capacity != null && (
                <div className="info-text" style={{ marginTop: 4 }}>
                  (총 좌석수: {capacity}석)
                </div>
              )}
              <div className="info-text" style={{ marginTop: 4 }}>
                ※ 위치는 Termux에서 서버로 보내는 GPS 기준으로
                사용자 앱에서 표시됩니다.
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
                이 QR을 승객 앱에서 스캔하면 서버의{" "}
                <code>/qr/checkin</code> 로직에서 탑승 처리하도록
                구현할 수 있습니다. <br />
                (코드: <code>EVERYBUS_{"{busId}_{time}"}</code>)
              </div>
            </div>

            <button className="button-primary stop" onClick={handleToggle}>
              운행 종료
            </button>
          </>
        ) : (
          <>
            {/* 1️⃣ 호차 선택 */}
            <div className="card">
              <div className="card-subtitle">1️⃣ 호차 선택</div>
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
                      onChange={() => {
                        setBusId(b.id);
                        setBusLabel(b.label);
                      }}
                    />{" "}
                    {b.label} ({b.id})
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

            {/* 3️⃣ 출발 정류장 */}
            <div className="card">
              <div className="card-subtitle">3️⃣ 출발 정류장</div>
              {stops.map((s) => (
                <label
                  key={s.id}
                  style={{ display: "block", margin: "4px 0" }}
                >
                  <input
                    type="radio"
                    name="fromStop"
                    value={s.name}
                    checked={fromStopName === s.name}
                    onChange={() => {
                      setFromStopName(s.name);
                      setFromStopId(String(s.id));
                    }}
                  />{" "}
                  {s.name}
                </label>
              ))}
            </div>

            {/* 4️⃣ 도착 정류장 */}
            <div className="card">
              <div className="card-subtitle">4️⃣ 도착 정류장</div>
              {stops.map((s) => (
                <label
                  key={s.id}
                  style={{ display: "block", margin: "4px 0" }}
                >
                  <input
                    type="radio"
                    name="toStop"
                    value={s.name}
                    checked={toStopName === s.name}
                    onChange={() => {
                      setToStopName(s.name);
                      setToStopId(String(s.id));
                    }}
                  />{" "}
                  {s.name}
                </label>
              ))}
            </div>

            {/* 5️⃣ 출발 시간 */}
            <div className="card">
              <div className="card-subtitle">5️⃣ 출발 시간</div>
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
            {qrUrl ? <img src={qrUrl} alt="QR" /> : <div>QR 생성 중...</div>}
          </div>
        </div>
      )}
    </div>
  );
}
