// App.js — EveryBus React UI (노선 폴리라인 + 라이브 위치 + ETA + QR 체크인)
import React, {
  useEffect,
  useRef,
  useState,
  createContext,
  useContext,
  useMemo,
} from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Scanner } from "@yudiel/react-qr-scanner";

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
    } catch (e) {
      // ignore
    }
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

/********************** 사용자 위치 추적 **********************/
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
      const map = {
        1: "PERMISSION_DENIED",
        2: "POSITION_UNAVAILABLE",
        3: "TIMEOUT",
      };
      const code = err?.code;
      if (code === 1) {
        if (!_gpsPermissionWarned) {
          console.warn(
            `GPS Error: ${map[code]}${err?.message ? ` — ${err.message}` : ""}`
          );
          _gpsPermissionWarned = true;
        }
      } else {
        if (!_gpsGenericWarned) {
          console.warn(
            `GPS Error: ${map[code] || "UNKNOWN"}${
              err?.message ? ` — ${err.message}` : ""
            }`
          );
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
        const pos = await getOnce({
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 120000,
        });
        if (!canceled)
          setUserLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
      } catch (e1) {
        logError(e1);
        try {
          const pos2 = await getOnce({
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 0,
          });
          if (!canceled)
            setUserLocation({
              lat: pos2.coords.latitude,
              lng: pos2.coords.longitude,
            });
        } catch (e2) {
          logError(e2);
          if (!canceled) {
            if (!_gpsFallbackWarned) {
              console.warn("⚠️ 위치 폴백 좌표 사용");
              _gpsFallbackWarned = true;
            }
            setUserLocation({ lat: 37.3308, lng: 126.8398 });
          }
        }
      }

      const watchWith = (opts) =>
        navigator.geolocation.watchPosition(
          (pos) =>
            setUserLocation({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            }),
          (err) => logError(err),
          opts
        );

      watchId = watchWith({
        enableHighAccuracy: false,
        timeout: 20000,
        maximumAge: 30000,
      });

      const t = setTimeout(() => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        watchId = watchWith({
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 5000,
        });
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
    console.warn("[fetchStopsOnce] /stops 에러:", e);
  }
  return [
    { id: "1", name: "안산대학교", lat: 37.3308, lng: 126.8398 },
    { id: "2", name: "상록수역", lat: 37.3175, lng: 126.866 },
  ];
}

// 차량 위치 + /bus/active 병합
async function fetchVehiclesOnce() {
  const base = await getServerURL();
  let vehicles = [];
  try {
    const r = await fetch(`${base}/bus/location`);
    if (r.ok) vehicles = await r.json();
  } catch (e) {
    console.warn("[fetchVehiclesOnce] /bus/location 에러:", e);
  }

  try {
    const r2 = await fetch(`${base}/bus/active`);
    if (r2.ok) {
      const raw = await r2.json();
      const active = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const idx = new Map(vehicles.map((v) => [String(v.id), v]));
      active.forEach((a) => {
        const key = String(a.id);
        const prev = idx.get(key) || { id: key };
        const norm = {
          ...a,
          id: key,
          stopId: a.stopId != null ? String(a.stopId) : prev.stopId,
          time: a.time != null ? String(a.time).trim() : prev.time,
        };
        idx.set(key, { ...prev, ...norm });
      });
      vehicles = [...idx.values()];
    }
  } catch (e) {
    console.warn("[fetchVehiclesOnce] /bus/active 에러:", e);
  }

  return vehicles;
}

