import React, { useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

export default function Driver() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialBus = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("bus") || "";
  }, [location.search]);

  const [busList] = useState([]);
  const [selectedBus, setSelectedBus] = useState(initialBus);
  const [passengerCount] = useState("");
  const [maxCapacity] = useState("");

  const handleStart = () => {
    const search = new URLSearchParams();
    if (selectedBus) search.set("bus", selectedBus);
    navigate(`/route${search.toString() ? "?" + search.toString() : ""}`);
  };

  return (
    <>
      <header className="header">
        <h1>셔틀버스 운행</h1>
      </header>
      <main className="main">
        <section className="bus-info">
          <label htmlFor="busSelect">버스 번호:</label>
          <select
            id="busSelect"
            value={selectedBus}
            onChange={(e) => setSelectedBus(e.target.value)}
          >
            <option value="">선택하세요</option>
          </select>
        </section>
        <section className="controls">
          <button id="startBtn" className="start" onClick={handleStart}>
            운행 시작
          </button>
        </section>
        <section className="status centered">
          <div className="status-item">
            <span>현재 탑승자 수</span>
            <strong id="passengerCount">{String(passengerCount || "-")}</strong>
          </div>
          <div className="status-item">
            <span>최대 탑승 인원</span>
            <strong id="maxCapacity">{String(maxCapacity || "-")}</strong>
          </div>
        </section>
      </main>
    </>
  );
}
