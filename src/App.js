import React, { useEffect, useMemo, useRef, useState, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, useParams } from "react-router-dom";

/**
 * EveryBus React UI (연결 버전) — 전체 수정본
 * - 스플래시 → 메인(지도+목록) → 정류장 상세, 즐겨찾기, 알림 설정
 * - 하단 탭바
 * - Tailwind 기반
 *
 * ✅ 실연동
 *  1) 백엔드: /stops(권장) 또는 /bus-info(호환) 자동 매핑
 *  2) Kakao 지도: SDK 자동 로딩 + 마커 + 클릭 시 상세 이동
 *
 * ⛳ 바꿀 것 2개
 *  - KAKAO_APP_KEY: 카카오 앱 키 (env 권장)
 *  - PROD_SERVER_URL: 배포 서버 주소 (env 권장)
 */

/********************** 환경값 **********************/
const KAKAO_APP_KEY =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_KAKAO_APP_KEY) ||
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_KAKAO_APP_KEY) ||
  "YOUR_KAKAO_APP_KEY";

const PROD_SERVER_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SERVER_URL) ||
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_SERVER_URL) ||
  "https://project-1-ek9j.onrender.com";

const getServerURL = () =>
  window.location.hostname.includes("localhost") ? "http://localhost:5000" : PROD_SERVER_URL;

/********************** 공용 컨텍스트 **********************/
const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

