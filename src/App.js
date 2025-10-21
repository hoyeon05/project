// App.js — EveryBus React UI (정리/최종본)
// - 정류장 선택 시에만 버스 아이콘 표시
// - 홈/다른 화면으로 돌아오면 자동 숨김
// - 차량 폴링은 App 최상단에서 공통 수행
// - imei/deviceId 매핑 보강

import React, {
  useEffect, useMemo, useRef, useState, createContext, useContext
} from "react";
import {
  BrowserRouter, Routes, Route, Link, useNavigate, useLocation, useParams
} from "react-router-dom";
import "./App.css";

/********************** 환경값 **********************/
const KAKAO_APP_KEY =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_KAKAO_APP_KEY) ||
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_KAKAO_APP_KEY) ||
  "1befb49da92b720b377651fbf18cd76a";

const PROD_SERVER_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SERVER_URL) ||
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_SERVER_URL) ||
  "https://project-1-ek9j.onrender.com";

const getServerURL = () =>
  window.location.hostname.includes("localhost") ? "http://localhost:5000" : PROD_SERVER_URL;

const MAP_HEIGHT = 360;
const VEHICLE_POLL_MS = 5000;
const REAL_SHUTTLE_IMEI = "350599638756152";

/********************** 컨텍스트 **********************/
const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

