// src/RouteEditor.js
// 노선 편집기 (관리자/개발용)
// - kakao 지도 클릭해서 좌표 추가
// - polyline 표시
// - "노선 저장" -> 백엔드 /routes 에 저장 + 클립보드 복사
// - 저장된 노선 목록 조회해서 선택하면 미리보기

import React, { useEffect, useRef, useState } from "react";

const PROD_SERVER_URL = "https://project-1-ek9j.onrender.com";
const LOCAL_SERVER_URL = "http://localhost:5000";

let cachedBase = null;
async function getBase() {
  if (cachedBase) return cachedBase;
  for (const b of [PROD_SERVER_URL, LOCAL_SERVER_URL]) {
    try {
      const r = await fetch(`${b}/health`);
      if (r.ok) {
        cachedBase = b;
        return b;
      }
    } catch {}
  }
  cachedBase = PROD_SERVER_URL;
  return cachedBase;
}

async function loadKakaoMaps() {
  if (window.kakao?.maps) return true;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src =
      "https://dapi.kakao.com/v2/maps/sdk.js?appkey=1befb49da92b720b377651fbf18cd76a&autoload=false";
    s.onload = () =>
      window.kakao.maps.load(() => resolve(true));
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// 간단한 라인 단순화(굵게만, 필요 없으면 그냥 points 리턴해도 됨)
function simplify(points, step = 1) {
  if (!Array.isArray(points) || points.length <= 2)
    return points || [];
  if (step <= 1) return points;
  const out = [];
  for (let i = 0; i < points.length; i += step) {
    out.push(points[i]);
  }
  if (
    points.length % step !== 0 &&
    out[out.length - 1] !== points[points.length - 1]
  ) {
    out.push(points[points.length - 1]);
  }
  return out;
}

export default function RouteEditor() {
  const mapRef = useRef(null);
  const polylineRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [routeName, setRouteName] = useState("");
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [loading, setLoading] = useState(false);

  // 지도 초기화
  useEffect(() => {
    (async () => {
      await loadKakaoMaps();
      const kakao = window.kakao;
      const container =
        document.getElementById("route-editor-map");
      if (!container) return;

      const map = new kakao.maps.Map(container, {
        center: new kakao.maps.LatLng(
          37.30927735109936,
          126.87543411783554
        ),
        level: 4,
      });
      mapRef.current = map;

      kakao.maps.event.addListener(
        map,
        "click",
        (mouseEvent) => {
          const latlng = mouseEvent.latLng;
          const p = {
            lat: latlng.getLat(),
            lng: latlng.getLng(),
          };
          setPoints((prev) => [...prev, p]);
        }
      );
    })();
  }, []);

  // points 변경 시 polyline 업데이트
  useEffect(() => {
    if (!window.kakao?.maps || !mapRef.current) return;
    const kakao = window.kakao;

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }
    if (!points.length) return;

    const path = points.map(
      (p) => new kakao.maps.LatLng(p.lat, p.lng)
    );
    const polyline = new kakao.maps.Polyline({
      map: mapRef.current,
      path,
      strokeWeight: 4,
      strokeColor: "#007aff",
      strokeOpacity: 0.9,
      strokeStyle: "solid",
    });
    polylineRef.current = polyline;

    // 경계에 맞춰 보기
    const bounds = new kakao.maps.LatLngBounds();
    path.forEach((latlng) => bounds.extend(latlng));
    mapRef.current.setBounds(bounds);
  }, [points]);

  // 저장된 노선 목록 불러오기
  const loadSavedRoutes = async () => {
    setLoading(true);
    try {
      const base = await getBase();
      const res = await fetch(`${base}/routes`);
      if (res.ok) {
        const data = await res.json();
        setSavedRoutes(Array.isArray(data) ? data : []);
      } else {
        alert("노선 목록 불러오기 실패");
      }
    } catch (e) {
      console.error(e);
      alert("노선 목록 불러오기 에러");
    } finally {
      setLoading(false);
    }
  };

  // 선택한 저장 노선 미리보기
  const handlePreviewRoute = (route) => {
    if (!route || !Array.isArray(route.points)) return;
    setRouteName(route.name || "");
    setPoints(
      route.points.map((p) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
      }))
    );
  };

  // 현재 그린 노선 저장
  const handleSave = async () => {
    if (points.length < 2) {
      alert("두 개 이상 좌표를 찍어야 합니다.");
      return;
    }

    const name =
      routeName.trim() ||
      `노선_${new Date()
        .toISOString()
        .slice(0, 19)
        .replace("T", " ")}`;

    const simple = simplify(points, 1); // 필요하면 2 이상 주면 더 단순화
    const json = JSON.stringify(
      { name, points: simple },
      null,
      2
    );

    try {
      const base = await getBase();
      const res = await fetch(`${base}/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, points: simple }),
      });
      if (!res.ok) {
        console.error(await res.text());
        alert("❌ 서버에 노선 저장 실패");
        return;
      }
      const data = await res.json();
      alert("✅ 노선이 MongoDB에 저장되었습니다.");

      // 목록 갱신용
      setSavedRoutes((prev) =>
        data?.route
          ? [...prev, data.route]
          : prev
      );
    } catch (e) {
      console.error(e);
      alert("네트워크 오류로 노선 저장 실패");
    }

    // 편의를 위해 클립보드에도 복사
    navigator.clipboard
      .writeText(json)
      .catch(() => {});
  };

  const handleReset = () => {
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }
    setPoints([]);
  };

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont",
      }}
    >
      <h2 style={{ marginBottom: 8 }}>노선 편집기 (관리자용)</h2>
      <p
        style={{
          fontSize: 12,
          color: "#666",
          marginBottom: 12,
        }}
      >
        지도를 클릭해 노선을 그리고, "노선 저장"을 누르면
        MongoDB에 저장됩니다.
      </p>

      <div
        id="route-editor-map"
        style={{
          width: "100%",
          height: "420px",
          borderRadius: 8,
          border: "1px solid #ddd",
          marginBottom: 12,
        }}
      />

      <div style={{ marginBottom: 8 }}>
        <input
          type="text"
          placeholder="노선 이름 (예: 상록수역 ↔ 안산대 순환)"
          value={routeName}
          onChange={(e) => setRouteName(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid #ccc",
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={handleSave}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 6,
            border: "none",
            background: "#007aff",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          노선 저장
        </button>
        <button
          onClick={handleReset}
          style={{
            width: 90,
            padding: "8px 0",
            borderRadius: 6,
            border: "1px solid #ccc",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          초기화
        </button>
        <button
          onClick={loadSavedRoutes}
          style={{
            width: 110,
            padding: "8px 0",
            borderRadius: 6,
            border: "1px solid #ccc",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          노선 목록 불러오기
        </button>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: "#666" }}>
          노선 목록 불러오는 중...
        </div>
      )}

      {savedRoutes.length > 0 && (
        <div
          style={{
            marginTop: 4,
            padding: 8,
            borderRadius: 6,
            border: "1px solid #eee",
            maxHeight: 160,
            overflowY: "auto",
            fontSize: 13,
          }}
        >
          <div
            style={{
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            저장된 노선 목록 (클릭 시 미리보기)
          </div>
          {savedRoutes.map((r) => (
            <div
              key={r.id}
              onClick={() => handlePreviewRoute(r)}
              style={{
                padding: "4px 6px",
                borderRadius: 4,
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>{r.name}</span>
              <span
                style={{
                  fontSize: 11,
                  color: "#999",
                }}
              >
                {r.points?.length || 0} pts
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