/********************** Kakao SDK 로더 **********************/
async function loadKakaoMaps(appKey) {
  // 이미 로드됨
  if (window.kakao?.maps) return true;

  // 기존 스크립트가 있으면 로드 완료까지 폴링
  const existing = document.getElementById("kakao-sdk");
  if (existing) {
    await new Promise((res) => {
      const check = () => (window.kakao?.maps ? res(true) : setTimeout(check, 50));
      check();
    });
    return true;
  }

  // 신규 로드
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.id = "kakao-sdk";
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=1befb49da92b720b377651fbf18cd76a&autoload&autoload=false&libraries=services`;
    s.onload = () => {
      if (!window.kakao?.maps) return reject(new Error("Kakao global missing"));
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
function mapToStops(raw) {
  // 케이스 1: 이미 정류장 배열
  if (Array.isArray(raw) && raw[0]?.id && raw[0]?.lat != null && raw[0]?.lng != null) {
    return raw
      .map((s) => ({
        id: String(s.id),
        name: s.name || s.stopName || "이름없는 정류장",
        lat: Number(s.lat),
        lng: Number(s.lng),
        nextArrivals: s.nextArrivals || s.arrivals || [],
        favorite: !!s.favorite,
      }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  }

  // 케이스 2: {stops:[...]}
  if (raw?.stops && Array.isArray(raw.stops)) return mapToStops(raw.stops);

  // 케이스 3: /bus-info 형식 → 정류장 기준 묶기
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
          id: stopId,
          name: stopName,
          lat: Number(lat),
          lng: Number(lng),
          nextArrivals: [],
          favorite: false,
        });
      }
      if (eta != null) byStop.get(stopId).nextArrivals.push(String(eta));
    });

    return [...byStop.values()]
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => ({ ...s, nextArrivals: s.nextArrivals.slice(0, 3) }));
  }

  // 알 수 없는 형식
  return [];
}

/********************** API **********************/
async function fetchStopsOnce() {
  const base = getServerURL();

  // 1순위: /stops
  try {
    const r = await fetch(`${base}/stops`, { headers: { Accept: "application/json" } });
    if (r.ok) {
      const data = await r.json();
      const mapped = mapToStops(data);
      if (mapped.length) return mapped;
    } else {
      console.error("/stops response not ok:", r.status, r.statusText);
    }
  } catch (e) {
    console.error("/stops fetch error:", e);
  }

  // 2순위: /bus-info
  try {
    const r2 = await fetch(`${base}/bus-info`, { headers: { Accept: "application/json" } });
    if (r2.ok) {
      const data2 = await r2.json();
      const mapped2 = mapToStops(data2);
      if (mapped2.length) return mapped2;
    } else {
      console.error("/bus-info response not ok:", r2.status, r2.statusText);
    }
  } catch (e) {
    console.error("/bus-info fetch error:", e);
  }

  return [];
}

/********************** 즐겨찾기 저장 유틸 (localStorage) **********************/
const FAV_KEY = "everybus:favorites";

function loadFavIds() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveFavIds(set) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
  } catch {}
}

/********************** 유틸 컴포넌트 **********************/
const Page = ({ title, right, children }) => {
  const nav = useNavigate();
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b">
        <div className="max-w-screen-sm mx-auto flex items-center justify-between px-4 h-14">
          <button onClick={() => nav(-1)} className="px-2 py-1 text-sm rounded hover:bg-gray-100" aria-label="뒤로가기">
            〈
          </button>
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
  const isActive = (to) => current === to || (to === "/" && current.startsWith("/stop/"));

  const Item = ({ to, label, icon }) => (
    <Link
      to={to}
      className={`flex flex-col items-center gap-1 px-3 py-2 rounded ${
        isActive(to) ? "bg-gray-200" : "hover:bg-gray-100"
      }`}
    >
      <span aria-hidden className="text-xl">
        {icon}
      </span>
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
    // 권한/초기 체크 후 홈 이동 등 필요 시 작성
  }, []);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white p-8">
      <div className="text-4xl font-extrabold tracking-wide mb-2">EVERYBUS</div>
      <p className="text-gray-600 mb-8">실시간 캠퍼스 버스 도착 알림</p>
      <button
        onClick={() => nav("/")}
        className="px-6 py-3 rounded-2xl shadow bg-blue-600 text-white hover:bg-blue-700 active:scale-[.99]"
      >
        시작하기
      </button>
    </div>
  );
};

/********************** 홈 (지도 + 목록) **********************/
const HomeScreen = () => {
  const { stops, setStops, toggleFavorite, search, setSearch, favIds, setFavIds } = useApp();
  const nav = useNavigate();
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [loadError, setLoadError] = useState("");

  // 초기 데이터 + 30초마다 갱신 (전체 동기화 + 즐겨찾기 유지)
  useEffect(() => {
    let alive = true;

    const applyData = (data) => {
      if (!alive) return;
      if (data.length === 0) {
        setLoadError("서버에서 정류장 정보를 불러오지 못했습니다.");
        return;
      }
      setLoadError("");
      setStops(
        data.map((s) => ({
          ...s,
          favorite: favIds.has(String(s.id)),
        }))
      );
    };

    (async () => {
      const data = await fetchStopsOnce();
      applyData(data);
    })();

    const iv = setInterval(async () => {
      const data = await fetchStopsOnce();
      if (data.length) applyData(data);
    }, 30000);

    return () => {
      alive = false;
      clearInterval(iv);
    };
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
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  // 검색 필터
  const filtered = useMemo(() => {
    if (!search.trim()) return stops;
    const q = search.trim().toLowerCase();
    return stops.filter((s) => (s.name || "").toLowerCase().includes(q));
  }, [stops, search]);

  // 마커 렌더링 & 정리
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

    if (filtered.length > 1) mapRef.current.setBounds(bounds);
    else mapRef.current.setCenter(new kakao.maps.LatLng(filtered[0].lat, filtered[0].lng));

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
  }, [filtered, nav]);

  const onToggleFavorite = (id) => {
    const sid = String(id);
    setStops((prev) =>
      prev.map((s) => (String(s.id) === sid ? { ...s, favorite: !s.favorite } : s))
    );
    setFavIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      saveFavIds(next);
      return next;
    });
  };

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
            <button className="text-sm text-gray-500" onClick={() => setSearch("")}>
              지우기
            </button>
          )}
        </div>
      </div>

      {/* 지도 */}
      <div
        ref={mapEl}
        id="map"
        className="w-full h-56 bg-gray-200 rounded-2xl mb-4 flex items-center justify-center"
      >
        <span className="text-gray-600">지도 로딩 중…</span>
      </div>

      {/* 서버 에러 안내 */}
      {loadError && (
        <div className="mb-3 text-center text-sm text-red-600">{loadError}</div>
      )}

      {/* 정류장 리스트 */}
      <div className="space-y-2">
        {filtered.map((stop) => (
          <div
            key={stop.id}
            role="button"
            tabIndex={0}
            className="w-full bg-white border rounded-2xl px-4 py-3 text-left hover:bg-gray-50 active:scale-[.999] focus:outline-none"
            onClick={() => nav(`/stop/${stop.id}`)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") nav(`/stop/${stop.id}`);
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{stop.name}</div>
                <div className="text-xs text-gray-500">
                  다음 도착:{" "}
                  {stop.nextArrivals?.length ? stop.nextArrivals.join(", ") : "정보 수집 중"}
                </div>
              </div>
              <span
                role="button"
                aria-label="즐겨찾기 토글"
                title="즐겨찾기"
                className="text-xl select-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(stop.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    onToggleFavorite(stop.id);
                  }
                }}
                tabIndex={0}
              >
                {stop.favorite ? "⭐" : "☆"}
              </span>
            </div>
          </div>
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

    return () => {
      // 단일 마커/맵은 GC에 맡겨도 되지만, 필요 시 추가 정리 가능
    };
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
      right={
        <button onClick={() => nav("/alerts")} className="text-sm text-blue-600">
          알림설정
        </button>
      }
    >
      <div className="bg-white border rounded-2xl p-4 mb-3">
        <div className="text-sm text-gray-500 mb-2">다음 도착 예정</div>
        <div className="flex gap-2 flex-wrap">
          {(stop.nextArrivals?.length ? stop.nextArrivals : ["정보 수집 중"]).map((t, idx) => (
            <div key={idx} className="px-3 py-2 rounded-xl bg-gray-100 text-sm">
              {t}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-2xl p-4 mb-3">
        <div className="text-sm text-gray-500 mb-2">정류장 위치</div>
        <div
          ref={mapEl}
          className="w-full h-52 bg-gray-200 rounded-xl flex items-center justify-center"
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
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") nav(`/stop/${stop.id}`);
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{stop.name}</div>
                <div className="text-xs text-gray-500">
                  다음 도착:{" "}
                  {stop.nextArrivals?.length ? stop.nextArrivals.join(", ") : "정보 수집 중"}
                </div>
              </div>
              <span className="text-xl">⭐</span>
            </div>
          </div>
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
          <button
            onClick={() => setEnabled((v) => !v)}
            className={`px-4 py-2 rounded-xl border ${
              enabled ? "bg-blue-600 text-white border-blue-600" : "bg-white"
            }`}
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

  // 즐겨찾기 id Set (영속)
  const [favIds, setFavIds] = useState(() => loadFavIds());

  const toggleFavorite = (id) => {
    const sid = String(id);
    setStops((prev) => prev.map((s) => (String(s.id) === sid ? { ...s, favorite: !s.favorite } : s)));
    setFavIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      saveFavIds(next);
      return next;
    });
  };

  const ctx = {
    stops,
    setStops,
    search,
    setSearch,
    toggleFavorite,
    favIds,
    setFavIds,
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
      <Link className="text-blue-600" to="/">
        홈으로
      </Link>
    </div>
  </div>
);
