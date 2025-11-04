// App.js — EveryBus Driver (스크롤형 시간 설정 버전)
// - 시간표 DB 제거
// - <input type="time"> → 네이티브 스크롤 선택
// - "현재시간으로 설정" 버튼 유지

import React, { useState, useEffect, useMemo } from "react";
import "./App.css";

const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";
const SERVICE_WINDOW_MINUTES = 120;
const ACTIVE_POLL_MS = 3000;

let cachedBase = null;
async function getBase() {
  if (cachedBase) return cachedBase;
  for (const b of [PROD_SERVER_URL, LOCAL_SERVER_URL]) {
    try {
      const r = await fetch(`${b}/health`);
      if (r.ok) { cachedBase = b; return b; }
    } catch {}
  }
  cachedBase = PROD_SERVER_URL;
  return cachedBase;
}

export default function BusStop() {
  const [selectedBusId, setSelectedBusId] = useState(null);
  const [selectedBusLabel, setSelectedBusLabel] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [selectedStopName, setSelectedStopName] = useState(null);
  const [selectedTime, setSelectedTime] = useState(""); // 스크롤 피커 값
  const [isDriving, setIsDriving] = useState(false);
  const [passengerCount, setPassengerCount] = useState(0);
  const [showQR, setShowQR] = useState(false);

  const [busOptions, setBusOptions] = useState([]);
  const [stopOptions, setStopOptions] = useState([]);
  const [stopsData, setStopsData] = useState([]);

  const driverOptions = ["김기사", "박기사", "이기사"];

  const stopIdByName = useMemo(() => {
    const m = new Map();
    stopsData.forEach(s => {
      if (!m.has(s.name)) m.set(s.name, String(s.id ?? s._id ?? s.name));
    });
    return m;
  }, [stopsData]);

  // 차량 + 정류장 불러오기
  useEffect(() => {
    (async () => {
      const base = await getBase();
      try {
        const r = await fetch(`${base}/vehicles`);
        if (r.ok) {
          const data = await r.json();
          setBusOptions((Array.isArray(data) ? data : []).map(v => ({
            id: String(v.id),
            label: v.label || v.id
          })));
        }
      } catch {}
      try {
        const r = await fetch(`${base}/stops`);
        if (r.ok) {
          const arr = await r.json();
          setStopsData(arr);
          const names = Array.from(new Set(arr.map(s => s.name))).sort();
          setStopOptions(names);
          if (!selectedStopName && names.length) setSelectedStopName(names[0]);
        }
      } catch {}
    })();
  }, []);

  // 운행 중 탑승 인원 실시간 반영
  useEffect(() => {
    let timer;
    let alive = true;
    (async function loop() {
      if (!isDriving || !selectedBusId) return;
      const base = await getBase();
      try {
        const r = await fetch(`${base}/bus/active`);
        if (r.ok) {
          const list = await r.json();
          const me = (Array.isArray(list) ? list : []).find(x => String(x.id) === String(selectedBusId));
          if (alive && me) setPassengerCount(Number(me.boardings || 0));
        }
      } catch {}
      timer = setTimeout(loop, ACTIVE_POLL_MS);
    })();
    return () => { alive = false; timer && clearTimeout(timer); };
  }, [isDriving, selectedBusId]);

  async function sendActiveToServer(payload) {
    const base = await getBase();
    try {
      const res = await fetch(`${base}/bus/active`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  const handleToggleDriving = async () => {
    if (isDriving) {
      if (!window.confirm("운행을 종료하시겠습니까?")) return;
      await sendActiveToServer({ id: selectedBusId, active: false, end: new Date().toISOString() });
      setIsDriving(false);
      setPassengerCount(0);
      setShowQR(false);
      return;
    }

    if (!selectedBusId || !selectedDriver || !selectedStopName || !selectedTime) {
      alert("버스 / 기사 / 정류장 / 시간을 모두 입력해주세요.");
      return;
    }

    const now = Date.now();
    const startISO = new Date(now).toISOString();
    const endISO = new Date(now + SERVICE_WINDOW_MINUTES * 60 * 1000).toISOString();
    const stopId = stopIdByName.get(selectedStopName) || selectedStopName;

    const ok = await sendActiveToServer({
      id: selectedBusId,
      stopId,
      time: selectedTime,
      driver: selectedDriver,
      route: selectedBusLabel,
      active: true,
      serviceWindow: { start: startISO, end: endISO },
    });

    if (!ok) {
      alert("운행 시작 전송 실패!");
      return;
    }

    setPassengerCount(0);
    setIsDriving(true);
  };

  const handleNowTime = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    setSelectedTime(`${hh}:${mm}`);
  };

  // QR URL 생성
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => {
    (async () => {
      const base = await getBase();
      if (selectedBusId && selectedTime) {
        setQrUrl(`${base}/boarding/scan?id=${encodeURIComponent(selectedBusId)}&time=${encodeURIComponent(selectedTime)}`);
      } else {
        setQrUrl("");
      }
    })();
  }, [selectedBusId, selectedTime]);

  return (
    <div className="page-container">
      <div className="page-header fixed top-0 w-full bg-white shadow z-10">
        <h1 className="page-title text-center py-3">{isDriving ? "운행 중" : "EveryBus 운행 관리"}</h1>
      </div>

      <div className="page-content" style={{ marginTop: 80 }}>
        {isDriving ? (
          <>
            <div className="card">
              <div className="card-subtitle">현재 운행 정보</div>
              <div className="info-item"><b>버스:</b> {selectedBusLabel}</div>
              <div className="info-item"><b>기사:</b> {selectedDriver}</div>
              <div className="info-item"><b>정류장:</b> {selectedStopName}</div>
              <div className="info-item"><b>출발 시간:</b> {selectedTime}</div>
            </div>

            <div className="card">
              <div className="card-subtitle">현재 탑승자 수</div>
              <div className="count-display">{passengerCount}</div>
              <button className="button-primary start" onClick={() => setShowQR(true)}>QR 코드 보기</button>
            </div>

            <button className="button-primary stop" onClick={handleToggleDriving}>운행 종료</button>
          </>
        ) : (
          <>
            {/* 버스 선택 */}
            <div className="card">
              <div className="card-subtitle">1. 버스 선택</div>
              {busOptions.map(b => (
                <label key={b.id} style={{ display: "block", margin: "4px 0" }}>
                  <input type="radio" name="bus" value={b.id}
                    checked={selectedBusId === b.id}
                    onChange={() => { setSelectedBusId(b.id); setSelectedBusLabel(b.label); }} />
                  {b.label}
                </label>
              ))}
            </div>

            {/* 기사 선택 */}
            <div className="card">
              <div className="card-subtitle">2. 기사 선택</div>
              {driverOptions.map(d => (
                <label key={d} style={{ display: "block", margin: "4px 0" }}>
                  <input type="radio" name="driver" value={d}
                    checked={selectedDriver === d}
                    onChange={() => setSelectedDriver(d)} />
                  {d}
                </label>
              ))}
            </div>

            {/* 정류장 선택 */}
            <div className="card">
              <div className="card-subtitle">3. 정류장 선택</div>
              {stopOptions.map(s => (
                <label key={s} style={{ display: "block", margin: "4px 0" }}>
                  <input type="radio" name="stop" value={s}
                    checked={selectedStopName === s}
                    onChange={() => setSelectedStopName(s)} />
                  {s}
                </label>
              ))}
            </div>

            {/* 시간 설정 (스크롤 피커) */}
            <div className="card">
              <div className="card-subtitle">4. 출발 시간 설정</div>
              <input
                type="time"
                className="text-input"
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                style={{
                  fontSize: "1.2rem",
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #ddd",
                  background: "#fdfdfd",
                }}
              />
              <button
                className="button-primary start"
                onClick={handleNowTime}
                style={{ marginTop: 10 }}
              >
                현재 시간으로 설정
              </button>
              <p style={{ fontSize: 12, color: "#555", marginTop: 6 }}>
                ⏰ 스크롤을 위아래로 움직여 시간을 선택하세요.
              </p>
            </div>

            <button className="button-primary start" onClick={handleToggleDriving}>
              운행 시작
            </button>
          </>
        )}
      </div>

      {/* QR 모달 */}
      {isDriving && showQR && (
        <div className="qr-modal-overlay" onClick={() => setShowQR(false)}>
          <div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="card-subtitle">승객용 QR 코드</div>
            {qrUrl && (
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrUrl)}`}
                alt="QR"
              />
            )}
            <button className="button-primary start" onClick={() => setShowQR(false)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