// 노선 목록
async function fetchRoutesOnce() {
  const base = await getServerURL();
  try {
    const r = await fetch(`${base}/routes`);
    if (!r.ok) {
      console.warn("[routes] HTTP", r.status);
      return [];
    }
    const data = await r.json();
    if (!Array.isArray(data)) {
      console.warn("[routes] invalid payload", data);
      return [];
    }
    const list = data
      .map((rt) => ({
        id: String(rt.id || rt._id || rt.name || ""),
        name: String(rt.name || ""),
        points: (rt.points || [])
          .map((p) => ({
            lat: Number(p.lat),
            lng: Number(p.lng),
          }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
      }))
      .filter((r) => r.id && r.name && r.points.length > 1);

    console.log("🚏 routes loaded:", list.map((r) => r.name));
    return list;
  } catch (e) {
    console.warn("[fetchRoutesOnce] /routes 에러:", e);
    return [];
  }
}

/********************** 유틸 **********************/
function isActiveNow(v) {
  if (!v || v.active !== true) return false;

  const now = Date.now();

  if (v.serviceWindow && (v.serviceWindow.start || v.serviceWindow.end)) {
    try {
      const s = v.serviceWindow.start
        ? new Date(v.serviceWindow.start).getTime()
        : -Infinity;
      const e = v.serviceWindow.end
        ? new Date(v.serviceWindow.end).getTime()
        : Infinity;
      if (Number.isFinite(s) || Number.isFinite(e)) {
        return now >= s && now <= e;
      }
    } catch (e) {
      console.warn("isActiveNow serviceWindow parse error", e);
    }
  }

  if (v.updatedAt) {
    const up = new Date(v.updatedAt).getTime();
    if (Number.isFinite(up)) {
      const DIFF = now - up;
      const ACTIVE_MS = 30 * 60 * 1000;
      return DIFF >= 0 && DIFF <= ACTIVE_MS;
    }
  }

  return false;
}

function haversineMeters(a, b) {
  if (!a || !b) return NaN;
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sin = Math.sin;
  const x =
    sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

/********************** 토스트 **********************/
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
          <button
            onClick={() => nav(-1)}
            className="header-back-btn"
            aria-label="뒤로가기"
          >
            〈
          </button>
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
          <TabItem to="/qr" icon="📷" label="QR" />
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
  const {
    stops,
    vehicles,
    visibleVehicleIds,
    favIds,
    toggleFav,
    userLocation,
    routes,
  } = useApp();

  const mapRef = useRef(null);
  const mapEl = useRef(null);
  const busOverlays = useRef([]);
  const stopMarkers = useRef([]);
  const userMarkerRef = useRef(null);
  const routeLinesRef = useRef([]);
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

  // 유저 위치 마커
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
        ),
      });
      mapRef.current.setCenter(pos);
    } else {
      userMarkerRef.current.setPosition(pos);
    }
  }, [userLocation]);

  // 정류장 마커
  useEffect(() => {
    if (!window.kakao?.maps || !mapRef.current) return;
    stopMarkers.current.forEach((m) => m.setMap(null));
    stopMarkers.current = [];
    stops.forEach((s) => {
      const pos = new window.kakao.maps.LatLng(s.lat, s.lng);
      const marker = new window.kakao.maps.Marker({
        position: pos,
        map: mapRef.current,
      });
      window.kakao.maps.event.addListener(marker, "click", () =>
        nav(`/stop/${s.id}`)
      );
      stopMarkers.current.push(marker);
    });
  }, [stops, nav]);

  // 노선 폴리라인
  useEffect(() => {
    if (!window.kakao?.maps || !mapRef.current) return;
    routeLinesRef.current.forEach((line) => line.setMap(null));
    routeLinesRef.current = [];

    if (!routes || !routes.length) return;
    const kakao = window.kakao;

    routes.forEach((rt, idx) => {
      if (!rt.points || rt.points.length < 2) return;
      const path = rt.points.map(
        (p) => new kakao.maps.LatLng(p.lat, p.lng)
      );
      const polyline = new kakao.maps.Polyline({
        map: mapRef.current,
        path,
        strokeWeight: 3,
        strokeColor: idx % 2 === 0 ? "#007aff" : "#ff5e3a",
        strokeOpacity: 0.6,
        strokeStyle: "solid",
      });
      routeLinesRef.current.push(polyline);
    });
  }, [routes]);

  // 차량 오버레이
  useEffect(() => {
    if (!window.kakao?.maps || !mapRef.current) return;
    busOverlays.current.forEach((o) => o.setMap(null));
    busOverlays.current = [];
    const visibleVehicles = vehicles.filter((v) =>
      visibleVehicleIds.includes(v.id)
    );
    visibleVehicles.forEach((v) => {
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return;
      const pos = new window.kakao.maps.LatLng(v.lat, v.lng);
      const overlay = new window.kakao.maps.CustomOverlay({
        position: pos,
        content:
          '<div style="text-align:center;">🚌<br/><small>' +
          (v.route || "셔틀") +
          "</small></div>",
        yAnchor: 0.5,
      });
      overlay.setMap(mapRef.current);
      busOverlays.current.push(overlay);
    });
  }, [vehicles, visibleVehicleIds]);

  // 정류장별 운행중 카운트
  const activeCountByStop = useMemo(() => {
    const m = new Map();
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
          <button className="header-link-btn" onClick={() => nav("/favorites")}>
            즐겨찾기
          </button>
          <button className="header-link-btn" onClick={() => nav("/alerts")}>
            알림
          </button>
        </div>
      }
    >
      <div className="map-container" style={{ height: MAP_HEIGHT }}>
        <div ref={mapEl} style={{ width: "100%", height: "100%" }} />
      </div>

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
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") && nav(`/stop/${s.id}`)
              }
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
      right={
        alerts.length > 0 ? (
          <button className="header-link-btn" onClick={clearAlerts}>
            전체 지우기
          </button>
        ) : null
      }
    >
      <div className="card">
        <div className="card-subtitle">안내</div>
        <ul className="info-list">
          <li>현재 앱 내 토스트/알림은 비활성화되어 있어요.</li>
          <li>
            알림을 다시 보이게 하려면 App.js 상단의{" "}
            <b>NOTIFY_ENABLED</b>를 <code>true</code>로 바꾸세요.
          </li>
        </ul>
      </div>
      {alerts.length === 0 ? (
        <div className="list-empty-text">새 알림이 없어요.</div>
      ) : (
        <div className="card-list">
          {alerts.map((a) => (
            <div className="card" key={a.id}>
              <div className="card-subtitle">
                {new Date(a.ts).toLocaleString()}
              </div>
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
  const { stops, vehicles, routes } = useApp();
  const nav = useNavigate();

  const stop = useMemo(
    () => stops.find((s) => String(s.id) === String(id)),
    [stops, id]
  );

  const mapRef = useRef(null);
  const mapEl = useRef(null);

  const activeRoute = useMemo(() => {
    if (!routes || !routes.length || !stop) return null;

    const name = stop.name || "";
    let targetName = null;

    if (name.includes("안산대1") || name.includes("안산대 1")) {
      targetName = "상록수-안산대 1";
    } else if (name.includes("안산대2") || name.includes("안산대 2")) {
      targetName = "상록수-안산대 2";
    } else if (name.includes("상록수")) {
      targetName = "상록수-안산대 1";
    }

    if (!targetName) return null;
    return routes.find((r) => r.name === targetName) || null;
  }, [routes, stop]);

  useEffect(() => {
    (async () => {
      await loadKakaoMaps();
      if (!stop) return;
      const kakao = window.kakao;
      const center = new kakao.maps.LatLng(stop.lat, stop.lng);

      const map = new kakao.maps.Map(mapEl.current, {
        center,
        level: 4,
      });
      mapRef.current = map;

      new kakao.maps.Marker({ position: center, map });

      if (activeRoute && activeRoute.points && activeRoute.points.length > 1) {
        const path = activeRoute.points.map(
          (p) => new kakao.maps.LatLng(p.lat, p.lng)
        );
        new kakao.maps.Polyline({
          map,
          path,
          strokeWeight: 4,
          strokeColor: "#007aff",
          strokeOpacity: 0.7,
          strokeStyle: "solid",
        });
      }

      setTimeout(() => map && map.relayout(), 0);
    })();
  }, [stop, activeRoute]);

  const activeTimes = useMemo(() => {
    const set = new Set();
    vehicles.forEach((v) => {
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
      right={
        <span className="info-text">
          {activeCount > 0 ? `운행중 ${activeCount}대` : "현재 운행 없음"}
        </span>
      }
    >
      <div className="map-container" style={{ height: MAP_HEIGHT }}>
        <div ref={mapEl} style={{ width: "100%", height: "100%" }} />
      </div>

      <div className="card">
        <div className="card-subtitle">운행중인 시간대</div>
        {activeTimes.length === 0 ? (
          <div className="info-text">
            현재 이 정류장에는 운행 중인 시간대가 없습니다.
          </div>
        ) : (
          <div className="bus-list">
            {activeTimes.map((t) => (
              <button
                key={t}
                className="bus-item"
                onClick={() =>
                  nav(`/stop/${id}/live/${encodeURIComponent(t)}`)
                }
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

/********************** QR 체크인 **********************/
/********************** QR 체크인 (1분 쿨다운) **********************/
const QrCheckScreen = () => {
  const { addNotice } = useApp();
  const [lastCode, setLastCode] = useState("");
  const [status, setStatus] = useState("READY"); 
  // READY | SENDING | DONE | ERROR | COOLDOWN

  const lastScanRef = useRef(0);        // 너무 자주 들어오는 프레임 막기 (1~2초)
  const blockUntilRef = useRef(0);      // ✅ 1분 쿨다운 끝나는 시간

  const handleScan = async (detected) => {
    // QR 없으면 무시
    if (!detected || detected.length === 0) return;

    const value =
      detected[0]?.rawValue ??
      detected[0]?.value ??
      (typeof detected[0] === "string" ? detected[0] : "");

    if (!value) return;

    const now = Date.now();

    // ✅ 1) 1분 쿨다운: 직전에 성공한 뒤 1분 안이면 전부 무시
    if (now < blockUntilRef.current) {
      // 상태만 안내용으로 갱신
      if (status !== "COOLDOWN") {
        setStatus("COOLDOWN");
        setLastCode(value);
      }
      return;
    }

    // ✅ 2) 너무 짧은 시간(1.5초) 안에 여러 프레임 들어오는 것도 필터
    if (now - lastScanRef.current < 1500) return;
    lastScanRef.current = now;

    // 전송 중이면 또 보내지 않음
    if (status === "SENDING") return;

    setLastCode(value);
    setStatus("SENDING");

    try {
      const base = await getServerURL();
      await fetch(`${base}/qr/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: value,
          ts: Date.now(),
          ua: navigator.userAgent,
        }),
      }).catch(() => {});

      if (addNotice) addNotice("QR 체크인 완료");

      setStatus("DONE");
      // ✅ 3) 지금부터 1분 동안은 다시 안 받도록 블록
      blockUntilRef.current = Date.now() + 60 * 1000;
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
          onError={(err) => console.warn("[QR] error", err)}
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
                ? "체크인 처리 완료 (1분 동안 다시 처리되지 않습니다)"
                : status === "SENDING"
                ? "서버 전송 중..."
                : status === "ERROR"
                ? "전송 실패 (QR은 인식됨)"
                : status === "COOLDOWN"
                ? "이미 체크인 처리됨 (1분 후 다시 가능)"
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


/********************** 라이브 화면 (노선 + 버스 위치 + ETA) **********************/
const TimeLiveScreen = () => {
  const { id, time } = useParams();
  const { stops, vehicles, routes } = useApp();
  const [search] = useSearchParams();
  const speedKmh =
    Number(search.get("speedKmh")) > 0
      ? Number(search.get("speedKmh"))
      : 18;

  const stop = useMemo(
    () => stops.find((s) => String(s.id) === String(id)),
    [stops, id]
  );

  const mapRef = useRef(null);
  const mapEl = useRef(null);
  const overlays = useRef([]);

  const actives = useMemo(() => {
    const t = String(time || "").trim();
    return vehicles.filter(
      (v) =>
        String(v.stopId) === String(id) &&
        isActiveNow(v) &&
        String(v.time || "").trim() === t
    );
  }, [vehicles, id, time]);

  const nearestBus = useMemo(() => {
    if (!actives.length || !stops.length) return null;
    const s = stops.find((x) => String(x.id) === String(id));
    if (!s) return null;
    const withDist = actives
      .filter(
        (v) => Number.isFinite(v.lat) && Number.isFinite(v.lng)
      )
      .map((v) => ({
        v,
        d: haversineMeters(
          { lat: v.lat, lng: v.lng },
          { lat: s.lat, lng: s.lng }
        ),
      }));
    if (!withDist.length) return null;
    return withDist.sort((a, b) => a.d - b.d)[0].v;
  }, [actives, stops, id]);

  const etaText = useMemo(() => {
    if (!stop || actives.length === 0) return "정보 없음";
    const withDist = actives
      .filter(
        (v) => Number.isFinite(v.lat) && Number.isFinite(v.lng)
      )
      .map((v) => ({
        v,
        d: haversineMeters(
          { lat: v.lat, lng: v.lng },
          { lat: stop.lat, lng: stop.lng }
        ),
      }));
    if (!withDist.length) return "정보 없음";
    const nearest = withDist.sort((a, b) => a.d - b.d)[0];
    const mps = (speedKmh * 1000) / 3600;
    const mins = Math.max(1, Math.round(nearest.d / mps / 60));
    return `${mins}분 후 도착 예정`;
  }, [actives, stop, speedKmh]);

  const activeRoute = useMemo(() => {
    if (!routes || !routes.length || !stop) return null;

    const name = stop.name || "";
    let targetName = null;

    if (name.includes("안산대1") || name.includes("안산대 1")) {
      targetName = "상록수-안산대 1";
    } else if (name.includes("안산대2") || name.includes("안산대 2")) {
      targetName = "상록수-안산대 2";
    } else if (name.includes("상록수")) {
      targetName = "상록수-안산대 1";
    }

    if (!targetName) return null;
    return routes.find((r) => r.name === targetName) || null;
  }, [routes, stop]);

  useEffect(() => {
    (async () => {
      await loadKakaoMaps();
      if (!stop) return;
      const kakao = window.kakao;

      const center =
        nearestBus &&
        Number.isFinite(nearestBus.lat) &&
        Number.isFinite(nearestBus.lng)
          ? new kakao.maps.LatLng(nearestBus.lat, nearestBus.lng)
          : new kakao.maps.LatLng(stop.lat, stop.lng);

      const map = new kakao.maps.Map(mapEl.current, {
        center,
        level: 4,
      });
      mapRef.current = map;

      new kakao.maps.Marker({
        position: new kakao.maps.LatLng(stop.lat, stop.lng),
        map,
      });

      if (
        activeRoute &&
        activeRoute.points &&
        activeRoute.points.length > 1
      ) {
        const path = activeRoute.points.map(
          (p) => new kakao.maps.LatLng(p.lat, p.lng)
        );
        new kakao.maps.Polyline({
          map,
          path,
          strokeWeight: 4,
          strokeColor: "#007aff",
          strokeOpacity: 0.7,
          strokeStyle: "solid",
        });
      }

      overlays.current.forEach((o) => o.setMap(null));
      overlays.current = [];
      actives.forEach((v) => {
        if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return;
        const overlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(v.lat, v.lng),
          content: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-50%);">
                <div style="font-size:22px;filter:drop-shadow(0 0 2px rgba(0,0,0,.5));">🚌</div>
                <div style="font-size:10px;font-weight:bold;line-height:1;margin-top:2px;">${
                  v.route || "셔틀"
                }</div>
              </div>`,
          yAnchor: 0.5,
          xAnchor: 0.5,
        });
        overlay.setMap(map);
        overlays.current.push(overlay);
      });

      setTimeout(() => map && map.relayout(), 0);
    })();
  }, [actives, stop, nearestBus, activeRoute]);

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
          (기본 속도 {speedKmh}km/h 기준 계산 • URL에{" "}
          <code>?speedKmh=20</code> 처럼 전달하면 변경 가능)
        </div>
      </div>
    </Page>
  );
};

/********************** App 루트 **********************/
export default function App() {
  const [stops, setStops] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [favIds, setFavIds] = useState(() => {
    try {
      return new Set(
        JSON.parse(localStorage.getItem("everybus:favorites") || "[]")
      );
    } catch {
      return new Set();
    }
  });
  const [visibleVehicleIds, setVisibleVehicleIds] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [toasts, setToasts] = useState([]);

  // ✅ QR 이후 강제 새로고침용
  const refreshVehicles = async () => {
    const v = await fetchVehiclesOnce();
    setVehicles(v);
  };

  const addNotice = (message) => {
    if (!NOTIFY_ENABLED) return;
    const n = { id: crypto.randomUUID(), ts: Date.now(), message };
    setAlerts((prev) => [n, ...prev]);
    setToasts((prev) => [...prev, n]);
  };
  const closeToast = (id) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));
  const clearAlerts = () => setAlerts([]);

  const toggleFav = (id) => {
    setFavIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("everybus:favorites", JSON.stringify([...next]));
      setStops((prevStops) =>
        prevStops.map((s) =>
          String(s.id) === String(id)
            ? { ...s, favorite: next.has(String(id)) }
            : s
        )
      );
      return next;
    });
  };

  useUserLocation(setUserLocation);

  // 정류장
  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await fetchStopsOnce();
      if (!alive) return;
      const favSet = new Set([...favIds].map(String));
      setStops(
        data.map((s) => ({
          ...s,
          favorite: favSet.has(String(s.id)),
        }))
      );
    })();
    return () => {
      alive = false;
    };
  }, [favIds]);

  // 차량
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

  // 노선
  useEffect(() => {
    let alive = true;
    (async () => {
      const rts = await fetchRoutesOnce();
      if (alive) setRoutes(rts);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ctx = {
    stops,
    setStops,
    vehicles,
    setVehicles,
    routes,
    setRoutes,
    favIds,
    toggleFav,
    userLocation,
    visibleVehicleIds,
    setVisibleVehicleIds,
    alerts,
    clearAlerts,
    addNotice,
    refreshVehicles, // ✅ QR에서 사용
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="toast-wrap">
        {toasts.map((t) => (
          <Notice
            key={t.id}
            text={t.message}
            onClose={() => closeToast(t.id)}
          />
        ))}
      </div>

      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/favorites" element={<FavoritesScreen />} />
          <Route path="/alerts" element={<AlertsScreen />} />
          <Route path="/qr" element={<QrCheckScreen />} />
          <Route path="/stop/:id" element={<StopDetail />} />
          <Route path="/stop/:id/live/:time" element={<TimeLiveScreen />} />
          <Route
            path="*"
            element={
              <div className="not-found-page">
                <div className="not-found-content">
                  <div className="not-found-icon">🧭</div>
                  <div className="not-found-title">
                    페이지를 찾을 수 없습니다
                  </div>
                  <Link className="link" to="/">
                    홈으로
                  </Link>
                </div>
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </AppContext.Provider>
  );
}
