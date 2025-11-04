// App.js — EveryBus Driver (기사님 앱 완성본)
// - 목록엔 "1호차" 같은 라벨 표시, 서버엔 IMEI(id) 전송
// - /bus/active 업서트(put) + start/stop 폴백(post) 지원
// - 마지막 선택값 localStorage 저장/복원

import React, { useState, useEffect, useMemo } from "react";
import "./App.css";

/* ================== 환경 ================== */
const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";
const SERVICE_WINDOW_MINUTES = 120;

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

/* ================== 유틸: localStorage ================== */
const LS_KEY = "everybus:driver:selection";
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
function saveSelection(sel) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(sel)); } catch {}
}

/* ================== 메인 컴포넌트 ================== */
export default function BusStop() {
  // 선택 상태 (id=IMEI, label=표시명)
  const saved = loadSaved();
  const [selectedBusId, setSelectedBusId] = useState(saved.busId || null);
  const [selectedBusLabel, setSelectedBusLabel] = useState(saved.busLabel || null);
  const [selectedDriver, setSelectedDriver] = useState(saved.driver || null);
  const [selectedTime, setSelectedTime] = useState(saved.time || null);      // "HH:MM"
  const [selectedStopName, setSelectedStopName] = useState(saved.stopName || null);

  const [isDriving, setIsDriving] = useState(false);
  const [passengerCount, setPassengerCount] = useState(0);
  const [showQR, setShowQR] = useState(false);
  const [submitting, setSubmitting] = useState(false); // 중복 클릭 방지

  // DB 옵션
  const [busOptions, setBusOptions] = useState([]);   // [{id, label}]
  const [stopsData, setStopsData] = useState([]);     // [{id,name,lat,lng}]
  const [stopOptions, setStopOptions] = useState([]); // ["안산대1", "상록수역", ...]
  const [timeOptions, setTimeOptions] = useState([]); // ["08:40", ...]

  // 수동 입력 (선택)
  const [imeiInput, setImeiInput] = useState("");
  const [labelInput, setLabelInput] = useState("");

  // 기사 이름(임시)
  const driverOptions = ["김기사", "박기사", "이기사"];

  // 정류장 이름 -> id 매핑
  const stopIdByName = useMemo(() => {
    const m = new Map();
    stopsData.forEach(s => {
      // 동일 이름 여러 개면 첫 번째만 사용
      if (!m.has(s.name)) m.set(s.name, String(s.id ?? s._id ?? s.name));
    });
    return m;
  }, [stopsData]);

  // ====== 옵션 로딩 ======
  useEffect(() => {
    (async () => {
      const base = await getBase();

      // 1) 차량 목록
      try {
        const r = await fetch(`${base}/vehicles`);
        if (r.ok) {
          const data = await r.json(); // [{id,label}]
          const dedup = new Map();
          (Array.isArray(data) ? data : []).forEach(v => {
            const id = String(v.id);
            if (!dedup.has(id)) dedup.set(id, { id, label: v.label ? String(v.label) : id });
          });
          const safe = Array.from(dedup.values()).sort((a, b) => (a.label || "").localeCompare(b.label || ""));
          setBusOptions(safe);

          // 저장된 선택이 유효하면 복구
          if (saved.busId && safe.some(x => x.id === saved.busId)) {
            setSelectedBusId(saved.busId);
            setSelectedBusLabel(saved.busLabel || saved.busId);
          }
        }
      } catch {}

      // 2) 정류장 목록
      try {
        const r = await fetch(`${base}/stops`);
        if (r.ok) {
          const stops = await r.json();
          const arr = Array.isArray(stops) ? stops : [];
          setStopsData(arr);
          const names = Array.from(new Set(arr.map(s => s.name))).sort();
          setStopOptions(names);

          if (!saved.stopName) {
            if (!selectedStopName && names.length) setSelectedStopName(names[0]);
          } else {
            setSelectedStopName(saved.stopName);
          }
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          const rows = await r.json();  // 다수 문서 가능
          const doc = (Array.isArray(rows) ? rows : []).find(x => Array.isArray(x?.times) && x.times.length) || null;
          const times = doc ? doc.times.slice() : [];
          const uniq = Array.from(new Set(times)).sort();
          setTimeOptions(uniq);

          if (!saved.time) {
            if (!selectedTime && uniq.length) setSelectedTime(uniq[0]);
          } else {
            setSelectedTime(saved.time);
          }
        } else {
          setTimeOptions([]);
        }
      } catch {
        setTimeOptions([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStopName]);

  // ========== 탑승자 수 시뮬레이션 ==========
  useEffect(() => {
    let id;
    if (isDriving) {
      id = setInterval(() => setPassengerCount(c => c + 1), 5000);
    }
    return () => id && clearInterval(id);
  }, [isDriving]);

  // 선택 변경될 때마다 저장
  useEffect(() => {
    saveSelection({
      busId: selectedBusId || null,
      busLabel: selectedBusLabel || null,
      driver: selectedDriver || null,
      time: selectedTime || null,
      stopName: selectedStopName || null,
    });
  }, [selectedBusId, selectedBusLabel, selectedDriver, selectedTime, selectedStopName]);

  // ====== 서버 전송 유틸(업서트 PUT → 폴백 POST /start|/stop) ======
  async function sendActiveToServer(payload, mode /* "start"|"stop" */) {
    const base = await getBase();

    // 1) 표준 업서트
    try {
      const res = await fetch(`${base}/bus/active`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return true;
    } catch {}

    // 2) 폴백
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
    if (submitting) return;
    setSubmitting(true);

    if (isDriving) {
      if (!window.confirm("운행을 종료하시겠습니까?")) { setSubmitting(false); return; }

      const ok = await sendActiveToServer(
        { id: selectedBusId, active: false, end: new Date().toISOString() },
        "stop"
      );

      setSubmitting(false);

      if (!ok) {
        alert("서버로 운행 종료 전송 실패. 네트워크나 서버를 확인해주세요.");
        return;
      }

      setIsDriving(false);
      setPassengerCount(0);
      setShowQR(false);
      return;
    }

    // 시작 유효성
    if (!selectedBusId || !selectedDriver || !selectedTime || !selectedStopName) {
      alert("버스(IMEI)/기사/정류장/시간을 모두 선택해주세요.");
      setSubmitting(false);
      return;
    }

    const now = Date.now();
    const startISO = new Date(now).toISOString();
    const endISO = new Date(now + SERVICE_WINDOW_MINUTES * 60 * 1000).toISOString();
    const stopId = stopIdByName.get(selectedStopName) || String(selectedStopName);

    const ok = await sendActiveToServer(
      {
        id: String(selectedBusId),                // 서버엔 실제 ID(IMEI)
        stopId: String(stopId),
        time: String(selectedTime).trim(),
        driver: selectedDriver,
        route: selectedBusLabel || null,          // 사용자앱 지도 라벨
        active: true,
        serviceWindow: { start: startISO, end: endISO },
      },
      "start"
    );

    setSubmitting(false);

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
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=EVERYBUS_${selectedBusId}_${selectedTime}`}
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
                <div className="info-item">
                  <span className="info-label">🚌 버스</span>
                  <span className="info-value">{selectedBusLabel || selectedBusId}</span>
                </div>
                <div className="info-text" style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                  (ID: {selectedBusId})
                </div>

                <div className="info-item">
                  <span className="info-label">👨‍✈️ 기사</span>
                  <span className="info-value">{selectedDriver}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">🕒 시간</span>
                  <span className="info-value">{selectedTime}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">🚏 정류장</span>
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

            <button className="button-primary stop" onClick={handleToggleDriving} disabled={submitting}>
              {submitting ? "종료 중..." : "운행 종료"}
            </button>
          </>
        ) : (
          <>
            <div className="card">
              <div className="card-subtitle">현재 운행 상태</div>
              <p className="status-display stopped">운행 대기</p>
            </div>

            {/* 1) 버스 선택 (id=IMEI, label=표시명) */}
            <div className="card">
              <div className="card-subtitle">1. 버스 선택</div>
              <div className="selectable-list">
                {busOptions.map((b) => (
                  <label key={b.id} className={`selectable-item ${selectedBusId === b.id ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="bus"
                      value={b.id}
                      checked={selectedBusId === b.id}
                      onChange={() => {
                        setSelectedBusId(b.id);
                        setSelectedBusLabel(b.label ?? b.id);
                      }}
                    />
                    <div className="item-name">{b.label ?? b.id}</div>
                    <div className="info-text" style={{ fontSize: 12, opacity: 0.7 }}>({b.id})</div>
                  </label>
                ))}
                {busOptions.length === 0 && <div className="info-text">등록된 버스가 없습니다. 아래에서 직접 입력할 수 있습니다.</div>}
              </div>

              {/* 수동 입력 (선택) */}
              <div className="card" style={{ marginTop: 12 }}>
                <div className="card-subtitle">직접 입력(선택)</div>
                <input
                  type="text"
                  className="text-input"
                  placeholder="IMEI 예: 350599638756152"
                  value={imeiInput}
                  onChange={(e) => setImeiInput(e.target.value.trim())}
                />
                <input
                  type="text"
                  className="text-input"
                  style={{ marginTop: 8 }}
                  placeholder="표시명 예: 1호차 (선택)"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                />
                <button
                  className="button-primary start"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    if (!imeiInput) return alert("IMEI를 입력하세요.");
                    setSelectedBusId(imeiInput);
                    setSelectedBusLabel(labelInput || imeiInput);
                  }}
                >
                  이 IMEI 사용
                </button>
              </div>
            </div>

            {/* 2) 기사 선택 */}
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

            {/* 3) 정류장 선택 */}
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

            {/* 4) 시간대 선택 */}
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
              disabled={!selectedBusId || !selectedDriver || !selectedStopName || !selectedTime || submitting}
            >
              {submitting ? "시작 중..." : "운행 시작"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
