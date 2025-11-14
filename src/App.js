// App.js (Permission denied 오류 핸들링 강화 + 정류장 폴백 수정)

import React, { useEffect, useMemo, useRef, useState, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, useParams } from "react-router-dom";
// [수정] react-icons 및 Scanner 임포트
import { 
  BsHouseDoorFill, BsHouseDoor, 
  BsStarFill, BsStar, 
  BsChevronLeft, BsCompass,
  BsSearch,
  BsQrCode // QR 아이콘
} from "react-icons/bs";
import { Scanner } from "@yudiel/react-qr-scanner"; // QR 스캐너
import './App.css'; // App.css 임포트

/**
 * EveryBus React UI — 최종 통합 및 수정 버전
 * ... (이하 동일) ...
 */

/********************** 환경값 **********************/
// ... (변경 없음) ...
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
const REAL_SHUTTLE_IMEI = '350599638756152';

/********************** 컨텍스트 **********************/
// ... (변경 없음) ...
const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

/********************** Kakao SDK 로더 **********************/
// ... (변경 없음) ...
async function loadKakaoMaps(appKey) { /* ... (내용 동일) ... */
    if (window.kakao?.maps) return true;
    if (document.getElementById("kakao-sdk")) {
        await new Promise((res) => {
        const check = () => (window.kakao?.maps ? res(true) : setTimeout(check, 50));
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
        window.kakao.maps.load(() => (window.kakao?.maps ? resolve(true) : reject(new Error("Kakao maps failed to load"))));
        };
        s.onerror = reject;
        document.head.appendChild(s);
    });
    return true;
}

/********************** [수정] 사용자 위치 추적 Hook (오류 처리 강화) **********************/
function useUserLocation(setUserLocation) {
    useEffect(() => {
        if (!navigator.geolocation) {
            console.warn("Geolocation not supported by this browser.");
            setUserLocation(null); // 위치 정보 없음으로 설정
            return;
        }

        let watchId = null;

        const successHandler = (position) => {
            console.log("✅ LOCATION SUCCESS:", position.coords.latitude, position.coords.longitude);
            setUserLocation({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: position.timestamp,
            });
        };

        const errorHandler = (error) => {
            console.error("❌ LOCATION ERROR:", error.code, error.message);
            setUserLocation(null); // 위치 정보 없음으로 설정

            // [FIX] Permission Denied (오류 코드 1)의 경우,
            // 반복적인 오류 발생을 막기 위해 watch를 즉시 중단합니다.
            if (error.code === 1) { 
                if (watchId) {
                    navigator.geolocation.clearWatch(watchId);
                    watchId = null;
                }
            }
            // 다른 오류(e.g., TIMEOUT)는 watch가 자동으로 재시도하도록 둡니다.
        };

        // 1. 먼저 현재 위치를 한 번만(getCurrentPosition) 요청해 봅니다. (빠른 응답)
        navigator.geolocation.getCurrentPosition(successHandler, (initialError) => {
            // 1-1. 한 번 요청이 '권한 거부'로 즉시 실패한 경우
            if (initialError.code === 1) {
                console.error("❌ LOCATION ERROR: Permission Denied. Watch not started.");
                setUserLocation(null);
                return; // watchPosition을 시작조차 하지 않습니다.
            }

            // 1-2. 다른 이유로 실패한 경우(e.g., 타임아웃), watchPosition을 시작합니다.
            console.warn("Initial location get failed, starting watch...", initialError.message);
            watchId = navigator.geolocation.watchPosition(
                successHandler,
                errorHandler,
                {
                    enableHighAccuracy: true,
                    timeout: 5000,
                    maximumAge: 0,
                }
            );
        }, {
            enableHighAccuracy: false, // 빠르고 낮은 정확도로 먼저 시도
            timeout: 3000,
            maximumAge: 60000 
        });

        // 컴포넌트 언마운트 시 watch를 정리합니다.
        return () => {
            if (watchId) {
                navigator.geolocation.clearWatch(watchId);
            }
        };
    }, [setUserLocation]);
}


