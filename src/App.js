import React, { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import Driver from './pages/Driver';
import RoutePage from './pages/Route';
function EndedAlert() {
  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("ended") === "true") {
      alert("운행이 종료되었습니다.");
      params.delete("ended");
      const newSearch = params.toString();
      const newUrl = `${location.pathname}${newSearch ? "?" + newSearch : ""}`;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, [location]);
  return null;
}

export default function App() {
  return (
    <>
      <EndedAlert />
      <Routes>
        <Route path="/" element={<Driver />} />
        <Route path="/driver" element={<Driver />} />
        <Route path="/route" element={<RoutePage />} />
      </Routes>
    </>
  );
}
