import React, { useEffect, useMemo, useRef, useState, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, useParams } from "react-router-dom";
import 'tailwindcss/tailwind.css'; // Tailwind CSS 임포트 (가정)


/**
 * EveryBus React UI — 최종 통합 및 수정 버전
 * - Kakao 지도 + 정류장 마커 + 버스 오버레이
 * - 사용자 위치 실시간 추적 및 마커 유지 기능
 * - IMEI 기반 서버 통신
 * * ⭐ [수정 사항] ⭐
 * 1. 버스 GPS는 초기에는 숨김. (visibleVehicleIds 초기값: [])
 * 2. 정류장 클릭 시 (HomeScreen의 목록 또는 마커) 특정 GPS 디바이스의 IMEI만 visibleVehicleIds에 추가하여 지도에 표시.
 */

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

// 지도 컨테이너 강제 높이(px)
const MAP_HEIGHT = 360;
const VEHICLE_POLL_MS = 5000;

// 💡 사용자님의 요청에 따라 GPS 디바이스를 가진 '실제 셔틀'의 IMEI를 정의합니다.
const REAL_SHUTTLE_IMEI = '350599638756152';

/********************** 컨텍스트 **********************/
const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

/********************** Kakao SDK 로더 **********************/
async function loadKakaoMaps(appKey) {
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
      // autoload=false 인 경우 load()를 호출해야 라이브러리가 로드됨
      window.kakao.maps.load(() => (window.kakao?.maps ? resolve(true) : reject(new Error("Kakao maps failed to load"))));
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
    };

    // watchPosition으로 실시간 위치 변화 감지
    const watchId = navigator.geolocation.watchPosition(
      successHandler,
      errorHandler,
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      }
    );

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

