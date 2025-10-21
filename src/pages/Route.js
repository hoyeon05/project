import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import KakaoMap from '../components/KakaoMap';

export default function RoutePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const bus = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("bus") || "";
  }, [location.search]);

  const [passengerCount] = useState("");
  const [maxCapacity] = useState("");
  const [eta] = useState("");
  const [deadline] = useState("");

  const handleEnd = () => {
    const params = new URLSearchParams();
    params.set("ended", "true");
    if (bus) params.set("bus", bus);
    navigate(`/driver?${params.toString()}`);
  };

  return (
    <>
      <header className="header">
        <h1>셔틀 경로 안내</h1>
      </header>
      <main className="main">
        <div id="map" className="map-box">
          <KakaoMap />
        </div>
        <section className="status centered">
          <div className="status-item">
            <span>현재 탑승자 수</span>
            <strong id="passengerCount">{String(passengerCount || "-")}</strong>
          </div>
          <div className="status-item">
            <span>최대 탑승 인원</span>
            <strong id="maxCapacity">{String(maxCapacity || "-")}</strong>
          </div>
          <div className="status-item">
            <span>도착 예정 시간</span>
            <strong id="eta">{String(eta || "-")}</strong>
          </div>
          <div className="status-item">
            <span>도착시간</span>
            <strong id="deadline">{String(deadline || "-")}</strong>
          </div>
        </section>
        <section className="controls">
          <button id="endButton" className="stop" onClick={handleEnd}>
            운행 종료
          </button>
        </section>
      </main>
    </>
  );
}
