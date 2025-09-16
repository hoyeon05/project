import React, { useEffect, useMemo, useRef, useState, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, useParams } from "react-router-dom";

/**
 * EveryBus React UI (연결 버전)
 * - 화면: 스플래시 → 메인(지도+목록) → 정류장 상세, 즐겨찾기, 알림 설정
 * - 하단 탭바 포함
 * - Tailwind 기반
 *
 * ✅ 실제 연동 포함
 *  1) 백엔드: /stops(권장) 또는 /bus-info(호환) 자동 매핑
 *  2) Kakao 지도: SDK 자동 로딩 + 마커 표시 + 클릭 시 상세 이동
 *
 * ⛳ 바꿔야 할 것 딱 2개
 *  - KAKAO_APP_KEY: 카카오 앱 키
 *  - PROD_SERVER_URL: 배포 서버 주소(예: Render)
 */

/********************** 환경값 **********************/
/* ********************** 환경값 ********************** */
// CRA(react-scripts) → REACT_APP_*
// Vite → VITE_*
// 둘 다 없으면 하드코딩 값으로 폴백
const KAKAO_APP_KEY = (
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_KAKAO_APP_KEY) ||
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_KAKAO_APP_KEY) ||
  "YOUR_KAKAO_APP_KEY"
);


const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com"; // 필요 시 교체
const getServerURL = () => (window.location.hostname.includes("localhost") ? "http://localhost:5000" : PROD_SERVER_URL);


/********************** 공용 컨텍스트 **********************/
const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