function mapToVehicles(raw) {
  if (Array.isArray(raw) && raw[0]?.lat != null && raw[0]?.lng != null) {
    return raw
      .map((v, idx) => ({
        // IMEI를 ID로 사용
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

  // 임시 정류장 데이터 (서버 응답이 없을 경우)
  return [
      { id: '1', name: '안산대학교', lat: 37.3308, lng: 126.8398, nextArrivals: ['5분 후', '15분 후'], favorite: false },
      { id: '2', name: '상록수역', lat: 37.3175, lng: 126.8660, nextArrivals: ['8분 후', '18분 후'], favorite: false }
  ];
}

// 🔑 모든 차량 데이터를 요청하는 함수
async function fetchVehiclesOnce() {
  const base = getServerURL();
  
  // 모든 차량의 위치 정보를 가져오는 엔드포인트를 사용합니다. (IMEI 필터링은 클라이언트에서 수행)
  const path = `/bus/location`;

  try {
    const r = await fetch(`${base}${path}`, { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    
    const data = await r.json();
    
    // 서버 응답이 배열 형태의 차량 위치 정보라고 가정
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
    <div className="min-h-screen flex flex-col bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b">
        <div className="max-w-screen-sm mx-auto flex items-center justify-between px-4 h-14">
          <button onClick={() => nav(-1)} className="px-2 py-1 text-sm rounded hover:bg-gray-100" aria-label="뒤로가기">〈</button>
          <h1 className="font-semibold text-lg">{title}</h1>
          <div className="min-w-[2rem] text-right">{right}</div>
        </div>
      </div>
      <div className="flex-1 max-w-screen-sm w-full mx-auto p-4">{children}</div>
      <Tabbar />
    </div>
  );
};

const Tabbar = () => {
  const { pathname } = useLocation();
  const isActive = (to) => pathname === to || (to === "/" && pathname.startsWith("/stop/"));
  const Item = ({ to, label, icon }) => (
    <Link to={to} className={`flex flex-col items-center gap-1 px-3 py-2 rounded ${isActive(to) ? "bg-blue-100 text-blue-700" : "text-gray-700 hover:bg-gray-100"}`}>
      <span aria-hidden className="text-xl">{icon}</span>
      <span className="text-xs">{label}</span>
    </Link>
  );
  return (
    <div className="sticky bottom-0 z-10 bg-white border-t">
      <div className="max-w-screen-sm mx-auto grid grid-cols-3 gap-2 p-2 text-gray-700">
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white p-8">
      <div className="text-4xl font-extrabold tracking-wide mb-2 text-blue-600">EVERYBUS</div>
      <p className="text-gray-600 mb-8">실시간 캠퍼스 버스 도착 알림</p>
      <button onClick={() => nav("/")} className="px-6 py-3 rounded-full shadow-lg bg-blue-600 text-white hover:bg-blue-700 active:scale-[.99]">
        시작하기
      </button>
    </div>
  );
};

/********************** 홈 (지도 + 목록 + 차량 오버레이 관리) **********************/
const HomeScreen = () => {
  const { stops, setStops, search, setSearch, favIds, setFavIds, vehicles, setVehicles, userLocation, visibleVehicleIds, setVisibleVehicleIds } = useApp();
  const nav = useNavigate();
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const stopMarkersRef = useRef([]);
  const busOverlaysRef = useRef([]);
  const userMarkerRef = useRef(null);
  const [loadError, setLoadError] = useState("");
  const [lastBusUpdate, setLastBusUpdate] = useState(0);

  // 정류장: 초기 로드 + 30초 갱신
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

  // Kakao 지도 초기화
  useEffect(() => {
    let canceled = false;
    (async () => {
      await loadKakaoMaps(KAKAO_APP_KEY);
      if (canceled) return;
      const kakao = window.kakao;
      if (!mapRef.current) {
        // 안산대학교를 기본 중심으로 설정
        mapRef.current = new kakao.maps.Map(mapEl.current, {
          center: new kakao.maps.LatLng(37.3308, 126.8398), 
          level: 5,
        });
        setTimeout(() => mapRef.current && mapRef.current.relayout(), 0);
      }
    })();
    return () => { canceled = true; };
  }, []);

  // 창 크기 변경 시 relayout
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

  // 정류장 마커 렌더링
  useEffect(() => {
    const kakao = window.kakao;
    if (!kakao?.maps || !mapRef.current) return;

    // 기존 마커 제거
    stopMarkersRef.current.forEach((m) => m.setMap(null));
    stopMarkersRef.current = [];
    if (!filtered.length) return;

    mapRef.current.relayout();
    const bounds = new kakao.maps.LatLngBounds();

    filtered.forEach((s) => {
      const pos = new kakao.maps.LatLng(s.lat, s.lng);
      const marker = new kakao.maps.Marker({ position: pos, map: mapRef.current });
      
      // ⭐ [핵심 수정] 정류장 클릭 시, 특정 GPS 버스만 보이게 처리
      const handleStopClick = () => {
        // 지도를 정류장 중심으로 이동
        mapRef.current.setCenter(pos);
        mapRef.current.setLevel(3);

        // 특정 GPS 디바이스 (REAL_SHUTTLE_IMEI)만 보이도록 설정
        setVisibleVehicleIds([REAL_SHUTTLE_IMEI]);

        // 상세 페이지로 이동하는 것은 막았습니다. (요청에 따라 지도에서 바로 보여주기 위함)
        // nav(`/stop/${s.id}`); 
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
  }, [filtered, setVisibleVehicleIds]); // setVisibleVehicleIds 추가

  // 차량 폴링 (모든 차량 위치를 서버에서 가져옴)
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
  }, [setVehicles]);

  // 차량 오버레이 렌더링
  useEffect(() => {
    const kakao = window.kakao;
    if (!kakao?.maps || !mapRef.current) return;

    // 기존 오버레이 제거
    busOverlaysRef.current.forEach((o) => o.setMap(null));
    busOverlaysRef.current = [];
    
    // ⭐ [핵심 수정] visibleVehicleIds에 포함된 버스만 필터링하여 렌더링
    // visibleVehicleIds는 초기에는 비어 있으므로, 초기 화면에는 버스가 표시되지 않음
    const visibleVehicles = vehicles
        .filter(v => visibleVehicleIds.includes(v.id));

    if (!visibleVehicles.length) return;

    visibleVehicles.forEach((v) => {
      const pos = new kakao.maps.LatLng(v.lat, v.lng);
      const rotate = typeof v.heading === "number" ? `transform: rotate(${Math.round(v.heading)}deg);` : "";
      
      // 버스 ID를 route 대신 표시 (IMEI 기반 디바이스임을 강조)
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
  }, [vehicles, visibleVehicleIds]); // visibleVehicleIds를 의존성 배열에 추가

  // 사용자 위치 마커 렌더링 및 업데이트
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

    return () => {
        userMarkerRef.current?.setMap(null);
    };
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

  /**
   * 정류장 목록 클릭 핸들러: 정류장 중심으로 이동시키고 특정 버스만 표시
   */
  const handleListStopClick = (stop) => {
    const kakao = window.kakao;
    if (mapRef.current && kakao?.maps) {
        const pos = new kakao.maps.LatLng(stop.lat, stop.lng);
        mapRef.current.setCenter(pos);
        mapRef.current.setLevel(3); // 확대하여 보여줌
    }
    // ⭐ [핵심 수정] 목록 클릭 시에도 특정 GPS 버스만 보이도록 설정
    setVisibleVehicleIds([REAL_SHUTTLE_IMEI]);
  };

  return (
    <Page title="EVERYBUS">
      {/* 검색 */}
      <div className="mb-3">
        <div className="flex items-center gap-2 bg-white border rounded-2xl px-3 py-2 shadow-sm">
          <span>🔎</span>
          <input
            className="flex-1 outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="정류장 검색 (예: 안산대학교)"
          />
          {search && <button className="text-sm text-gray-500" onClick={() => setSearch("")}>지우기</button>}
        </div>
      </div>

      {/* 지도 */}
      <div
        ref={mapEl}
        id="map"
        style={{ width: "100%", height: MAP_HEIGHT }}
        className="bg-gray-200 rounded-2xl shadow-md mb-1 flex items-center justify-center relative overflow-hidden"
      >
        <span className="text-gray-600">지도 로딩 중…</span>
      </div>

      {/* 보조 정보 */}
      <div className="flex items-center justify-between mb-3 text-xs text-gray-500">
        <div>
          {visibleVehicleIds.length === 0 
              ? "정류장을 선택하면 셔틀 위치가 표시됩니다." 
              : `실시간 셔틀 위치 표시 중 (${Math.max(0, Math.round((Date.now() - lastBusUpdate) / 1000))}초 전 갱신)`}
        </div>
        {loadError && <div className="text-red-600">{loadError}</div>}
      </div>

      {/* 정류장 리스트 */}
      <div className="space-y-2">
        {filtered.map((stop) => (
          <div
            key={stop.id}
            role="button"
            tabIndex={0}
            className="w-full bg-white border rounded-2xl px-4 py-3 text-left shadow-sm hover:bg-gray-50 active:scale-[.999] focus:outline-none"
            onClick={() => handleListStopClick(stop)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleListStopClick(stop); }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{stop.name}</div>
                <div className="text-xs text-gray-500">
                  다음 도착: {stop.nextArrivals?.length ? stop.nextArrivals.join(", ") : "정보 수집 중"}
                </div>
              </div>
              <span
                role="button"
                aria-label="즐겨찾기 토글"
                title="즐겨찾기"
                className="text-xl select-none"
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(stop.id); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onToggleFavorite(stop.id); } }}
                tabIndex={0}
              >
                {stop.favorite ? "⭐" : "☆"}
              </span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="text-center text-gray-500 py-10">검색 결과가 없습니다.</div>}
      </div>
    </Page>
  );
};

/********************** 정류장 상세 **********************/
const StopDetail = () => {
  const { stops, setVisibleVehicleIds } = useApp();
  const { id } = useParams();
  const stop = stops.find((s) => String(s.id) === String(id));
  const nav = useNavigate();
  const mapEl = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    // 상세 페이지에 진입 시에도 특정 GPS 버스만 보이도록 설정
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
  }, [stop, setVisibleVehicleIds]); // setVisibleVehicleIds 추가

  // 컴포넌트 언마운트 시 버스 숨기기
  useEffect(() => {
      return () => {
          // 홈으로 돌아가거나 다른 페이지로 이동할 때 다시 버스 위치를 숨깁니다.
          setVisibleVehicleIds([]);
      };
  }, [setVisibleVehicleIds]);


  if (!stop) {
    return (
      <Page title="정류장 상세">
        <div className="text-center text-gray-500">정류장을 찾을 수 없습니다.</div>
      </Page>
    );
  }

  return (
    <Page
      title={stop.name}
      right={<button onClick={() => nav("/alerts")} className="text-sm text-blue-600">알림설정</button>}
    >
      <div className="bg-white border rounded-2xl p-4 mb-3 shadow-sm">
        <div className="text-sm text-gray-500 mb-2">다음 도착 예정</div>
        <div className="flex gap-2 flex-wrap">
          {(stop.nextArrivals?.length ? stop.nextArrivals : ["정보 수집 중"]).map((t, idx) => (
            <div key={idx} className="px-3 py-2 rounded-xl bg-gray-100 text-sm font-medium">{t}</div>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-2xl p-4 mb-3 shadow-sm">
        <div className="text-sm text-gray-500 mb-2">정류장 위치</div>
        <div
          ref={mapEl}
          style={{ width: "100%", height: MAP_HEIGHT }}
          className="bg-gray-200 rounded-xl flex items-center justify-center overflow-hidden"
        >
          지도(단일 마커)
        </div>
      </div>

      <div className="bg-white border rounded-2xl p-4 shadow-sm">
        <div className="text-sm text-gray-500 mb-2">노선 & 최근 도착 기록</div>
        <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
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

  // 즐겨찾기 페이지 진입 시에도 버스 숨기기
  useEffect(() => {
      setVisibleVehicleIds([]);
  }, [setVisibleVehicleIds]);

  return (
    <Page title="즐겨찾기">
      <div className="space-y-2">
        {favorites.map((stop) => (
          <div
            key={stop.id}
            role="button"
            tabIndex={0}
            className="w-full bg-white border rounded-2xl px-4 py-3 text-left shadow-sm hover:bg-gray-50 focus:outline-none"
            onClick={() => nav(`/stop/${stop.id}`)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") nav(`/stop/${stop.id}`); }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{stop.name}</div>
                <div className="text-xs text-gray-500">
                  다음 도착: {stop.nextArrivals?.length ? stop.nextArrivals.join(", ") : "정보 수집 중"}
                </div>
              </div>
              <span className="text-xl">⭐</span>
            </div>
          </div>
        ))}
        {favorites.length === 0 && <div className="text-center text-gray-500 py-10">즐겨찾기한 정류장이 없습니다.</div>}
      </div>
    </Page>
  );
};

/********************** 알림 설정 **********************/
const AlertsScreen = () => {
  const { setVisibleVehicleIds } = useApp();
  const [enabled, setEnabled] = useState(true);
  const [minutes, setMinutes] = useState(3);

  // 알림 페이지 진입 시에도 버스 숨기기
  useEffect(() => {
      setVisibleVehicleIds([]);
  }, [setVisibleVehicleIds]);
  
  return (
    <Page title="알림 설정">
      <div className="bg-white border rounded-2xl p-4 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">도착 알림</div>
            <div className="text-xs text-gray-500">버스가 도착 {minutes}분 전에 알려줄게요</div>
          </div>
          <button
            onClick={() => setEnabled((v) => !v)}
            className={`px-4 py-2 rounded-xl border transition duration-150 ${enabled ? "bg-blue-600 text-white border-blue-600 shadow-md" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"}`}
          >
            {enabled ? "ON" : "OFF"}
          </button>
        </div>
        <div>
          <label className="text-sm text-gray-600">알림 시점 (분)</label>
          <input
            type="number"
            min={1}
            max={30}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="mt-1 w-full border rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="text-xs text-gray-400">※ 실제 푸시는 백엔드/FCM에서 처리, 이 화면은 설정 UI</div>
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
  // ⭐ 초기에는 빈 배열로 설정하여 버스 위치를 숨김
  const [visibleVehicleIds, setVisibleVehicleIds] = useState([]); 

  // 사용자 위치 상태 및 추적 훅 실행
  const [userLocation, setUserLocation] = useState(null);
  useUserLocation(setUserLocation); // Custom Hook 실행

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
    // Context에 추가
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
          <Route path="/alerts" element={<AlertsScreen />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AppContext.Provider>
  );
}

const NotFound = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="text-center">
      <div className="text-4xl mb-2">🧭</div>
      <div className="font-semibold">페이지를 찾을 수 없습니다</div>
      <Link className="text-blue-600" to="/">홈으로</Link>
    </div>
  </div>
);
