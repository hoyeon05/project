// RouteEditor.js
import React, { useEffect, useRef, useState } from "react";

// 이미 App.js에서 쓰는 kakao sdk 로더가 있다면 거기 거 가져와 써도 되고,
// 여기서만 쓸 거면 아래처럼 간단 버전 두면 됨.
async function loadKakaoMaps() {
  if (window.kakao?.maps) return true;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src =
      "https://dapi.kakao.com/v2/maps/sdk.js?appkey=1befb49da92b720b377651fbf18cd76a&autoload=false";
    s.onload = () => window.kakao.maps.load(() => resolve(true));
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default function RouteEditor() {
  const mapRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [polyline, setPolyline] = useState(null);

  useEffect(() => {
    (async () => {
      await loadKakaoMaps();
      const kakao = window.kakao;
      const container = document.getElementById("route-editor-map");
      const map = new kakao.maps.Map(container, {
        center: new kakao.maps.LatLng(37.305, 126.87), // 시작 위치: 안산 근처
        level: 4,
      });
      mapRef.current = map;

      // 지도 클릭할 때마다 좌표 추가 + 마커 + 폴리라인 갱신
      kakao.maps.event.addListener(map, "click", (mouseEvent) => {
        const latlng = mouseEvent.latLng;
        const pt = { lat: latlng.getLat(), lng: latlng.getLng() };

        setPoints((prev) => {
          const next = [...prev, pt];

          // 마커
          new kakao.maps.Marker({
            position: latlng,
            map,
          });

          // 폴리라인
          if (polyline) polyline.setMap(null);
          const line = new kakao.maps.Polyline({
            path: next.map((p) => new kakao.maps.LatLng(p.lat, p.lng)),
            strokeWeight: 5,
            strokeColor: "#1D4ED8",
            strokeOpacity: 0.9,
            strokeStyle: "solid",
          });
          line.setMap(map);
          setPolyline(line);

          return next;
        });
      });
    })();
  }, []); // 최초 1회

  const handleSave = () => {
    if (points.length < 2) {
      alert("두 개 이상 찍어야 노선이 됩니다.");
      return;
    }
    const json = JSON.stringify(points, null, 2);
    console.log("=== ROUTE JSON ===");
    console.log(json);
    navigator.clipboard.writeText(json).catch(() => {});
    alert("노선 좌표를 콘솔과 클립보드에 저장했습니다.");
  };

  const handleReset = () => {
    if (polyline) polyline.setMap(null);
    setPolyline(null);
    setPoints([]);
    // 마커는 샘플이니까 냅두거나, 진짜 하려면 ref로 따로 관리해서 지우면 됨
    alert("초기화 완료. 다시 찍으세요.");
  };

  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <div
        id="route-editor-map"
        style={{ width: "100%", height: "90vh", border: "1px solid #ccc" }}
      />
      <div style={{ padding: "8px", textAlign: "center" }}>
        <button onClick={handleSave}>💾 노선 저장</button>
        <button onClick={handleReset} style={{ marginLeft: 8 }}>🧹 초기화</button>
      </div>
    </div>
  );
}
