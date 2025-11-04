import React, { useState, useEffect, useMemo } from "react";
import "./App.css";

// 백엔드 자동 선택(프론트의 다른 파일에도 동일 규칙)
const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";

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

// 서비스 윈도우 길이(분) — 필요시 조정
const SERVICE_WINDOW_MINUTES = 120;

function BusStop() {
  // 선택 상태
  const [selectedBus, setSelectedBus] = useState(null);       // Vehicle.id
  const [selectedDriver, setSelectedDriver] = useState(null);  // 간단 배열
  const [selectedTime, setSelectedTime] = useState(null);      // "HH:MM"
  const [selectedStopName, setSelectedStopName] = useState(null); // 정류장명

  const [isDriving, setIsDriving] = useState(false);
  const [passengerCount, setPassengerCount] = useState(0);
  const [showQR, setShowQR] = useState(false);

  // DB에서 읽어오는 옵션
  const [busOptions, setBusOptions] = useState([]);            // [{id, route, label}]
  const [stopsData, setStopsData] = useState([]);              // [{id,name,lat,lng}]
  const [stopOptions, setStopOptions] = useState([]);          // ["안산대1","안산대2","상록수역"]
  const [timeOptions, setTimeOptions] = useState([]);          // ["08:40","08:45",...]

  // 임시: 기사 이름(컬렉션이 없으므로 하드코딩)
  const driverOptions = ["김기사", "박기사", "이기사"];

  // 정류장 이름 → id 매핑
  const stopIdByName = useMemo(() => {
    const m = new Map();
    stopsData.forEach(s => {
      // 동일 이름의 정류장이 여러 개면 첫번째만 사용(필요시 개선)
      if (!m.has(s.name)) m.set(s.name, String(s.id ?? s._id ?? s.name));
    });
    return m;
  }, [stopsData]);

  // ====== DB에서 옵션 로드 ======
  useEffect(() => {
    (async () => {
      const base = await getBase();

      // 1) 차량 목록
      try {
        const r = await fetch(`${base}/vehicles`);
        if (r.ok) {
          const data = await r.json();          // [{id, route, label}]
          setBusOptions(Array.isArray(data) ? data : []);
        }
      } catch {}

      // 2) 정류장 목록
      try {
        const r = await fetch(`${base}/stops`);
        if (r.ok) {
          const stops = await r.json();         // [{id,name,lat,lng}, ...]
          setStopsData(Array.isArray(stops) ? stops : []);
          // 화면에는 이름만 쓰면 됨
          const names = Array.from(new Set((stops || []).map(s => s.name))).sort();
          setStopOptions(names);
          if (!selectedStopName && names.length) setSelectedStopName(names[0]);
        }
      } catch {}
    })();
  }, []); // 최초 1회

  // ====== 정류장/방향에 따라 시간표 로드 ======
  useEffect(() => {
    (async () => {
      const base = await getBase();
      if (!selectedStopName) return;

      const isStation = selectedStopName.includes("상록수");
      const direction = isStation ? "상록수역→대학" : "대학→상록수역";

      try {
        const r = await fetch(`${base}/timebus?direction=${encodeURIComponent(direction)}`);
        if (r.ok) {
          const rows = await r.json();  // 보통 1문서, 혹은 다수 문서
          const times = (rows?.[0]?.times || []).slice();
          const uniq = Array.from(new Set(times)).sort();
          setTimeOptions(uniq);
          if (!selectedTime && uniq.length) setSelectedTime(uniq[0]);
        } else {
          setTimeOptions([]);
        }
      } catch {
        setTimeOptions([]);
      }
    })();
  }, [selectedStopName]);

  // ========== 탑승자 수 시뮬레이션 ==========
  useEffect(() => {
    let id;
    if (isDriving) {
      id = setInterval(() => setPassengerCount(c => c + 1), 5000);
    }
    return () => id && clearInterval(id);
  }, [isDriving]);

  // ====== 서버 전송 유틸(업서트 PUT → 폴백 POST /start|/stop) ======
  async function sendActiveToServer(payload, mode /* "start"|"stop" */) {
    const base = await getBase();

    // 1) 표준 업서트 시도
    try {
      const res = await fetch(`${base}/bus/active`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return true;
    } catch {}

    // 2) 폴백: start/stop 전용 엔드포인트
    const endpoint = mode === "start" ? `${base}/bus/active/start` : `${base}/bus/active/stop`;
    try {
      const res2 = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res2.ok) return true;
    } catch {}

    return false;
  }

  // ========== 운행 시작/종료 ==========
  const handleToggleDriving = async () => {
    if (isDriving) {
      if (!window.confirm("운행을 종료하시겠습니까?")) return;

      const ok = await sendActiveToServer(
        {
          id: selectedBus,
          active: false,
          // 원한다면 end 타임스탬프도 보냄
          end: new Date().toISOString(),
        },
        "stop"
      );

      if (!ok) {
        alert("서버로 운행 종료 전송 실패. 네트워크나 서버를 확인해주세요.");
        return;
      }

      setIsDriving(false);
      setPassengerCount(0);
      setShowQR(false);
      return;
    }

    // 시작
    if (!selectedBus || !selectedDriver || !selectedTime || !selectedStopName) {
      alert("버스/기사/정류장/시간을 모두 선택해주세요.");
      return;
    }

    const now = Date.now();
    const startISO = new Date(now).toISOString();
    const endISO = new Date(now + SERVICE_WINDOW_MINUTES * 60 * 1000).toISOString();
    const stopId = stopIdByName.get(selectedStopName) || String(selectedStopName);

    const ok = await sendActiveToServer(
      {
        id: selectedBus,            // 차량/디바이스 고유 ID
        stopId,                     // 정류장 ID
        time: selectedTime,         // 선택한 시간대(HH:MM)
        driver: selectedDriver,     // 기사명
        active: true,               // 운행 시작
        serviceWindow: { start: startISO, end: endISO },
      },
      "start"
    );

    if (!ok) {
      alert("서버로 운행 시작 전송 실패. 네트워크나 서버를 확인해주세요.");
      return;
    }

    setIsDriving(true);
  };

  // ================== UI ==================
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-inner">
          <div style={{ width: "2rem" }} />
          <h1 className="page-title">{isDriving ? "운행 중" : "EveryBus 운행 관리"}</h1>
          <div style={{ width: "2rem" }} />
        </div>
      </div>

      {/* QR 모달 */}
      {isDriving && showQR && (
        <div className="qr-modal-overlay" onClick={() => setShowQR(false)}>
          <div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="card-subtitle">승객 탑승용 QR 코드</div>
            <div className="qr-placeholder">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=EVERYBUS_${selectedBus}_${selectedTime}`}
                alt="QR"
              />
              <span className="info-text" style={{ marginTop: 10 }}>
                (학생들이 이 코드를 스캔하면 탑승 처리됩니다)
              </span>
            </div>
            <button className="button-primary start" onClick={() => setShowQR(false)}>
              닫기
            </button>
          </div>
        </div>
      )}

      <div className="page-content">
        {isDriving ? (
          <>
            <div className="card">
              <div className="card-subtitle">현재 운행 정보</div>
              <div className="driving-info-list">
                <div className="info-item"><span className="info-label">🚌 버스</span>
                  <span className="info-value">
                    {busOptions.find(b => b.id === selectedBus)?.label || selectedBus}
                  </span>
                </div>
                <div className="info-item"><span className="info-label">👨‍✈️ 기사</span>
                  <span className="info-value">{selectedDriver}</span>
                </div>
                <div className="info-item"><span className="info-label">🕒 시간</span>
                  <span className="info-value">{selectedTime}</span>
                </div>
                <div className="info-item"><span className="info-label">🚏 정류장</span>
                  <span className="info-value">{selectedStopName}</span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-subtitle">현재 탑승자 수 (실시간)</div>
              <div className="passenger-counter">
                <div className="count-display">{passengerCount}</div>
                <button className="button-primary start" style={{ marginTop: 10 }} onClick={() => setShowQR(true)}>
                  탑승 QR 코드 보기
                </button>
              </div>
            </div>

            <button className="button-primary stop" onClick={handleToggleDriving}>
              운행 종료
            </button>
          </>
        ) : (
          <>
            <div className="card">
              <div className="card-subtitle">현재 운행 상태</div>
              <p className="status-display stopped">운행 대기</p>
            </div>

            {/* 1) 버스 선택 */}
            <div className="card">
              <div className="card-subtitle">1. 버스 선택</div>
              <div className="selectable-list">
                {busOptions.map((b) => (
                  <label key={b.id} className={`selectable-item ${selectedBus === b.id ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="bus"
                      value={b.id}
                      checked={selectedBus === b.id}
                      onChange={() => setSelectedBus(b.id)}
                    />
                    <div className="item-name">{b.label ?? b.id}</div>
                  </label>
                ))}
                {busOptions.length === 0 && <div className="info-text">등록된 버스가 없습니다.</div>}
              </div>
            </div>

            {/* 2) 기사 선택 (임시 배열) */}
            <div className="card">
              <div className="card-subtitle">2. 기사님 이름</div>
              <div className="selectable-list">
                {driverOptions.map((name) => (
                  <label key={name} className={`selectable-item ${selectedDriver === name ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="driver"
                      value={name}
                      checked={selectedDriver === name}
                      onChange={() => setSelectedDriver(name)}
                    />
                    <div className="item-name">{name}</div>
                  </label>
                ))}
              </div>
            </div>

            {/* 3) 정류장 선택 (BusStop 컬렉션) */}
            <div className="card">
              <div className="card-subtitle">3. 정류장 선택</div>
              <div className="selectable-list">
                {stopOptions.map((nm) => (
                  <label key={nm} className={`selectable-item ${selectedStopName === nm ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="stop"
                      value={nm}
                      checked={selectedStopName === nm}
                      onChange={() => setSelectedStopName(nm)}
                    />
                    <div className="item-name">{nm}</div>
                  </label>
                ))}
              </div>
            </div>

            {/* 4) 시간대 선택 (timebus 컬렉션 → direction 기준) */}
            <div className="card">
              <div className="card-subtitle">4. 시간대 선택</div>
              <div className="selectable-list">
                {timeOptions.map((t) => (
                  <label key={t} className={`selectable-item ${selectedTime === t ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="time"
                      value={t}
                      checked={selectedTime === t}
                      onChange={() => setSelectedTime(t)}
                    />
                    <div className="item-name">{t}</div>
                  </label>
                ))}
                {timeOptions.length === 0 && (
                  <div className="info-text">선택한 정류장의 방향에 해당하는 시간표가 없습니다.</div>
                )}
              </div>
            </div>

            <button
              className="button-primary start"
              onClick={handleToggleDriving}
              disabled={!selectedBus || !selectedDriver || !selectedStopName || !selectedTime}
            >
              운행 시작
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default BusStop;
