// App.js
import React, { useEffect, useRef, useState } from 'react';
import './App.css';

function App() {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const locationOverlayRef = useRef(null);
  const [stations, setStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState('all');
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('favorites');
    return saved ? JSON.parse(saved) : [];
  });

  const allBusList = [
    { id: 1, name: '1호차', station: '상록수역' },
    { id: 2, name: '2호차', station: '한대앞역' },
    { id: 3, name: '3호차', station: '안산대학교' },
    { id: 4, name: '4호차', station: '상록수역' },
    { id: 5, name: '5호차', station: '한대앞역' },
    { id: 6, name: '6호차', station: '안산대학교' },
    { id: 7, name: '7호차', station: '상록수역' },
    { id: 8, name: '8호차', station: '한대앞역' },
  ];

  const serverURL = window.location.hostname.includes("localhost")
  ? "http://localhost:5000"
  : "https://project-1-ek9j.onrender.com";


  useEffect(() => {
    const script = document.createElement('script');
    script.src =
      'https://dapi.kakao.com/v2/maps/sdk.js?appkey=1befb49da92b720b377651fbf18cd76a&autoload=false';
    script.async = true;
    script.onload = () => {
      window.kakao.maps.load(() => {
        if (mapRef.current && !mapInstanceRef.current) {
          const map = new window.kakao.maps.Map(mapRef.current, {
            center: new window.kakao.maps.LatLng(37.5665, 126.978),
            level: 4,
          });
          mapInstanceRef.current = map;
          loadBusStops(map);
          showMyLocation(map);
        }
      });
    };
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, []);

  const loadBusStops = (map) => {
    fetch(`${serverURL}/bus-info`)
      .then(res => res.json())
      .then(data => {
        setStations(data);
        data.forEach(stop => {
          const marker = new window.kakao.maps.Marker({
            map,
            position: new window.kakao.maps.LatLng(stop.lat, stop.lng),
            title: stop.name,
          });

          const infoWindow = new window.kakao.maps.InfoWindow({
            content: `<div style="padding:5px;">${stop.name}</div>`  // ✅ HTML 문자열
          });
          

          let isOpen = false;
          window.kakao.maps.event.addListener(marker, 'click', () => {
            if (isOpen) {
              infoWindow.close();
              isOpen = false;
            } else {
              infoWindow.open(map, marker);
              isOpen = true;
            }
          });
        });
      })
      .catch(err => console.error('❌ 버스 정류장 정보 로드 실패:', err));
  };

 // App.js 내부
 const showMyLocation = (map) => {
  if (!navigator.geolocation) {
    alert("위치 정보를 사용할 수 없습니다.");
    return;
  }

  navigator.geolocation.watchPosition(
    (position) => {
      const latlng = new window.kakao.maps.LatLng(
        position.coords.latitude,
        position.coords.longitude
      );

      // 커스텀 위치 마커 요소 생성
      const content = document.createElement('div');
      content.className = 'custom-my-location';

      const inner = document.createElement('div');
      inner.className = 'custom-my-location-inner';
      content.appendChild(inner);

      // 오버레이가 없으면 새로 생성
      if (!locationOverlayRef.current) {
        const overlay = new window.kakao.maps.CustomOverlay({
          position: latlng,
          content: content,
          yAnchor: 1,
          zIndex: 10,
        });
        overlay.setMap(map);
        locationOverlayRef.current = overlay;
      } else {
        // 기존 오버레이 위치만 갱신
        locationOverlayRef.current.setPosition(latlng);
        locationOverlayRef.current.setContent(content);
      }

      // 지도도 같이 이동 (옵션)
      map.setCenter(latlng);
    },
    (error) => {
      console.error('📍 위치 정보 오류:', error);
      alert("위치 정보를 가져올 수 없습니다.");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 5000,
    }
  );
};


  const handleSelectChange = (event) => {
    const selected = event.target.value;
    setSelectedStation(selected);
    const station = stations.find(s => s.name === selected);
    if (station && mapInstanceRef.current) {
      mapInstanceRef.current.setCenter(new window.kakao.maps.LatLng(station.lat, station.lng));
    }
  };

  return (
    <div className="App">
      <div className="title-bar-container">
        <h1 style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/main.html'}>
          에브리버스
        </h1>
      </div>

      <div className="search-container">
        <label htmlFor="stationSelect">정류장 선택:</label>
        <select
          id="stationSelect"
          value={selectedStation}
          onChange={handleSelectChange}
        >
          <option value="all">전체 보기</option>
          {stations.map((station, idx) => (
            <option key={idx} value={station.name}>{station.name}</option>
          ))}
        </select>
      </div>

      <div id="map" className="map" ref={mapRef}></div>

      <div className="section-title">즐겨찾기한 노선</div>
      <div className="bus-list">
        {favorites.length === 0 && <div>즐겨찾기한 노선이 없습니다.</div>}
        {allBusList
          .filter((bus) => favorites.includes(bus.id))
          .map((bus) => (
            <div key={bus.id} className="bus-item">
              <span>{bus.name} ({bus.station})</span>
            </div>
          ))}
      </div>

      <div className="footer-buttons">
        <a href="signin.html" className="icon-btn" title="로그아웃">
          <img src="https://img.icons8.com/ios-filled/50/logout-rounded-left.png" alt="Logout" />
        </a>
        <a href="setting.html" className="icon-btn" title="설정">
          <img src="https://img.icons8.com/ios-filled/50/settings.png" alt="Settings" />
        </a>
        <a href="mainbus.html" className="icon-btn" title="실시간 버스위치">
          <img src="https://img.icons8.com/ios-filled/50/bus.png" alt="Bus" />
        </a>
      </div>
    </div>
  );

          }
export default App; 