/********************** Kakao SDK 로더 **********************/
async function loadKakaoMaps(appKey) {
  if (window.kakao?.maps) return true;
  // 이미 스크립트 추가됨?
  if (document.getElementById("kakao-sdk")) {
    await new Promise((res) => (window.kakao?.maps ? res() : (window.kakaoOnLoad = res)));
    return true;
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.id = "kakao-sdk";
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=1befb49da92b720b377651fbf18cd76a&autoload=false`;
    s.onload = () => {
      window.kakao.maps.load(() => {
        if (window.kakao?.maps) resolve(true);
        else reject(new Error("Kakao maps failed to load"));
      });
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return true;
}

/********************** 스키마 어댑터 **********************/
// 서버 응답이 /stops 또는 /bus-info 등 다양할 수 있어 통합 매퍼 제공
function mapToStops(raw) {
  // 케이스 1: 이미 정류장 배열
  if (Array.isArray(raw) && raw[0]?.id && raw[0]?.lat && raw[0]?.lng) {
    return raw.map((s) => ({
      id: String(s.id),
      name: s.name || s.stopName || "이름없는 정류장",
      lat: Number(s.lat),
      lng: Number(s.lng),
      nextArrivals: s.nextArrivals || s.arrivals || [],
      favorite: !!s.favorite,
    }));
  }
  // 케이스 2: {stops:[...]} 래핑
  if (raw?.stops && Array.isArray(raw.stops)) return mapToStops(raw.stops);

  // 케이스 3: /bus-info 형식 (예: 각 버스의 다음 도착 포함). 정류장 기준으로 묶기
  if (Array.isArray(raw) && raw.length && (raw[0].stopId || raw[0].stop)) {
    const byStop = new Map();
    raw.forEach((item) => {
      const stopId = String(item.stopId || item.stop?.id || item.stop);
      const stopName = item.stopName || item.stop?.name || "정류장";
      const lat = item.stopLat || item.lat || item.stop?.lat;
      const lng = item.stopLng || item.lng || item.stop?.lng;
      const eta = item.eta || item.arrival || item.nextArrival || null;
      if (!byStop.has(stopId)) byStop.set(stopId, { id: stopId, name: stopName, lat: Number(lat), lng: Number(lng), nextArrivals: [], favorite: false });
      if (eta) byStop.get(stopId).nextArrivals.push(String(eta));
    });
    return [...byStop.values()].map((s) => ({ ...s, nextArrivals: s.nextArrivals.slice(0, 3) }));
  }

  // 알 수 없는 형식 → 빈 배열
  return [];
}

/********************** API **********************/
async function fetchStopsOnce() {
  const base = getServerURL();
  // 1순위: /stops
  try {
    const r = await fetch(`${base}/stops`, { headers: { "Accept": "application/json" } });
    if (r.ok) {
      const data = await r.json();
      const mapped = mapToStops(data);
      if (mapped.length) return mapped;
    }
  } catch (e) {}
  // 2순위: /bus-info
  try {
    const r2 = await fetch(`${base}/bus-info`, { headers: { "Accept": "application/json" } });
    if (r2.ok) {
      const data2 = await r2.json();
      const mapped2 = mapToStops(data2);
      if (mapped2.length) return mapped2;
    }
  } catch (e) {}
  return [];
}

/********************** 유틸 컴포넌트 **********************/
const Page = ({ title, right, children }) => {
  const nav = useNavigate();
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b">
        <div className="max-w-screen-sm mx-auto flex items-center justify-between px-4 h-14">
          <button onClick={() => nav(-1)} className="px-2 py-1 text-sm rounded hover:bg-gray-100">〈</button>
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
  const location = useLocation();
  const current = location.pathname;
  const Item = ({ to, label, icon }) => (
    <Link to={to} className={`flex flex-col items-center gap-1 px-3 py-2 rounded ${current === to ? "bg-gray-200" : "hover:bg-gray-100"}`}>
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
  useEffect(() => {
    // 권한/초기 체크 후 홈 이동
  }, []);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white p-8">
      <div className="text-4xl font-extrabold tracking-wide mb-2">EVERYBUS</div>
      <p className="text-gray-600 mb-8">실시간 캠퍼스 버스 도착 알림</p>
      <button onClick={() => nav("/")} className="px-6 py-3 rounded-2xl shadow bg-blue-600 text-white hover:bg-blue-700 active:scale-[.99]">시작하기</button>
    </div>
  );
};

/********************** 홈 (지도 + 목록) **********************/
const HomeScreen = () => {
  const { stops, setStops, toggleFavorite, search, setSearch } = useApp();
  const nav = useNavigate();
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  // 초기 데이터 로드 + 주기 갱신(30초)
  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await fetchStopsOnce();
      if (alive && data.length) setStops(data);
    })();
    const iv = setInterval(async () => {
      const data = await fetchStopsOnce();
      if (data.length) setStops((prev) => {
        // id 기준으로 nextArrivals만 부드럽게 갱신
        const next = new Map(data.map((s) => [s.id, s]));
        return prev.map((p) => (next.has(p.id) ? { ...p, nextArrivals: next.get(p.id).nextArrivals } : p));
      });
    }, 30000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [setStops]);

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
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  // 마커 렌더링 (검색/데이터 변화 시)
  const filtered = useMemo(() => {
    if (!search.trim()) return stops;
    const q = search.trim().toLowerCase();
    return stops.filter((s) => s.name.toLowerCase().includes(q));
  }, [stops, search]);

  useEffect(() => {
    const kakao = window.kakao;
    if (!kakao?.maps || !mapRef.current) return;

    // 기존 마커 제거
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    if (!filtered.length) return;

    const bounds = new kakao.maps.LatLngBounds();
    filtered.forEach((s) => {
      const pos = new kakao.maps.LatLng(s.lat, s.lng);
      const marker = new kakao.maps.Marker({ position: pos, map: mapRef.current });
      kakao.maps.event.addListener(marker, "click", () => nav(`/stop/${s.id}`));
      markersRef.current.push(marker);
      bounds.extend(pos);
    });
    // 범위 맞추기
    if (filtered.length > 1) mapRef.current.setBounds(bounds);
    else mapRef.current.setCenter(new kakao.maps.LatLng(filtered[0].lat, filtered[0].lng));
  }, [filtered, nav]);

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
          {search && (
            <button className="text-sm text-gray-500" onClick={() => setSearch("")}>지우기</button>
          )}
        </div>
      </div>

      {/* 지도 */}
      <div ref={mapEl} id="map" className="w-full h-56 bg-gray-200 rounded-2xl mb-4 flex items-center justify-center">
        <span className="text-gray-600">지도 로딩 중…</span>
      </div>

      {/* 정류장 리스트 */}
      <div className="space-y-2">
        {filtered.map((stop) => (
          <button
            key={stop.id}
            className="w-full bg-white border rounded-2xl px-4 py-3 text-left hover:bg-gray-50 active:scale-[.999]"
            onClick={() => nav(`/stop/${stop.id}`)}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{stop.name}</div>
                <div className="text-xs text-gray-500">다음 도착: {stop.nextArrivals?.length ? stop.nextArrivals.join(", ") : "정보 수집 중"}</div>
              </div>
              <button
                className="text-xl"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(stop.id);
                }}
                aria-label="즐겨찾기 토글"
                title="즐겨찾기"
              >
                {stop.favorite ? "⭐" : "☆"}
              </button>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-gray-500 py-10">검색 결과가 없습니다.</div>
        )}
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
    <Page title={stop.name} right={<button onClick={() => nav("/alerts")} className="text-sm text-blue-600">알림설정</button>}>
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
        <div ref={mapEl} className="w-full h-52 bg-gray-200 rounded-xl flex items-center justify-center">지도(단일 마커)</div>
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
          <button
            key={stop.id}
            className="w-full bg-white border rounded-2xl px-4 py-3 text-left hover:bg-gray-50"
            onClick={() => nav(`/stop/${stop.id}`)}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{stop.name}</div>
                <div className="text-xs text-gray-500">다음 도착: {stop.nextArrivals?.length ? stop.nextArrivals.join(", ") : "정보 수집 중"}</div>
              </div>
              <span className="text-xl">⭐</span>
            </div>
          </button>
        ))}
        {favorites.length === 0 && (
          <div className="text-center text-gray-500 py-10">즐겨찾기한 정류장이 없습니다.</div>
        )}
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
          <button onClick={() => setEnabled((v) => !v)} className={`px-4 py-2 rounded-xl border ${enabled ? "bg-blue-600 text-white border-blue-600" : "bg-white"}`}>
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

  const toggleFavorite = (id) => {
    setStops((prev) => prev.map((s) => (String(s.id) === String(id) ? { ...s, favorite: !s.favorite } : s)));
  };

  const ctx = {
    stops,
    setStops,
    search,
    setSearch,
    toggleFavorite,
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


