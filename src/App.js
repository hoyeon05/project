// DriverApp.js — EveryBus 기사님용 (수정본)
import React, { useState, useEffect, useMemo } from "react";
import "./App.css";

const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";
const GPS_POLL_MS = 8000;
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
  const [passengers, setPassengers] = useState(0);
  const [showQR, setShowQR] = useState(false);

  const [busOptions, setBusOptions] = useState([]);
  const [stops, setStops] = useState([]);

  // 현재 활성 세션 (종료/새로고침용)
  const [activeSession, setActiveSession] = useState(null); // { id, stopId, time }

  const driverOptions = ["김기사", "박기사", "이기사", "최기사"];

  // 차량/정류장 로드
  useEffect(() => {
    (async () => {
      const base = await getBase();
      try {
        const r = await fetch(`${base}/vehicles`);
        if (r.ok) {
          const arr = await r.json();
          setBusOptions(
            (Array.isArray(arr) ? arr : []).map((v) => ({
              id: String(v.id),
              label: v.label || v.id,
            }))
          );
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
    stops.forEach((s) =>
      m.set(s.name, String(s.id ?? s._id ?? s.name))
    );
    return m;
  }, [stops]);

  // 🛰 GPS 자동 전송 (운행 중에만)
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
        (err) => {
          console.warn("GPS 에러", err);
        }
      );

      timer = setTimeout(loop, GPS_POLL_MS);
    };

    loop();
    return () => timer && clearTimeout(timer);
  }, [isDriving, busId]);

  // ----- 서버 헬퍼 -----
  async function startActiveOnServer({ id, stopId, time, driver, route }) {
    const base = await getBase();
    const now = Date.now();
    const start = new Date(now).toISOString();
    const end = new Date(
      now + SERVICE_WINDOW_MINUTES * 60 * 1000
    ).toISOString();

    try {
      const res = await fetch(`${base}/bus/active/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: String(id),
          stopId: String(stopId),
          time: String(time),
          driver,
          route,
          serviceWindow: { start, end },
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function stopActiveOnServer(id) {
    if (!id) return false;
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

  // ----- 운행 시작 / 종료 -----
  const handleToggle = async () => {
    // 종료
    if (isDriving) {
      if (!window.confirm("운행을 종료하시겠습니까?")) return;

      const ok = await stopActiveOnServer(busId);
      if (!ok) {
        alert(
          "운행 종료 요청이 서버에 반영되지 않았을 수 있습니다. 관리자에게 문의하세요."
        );
      }
      setIsDriving(false);
      setPassengers(0);
      setActiveSession(null);
      setShowQR(false);
      return;
    }

    // 시작
    if (!busId || !driver || !stopName || !time) {
      alert("버스, 기사, 정류장, 시간을 모두 입력해주세요.");
      return;
    }

    const sid = stopIdByName.get(stopName) || stopId || stopName;
    const ok = await startActiveOnServer({
      id: busId,
      stopId: sid,
      time,
      driver,
      route: `셔틀 (${busId})`,
    });

    if (!ok) {
      alert("운행 시작 실패! (서버 응답 오류)");
      return;
    }

    setIsDriving(true);
    setPassengers(0);
    setActiveSession({ id: busId, stopId: sid, time });
    console.log(`✅ 운행 시작: ${busId}, ${driver}, ${stopName}, ${time}`);
  };

  // 새로고침/탭 닫을 때도 종료 시도
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (!activeSession) return;
      // 동기 호출은 제한적이지만, 일단 Best Effort
      navigator.sendBeacon &&
        navigator.sendBeacon(
          `${PROD_SERVER_URL}/bus/active/stop`,
          new Blob(
            [JSON.stringify({ id: String(activeSession.id) })],
            { type: "application/json" }
          )
        );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () =>
      window.removeEventListener(
        "beforeunload",
        handleBeforeUnload
      );
  }, [activeSession]);

  const handleNowTime = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    setTime(`${hh}:${mm}`);
  };

  // QR (EVERYBUS_id_time 포맷)
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => {
    if (busId && time) {
      const data = encodeURIComponent(
        `EVERYBUS_${busId}_${time}`
      );
      setQrUrl(
        `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${data}`
      );
    } else setQrUrl("");
  }, [busId, time]);

  // ----- UI -----
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
              <div className="card-subtitle">
                승객용 QR 코드
              </div>
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt="QR"
                  style={{
                    width: 220,
                    height: 220,
                    margin: "auto",
                  }}
                />
              ) : (
                <div className="info-text">
                  QR 생성 중...
                </div>
              )}
            </div>

            <button
              className="button-primary stop"
              onClick={handleToggle}
            >
              운행 종료
            </button>
          </>
        ) : (
          <>
            {/* 1. 버스 선택 */}
            <div className="card">
              <div className="card-subtitle">
                1️⃣ 버스 선택
              </div>
              {busOptions.map((b) => (
                <label
                  key={b.id}
                  style={{
                    display: "block",
                    margin: "4px 0",
                  }}
                >
                  <input
                    type="radio"
                    name="bus"
                    value={b.id}
                    checked={busId === b.id}
                    onChange={() =>
                      setBusId(b.id)
                    }
                  />{" "}
                  {b.label}
                </label>
              ))}
            </div>

            {/* 2. 기사 선택 */}
            <div className="card">
              <div className="card-subtitle">
                2️⃣ 기사 선택
              </div>
              {driverOptions.map((d) => (
                <label
                  key={d}
                  style={{
                    display: "block",
                    margin: "4px 0",
                  }}
                >
                  <input
                    type="radio"
                    name="driver"
                    value={d}
                    checked={
                      driver === d
                    }
                    onChange={() =>
                      setDriver(d)
                    }
                  />{" "}
                  {d}
                </label>
              ))}
            </div>

            {/* 3. 정류장 선택 */}
            <div className="card">
              <div className="card-subtitle">
                3️⃣ 정류장 선택
              </div>
              {stops.map((s) => (
                <label
                  key={s.id}
                  style={{
                    display: "block",
                    margin: "4px 0",
                  }}
                >
                  <input
                    type="radio"
                    name="stop"
                    value={s.name}
                    checked={
                      stopName ===
                      s.name
                    }
                    onChange={() => {
                      setStopName(
                        s.name
                      );
                      setStopId(
                        String(
                          s.id
                        )
                      );
                    }}
                  />{" "}
                  {s.name}
                </label>
              ))}
            </div>

            {/* 4. 시간 설정 */}
            <div className="card">
              <div className="card-subtitle">
                4️⃣ 출발 시간 설정
              </div>
              <input
                type="time"
                className="text-input"
                value={time}
                onChange={(e) =>
                  setTime(
                    e.target
                      .value
                  )
                }
              />
              <button
                className="button-primary start"
                onClick={handleNowTime}
                style={{ marginTop: 8 }}
              >
                현재 시간으로 설정
              </button>
            </div>

            <button
              className="button-primary start"
              onClick={handleToggle}
            >
              운행 시작
            </button>
          </>
        )}
      </div>

      {/* QR 모달 (필요 시 사용) */}
      {isDriving && showQR && (
        <div
          className="qr-modal-overlay"
          onClick={() =>
            setShowQR(false)
          }
        >
          <div
            className="qr-modal-content"
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            {qrUrl ? (
              <img
                src={qrUrl}
                alt="QR"
              />
            ) : (
              <div>
                QR 생성 중...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
