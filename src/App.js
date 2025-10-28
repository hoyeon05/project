// App.js — EveryBus React UI (Render 자동연결 안정화본)
import React, { useEffect, useRef, useState, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";
import "./App.css";

/********************** 환경값 **********************/
const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";
const MAP_HEIGHT = 360;
const VEHICLE_POLL_MS = 5000;
const REAL_SHUTTLE_IMEI = "350599638756152";

let cachedServerURL = null;
async function getServerURL() {
  if (cachedServerURL) return cachedServerURL;
  const candidates = [PROD_SERVER_URL, LOCAL_SERVER_URL];
  for (const base of candidates) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) {
        console.log(`✅ 연결된 서버: ${base}`);
        cachedServerURL = base;
        return base;
      }
    } catch (_) {}
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
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=1befb49da92b720b377651fbf18cd76a&autoload=false&libraries=services`;
    s.onload = () => {
      window.kakao.maps.load(() => resolve(true));
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/********************** 사용자 위치 추적 **********************/
function useUserLocation(setUserLocation) {
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => console.warn("GPS Error:", err.message),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [setUserLocation]);
}

/********************** 서버 데이터 **********************/
async function fetchStopsOnce() {
  const base = await getServerURL();
  try {
    const r = await fetch(`${base}/stops`);
    if (r.ok) return await r.json();
  } catch (e) {
    console.warn(`[fetchStopsOnce] /stops 에러:`, e);
  }
  try {
    const r2 = await fetch(`${base}/bus-info`);
    if (r2.ok) return await r2.json();
  } catch (e) {
    console.warn(`[fetchStopsOnce] /bus-info 에러:`, e);
  }
  console.warn("⚠️ 서버에서 정류장 데이터를 받지 못함 — 기본값 사용");
  return [
    { id: "1", name: "안산대학교", lat: 37.3308, lng: 126.8398 },
    { id: "2", name: "상록수역", lat: 37.3175, lng: 126.866 },
  ];
}

async function fetchVehiclesOnce() {
  const base = await getServerURL();
  try {
    const r = await fetch(`${base}/bus/location`);
    if (r.ok) return await r.json();
  } catch (e) {
    console.warn(`[fetchVehiclesOnce] /bus/location 에러:`, e);
  }
  return [];
}

/********************** 즐겨찾기 **********************/
const FAV_KEY = "everybus:favorites";
const loadFavIds = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

/********************** 기본 페이지 **********************/
const Page = ({ title, children }) => {
  const nav = useNavigate();
  return (
    <div className="page-container">
      <div className="page-header">
        <button onClick={() => nav(-1)} className="header-back-btn">〈</button>
        <h1>{title}</h1>
      </div>
      <div className="page-content">{children}</div>
      <Tabbar />
    </div>
  );
};

const Tabbar = () => {
  const { pathname } = useLocation();
  const isActive = (to) => pathname === to;
  const Item = ({ to, label, icon }) => (
    <Link to={to} className={isActive(to) ? "tab-item active" : "tab-item"}>
      <span>{icon}</span>
      <span>{label}</span>
    </Link>
  );
  return (
    <div className="tab-bar">
      <Item to="/" label="홈" icon="🏠" />
    </div>
  );
};

/********************** 홈 **********************/
const HomeScreen = () => {
  const { stops, setStops, vehicles, visibleVehicleIds, setVisibleVehicleIds, favIds } = useApp();
  const mapRef = useRef(null);
  const mapEl = useRef(null);
  const busOverlays = useRef([]);
  const stopMarkers = useRef([]);

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
      window.kakao.maps.event.addListener(marker, "click", () => {
        setVisibleVehicleIds([REAL_SHUTTLE_IMEI]);
        mapRef.current.setCenter(pos);
        mapRef.current.setLevel(4);
      });
      stopMarkers.current.push(marker);
    });
  }, [stops, setVisibleVehicleIds]);

  // 차량 오버레이
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

  return (
    <Page title="EVERYBUS">
      <div ref={mapEl} style={{ width: "100%", height: MAP_HEIGHT }} />
      <div className="bus-list">
        {stops.map((s) => (
          <div key={s.id} className="bus-item">
            <span>{s.name}</span>
            <span>{s.favorite ? "⭐" : "☆"}</span>
          </div>
        ))}
      </div>
    </Page>
  );
};

/********************** App 루트 **********************/
export default function App() {
  const [stops, setStops] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [favIds] = useState(() => loadFavIds());
  const [visibleVehicleIds, setVisibleVehicleIds] = useState([]);
  const [userLocation, setUserLocation] = useState(null);

  useUserLocation(setUserLocation);

  // 실시간 차량 폴링
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
    stops,
    setStops,
    vehicles,
    setVehicles,
    favIds,
    userLocation,
    visibleVehicleIds,
    setVisibleVehicleIds,
  };

  return (
    <AppContext.Provider value={ctx}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
        </Routes>
      </BrowserRouter>
    </AppContext.Provider>
  );
}
