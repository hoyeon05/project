import React, { useEffect, useMemo, useRef, useState, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, useParams } from "react-router-dom";

/**
 * EveryBus React UI — 차량 항상 표시 버전
 * - 정류장: /stops 또는 /bus-info (자동 매핑)
 * - 차량위치: /vehicles → /bus-positions → /busLocations → /realtime (자동 폴백)
 * - Kakao 지도 + 정류장 마커 + 버스 오버레이(항상 표시)
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
      window.kakao.maps.load(() => (window.kakao?.maps ? resolve(true) : reject(new Error("Kakao maps failed to load"))));
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return true;
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
        id: String(v.id ?? v.busId ?? idx),
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

  return [];
}

async function fetchVehiclesOnce() {
  const base = getServerURL();
  const tryFetch = async (path) => {
    try {
      const r = await fetch(`${base}${path}`, { headers: { Accept: "application/json" } });
      if (!r.ok) return [];
      return mapToVehicles(await r.json());
    } catch (e) { console.error(`${path} fetch error:`, e); return []; }
  };
  for (const path of ["/vehicles", "/bus-positions", "/busLocations", "/realtime"]) {
    const v = await tryFetch(path);
    if (v.length) return v;
  }
  return [];
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
    <Link to={to} className={`flex flex-col items-center gap-1 px-3 py-2 rounded ${isActive(to) ? "bg-gray-200" : "hover:bg-gray-100"}`}>
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
      <div className="text-4xl font-extrabold tracking-wide mb-2">EVERYBUS</div>
      <p className="text-gray-600 mb-8">실시간 캠퍼스 버스 도착 알림</p>
      <button onClick={() => nav("/")} className="px-6 py-3 rounded-2xl shadow bg-blue-600 text-white hover:bg-blue-700 active:scale-[.99]">
        시작하기
      </button>
    </div>
  );
};

/********************** 홈 (지도 + 목록 + 차량 오버레이 항상 ON) **********************/
const HomeScreen = () => {
  const { stops, setStops, search, setSearch, favIds, setFavIds, vehicles, setVehicles } = useApp();
  const nav = useNavigate();
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const stopMarkersRef = useRef([]);
  const busOverlaysRef = useRef([]);
  const [loadError, setLoadError] = useState("");
  const [lastBusUpdate, setLastBusUpdate] = useState(0);

  // 정류장: 초기 로드 + 30초 갱신
  useEffect(() => {
    let alive = true;
    const applyData = (data) => {
      if (!alive) return;
      if (!data.length) { setLoadError("서버에서 정류장 정보를 불러오지 못했습니다."); return; }
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
        mapRef.current = new kakao.maps.Map(mapEl.current, {
          center: new kakao.maps.LatLng(37.2999, 126.8399),
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

    stopMarkersRef.current.forEach((m) => m.setMap(null));
    stopMarkersRef.current = [];
    if (!filtered.length) return;

    mapRef.current.relayout();
    const bounds = new kakao.maps.LatLngBounds();

    filtered.forEach((s) => {
      const pos = new kakao.maps.LatLng(s.lat, s.lng);
      const marker = new kakao.maps.Marker({ position: pos, map: mapRef.current });
      kakao.maps.event.addListener(marker, "click", () => nav(`/stop/${s.id}`));
      stopMarkersRef.current.push(marker);
      bounds.extend(pos);
    });

    if (filtered.length > 1) mapRef.current.setBounds(bounds);
    else mapRef.current.setCenter(new kakao.maps.LatLng(filtered[0].lat, filtered[0].lng));

    return () => {
      stopMarkersRef.current.forEach((m) => m.setMap(null));
      stopMarkersRef.current = [];
    };
  }, [filtered, nav]);

  // 차량 폴링 (항상 ON)
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

    busOverlaysRef.current.forEach((o) => o.setMap(null));
    busOverlaysRef.current = [];
    if (!vehicles.length) return;

    vehicles.forEach((v) => {
      const pos = new kakao.maps.LatLng(v.lat, v.lng);
      const rotate = typeof v.heading === "number" ? `transform: rotate(${Math.round(v.heading)}deg);` : "";
      const label = v.route ? `<div style="font-size:10px;line-height:1;margin-top:2px;text-align:center">${String(v.route)}</div>` : "";
      const content =
        `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto">
           <div style="font-size:20px;filter: drop-shadow(0 0 2px rgba(0,0,0,.2)); ${rotate}">🚌</div>
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
  }, [vehicles]);

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

  const lastBusText = lastBusUpdate
    ? `버스 위치 갱신: ${Math.max(0, Math.round((Date.now() - lastBusUpdate) / 1000))}초 전`
    : "버스 위치 준비 중…";

  return (
    <Page title="EVERYBUS">
      {/* 검색 */}
      <div className="mb-3">
        <div className="flex items-center gap-2 bg-white border rounded-2xl px-3 py-2">
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
        className="bg-gray-200 rounded-2xl mb-1 flex items-center justify-center"
      >
        <span className="text-gray-600">지도 로딩 중…</span>
      </div>

      {/* 보조 정보 */}
      <div className="flex items-center justify-between mb-3 text-xs text-gray-500">
        <div>{lastBusText}</div>
        {loadError && <div className="text-red-600">{loadError}</div>}
      </div>

      {/* 정류장 리스트 */}
      <div className="space-y-2">
        {filtered.map((stop) => (
          <div
            key={stop.id}
            role="button"
            tabIndex={0}
            className="w-full bg-white border rounded-2xl px-4 py-3 text-left hover:bg-gray-50 active:scale-[.999] focus:outline-none"
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
  const { stops } = useApp();
  const { id } = useParams();
  const stop = stops.find((s) => String(s.id) === String(id));
  const nav = useNavigate();
  const mapEl = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!stop) return;
    (async () => {
      await loadKakaoMaps(KAKAO_APP_KEY);
      const kakao = window.kakao;
      const center = new kakao.maps.LatLng(stop.lat, stop.lng);
      mapRef.current = new kakao.maps.Map(mapEl.current, { center, level: 4 });
      new kakao.maps.Marker({ position: center, map: mapRef.current });
      setTimeout(() => mapRef.current && mapRef.current.relayout(), 0);
    })();
  }, [stop]);

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
      <div className="bg-white border rounded-2xl p-4 mb-3">
        <div className="text-sm text-gray-500 mb-2">다음 도착 예정</div>
        <div className="flex gap-2 flex-wrap">
          {(stop.nextArrivals?.length ? stop.nextArrivals : ["정보 수집 중"]).map((t, idx) => (
            <div key={idx} className="px-3 py-2 rounded-xl bg-gray-100 text-sm">{t}</div>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-2xl p-4 mb-3">
        <div className="text-sm text-gray-500 mb-2">정류장 위치</div>
        <div
          ref={mapEl}
          style={{ width: "100%", height: MAP_HEIGHT }}
          className="bg-gray-200 rounded-xl flex items-center justify-center"
        >
          지도(단일 마커)
        </div>
      </div>

      <div className="bg-white border rounded-2xl p-4">
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
  const { stops } = useApp();
  const nav = useNavigate();
  const favorites = stops.filter((s) => s.favorite);
  return (
    <Page title="즐겨찾기">
      <div className="space-y-2">
        {favorites.map((stop) => (
          <div
            key={stop.id}
            role="button"
            tabIndex={0}
            className="w-full bg-white border rounded-2xl px-4 py-3 text-left hover:bg-gray-50 focus:outline-none"
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
  const [enabled, setEnabled] = useState(true);
  const [minutes, setMinutes] = useState(3);
  return (
    <Page title="알림 설정">
      <div className="bg-white border rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">도착 알림</div>
            <div className="text-xs text-gray-500">버스가 도착 {minutes}분 전에 알려줄게요</div>
          </div>
          <button
            onClick={() => setEnabled((v) => !v)}
            className={`px-4 py-2 rounded-xl border ${enabled ? "bg-blue-600 text-white border-blue-600" : "bg-white"}`}
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
            className="mt-1 w-full border rounded-xl px-3 py-2"
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

  // 차량 상태 (항상 표시)
  const [vehicles, setVehicles] = useState([]);

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

  const ctx = { stops, setStops, search, setSearch, toggleFavorite, favIds, setFavIds, vehicles, setVehicles };

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
