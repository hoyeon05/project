// DriverApp.js — EveryBus 기사님용 (Render 서버 연동 + 좌석 실시간 표시 + 안정화)
// 서버: https://project-1-ek9j.onrender.com
// 기능: 운행 시작/종료, 실시간 위치 전송, 탑승 인원/남은 좌석 표시, QR 발급
// 보강:
//  - 서버 자동 선택(getBase) 캐시 + 헬스체크
//  - 폴링 타이머 메모리릭 방지(클린업 확실히)
//  - 탭 비활성화 시 폴링 일시중지(배터리 절약)
//  - 예외/네트워크 처리, 좌석 파싱 안전화

import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";

const GPS_POLL_MS = 8000;         // 위치 갱신 주기
const PASSENGER_POLL_MS = 5000;   // 탑승 인원 갱신 주기
const SERVICE_WINDOW_MINUTES = 120;

let cachedBase = null;
async function getBase() {
  if (cachedBase) return cachedBase;
  for (const b of [PROD_SERVER_URL, LOCAL_SERVER_URL]) {
    try {
      const r = await fetch(`${b}/health`, { cache: "no-store" });
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

// /bus/active 응답에서 좌석 정보 가져오기
function extractSeatInfo(raw, busId) {
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const item = list.find((v) => v && String(v.id) === String(busId));
  if (!item) return null;

  const capacity = Number(
    item.capacity ??
      item.seatCapacity ??
      item.maxSeats ??
      item.totalSeats ??
      24 // 서버에서 주면 얘는 무시됨
  );
  const onboard = Number(
    item.onboard ??
      item.passengers ??
      item.currentPassengers ??
      0
  );

  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  const safeOnboard = Number.isFinite(onboard) && onboard >= 0 ? onboard : 0;
  const left = Math.max(0, capacity - safeOnboard);
  return { capacity, onboard: safeOnboard, left };
}

// 배터리 절약: 탭이 숨겨졌을 때 true
function isPageHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export default function DriverApp() {
  // 선택 상태
  const [busId, setBusId] = useState("");
  const [driver, setDriver] = useState("");
  const [stopName, setStopName] = useState("");
  const [stopId, setStopId] = useState("");
  const [time, setTime] = useState("");

  const [isDriving, setIsDriving] = useState(false);

  // 좌석 상태
  const [capacity, setCapacity] = useState(null);
  const [onboard, setOnboard] = useState(0);

  // 선택 목록
  const [busOptions, setBusOptions] = useState([]);
  const [stops, setStops] = useState([]);
  const driverOptions = ["김기사", "박기사", "이기사", "최기사"];

  const [showQR, setShowQR] = useState(false);
  const [qrUrl, setQrUrl] = useState("");

  // 타이머/컨트롤러 레퍼런스
  const gpsTimerRef = useRef(null);
  const paxTimerRef = useRef(null);

  /* 초기: 서버에서 차량/정류장 불러오기 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = await getBase();

      // 차량 목록
      let vehicles = [];
      try {
        const r = await fetch(`${base}/vehicles`, { cache: "no-store" });
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data) && data.length) {
            vehicles = data
              .map((v) => ({
                id: String(v.id),
                label: v.label ? String(v.label) : String(v.id),
              }))
              .filter((v) => v.id);
          }
        }
      } catch (e) {
        console.warn("❌ /vehicles 오류:", e);
      }

      // 폴백: /bus/location
      if (!vehicles.length) {
        try {
          const r2 = await fetch(`${base}/bus/location`, { cache: "no-store" });
          if (r2.ok) {
            const arr = await r2.json();
            const uniqIds = Array.from(
              new Set(
                (Array.isArray(arr) ? arr : [])
                  .map((v) => v && v.id && String(v.id))
                  .filter(Boolean)
              )
            );
            vehicles = uniqIds.map((id) => ({ id, label: id }));
          }
        } catch (e) {
          console.warn("❌ /bus/location 오류:", e);
        }
      }

      if (!cancelled) setBusOptions(vehicles);

      // 정류장 목록
      try {
        const r = await fetch(`${base}/stops`, { cache: "no-store" });
        if (r.ok) {
          const arr = await r.json();
          if (!cancelled) setStops(Array.isArray(arr) ? arr : []);
        }
      } catch (e) {
        console.warn("❌ /stops 오류:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 정류장 이름 -> id 맵
  const stopIdByName = useMemo(() => {
    const m = new Map();
    stops.forEach((s) => m.set(s.name, String(s.id)));
    return m;
  }, [stops]);

  /* GPS 자동 전송: 운행 중 & busId 선택 & 탭 활성화일 때 */
  useEffect(() => {
    // 클린업 함수
    const clear = () => {
      if (gpsTimerRef.current) {
        clearTimeout(gpsTimerRef.current);
        gpsTimerRef.current = null;
      }
    };
    clear();

    if (!isDriving || !busId) return;

    const tick = async () => {
      // 탭 비활성화면 잠깐 쉼(배터리 절약)
      if (isPageHidden()) {
        gpsTimerRef.current = setTimeout(tick, GPS_POLL_MS);
        return;
      }

      if (!navigator.geolocation) {
        console.warn("이 기기는 위치 정보를 지원하지 않습니다.");
        gpsTimerRef.current = setTimeout(tick, GPS_POLL_MS);
        return;
      }

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
                heading: Number.isFinite(pos.coords.heading)
                  ? pos.coords.heading
                  : 0,
              }),
            });
            console.log(
              `📡 위치 전송(${busId}): ${pos.coords.latitude}, ${pos.coords.longitude}`
            );
          } catch (err) {
            console.warn("❌ 위치 전송 실패", err);
          } finally {
            gpsTimerRef.current = setTimeout(tick, GPS_POLL_MS);
          }
        },
        (err) => {
          console.warn("❌ 위치 가져오기 실패", err);
          gpsTimerRef.current = setTimeout(tick, GPS_POLL_MS);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    };

    tick();
    // 탭 가시성 변경 시 즉시 재평가
    const visHandler = () => {
      clear();
      gpsTimerRef.current = setTimeout(tick, 200);
    };
    document.addEventListener("visibilitychange", visHandler);

    return () => {
      clear();
      document.removeEventListener("visibilitychange", visHandler);
    };
  }, [isDriving, busId]);

  /* 탑승 인원/남은 좌석: 운행 중일 때 /bus/active 폴링 */
  useEffect(() => {
    const clear = () => {
      if (paxTimerRef.current) {
        clearTimeout(paxTimerRef.current);
        paxTimerRef.current = null;
      }
    };
    clear();

    if (!isDriving || !busId) {
      setOnboard(0);
      return;
    }

    const poll = async () => {
      if (isPageHidden()) {
        paxTimerRef.current = setTimeout(poll, PASSENGER_POLL_MS);
        return;
      }
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
        console.warn("❌ 탑승 인원 조회 실패", e);
      } finally {
        paxTimerRef.current = setTimeout(poll, PASSENGER_POLL_MS);
      }
    };

    poll();
    const visHandler = () => {
      clear();
      paxTimerRef.current = setTimeout(poll, 200);
    };
    document.addEventListener("visibilitychange", visHandler);

    return () => {
      clear();
      document.removeEventListener("visibilitychange", visHandler);
    };
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

  /* 운행 시작/종료 */
  const handleToggle = async () => {
    if (isDriving) {
      if (!window.confirm("운행을 종료하시겠습니까?")) return;
      await sendActiveToServer({ id: busId, active: false });
      setIsDriving(false);
      setShowQR(false);
      return;
    }

    if (!busId || !driver || !stopName || !time) {
      alert("버스, 기사, 정류장, 시간을 모두 입력해주세요.");
      return;
    }

    const now = Date.now();
    const start = new Date(now).toISOString();
    const end = new Date(now + SERVICE_WINDOW_MINUTES * 60 * 1000).toISOString();
    const sid = stopIdByName.get(stopName) || stopId || stopName;

    const ok = await sendActiveToServer({
      id: busId,
      stopId: sid,
      time,
      driver,
      route: "안산대 셔틀",
      active: true,
      serviceWindow: { start, end },
      // capacity: 24, // 필요 시 서버 or 여기에서 설정
    });

    if (!ok) {
      alert("운행 시작 실패! (네트워크 또는 서버 오류)");
      return;
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

  /* QR URL 생성 — code 안에 busId, time 포함 */
  useEffect(() => {
    (async () => {
      if (busId && time) {
        const payload = `EVERYBUS_${busId}_${time}`;
        const encoded = encodeURIComponent(payload);
        setQrUrl(
          `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encoded}`
        );
      } else {
        setQrUrl("");
      }
    })();
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
            {/* 현재 운행 정보 + 좌석 상태 */}
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
                {leftSeats != null
                  ? `${leftSeats} 석`
                  : "좌석 정보 없음 (서버에서 capacity 제공 필요)"}
              </div>
              {capacity != null && (
                <div className="info-text" style={{ marginTop: 4 }}>
                  (총 좌석수: {capacity}석)
                </div>
              )}
              <div className="info-text" style={{ marginTop: 4 }}>
                ※ 승객이 QR 체크인할 때마다 서버의 onboard 값이 업데이트되면,
                이 화면의 숫자가 자동으로 갱신됩니다.
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
                <div className="info-text">
                  등록된 실시간 셔틀이 없습니다. (관리자에게 차량 등록 요청)
                </div>
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