/********************** 스키마 어댑터 **********************/
// ... (변경 없음) ...
function mapToStops(raw) { /* ... (내용 동일) ... */
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
            byStop.set(stopId, { id: stopId, name: stopName, lat: Number(lat), lng: Number(lng), nextArrivals: [], favorite: false });
        }
        if (eta != null) byStop.get(stopId).nextArrivals.push(String(eta));
        });
        return [...byStop.values()]
        .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
        .map((s) => ({ ...s, nextArrivals: s.nextArrivals.slice(0, 3) }));
    }
    return [];
}
function mapToVehicles(raw) { /* ... (내용 동일) ... */
    if (Array.isArray(raw) && raw[0]?.lat != null && raw[0]?.lng != null) {
        return raw
        .map((v, idx) => ({
            id: String(v.id ?? v.device_id ?? idx), 
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
// ... (변경 없음) ...
async function fetchStopsOnce() { /* ... (내용 동일) ... */
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

    // [수정] 정류장 폴백 데이터를 요청하신 3개로 수정합니다.
    return [
        { id: '1', name: '안산대1', lat: 37.3308, lng: 126.8398, nextArrivals: [], favorite: false },
        { id: '2', name: '상록수역', lat: 37.3175, lng: 126.8660, nextArrivals: [], favorite: false },
        { id: '3', name: '안산대2', lat: 37.3300, lng: 126.8388, nextArrivals: [], favorite: false }
    ];
}
async function fetchVehiclesOnce() { /* ... (내용 동일) ... */
    const base = getServerURL();
    const path = `/bus/location`;
    try {
        const r = await fetch(`${base}${path}`, { headers: { Accept: "application/json" } });
        if (!r.ok) return [];
        const data = await r.json();
        if (Array.isArray(data)) {
            return mapToVehicles(data);
        }
        return [];
    } catch (e) { 
        console.error(`${path} fetch error:`, e); 
        return []; 
    }
}
/********************** 즐겨찾기 저장 **********************/
// ... (변경 없음) ...
const FAV_KEY = "everybus:favorites";
const loadFavIds = () => { /* ... (내용 동일) ... */
  try { const raw = localStorage.getItem(FAV_KEY); return raw ? new Set(JSON.parse(raw)) : new Set(); }
  catch { return new Set(); }
};
const saveFavIds = (set) => { /* ... (내용 동일) ... */
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch {} 
};

/********************** 공통 UI **********************/
// ... (변경 없음) ...
const Page = ({ title, right, children }) => {
  const nav = useNavigate();
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-inner">
          {/* 아이콘 수정됨 */}
          <button onClick={() => nav(-1)} className="header-back-btn" aria-label="뒤로가기"><BsChevronLeft /></button>
          <h1 className="page-title">{title}</h1>
          <div className="header-right">{right}</div>
        </div>
      </div>
      <div className="page-content">{children}</div>
      <Tabbar />
    </div>
  );
};
// ... (변경 없음) ...
const Tabbar = () => {
  const { pathname } = useLocation();
  const isActive = (to) => pathname === to || (to === "/" && pathname.startsWith("/stop/"));
  
  const Item = ({ to, label, icon, activeIcon }) => {
    const active = isActive(to);
    return (
      <Link to={to} className={active ? "tab-item active" : "tab-item"}>
        <span aria-hidden className="tab-icon">{active ? activeIcon : icon}</span>
        <span className="tab-label">{label}</span>
      </Link>
    );
  };
  
  return (
    <div className="tab-bar">
      <div className="tab-bar-inner">
        {/* 아이콘 수정됨 */}
        <Item to="/" label="홈" icon={<BsHouseDoor />} activeIcon={<BsHouseDoorFill />} />
        <Item to="/favorites" label="즐겨찾기" icon={<BsStar />} activeIcon={<BsStarFill />} />
        {/* '알림'이 'QR'로 수정됨 */}
        <Item to="/qr" label="QR" icon={<BsQrCode />} activeIcon={<BsQrCode />} />
      </div>
    </div>
  );
};

/********************** 스플래시 **********************/
// ... (변경 없음) ...
const SplashScreen = () => {
  const nav = useNavigate();
  useEffect(() => {}, []);
  return (
    <div className="splash-screen">
      <div className="splash-title">EVERYBUS</div>
      <p className="splash-subtitle">실시간 캠퍼스 버스 도착 알림</p>
      <button onClick={() => nav("/")} className="splash-button">
        시작하기
      </button>
    </div>
  );
};

/********************** 홈 (지도 + 목록 + 차량 오버레이 관리) **********************/
const HomeScreen = () => {
  const { stops, setStops, search, setSearch, favIds, setFavIds, vehicles, setVehicles, userLocation, visibleVehicleIds, setVisibleVehicleIds, toggleFavorite } = useApp(); 
  const nav = useNavigate(); 
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const stopMarkersRef = useRef([]);
  const busOverlaysRef = useRef([]);
  const userMarkerRef = useRef(null);
  const [loadError, setLoadError] = useState("");
  const [lastBusUpdate, setLastBusUpdate] = useState(0);

  // ... (useEffect 로직들 변경 없음) ...
  useEffect(() => { /* ... (정류장 로드) ... */
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
  useEffect(() => { /* ... (지도 초기화) ... */
    let canceled = false;
    (async () => {
      await loadKakaoMaps(KAKAO_APP_KEY);
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
  useEffect(() => { /* ... (창 크기 변경) ... */
    const onResize = () => mapRef.current && mapRef.current.relayout();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const filtered = useMemo(() => { /* ... (검색 필터) ... */
    if (!search.trim()) return stops;
    const q = search.trim().toLowerCase();
    return stops.filter((s) => (s.name || "").toLowerCase().includes(q));
  }, [stops, search]);
  useEffect(() => { /* ... (정류장 마커) ... */
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
        setVisibleVehicleIds([REAL_SHUTTLE_IMEI]);
      };
      kakao.maps.event.addListener(marker, "click", handleStopClick);
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
  useEffect(() => { /* ... (차량 폴링) ... */
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
  }, [setVehicles]);
  useEffect(() => { /* ... (차량 오버레이) ... */
    const kakao = window.kakao;
    if (!kakao?.maps || !mapRef.current) return;
    busOverlaysRef.current.forEach((o) => o.setMap(null));
    busOverlaysRef.current = [];
    const visibleVehicles = vehicles
        .filter(v => visibleVehicleIds.includes(v.id));
    if (!visibleVehicles.length) return;
    visibleVehicles.forEach((v) => {
      const pos = new kakao.maps.LatLng(v.lat, v.lng);
      const rotate = typeof v.heading === "number" ? `transform: rotate(${Math.round(v.heading)}deg);` : "";
      const label = `<div style="font-size:10px;line-height:1;margin-top:2px;text-align:center;font-weight:bold;">${v.id === REAL_SHUTTLE_IMEI ? '실시간 셔틀' : '버스'}</div>`;
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
  useEffect(() => { /* ... (사용자 마커) ... */
    const kakao = window.kakao;
    // [수정] userLocation이 null일 때 (권한 거부 등) 마커를 생성하지 않도록 함
    if (!kakao?.maps || !mapRef.current || !userLocation) {
        userMarkerRef.current?.setMap(null);
        userMarkerRef.current = null; // 마커 참조도 제거
        return;
    }
    const pos = new kakao.maps.LatLng(userLocation.lat, userLocation.lng);
    if (!userMarkerRef.current) {
        const marker = new kakao.maps.CustomOverlay({
            position: pos,
            content: '<div style="background-color:blue; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 0 5px rgba(0,0,0,0.5); z-index:100;"></div>',
            yAnchor: 0.5,
            xAnchor: 0.5
        });
        marker.setMap(mapRef.current);
        userMarkerRef.current = marker;
    } else {
        if (userMarkerRef.current.getMap() !== mapRef.current) {
            userMarkerRef.current.setMap(mapRef.current); 
        }
        userMarkerRef.current.setPosition(pos);
    }
    
    // [수정] userLocation이 변경될 때만 cleanup을 반환하도록 구조 변경
    return () => {
        // 이 cleanup은 userLocation이 바뀌거나 컴포넌트가 언마운트될 때 호출됩니다.
        // userMarkerRef.current?.setMap(null); // 여기서 지우면 깜빡일 수 있으므로 시작 부분에서 처리
    };
  }, [userLocation]); // [수정] mapRef.current를 의존성 배열에서 제거 (권장사항)


  return (
    <Page title="EVERYBUS">
      {/* 검색 */}
      <div className="search-container">
        {/* 아이콘 수정됨 */}
        <span className="search-icon"><BsSearch /></span>
        <input
          className="search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="정류장 검색 (예: 안산대학교)"
        />
        {search && <button className="search-clear-btn" onClick={() => setSearch("")}>지우기</button>}
      </div>

      {/* 지도 */}
      <div
        ref={mapEl}
        id="map"
        style={{ width: "100%", height: MAP_HEIGHT }}
        className="map-container"
      >
        <span className="map-loading-text">지도 로딩 중…</span>
      </div>

      {/* 보조 정보 */}
      {/* ... (변경 없음) ... */}
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
                // 아이콘 상태에 따라 클래스 부여됨
                className={stop.favorite ? "favorite-btn active" : "favorite-btn"}
                onClick={(e) => { e.stopPropagation(); toggleFavorite(stop.id); }} 
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); toggleFavorite(stop.id); } }} 
                tabIndex={0}
              >
                {/* 아이콘 수정됨 */}
                {stop.favorite ? <BsStarFill /> : <BsStar />}
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
// ... (변경 없음) ...
const StopDetail = () => {
  const { stops, setVisibleVehicleIds } = useApp();
  const { id } = useParams();
  const stop = stops.find((s) => String(s.id) === String(id));
  const nav = useNavigate();
  const mapEl = useRef(null);
  const mapRef = useRef(null);

  // ... (useEffect 로직 변경 없음) ...
  useEffect(() => { /* ... (지도 로드) ... */
    setVisibleVehicleIds([REAL_SHUTTLE_IMEI]);
    if (!stop) return;
    (async () => {
      await loadKakaoMaps(KAKAO_APP_KEY);
      const kakao = window.kakao;
      const center = new kakao.maps.LatLng(stop.lat, stop.lng);
      mapRef.current = new kakao.maps.Map(mapEl.current, { center, level: 4 });
      new kakao.maps.Marker({ position: center, map: mapRef.current });
      setTimeout(() => mapRef.current && mapRef.current.relayout(), 0);
    })();
  }, [stop, setVisibleVehicleIds]);
  useEffect(() => { /* ... (언마운트) ... */
      return () => {
          setVisibleVehicleIds([]);
      };
  }, [setVisibleVehicleIds]);


  if (!stop) {
    return (
      <Page title="정류장 상세">
        <div className="list-empty-text">정류장을 찾을 수 없습니다.</div>
      </Page>
    );
  }

  return (
    // [수정] 알림설정 버튼이 QR 탭으로 바뀌었으므로 이 버튼은 제거하거나 다른 기능으로 대체해야 합니다.
    // 여기서는 일단 제거합니다.
    <Page
      title={stop.name}
      right={null} // '알림설정' 버튼 제거
    >
      {/* 1. 다음 도착 예정 */}
      <div className="card">
        <div className="card-subtitle">다음 도착 예정</div>
        <div className="arrival-tags">
          {(stop.nextArrivals?.length ? stop.nextArrivals : ["정보 수집 중"]).map((t, idx) => (
            <div key={idx} className="arrival-tag">{t}</div>
          ))}
        </div>
      </div>

      {/* 2: 시간표 카드 */}
      <div className="card">
        <div className="card-subtitle">시간표</div>
        <div className="timetable-placeholder">
          <table>
            <thead>
              <tr>
                <th>노선</th>
                <th>방향</th>
                <th>시간</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>A노선</td>
                <td>상록수역 방면</td>
                <td>09:00, 09:30, 10:00 ...</td>
              </tr>
              <tr>
                <td>B노선</td>
                <td>학교 순환</td>
                <td>09:15, 09:45, 10:15 ...</td>
              </tr>
              <tr>
                <td colSpan="3">(시간표 데이터가 여기에 표시됩니다)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. 정류장 위치 */}
      <div className="card">
        <div className="card-subtitle">정류장 위치</div>
        <div
          ref={mapEl}
          style={{ width: "100%", height: MAP_HEIGHT }}
          className="map-container"
        >
          지도(단일 마커)
        </div>
      </div>

      {/* 4. 노선 정보 */}
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
// ... (변경 없음) ...
const FavoritesScreen = () => {
  const { stops, setVisibleVehicleIds, toggleFavorite } = useApp(); 
  const nav = useNavigate();
  const favorites = stops.filter((s) => s.favorite);

  useEffect(() => {
      setVisibleVehicleIds([]);
  }, [setVisibleVehicleIds]);

  return (
    <Page title="즐겨찾기">
      <div className="bus-list">
        {favorites.map((stop) => (
          <div
            key={stop.id}
            role="button"
            tabIndex={0}
            className="bus-item" // 홈과 동일한 스타일 재사용
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
              {/* 즐겨찾기 버그 수정됨 */}
              <span
                role="button"
                aria-label="즐겨찾기 토글"
                title="즐겨찾기"
                className="favorite-btn active" 
                onClick={(e) => { e.stopPropagation(); toggleFavorite(stop.id); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); toggleFavorite(stop.id); } }}
                tabIndex={0}
              >
                <BsStarFill />
              </span>
            </div>
          </div>
        ))}
        {favorites.length === 0 && <div className="list-empty-text">즐겨찾기한 정류장이 없습니다.</div>}
      </div>
    </Page>
  );
};


/********************** [신규] QR 체크인 **********************/
// 'AlertsScreen' 대신 'QrCheckScreen'을 추가합니다.
const QrCheckScreen = () => {
  const { setVisibleVehicleIds } = useApp(); 
  const [lastCode, setLastCode] = useState("");
  const [status, setStatus] = useState("READY"); // READY | SENDING | DONE | ERROR

  useEffect(() => {
      setVisibleVehicleIds([]);
  }, [setVisibleVehicleIds]);

  const handleScan = async (detected) => {
    if (!detected || detected.length === 0) return;

    const value =
      detected[0]?.rawValue ??
      detected[0]?.value ??
      (typeof detected[0] === "string" ? detected[0] : "");

    if (!value) return;
    if (value === lastCode && status === "DONE") return;
    if (status === "SENDING") return;

    setLastCode(value);
    setStatus("SENDING");

    try {
      const base = getServerURL();
      await fetch(`${base}/qr/checkin`, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: value,
          ts: Date.now(),
          ua: navigator.userAgent,
        }),
      }).catch(() => {});

      console.log("QR 체크인 완료");
      setStatus("DONE");
    } catch (e) {
      console.warn("[QR] 체크인 전송 실패", e);
      setStatus("ERROR");
    }
  };

  return (
    <Page title="QR 체크인">
      <div className="card">
        <div className="card-subtitle">버스 / 정류장 QR을 스캔하세요</div>
        <div className="info-text">
          카메라 사용을 허용하면 자동으로 인식됩니다.
        </div>
      </div>

      <div className="qr-wrap" style={{ marginTop: 16 }}>
        <Scanner
          onScan={handleScan}
          onError={(err) => {
            console.warn("[QR] error", err);
            // [FIX] 카메라 권한이 거부되면 에러 상태를 표시
            if (String(err?.message).includes("Permission denied")) {
              setStatus("ERROR");
              setLastCode("카메라 권한이 거부되었습니다.");
            }
          }}
          constraints={{ facingMode: "environment" }}
          components={{ finder: true }} 
          style={{ width: "100%" }}
        />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-subtitle">스캔 결과</div>
        {lastCode ? (
          <>
            <div className="info-text" style={{ wordWrap: "break-word" }}>
              {lastCode}
            </div>
            <div className="info-text" style={{ marginTop: 6 }}>
              상태:{" "}
              {status === "DONE"
                ? "체크인 처리 완료"
                : status === "SENDING"
                ? "서버 전송 중..."
                : status === "ERROR"
                ? "오류 (권한 확인)"
                : "인식 대기 중"}
            </div>
          </>
        ) : (
          <div className="info-text">아직 스캔된 QR이 없습니다.</div>
        )}
      </div>
    </Page>
  );
};

/********************** 앱 루트 **********************/
// ... (변경 없음) ...
export default function App() {
  const [stops, setStops] = useState([]);
  const [search, setSearch] = useState("");
  const [favIds, setFavIds] = useState(() => loadFavIds());
  const [vehicles, setVehicles] = useState([]);
  const [visibleVehicleIds, setVisibleVehicleIds] = useState([]); 
  const [userLocation, setUserLocation] = useState(null);
  useUserLocation(setUserLocation); 

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
    visibleVehicleIds, setVisibleVehicleIds
  };

  return (
    <AppContext.Provider value={ctx}>
      <BrowserRouter>
        <Routes>
          <Route path="/splash" element={<SplashScreen />} />
          <Route path="/" element={<HomeScreen />} />
          <Route path="/stop/:id" element={<StopDetail />} />
          <Route path="/favorites" element={<FavoritesScreen />} />
          {/* [수정] /alerts 를 /qr 로 변경 */}
          <Route path="/qr" element={<QrCheckScreen />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AppContext.Provider>
  );
}

// ... (변경 없음) ...
const NotFound = () => (
  <div className="not-found-page">
    <div className="not-found-content">
      {/* 아이콘 수정됨 */}
      <div className="not-found-icon"><BsCompass /></div>
      <div className="not-found-title">페이지를 찾을 수 없습니다</div>
      <Link className="link" to="/">홈으로</Link>
    </div>
  </div>
);