/********************** Kakao SDK 로더 **********************/
async function loadKakaoMaps() {
  if (window.kakao?.maps) return true;
  if (document.getElementById("kakao-sdk")) {
    await new Promise((res) => {
      const check = () =>
        window.kakao?.maps ? res(true) : setTimeout(check, 50);
      check();
    });
    return true;
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.id = "kakao-sdk";
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&autoload=false&libraries=services`;
    s.onload = () => {
      if (!window.kakao?.maps) return reject(new Error("Kakao global missing"));
      window.kakao.maps.load(() =>
        window.kakao?.maps ? resolve(true) : reject(new Error("Kakao maps failed to load"))
      );
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return true;
}

/********************** 사용자 위치 추적 Hook **********************/
function useUserLocation(setUserLocation) {
  useEffect(() => {
    if (!navigator.geolocation) {
      console.warn("Geolocation not supported by this browser.");
      return;
    }
    const successHandler = (position) => {
      setUserLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      });
    };
    const errorHandler = (error) => {
      console.error("LOCATION ERROR:", error.code, error.message);
    };
    const watchId = navigator.geolocation.watchPosition(successHandler, errorHandler, {
      enableHighAccuracy: true, timeout: 5000, maximumAge: 0,
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [setUserLocation]);
}

/********************** 스키마 어댑터 **********************/
function mapToStops(raw) {
  if (Array.isArray(raw) && raw[0]?.id && raw[0]?.lat != null && raw[0]?.lng != null) {
    return raw
      .map((s) => ({
        id: String(s.id),
        name: s.name || s.stopName || "이름없는 정류장",
        lat: Number(s.lat), lng: Number(s.lng),
        nextArrivals: s.nextArrivals || s.arrivals || [],
        favorite: !!s.favorite,
      }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  }
  if (raw?.stops && Array.isArray(raw.stops)) return mapToStops(raw.stops);
  if (Array.isArray(raw) && raw.length && (raw[0].stopId || raw[0].stop)) {
    const byStop = new Map();
    raw.forEach((item) => {
      const stopId = String(item.stopId || item.stop?.id || item.stop);
      const stopName = item.stopName || item.stop?.name || "정류장";
      const lat = item.stopLat ?? item.lat ?? item.stop?.lat;
      const lng = item.stopLng ?? item.lng ?? item.stop?.lng;
      const eta = item.eta ?? item.arrival ?? item.nextArrival ?? null;
      if (!byStop.has(stopId)) {
        byStop.set(stopId, {
          id: stopId, name: stopName, lat: Number(lat), lng: Number(lng),
          nextArrivals: [], favorite: false
        });
      }
      if (eta != null) byStop.get(stopId).nextArrivals.push(String(eta));
    });
    return [...byStop.values()]
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => ({ ...s, nextArrivals: s.nextArrivals.slice(0, 3) }));
  }
  return [];
}

function mapToVehicles(raw) {
  if (Array.isArray(raw) && raw[0]?.lat != null && raw[0]?.lng != null) {
    return raw
      .map((v, idx) => ({
        // ✅ imei/deviceId 호환
        id: String(v.id ?? v.imei ?? v.deviceId ?? v.device_id ?? idx),
        lat: Number(v.lat ?? v.latitude ?? v.position?.lat ?? v.position?.latitude),
        lng: Number(v.lng ?? v.longitude ?? v.position?.lng ?? v.position?.longitude),
        heading: v.heading ?? v.bearing ?? v.direction ?? null,
        route: v.route ?? v.routeName ?? v.line ?? v.busNo ?? null,
        updatedAt: v.updatedAt ?? v.timestamp ?? null,
      }))
      .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));
  }
  if (raw?.vehicles && Array.isArray(raw.vehicles)) return mapToVehicles(raw.vehicles);
  return [];
}

/********************** API **********************/
async function fetchStopsOnce() {
  const base = getServerURL();
  try {
    const r = await fetch(`${base}/stops`, { headers: { Accept: "application/json" } });
    if (r.ok) {
      const mapped = mapToStops(await r.json());
      if (mapped.length) return mapped;
    } else { console.error("/stops response not ok:", r.status, r.statusText); }
  } catch (e) { console.error("/stops fetch error:", e); }
  try {
    const r2 = await fetch(`${base}/bus-info`, { headers: { Accept: "application/json" } });
    if (r2.ok) {
      const mapped2 = mapToStops(await r2.json());
      if (mapped2.length) return mapped2;
    } else { console.error("/bus-info response not ok:", r2.status, r2.statusText); }
  } catch (e) { console.error("/bus-info fetch error:", e); }
  // fallback
  return [
    { id: "1", name: "안산대학교", lat: 37.3308, lng: 126.8398, nextArrivals: ["5분 후", "15분 후"], favorite: false },
    { id: "2", name: "상록수역", lat: 37.3175, lng: 126.8660, nextArrivals: ["8분 후", "18분 후"], favorite: false },
  ];
}

async function fetchVehiclesOnce() {
  const base = getServerURL();
  const path = `/bus/location`;
  try {
    const r = await fetch(`${base}${path}`, { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    const data = await r.json();
    if (Array.isArray(data)) return mapToVehicles(data);
    return [];
  } catch (e) {
    console.error(`${path} fetch error:`, e);
    return [];
  }
}

/********************** 즐겨찾기 저장 **********************/
const FAV_KEY = "everybus:favorites";
const loadFavIds = () => {
  try { const raw = localStorage.getItem(FAV_KEY); return raw ? new Set(JSON.parse(raw)) : new Set(); }
  catch { return new Set(); }
};
const saveFavIds = (set) => { try { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch {} };

/********************** 공통 UI **********************/
const Page = ({ title, right, children }) => {
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
      <Tabbar />
    </div>
  );
};
const Tabbar = () => {
  const { pathname } = useLocation();
  const isActive = (to) => pathname === to || (to === "/" && pathname.startsWith("/stop/"));
  const Item = ({ to, label, icon }) => (
    <Link to={to} className={isActive(to) ? "tab-item active" : "tab-item"}>
      <span aria-hidden className="tab-icon">{icon}</span>
      <span className="tab-label">{label}</span>
    </Link>
  );
  return (
    <div className="tab-bar">
      <div className="tab-bar-inner">
        <Item to="/" label="홈" icon="🏠" />
        <Item to="/favorites" label="즐겨찾기" icon="⭐" />
        <Item to="/alerts" label="알림" icon="🔔" />
      </div>
    </div>
  );
};

/********************** 스플래시 **********************/
const SplashScreen = () => {
  const nav = useNavigate();
  useEffect(() => {}, []);
  return (
    <div className="splash-screen">
      <div className="splash-title">EVERYBUS</div>
      <p className="splash-subtitle">실시간 캠퍼스 버스 도착 알림</p>
      <button onClick={() => nav("/")} className="splash-button">시작하기</button>
    </div>
  );
};

/********************** 홈 **********************/
const HomeScreen = () => {
  const {
    stops, setStops, search, setSearch, favIds, setFavIds,
    vehicles, userLocation, visibleVehicleIds, setVisibleVehicleIds, lastBusUpdate
  } = useApp();

  const nav = useNavigate();
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const stopMarkersRef = useRef([]);
  const busOverlaysRef = useRef([]);
  const userMarkerRef = useRef(null);
  const [loadError, setLoadError] = useState("");

  // ✅ 홈 마운트 시 기본 숨김
  useEffect(() => { setVisibleVehicleIds([]); }, [setVisibleVehicleIds]);

  // 정류장 로드
  useEffect(() => {
    let alive = true;
    const applyData = (data) => {
      if (!alive) return;
      if (!data.length) { setLoadError("서버에서 정류장 정보를 불러오지 못했습니다. 임시 데이터를 사용합니다."); return; }
      setLoadError("");
      setStops(data.map((s) => ({ ...s, favorite: favIds.has(String(s.id)) })));
    };
    (async () => applyData(await fetchStopsOnce()))();
    const iv = setInterval(async () => {
      const data = await fetchStopsOnce();
      if (data.length) applyData(data);
    }, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [setStops, favIds]);

  // 지도 초기화
  useEffect(() => {
    let canceled = false;
    (async () => {
      await loadKakaoMaps();
      if (canceled) return;
      const kakao = window.kakao;
      if (!mapRef.current) {
        mapRef.current = new kakao.maps.Map(mapEl.current, {
          center: new kakao.maps.LatLng(37.3308, 126.8398),
          level: 5,
        });
        setTimeout(() => mapRef.current && mapRef.current.relayout(), 0);
      }
    })();
    return () => { canceled = true; };
  }, []);

  // 창 크기 변경
  useEffect(() => {
    const onResize = () => mapRef.current && mapRef.current.relayout();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 검색 필터
  const filtered = useMemo(() => {
    if (!search.trim()) return stops;
    const q = search.trim().toLowerCase();
    return stops.filter((s) => (s.name || "").toLowerCase().includes(q));
  }, [stops, search]);

  // 정류장 마커
  useEffect(() => {
    const kakao = window.kakao;
    if (!kakao?.maps || !mapRef.current) return;
    stopMarkersRef.current.forEach((m) => m.setMap(null));
    stopMarkersRef.current = [];
    if (!filtered.length) return;
    mapRef.current.relayout();
    const bounds = new kakao.maps.LatLngBounds();
    filtered.forEach((s) => {
      const pos = new kakao.maps.LatLng(s.lat, s.lng);
      const marker = new kakao.maps.Marker({ position: pos, map: mapRef.current });
      const handleStopClick = () => {
        mapRef.current.setCenter(pos);
        mapRef.current.setLevel(3);
        setVisibleVehicleIds([REAL_SHUTTLE_IMEI]); // ✅ 선택 시 표시
      };
      window.kakao.maps.event.addListener(marker, "click", handleStopClick);
      stopMarkersRef.current.push(marker);
      bounds.extend(pos);
    });
    if (filtered.length > 1) mapRef.current.setBounds(bounds);
    else if (filtered.length === 1) mapRef.current.setCenter(new kakao.maps.LatLng(filtered[0].lat, filtered[0].lng));
    return () => {
      stopMarkersRef.current.forEach((m) => m.setMap(null));
      stopMarkersRef.current = [];
    };
  }, [filtered, setVisibleVehicleIds]);

  // 버스 오버레이 (홈)
  useEffect(() => {
    const kakao = window.kakao;
    if (!kakao?.maps || !mapRef.current) return;
    busOverlaysRef.current.forEach((o) => o.setMap(null));
    busOverlaysRef.current = [];
    const visibleVehicles = vehicles.filter((v) => visibleVehicleIds.includes(v.id));
    if (!visibleVehicles.length) return;
    visibleVehicles.forEach((v) => {
      const pos = new kakao.maps.LatLng(v.lat, v.lng);
      const rotate = typeof v.heading === "number" ? `transform: rotate(${Math.round(v.heading)}deg);` : "";
      const label = `<div style="font-size:10px;line-height:1;margin-top:2px;text-align:center;font-weight:bold;">${v.id === REAL_SHUTTLE_IMEI ? "실시간 셔틀" : "버스"}</div>`;
      const content =
        `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto; transform: translateY(-50%);">
          <div style="font-size:20px;filter: drop-shadow(0 0 2px rgba(0,0,0,.5)); ${rotate}">🚌</div>
          ${label}
        </div>`;
      const overlay = new kakao.maps.CustomOverlay({ position: pos, content, yAnchor: 0.5, xAnchor: 0.5 });
      overlay.setMap(mapRef.current);
      busOverlaysRef.current.push(overlay);
    });
    return () => {
      busOverlaysRef.current.forEach((o) => o.setMap(null));
      busOverlaysRef.current = [];
    };
  }, [vehicles, visibleVehicleIds]);

  // 사용자 마커
  useEffect(() => {
    const kakao = window.kakao;
    if (!kakao?.maps || !mapRef.current || !userLocation) {
      userMarkerRef.current?.setMap(null);
      return;
    }
    const pos = new kakao.maps.LatLng(userLocation.lat, userLocation.lng);
    if (!userMarkerRef.current) {
      const marker = new kakao.maps.CustomOverlay({
        position: pos,
        content:
          '<div style="background-color:blue; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 0 5px rgba(0,0,0,0.5); z-index:100;"></div>',
        yAnchor: 0.5, xAnchor: 0.5
      });
      marker.setMap(mapRef.current);
      userMarkerRef.current = marker;
    } else {
      if (userMarkerRef.current.getMap() !== mapRef.current) {
        userMarkerRef.current.setMap(mapRef.current);
      }
      userMarkerRef.current.setPosition(pos);
    }
    return () => { userMarkerRef.current?.setMap(null); };
  }, [userLocation]);

  const onToggleFavorite = (id) => {
    const sid = String(id);
    setStops((prev) => prev.map((s) => (String(s.id) === sid ? { ...s, favorite: !s.favorite } : s)));
    setFavIds((prev) => {
      const next = new Set(prev);
      next.has(sid) ? next.delete(sid) : next.add(sid);
      saveFavIds(next);
      return next;
    });
  };

  return (
    <Page title="EVERYBUS">
      {/* 검색 */}
      <div className="search-container">
        <span>🔎</span>
        <input
          className="search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="정류장 검색 (예: 안산대학교)"
        />
        {search && <button className="search-clear-btn" onClick={() => setSearch("")}>지우기</button>}
      </div>

      {/* 지도 */}
      <div ref={mapEl} id="map" style={{ width: "100%", height: MAP_HEIGHT }} className="map-container">
        <span className="map-loading-text">지도 로딩 중…</span>
      </div>

      {/* 보조 정보 */}
      <div className="map-info-text">
        <div>
          {visibleVehicleIds.length === 0
            ? "정류장을 선택하면 셔틀 위치가 표시됩니다."
            : `실시간 셔틀 위치 표시 중 (${Math.max(0, Math.round((Date.now() - lastBusUpdate) / 1000))}초 전 갱신)`}
        </div>
        {loadError && <div className="error-text">{loadError}</div>}
      </div>

      {/* 정류장 리스트 */}
      <div className="bus-list">
        {filtered.map((stop) => (
          <div
            key={stop.id}
            role="button"
            tabIndex={0}
            className="bus-item"
            onClick={() => nav(`/stop/${stop.id}`)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") nav(`/stop/${stop.id}`); }}
          >
            <div className="bus-item-content">
              <div>
                <div className="bus-item-name">{stop.name}</div>
                <div className="bus-item-arrival">
                  다음 도착: {stop.nextArrivals?.length ? stop.nextArrivals.join(", ") : "정보 수집 중"}
                </div>
              </div>
              <span
                role="button"
                aria-label="즐겨찾기 토글"
                title="즐겨찾기"
                className="favorite-btn"
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(stop.id); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onToggleFavorite(stop.id); } }}
                tabIndex={0}
              >
                {stop.favorite ? "⭐" : "☆"}
              </span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="list-empty-text">검색 결과가 없습니다.</div>}
      </div>
    </Page>
  );
};

/********************** 정류장 상세 **********************/
const StopDetail = () => {
  const { stops, setVisibleVehicleIds, vehicles, visibleVehicleIds } = useApp();
  const { id } = useParams();
  const stop = stops.find((s) => String(s.id) === String(id));
  const nav = useNavigate();
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const busOverlaysRef = useRef([]);

  // 상세 진입 시 선택 상태로 전환
  useEffect(() => {
    setVisibleVehicleIds([REAL_SHUTTLE_IMEI]);
    if (!stop) return;
    (async () => {
      await loadKakaoMaps();
      const kakao = window.kakao;
      const center = new kakao.maps.LatLng(stop.lat, stop.lng);
      mapRef.current = new kakao.maps.Map(mapEl.current, { center, level: 4 });
      new kakao.maps.Marker({ position: center, map: mapRef.current });
      setTimeout(() => mapRef.current && mapRef.current.relayout(), 0);
    })();
  }, [stop, setVisibleVehicleIds]);

  // 상세 나가면 숨김
  useEffect(() => {
    return () => { setVisibleVehicleIds([]); };
  }, [setVisibleVehicleIds]);

  // 상세에서도 버스 오버레이 표시
  useEffect(() => {
    const kakao = window.kakao;
    if (!kakao?.maps || !mapRef.current) return;
    busOverlaysRef.current.forEach((o) => o.setMap(null));
    busOverlaysRef.current = [];
    const vis = vehicles.filter((v) => visibleVehicleIds.includes(v.id));
    if (!vis.length) return;
    vis.forEach((v) => {
      const pos = new kakao.maps.LatLng(v.lat, v.lng);
      const rotate = typeof v.heading === "number" ? `transform: rotate(${Math.round(v.heading)}deg);` : "";
      const label = `<div style="font-size:10px;line-height:1;margin-top:2px;text-align:center;font-weight:bold;">${v.id === REAL_SHUTTLE_IMEI ? "실시간 셔틀" : "버스"}</div>`;
      const content =
        `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto; transform: translateY(-50%);">
          <div style="font-size:20px;filter: drop-shadow(0 0 2px rgba(0,0,0,.5)); ${rotate}">🚌</div>
          ${label}
        </div>`;
      const overlay = new kakao.maps.CustomOverlay({ position: pos, content, yAnchor: 0.5, xAnchor: 0.5 });
      overlay.setMap(mapRef.current);
      busOverlaysRef.current.push(overlay);
    });
    return () => {
      busOverlaysRef.current.forEach((o) => o.setMap(null));
      busOverlaysRef.current = [];
    };
  }, [vehicles, visibleVehicleIds]);

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
      right={<button onClick={() => nav("/alerts")} className="header-link-btn">알림설정</button>}
    >
      <div className="card">
        <div className="card-subtitle">다음 도착 예정</div>
        <div className="arrival-tags">
          {(stop.nextArrivals?.length ? stop.nextArrivals : ["정보 수집 중"]).map((t, idx) => (
            <div key={idx} className="arrival-tag">{t}</div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-subtitle">정류장 위치</div>
        <div ref={mapEl} style={{ width: "100%", height: MAP_HEIGHT }} className="map-container">
          지도(단일 마커)
        </div>
      </div>

      <div className="card">
        <div className="card-subtitle">노선 & 최근 도착 기록</div>
        <ul className="info-list">
          <li>셔틀 A (학교 ↔ 상록수역)</li>
          <li>셔틀 B (학교 순환)</li>
        </ul>
      </div>
    </Page>
  );
};

/********************** 즐겨찾기 **********************/
const FavoritesScreen = () => {
  const { stops, setVisibleVehicleIds } = useApp();
  const nav = useNavigate();
  const favorites = stops.filter((s) => s.favorite);

  useEffect(() => { setVisibleVehicleIds([]); }, [setVisibleVehicleIds]);

  return (
    <Page title="즐겨찾기">
      <div className="bus-list">
        {favorites.map((stop) => (
          <div
            key={stop.id}
            role="button"
            tabIndex={0}
            className="bus-item"
            onClick={() => nav(`/stop/${stop.id}`)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") nav(`/stop/${stop.id}`); }}
          >
            <div className="bus-item-content">
              <div>
                <div className="bus-item-name">{stop.name}</div>
                <div className="bus-item-arrival">
                  다음 도착: {stop.nextArrivals?.length ? stop.nextArrivals.join(", ") : "정보 수집 중"}
                </div>
              </div>
              <span className="favorite-btn">⭐</span>
            </div>
          </div>
        ))}
        {favorites.length === 0 && <div className="list-empty-text">즐겨찾기한 정류장이 없습니다.</div>}
      </div>
    </Page>
  );
};

/********************** 알림 설정 **********************/
const AlertsScreen = () => {
  const { setVisibleVehicleIds } = useApp();
  const [enabled, setEnabled] = useState(true);
  const [minutes, setMinutes] = useState(3);

  useEffect(() => { setVisibleVehicleIds([]); }, [setVisibleVehicleIds]);

  return (
    <Page title="알림 설정">
      <div className="card">
        <div className="settings-item">
          <div>
            <div className="settings-item-title">도착 알림</div>
            <div className="card-subtitle">버스가 도착 {minutes}분 전에 알려줄게요</div>
          </div>
          <button onClick={() => setEnabled((v) => !v)} className={enabled ? "toggle-btn active" : "toggle-btn"}>
            {enabled ? "ON" : "OFF"}
          </button>
        </div>
        <div>
          <label className="input-label">알림 시점 (분)</label>
          <input
            type="number" min={1} max={30}
            value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}
            className="basic-input"
          />
        </div>
        <div className="info-text">※ 실제 푸시는 백엔드/FCM에서 처리, 이 화면은 설정 UI</div>
      </div>
    </Page>
  );
};

/********************** 앱 루트 **********************/
export default function App() {
  const [stops, setStops] = useState([]);
  const [search, setSearch] = useState("");
  const [favIds, setFavIds] = useState(() => loadFavIds());
  const [vehicles, setVehicles] = useState([]);
  const [visibleVehicleIds, setVisibleVehicleIds] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [lastBusUpdate, setLastBusUpdate] = useState(0);

  useUserLocation(setUserLocation);

  // ✅ 차량 폴링: 전역
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const v = await fetchVehiclesOnce();
      if (!alive) return;
      setVehicles(v);
      setLastBusUpdate(Date.now());
    };
    run();
    const iv = setInterval(run, VEHICLE_POLL_MS);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const toggleFavorite = (id) => {
    const sid = String(id);
    setStops((prev) => prev.map((s) => (String(s.id) === sid ? { ...s, favorite: !s.favorite } : s)));
    setFavIds((prev) => {
      const next = new Set(prev);
      next.has(sid) ? next.delete(sid) : next.add(sid);
      saveFavIds(next);
      return next;
    });
  };

  const ctx = {
    stops, setStops, search, setSearch, toggleFavorite,
    favIds, setFavIds, vehicles, setVehicles,
    userLocation, setUserLocation,
    visibleVehicleIds, setVisibleVehicleIds,
    lastBusUpdate,
  };

  return (
    <AppContext.Provider value={ctx}>
      <BrowserRouter>
        <Routes>
          <Route path="/splash" element={<SplashScreen />} />
          <Route path="/" element={<HomeScreen />} />
          <Route path="/stop/:id" element={<StopDetail />} />
          <Route path="/favorites" element={<FavoritesScreen />} />
          <Route path="/alerts" element={<AlertsScreen />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AppContext.Provider>
  );
}

/********************** 404 **********************/
const NotFound = () => (
  <div className="not-found-page">
    <div className="not-found-content">
      <div className="not-found-icon">🧭</div>
      <div className="not-found-title">페이지를 찾을 수 없습니다</div>
      <Link className="link" to="/">홈으로</Link>
    </div>
  </div>
);
