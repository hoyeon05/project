// App.js — EveryBus React UI (정류장 → 상세 전환 + 실시간 버스 표시 + 유저 위치 마커)
import React, { useEffect, useRef, useState, createContext, useContext, useMemo } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, useParams } from "react-router-dom";
import "./App.css";

/********************** 환경값 **********************/
const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";
const MAP_HEIGHT = 360;
const VEHICLE_POLL_MS = 5000;
const REAL_SHUTTLE_IMEI = "350599638756152";

/********************** 서버 자동 선택 **********************/
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
    s.src =
      "https://dapi.kakao.com/v2/maps/sdk.js?appkey=1befb49da92b720b377651fbf18cd76a&autoload=false&libraries=services";
    s.onload = () => window.kakao.maps.load(() => resolve(true));
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/********************** 사용자 위치 추적 (안정화) **********************/
function useUserLocation(setUserLocation) {
  useEffect(() => {
    if (!navigator.geolocation) {
      console.warn("GPS Error: 이 브라우저는 geolocation을 지원하지 않음");
      return;
    }
    let watchId = null;
    let canceled = false;

    const logError = (err) => {
      const map = { 1: "PERMISSION_DENIED", 2: "POSITION_UNAVAILABLE", 3: "TIMEOUT" };
      console.warn(`GPS Error: ${map[err?.code] || "UNKNOWN"}${err?.message ? ` — ${err.message}` : ""}`);
    };

    const getOnce = (opts) =>
      new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, opts);
      });

    const start = async () => {
      // 1차: 저정밀(성공확률 ↑)
      try {
        const pos = await getOnce({ enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
        if (!canceled) setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (e1) {
        logError(e1);
        // 2차: 고정밀
        try {
          const pos2 = await getOnce({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
          if (!canceled) setUserLocation({ lat: pos2.coords.latitude, lng: pos2.coords.longitude });
        } catch (e2) {
          logError(e2);
          // 3차: 폴백
          if (!canceled) {
            console.warn("⚠️ 위치 폴백 좌표 사용");
            setUserLocation({ lat: 37.3308, lng: 126.8398 });
          }
        }
      }

      // 지속 추적: 처음엔 저정밀 → 10초 후 고정밀
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

/********************** UI 공통 **********************/
const Page = ({ title, children, right }) => {
  const nav = useNavigate();
  return (
    <div className="page-container">
      <div className="page-header">
        <button onClick={() => nav(-1)} className="header-back-btn">〈</button>
        <h1 className="page-title">{title}</h1>
        <div className="header-right">{right}</div>
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
      <span className="tab-icon">{icon}</span>
      <span className="tab-label">{label}</span>
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
  const { stops, setStops, vehicles, visibleVehicleIds, favIds, userLocation } = useApp();
  const mapRef = useRef(null);
  const mapEl = useRef(null);
  const busOverlays = useRef([]);
  const stopMarkers = useRef([]);
  const userMarkerRef = useRef(null);        // ✅ 유저 위치 마커
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

  // ✅ 유저 위치 마커 & 최초 센터링
  useEffect(() => {
    if (!userLocation || !window.kakao?.maps || !mapRef.current) return;
    const kakao = window.kakao;
    const pos = new kakao.maps.LatLng(userLocation.lat, userLocation.lng);
    if (!userMarkerRef.current) {
      userMarkerRef.current = new kakao.maps.Marker({
        map: mapRef.current,
        position: pos,
        image: new kakao.maps.MarkerImage(
          // 심플 아이콘(원하면 커스텀 이미지로 교체 가능)
          "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png",
          new kakao.maps.Size(24, 35)
        )
      });
      mapRef.current.setCenter(pos);
    } else {
      userMarkerRef.current.setPosition(pos);
    }
  }, [userLocation]);

  // “내 위치” 버튼
  const recenter = () => {
    if (!userLocation || !window.kakao?.maps || !mapRef.current) return;
    const pos = new window.kakao.maps.LatLng(userLocation.lat, userLocation.lng);
    mapRef.current.panTo(pos);
  };

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
        // 👉 상세 화면으로 이동
        nav(`/stop/${s.id}`);
      });
      stopMarkers.current.push(marker);
    });
  }, [stops, nav]);

  // (홈 화면에서) 차량 오버레이 — 홈에서는 사용자가 특정 정류장을 선택하지 않았으니 숨김 유지
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
    <Page title="EVERYBUS" right={<button className="header-right-btn" onClick={recenter}>내 위치</button>}>
      <div ref={mapEl} style={{ width: "100%", height: MAP_HEIGHT }} />
      {!userLocation && (
        <div className="hint-box" style={{ padding: 8, fontSize: 14 }}>
          위치를 불러오는 중입니다…<br />
          • 브라우저 권한에서 <b>위치 허용</b>을 확인해 주세요.<br />
          • 실내/데스크탑 환경에서는 정확도가 낮을 수 있어요.
        </div>
      )}

      {/* 정류장 리스트 (👉 클릭 시 상세로 이동) */}
      <div className="bus-list">
        {stops.map((s) => (
          <div
            key={s.id}
            className="bus-item"
            role="button"
            tabIndex={0}
            onClick={() => nav(`/stop/${s.id}`)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && nav(`/stop/${s.id}`)}
          >
            <span className="bus-item-name">{s.name}</span>
            <span className="favorite-btn">{s.favorite ? "⭐" : "☆"}</span>
          </div>
        ))}
      </div>
    </Page>
  );
};

