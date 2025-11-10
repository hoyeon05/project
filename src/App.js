// App.js — EveryBus React UI (운행중 시간대 선택 → 라이브 화면 + ETA, GPS 콘솔 1회, 헤더 고정)
import React, { useEffect, useRef, useState, createContext, useContext, useMemo } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import "./App.css";

/********************** 환경값 **********************/
const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";
const MAP_HEIGHT = 360;
const VEHICLE_POLL_MS = 5000;

/********************** 알림/로그 제어 **********************/
const NOTIFY_ENABLED = false;
let _gpsPermissionWarned = false;
let _gpsFallbackWarned = false;
let _gpsGenericWarned = false;

/********************** 서버 자동 선택 **********************/
let cachedServerURL = null;
async function getServerURL() {
  if (cachedServerURL) return cachedServerURL;
  for (const base of [PROD_SERVER_URL, LOCAL_SERVER_URL]) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) {
        console.log(`✅ 연결된 서버: ${base}`);
        cachedServerURL = base;
        return base;
      }
    } catch {}
  }
  console.warn("⚠️ 서버 연결 실패, Render 기본 URL 사용");
  cachedServerURL = PROD_SERVER_URL;
  return cachedServerURL;
}

/********************** 컨텍스트 **********************/
const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

/********************** Kakao 지도 SDK **********************/
async function loadKakaoMaps() {
  if (window.kakao?.maps) return true;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src =
      "https://dapi.kakao.com/v2/maps/sdk.js?appkey=1befb49da92b720b377651fbf18cd76a&autoload=false&libraries=services";
    s.onload = () => window.kakao.maps.load(() => resolve(true));
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/********************** 사용자 위치 추적 (안정화 + 콘솔 1회) **********************/
function useUserLocation(setUserLocation) {
  useEffect(() => {
    if (!navigator.geolocation) {
      if (!_gpsGenericWarned) {
        console.warn("GPS Error: 이 브라우저는 geolocation을 지원하지 않음");
        _gpsGenericWarned = true;
      }
      return;
    }
    let watchId = null;
    let canceled = false;

    const logError = (err) => {
      const map = { 1: "PERMISSION_DENIED", 2: "POSITION_UNAVAILABLE", 3: "TIMEOUT" };
      const code = err?.code;
      if (code === 1) {
        if (!_gpsPermissionWarned) {
          console.warn(`GPS Error: ${map[code]}${err?.message ? ` — ${err.message}` : ""}`);
          _gpsPermissionWarned = true;
        }
      } else {
        if (!_gpsGenericWarned) {
          console.warn(`GPS Error: ${map[code] || "UNKNOWN"}${err?.message ? ` — ${err.message}` : ""}`);
          _gpsGenericWarned = true;
        }
      }
    };

    const getOnce = (opts) =>
      new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, opts);
      });

    const start = async () => {
      try {
        const pos = await getOnce({ enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
        if (!canceled) setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (e1) {
        logError(e1);
        try {
          const pos2 = await getOnce({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
          if (!canceled) setUserLocation({ lat: pos2.coords.latitude, lng: pos2.coords.longitude });
        } catch (e2) {
          logError(e2);
          if (!canceled) {
            if (!_gpsFallbackWarned) {
              console.warn("⚠️ 위치 폴백 좌표 사용");
              _gpsFallbackWarned = true;
            }
            setUserLocation({ lat: 37.3308, lng: 126.8398 }); // 안산대 근처
          }
        }
      }

      const watchWith = (opts) =>
        navigator.geolocation.watchPosition(
          (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          (err) => logError(err),
          opts
        );

      watchId = watchWith({ enableHighAccuracy: false, timeout: 20000, maximumAge: 30000 });
      const t = setTimeout(() => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        watchId = watchWith({ enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
      }, 10000);

      return () => clearTimeout(t);
    };

    let cleanupTimer;
    start().then((cleanup) => (cleanupTimer = cleanup));

    return () => {
      canceled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (typeof cleanupTimer === "function") cleanupTimer();
    };
  }, [setUserLocation]);
}

/********************** 서버 데이터 **********************/
// 정류장
async function fetchStopsOnce() {
  const base = await getServerURL();
  try {
    const r = await fetch(`${base}/stops`);
    if (r.ok) return await r.json();
  } catch (e) {
    console.warn("[fetchStopsOnce] /stops 에러:", e);
  }
  return [
    { id: "1", name: "안산대학교", lat: 37.3308, lng: 126.8398 },
    { id: "2", name: "상록수역", lat: 37.3175, lng: 126.866 },
  ];
}

// 차량 위치 + 운행중 메타 병합
async function fetchVehiclesOnce() {
  const base = await getServerURL();
  let vehicles = [];
  try {
    const r = await fetch(`${base}/bus/location`);
    if (r.ok) vehicles = await r.json(); // [{id,lat,lng,route...}]
  } catch (e) {
    console.warn("[fetchVehiclesOnce] /bus/location 에러:", e);
  }

  try {
    const r2 = await fetch(`${base}/bus/active`);
    if (r2.ok) {
      const active = await r2.json(); // [{id,stopId,time,active,serviceWindow...}]
      const idx = new Map(vehicles.map((v) => [String(v.id), v]));
      active.forEach((a) => {
        const key = String(a.id);
        const prev = idx.get(key) || { id: key };
        idx.set(key, { ...prev, ...a });
      });
      vehicles = [...idx.values()];
    }
  } catch {}

  return vehicles;
}

/********************** 유틸 **********************/
function isActiveNow(v) {
  if (!v?.active) return false;
  if (!v?.serviceWindow) return true;
  try {
    const now = Date.now();
    const s = v.serviceWindow.start ? new Date(v.serviceWindow.start).getTime() : -Infinity;
    const e = v.serviceWindow.end ? new Date(v.serviceWindow.end).getTime() : Infinity;
    return now >= s && now <= e;
  } catch {
    return true;
  }
}

// Haversine (meters)
function haversineMeters(a, b) {
  if (!a || !b) return NaN;
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sin = Math.sin;
  const x = sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

/********************** 토스트 (비활성) **********************/
const Notice = ({ text, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 2000);
    return () => clearTimeout(t);
  }, [onClose]);
  return <div className="toast">{text}</div>;
};

/********************** 공통 레이아웃 **********************/
const Page = ({ title, children, right }) => {
  const nav = useNavigate();
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-inner">
          <button onClick={() => nav(-1)} className="header-back-btn" aria-label="뒤로가기">〈</button>
          <h1 className="page-title">{title}</h1>
          <div className="header-right">{right}</div>
        </div>
      </div>

      <div className="page-content">{children}</div>

      <div className="tab-bar">
        <div className="tab-bar-inner">
          <TabItem to="/" icon="🏠" label="홈" />
          <TabItem to="/favorites" icon="⭐" label="즐겨찾기" />
          <TabItem to="/alerts" icon="🔔" label="알림" />
        </div>
      </div>
    </div>
  );
};

const TabItem = ({ to, icon, label }) => {
  const { pathname } = useLocation();
  const active = pathname === to;
  return (
    <Link to={to} className={active ? "tab-item active" : "tab-item"}>
      <span className="tab-icon">{icon}</span>
      <span className="tab-label">{label}</span>
    </Link>
  );
};

/********************** 홈 **********************/
const HomeScreen = () => {
  const { stops, setStops, vehicles, visibleVehicleIds, favIds, toggleFav, userLocation } = useApp();
  const mapRef = useRef(null);
  const mapEl = useRef(null);
  const busOverlays = useRef([]);
  const stopMarkers = useRef([]);
  const userMarkerRef = useRef(null);
  const nav = useNavigate();

  // 지도 초기화
  useEffect(() => {
    (async () => {
      await loadKakaoMaps();
      if (!mapRef.current) {
        mapRef.current = new window.kakao.maps.Map(mapEl.current, {
          center: new window.kakao.maps.LatLng(37.3308, 126.8398),
          level: 5,
        });
      }
    })();
  }, []);

  // 유저 위치 마커 & 최초 센터링
  useEffect(() => {
    if (!userLocation || !window.kakao?.maps || !mapRef.current) return;
    const kakao = window.kakao;
    const pos = new kakao.maps.LatLng(userLocation.lat, userLocation.lng);
    if (!userMarkerRef.current) {
      userMarkerRef.current = new kakao.maps.Marker({
        map: mapRef.current,
        position: pos,
        image: new kakao.maps.MarkerImage(
          "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png",
          new kakao.maps.Size(24, 35)
        )
      });
      mapRef.current.setCenter(pos);
    } else {
      userMarkerRef.current.setPosition(pos);
    }
  }, [userLocation]);

  // 정류장 로드
  useEffect(() => {
    (async () => {
      const data = await fetchStopsOnce();
      setStops(data.map((s) => ({ ...s, favorite: favIds.has(String(s.id)) })));
    })();
  }, [setStops, favIds]);

  // 정류장 마커
  useEffect(() => {
    if (!window.kakao?.maps || !mapRef.current) return;
    stopMarkers.current.forEach((m) => m.setMap(null));
    stopMarkers.current = [];
    stops.forEach((s) => {
      const pos = new window.kakao.maps.LatLng(s.lat, s.lng);
      const marker = new window.kakao.maps.Marker({ position: pos, map: mapRef.current });
      window.kakao.maps.event.addListener(marker, "click", () => nav(`/stop/${s.id}`));
      stopMarkers.current.push(marker);
    });
  }, [stops, nav]);

  // (홈) 차량 오버레이 — 홈은 기본 숨김
  useEffect(() => {
    if (!window.kakao?.maps || !mapRef.current) return;
    busOverlays.current.forEach((o) => o.setMap(null));
    busOverlays.current = [];
    const visibleVehicles = vehicles.filter((v) => visibleVehicleIds.includes(v.id));
    visibleVehicles.forEach((v) => {
      const pos = new window.kakao.maps.LatLng(v.lat, v.lng);
      const overlay = new window.kakao.maps.CustomOverlay({
        position: pos,
        content: `<div style="text-align:center;">🚌<br/><small>${v.route || "셔틀"}</small></div>`,
        yAnchor: 0.5,
      });
      overlay.setMap(mapRef.current);
      busOverlays.current.push(overlay);
    });
  }, [vehicles, visibleVehicleIds]);

  // 정류장별 "운행중" 집계
  const activeCountByStop = useMemo(() => {
    const m = new Map(); // stopId -> count
    vehicles.forEach((v) => {
      if (!v?.stopId) return;
      if (isActiveNow(v)) {
        const key = String(v.stopId);
        m.set(key, (m.get(key) || 0) + 1);
      }
    });
    return m;
  }, [vehicles]);

  return (
    <Page
      title="EVERYBUS"
      right={
        <div>
          <button className="header-link-btn" onClick={() => nav("/favorites")}>즐겨찾기</button>
          <button className="header-link-btn" onClick={() => nav("/alerts")}>알림</button>
        </div>
      }
    >
      <div className="map-container" style={{ height: MAP_HEIGHT }}>
        <div ref={mapEl} style={{ width: "100%", height: "100%" }} />
      </div>

      {/* 정류장 리스트 */}
      <div className="bus-list">
        {stops.map((s) => {
          const activeN = activeCountByStop.get(String(s.id)) || 0;
          return (
            <div
              key={s.id}
              className="bus-item"
              role="button"
              tabIndex={0}
              onClick={() => nav(`/stop/${s.id}`)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && nav(`/stop/${s.id}`)}
            >
              <div className="bus-item-content">
                <div>
                  <div className="bus-item-name">{s.name}</div>
                  {activeN > 0 && (
                    <div className="arrival-tags" style={{ marginTop: 6 }}>
                      <span className="arrival-tag">운행중 {activeN}대</span>
                    </div>
                  )}
                </div>
                <button
                  className="favorite-btn"
                  aria-label="즐겨찾기 토글"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFav(String(s.id));
                  }}
                >
                  {favIds.has(String(s.id)) ? "⭐" : "☆"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Page>
  );
};

/********************** 즐겨찾기 **********************/
const FavoritesScreen = () => {
  const { stops, favIds, toggleFav } = useApp();
  const nav = useNavigate();
  const favStops = useMemo(
    () => stops.filter((s) => favIds.has(String(s.id))),
    [stops, favIds]
  );

  return (
    <Page title="즐겨찾기">
      {favStops.length === 0 ? (
        <div className="list-empty-text">즐겨찾기한 정류장이 없어요.</div>
      ) : (
        <div className="bus-list">
          {favStops.map((s) => (
            <div
              key={s.id}
              className="bus-item"
              role="button"
              tabIndex={0}
              onClick={() => nav(`/stop/${s.id}`)}
            >
              <div className="bus-item-content">
                <div className="bus-item-name">{s.name}</div>
                <button
                  className="favorite-btn"
                  aria-label="즐겨찾기 해제"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFav(String(s.id));
                  }}
                >
                  {favIds.has(String(s.id)) ? "⭐" : "☆"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
};

/********************** 알림 (더미) **********************/
const AlertsScreen = () => {
  const { alerts, clearAlerts } = useApp();
  return (
    <Page
      title="알림"
      right={alerts.length > 0 ? <button className="header-link-btn" onClick={clearAlerts}>전체 지우기</button> : null}
    >
      <div className="card">
        <div className="card-subtitle">안내</div>
        <ul className="info-list">
          <li>현재 앱 내 토스트/알림은 비활성화되어 있어요.</li>
          <li>알림을 다시 보이게 하려면 App.js 상단의 <b>NOTIFY_ENABLED</b>를 <code>true</code>로 바꾸세요.</li>
        </ul>
      </div>
      {alerts.length === 0 ? (
        <div className="list-empty-text">새 알림이 없어요.</div>
      ) : (
        <div className="card-list">
          {alerts.map((a) => (
            <div className="card" key={a.id}>
              <div className="card-subtitle">{new Date(a.ts).toLocaleString()}</div>
              <div className="info-text">{a.message}</div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
};

/********************** 정류장 상세 **********************/
const StopDetail = () => {
  const { id } = useParams();
  const { stops, vehicles } = useApp();
  const nav = useNavigate();

  const stop = useMemo(() => stops.find((s) => String(s.id) === String(id)), [stops, id]);
  const mapRef = useRef(null);
  const mapEl = useRef(null);

  // 지도 초기화 + 정류장 마커
  useEffect(() => {
    (async () => {
      await loadKakaoMaps();
      if (!stop) return;
      const kakao = window.kakao;
      const center = new kakao.maps.LatLng(stop.lat, stop.lng);
      mapRef.current = new kakao.maps.Map(mapEl.current, { center, level: 4 });
      new kakao.maps.Marker({ position: center, map: mapRef.current });
      setTimeout(() => mapRef.current && mapRef.current.relayout(), 0);
    })();
  }, [stop]);

  // 이 정류장에서 현재 운행중인 시간대만 뽑기
  const activeTimes = useMemo(() => {
    const set = new Set();
    vehicles.forEach(v => {
      if (String(v.stopId) === String(id) && isActiveNow(v) && v.time) {
        set.add(String(v.time).trim());
      }
    });
    return Array.from(set).sort();
  }, [vehicles, id]);

  const activeCount = activeTimes.length;

  if (!stop) {
    return (
      <Page title="정류장 상세">
        <div className="list-empty-text">정류장을 찾을 수 없습니다.</div>
      </Page>
    );
  }

  return (
    <Page
      title={stop.name}
      right={<span className="info-text">{activeCount > 0 ? `운행중 ${activeCount}대` : "현재 운행 없음"}</span>}
    >
      <div className="map-container" style={{ height: MAP_HEIGHT }}>
        <div ref={mapEl} style={{ width: "100%", height: "100%" }} />
      </div>

      <div className="card">
        <div className="card-subtitle">운행중인 시간대</div>
        {activeTimes.length === 0 ? (
          <div className="info-text">현재 이 정류장에는 운행 중인 시간대가 없습니다.</div>
        ) : (
          <div className="bus-list">
            {activeTimes.map((t) => (
              <button
                key={t}
                className="bus-item"
                onClick={() => nav(`/stop/${id}/live/${encodeURIComponent(t)}`)}
                style={{ textAlign: "left" }}
              >
                <div className="bus-item-content">
                  <div className="bus-item-name">{t}</div>
                  <div className="arrival-tags">
                    <span className="arrival-tag">선택</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
};

/********************** 라이브 화면 (현재 버스 위치 + ETA) **********************/
const TimeLiveScreen = () => {
  const { id, time } = useParams(); // stopId, HH:MM
  const { stops, vehicles } = useApp();
  const [search] = useSearchParams(); // speedKmh(optional)
  const speedKmh = Number(search.get("speedKmh")) > 0 ? Number(search.get("speedKmh")) : 18; // 기본 18km/h
  const stop = useMemo(() => stops.find((s) => String(s.id) === String(id)), [stops, id]);

  const mapRef = useRef(null);
  const mapEl = useRef(null);
  const overlays = useRef([]);

  // 이 시간대에 해당하는 운행중 차량(여러대 가능)
  const actives = useMemo(() => {
    const t = String(time || "").trim();
    return vehicles.filter(v => String(v.stopId) === String(id) && isActiveNow(v) && String(v.time || "").trim() === t);
  }, [vehicles, id, time]);

  // ETA 계산
  const etaText = useMemo(() => {
    if (!stop || actives.length === 0) return "정보 없음";
    const withDist = actives
      .filter(v => Number.isFinite(v.lat) && Number.isFinite(v.lng))
      .map(v => ({ v, d: haversineMeters({ lat: v.lat, lng: v.lng }, { lat: stop.lat, lng: stop.lng }) }));
    if (withDist.length === 0) return "정보 없음";
    const nearest = withDist.sort((a, b) => a.d - b.d)[0];
    const mps = speedKmh * 1000 / 3600;
    const mins = Math.max(1, Math.round((nearest.d / mps) / 60));
    return `${mins}분 후 도착 예정`;
  }, [actives, stop, speedKmh]);

  // 지도 초기화 + 마커/오버레이
  useEffect(() => {
    (async () => {
      await loadKakaoMaps();
      if (!stop) return;
      const kakao = window.kakao;
      const center = actives.length > 0 && Number.isFinite(actives[0].lat) && Number.isFinite(actives[0].lng)
        ? new kakao.maps.LatLng(actives[0].lat, actives[0].lng)
        : new kakao.maps.LatLng(stop.lat, stop.lng);

      const map = new kakao.maps.Map(mapEl.current, { center, level: 4 });
      mapRef.current = map;

      // 정류장 마커
      new kakao.maps.Marker({ position: new kakao.maps.LatLng(stop.lat, stop.lng), map });

      // 버스 오버레이
      overlays.current.forEach(o => o.setMap(null));
      overlays.current = [];
      actives.forEach((v) => {
        if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return;
        const overlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(v.lat, v.lng),
          content: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-50%);">
              <div style="font-size:22px;filter:drop-shadow(0 0 2px rgba(0,0,0,.5));">🚌</div>
              <div style="font-size:10px;font-weight:bold;line-height:1;margin-top:2px;">${v.route || "셔틀"}</div>
            </div>`,
          yAnchor: 0.5, xAnchor: 0.5,
        });
        overlay.setMap(map);
        overlays.current.push(overlay);
      });

      setTimeout(() => map && map.relayout(), 0);
    })();
  }, [actives, stop]);

  if (!stop) {
    return (
      <Page title="라이브">
        <div className="list-empty-text">정류장을 찾을 수 없습니다.</div>
      </Page>
    );
  }

  return (
    <Page title={`${stop.name} • ${time}`}>
      <div className="map-container" style={{ height: MAP_HEIGHT }}>
        <div ref={mapEl} style={{ width: "100%", height: "100%" }} />
      </div>

      <div className="card">
        <div className="card-subtitle">예상 도착</div>
        <div style={{ fontWeight: 700, fontSize: "1rem" }}>{etaText}</div>
        <div className="info-text" style={{ marginTop: 6 }}>
          (기본 속도 {speedKmh}km/h 기준 계산 • URL에 <code>?speedKmh=20</code> 처럼 전달하면 변경 가능)
        </div>
      </div>
    </Page>
  );
};

/********************** App 루트 **********************/
export default function App() {
  const [stops, setStops] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [favIds, setFavIds] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("everybus:favorites") || "[]"));
    } catch {
      return new Set();
    }
  });
  const [visibleVehicleIds, setVisibleVehicleIds] = useState([]);
  const [userLocation, setUserLocation] = useState(null);

  const [alerts, setAlerts] = useState([]);
  const [toasts, setToasts] = useState([]);
  const addNotice = (message) => {
    if (!NOTIFY_ENABLED) return;
    const n = { id: crypto.randomUUID(), ts: Date.now(), message };
    setAlerts((prev) => [n, ...prev]);
    setToasts((prev) => [...prev, n]);
  };
  const closeToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));
  const clearAlerts = () => setAlerts([]);

  const toggleFav = (id) => {
    setFavIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("everybus:favorites", JSON.stringify([...next]));
      setStops((prevStops) =>
        prevStops.map((s) => (String(s.id) === String(id) ? { ...s, favorite: next.has(String(id)) } : s))
      );
      return next;
    });
  };

  useUserLocation(setUserLocation);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const v = await fetchVehiclesOnce();
      if (alive) setVehicles(v);
    };
    run();
    const iv = setInterval(run, VEHICLE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const ctx = {
    stops, setStops,
    vehicles, setVehicles,
    favIds, toggleFav,
    userLocation,
    visibleVehicleIds, setVisibleVehicleIds,
    alerts, clearAlerts, addNotice,
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="toast-wrap">
        {toasts.map((t) => (
          <Notice key={t.id} text={t.message} onClose={() => closeToast(t.id)} />
        ))}
      </div>

      <BrowserRouter>
  <Routes>
    <Route path="/" element={<HomeScreen />} />
    <Route path="/favorites" element={<FavoritesScreen />} />
    <Route path="/alerts" element={<AlertsScreen />} />
    <Route path="/stop/:id" element={<StopDetail />} />
    <Route path="/stop/:id/live/:time" element={<TimeLiveScreen />} />

    
    <Route path="/route-editor" element={<RouteEditor />} />

    <Route
      path="*"
      element={
        <div className="not-found-page">
          <div className="not-found-content">
            <div className="not-found-icon">🚌</div>
            <div className="not-found-title">페이지를 찾을 수 없습니다</div>
            <Link className="not-found-link" to="/">홈으로</Link>
          </div>
        </div>
      }
    />
  </Routes>
</BrowserRouter>

    </AppContext.Provider>
  );
}
