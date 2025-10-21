import React, { useEffect, useRef } from "react";
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.9780 };
const DEFAULT_LEVEL = 5;

export default function KakaoMap() {
  const mapRef = useRef(null);

  useEffect(() => {
    // CRA 환경변수 사용 (REACT_APP_ 접두어)
    const KAKAO_KEY = process.env.REACT_APP_KAKAO_APP_KEY;
    if (!KAKAO_KEY) {
      console.warn("REACT_APP_KAKAO_APP_KEY가 없습니다. .env에 설정하세요.");
      return;
    }

    const exist = document.querySelector('script[data-kakao="true"]');
    if (exist && window.kakao && window.kakao.maps) {
      init();
      return;
    }

    const script = document.createElement("script");
    script.setAttribute("data-kakao", "true");
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}`;
    script.async = true;
    script.onload = () => init();
    document.head.appendChild(script);

    function init() {
      const container = document.getElementById("map");
      if (!container) return;
      const kakao = window.kakao;
      const options = {
        center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
        level: DEFAULT_LEVEL,
      };
      const map = new kakao.maps.Map(container, options);
      mapRef.current = map;
    }
  }, []);

  return null;
}