/********************** 정류장 상세 **********************/
const StopDetail = () => {
  const { id } = useParams();
  const { stops, vehicles, visibleVehicleIds, setVisibleVehicleIds } = useApp();

  const stop = useMemo(() => stops.find((s) => String(s.id) === String(id)), [stops, id]);
  const mapRef = useRef(null);
  const mapEl = useRef(null);
  const busOverlays = useRef([]);

  // 상세 입장 시 버스 보이도록 설정, 나갈 때 숨김
  useEffect(() => {
    setVisibleVehicleIds([REAL_SHUTTLE_IMEI]);
    return () => setVisibleVehicleIds([]);
  }, [setVisibleVehicleIds]);

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

  // 버스 오버레이 (상세 화면)
  useEffect(() => {
    const kakao = window.kakao;
    if (!kakao?.maps || !mapRef.current) return;
    busOverlays.current.forEach((o) => o.setMap(null));
    busOverlays.current = [];
    const vis = vehicles.filter((v) => visibleVehicleIds.includes(v.id));
    vis.forEach((v) => {
      const pos = new kakao.maps.LatLng(v.lat, v.lng);
      const overlay = new kakao.maps.CustomOverlay({
        position: pos,
        content:
          `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-50%);">
             <div style="font-size:20px;filter:drop-shadow(0 0 2px rgba(0,0,0,.5));">🚌</div>
             <div style="font-size:10px;font-weight:bold;line-height:1;margin-top:2px;">${v.id===REAL_SHUTTLE_IMEI?"실시간 셔틀":"버스"}</div>
           </div>`,
        yAnchor: 0.5,
        xAnchor: 0.5,
      });
      overlay.setMap(mapRef.current);
      busOverlays.current.push(overlay);
    });
  }, [vehicles, visibleVehicleIds]);

  if (!stop) {
    return (
      <Page title="정류장 상세">
        <div className="list-empty-text">정류장을 찾을 수 없습니다.</div>
      </Page>
    );
  }

  return (
    <Page title={stop.name} right={<span className="header-right-note">실시간 위치 표시 중</span>}>
      <div ref={mapEl} style={{ width: "100%", height: MAP_HEIGHT }} className="map-container" />
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-subtitle">안내</div>
        <div className="info-text">이 화면을 여는 동안에만 셔틀 아이콘이 지도에 표시됩니다.</div>
      </div>
    </Page>
  );
};

/********************** App 루트 **********************/
export default function App() {
  const [stops, setStops] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [favIds] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("everybus:favorites") || "[]"));
    } catch {
      return new Set();
    }
  });
  const [visibleVehicleIds, setVisibleVehicleIds] = useState([]); // 상세에서만 채움
  const [userLocation, setUserLocation] = useState(null);

  useUserLocation(setUserLocation);

  // 실시간 차량 폴링 (전역)
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
          <Route path="/stop/:id" element={<StopDetail />} />
          <Route
            path="*"
            element={
              <div className="not-found-page">
                <div className="not-found-content">
                  <div className="not-found-icon">🧭</div>
                  <div className="not-found-title">페이지를 찾을 수 없습니다</div>
                  <Link className="link" to="/">홈으로</Link>
                </div>
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </AppContext.Provider>
  );
}
