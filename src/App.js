import React, { useState, useEffect } from 'react'; // ⭐ 1. useEffect 추가
// import { useNavigate } from 'react-router-dom'; // (제거됨)
import './App.css'; // 기존 App.css를 재사용합니다.

// --- 1. 선택을 위한 임시 데이터 (3개로 분리) ---
const busList = [
  { id: 'bus_001', name: '1호차 (경기71자1234)' },
  { id: 'bus_002', name: '2호차 (경기71자5678)' },
  { id: 'bus_003', name: '3호차 (경기71자9012)' },
];
const driverList = [
  { id: 'driver_A', name: '김제민 기사님' },
  { id: 'driver_B', name: '이안산 기사님' },
  { id: 'driver_C', name: '박테크 기사님' },
];
const timeSlotList = [
  { id: 'time_AM', name: '오전 운행 (09:00 - 12:00)' },
  { id: 'time_PM', name: '오후 운행 (13:00 - 18:00)' },
];
// ----------------------------------------------

function BusStop() {
  // const navigate = useNavigate(); // (제거됨)

  // --- 2. 3개의 항목을 위한 State ---
  const [selectedBus, setSelectedBus] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  // ---------------------------------

  const [isDriving, setIsDriving] = useState(false);
  const [passengerCount, setPassengerCount] = useState(0); 
  const [showQR, setShowQR] = useState(false); // ⭐ 2. QR 모달 상태 추가

  // ⭐ 3. 탑승자 수 시뮬레이션 (QR 스캔을 가정)
  useEffect(() => {
    let intervalId;
    if (isDriving) {
      // 운행이 시작되면, 5초마다 탑승자 수가 1씩 증가하는 것을 시뮬레이션합니다.
      // (실제로는 서버에서 데이터를 받아오는(polling) 로직이 들어갑니다)
      intervalId = setInterval(() => {
        setPassengerCount(prevCount => prevCount + 1);
      }, 5000); // 5초마다 1명 탑승 (시뮬레이션)
    }
    
    // 운행이 종료되거나, 화면이 사라질 때 인터벌을 정리합니다.
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isDriving]); // isDriving 상태가 바뀔 때마다 실행


  // 운행 시작/종료 버튼 클릭 시
  const handleToggleDriving = () => {
    if (isDriving) {
      // 운행 종료 로직
      if (window.confirm('운행을 종료하시겠습니까?')) {
        setIsDriving(false);
        setPassengerCount(0); // ⭐ 탑승자 수 초기화
        console.log('운행 종료');
      }
    } else {
      // 운행 시작 로직
      if (!selectedBus || !selectedDriver || !selectedTime) {
        alert('버스, 기사님, 시간대를 모두 선택해주세요.');
        return;
      }
      setIsDriving(true);
      console.log(`운행 시작: 
        버스: ${selectedBus}, 
        기사: ${selectedDriver}, 
        시간: ${selectedTime}
      `);
      // 여기에 위치 정보 전송 시작 API 호출
    }
  };

  // --- 4. JSX 구조 변경 ---
  return (
    <div className="page-container">
      {/* 1. 헤더 */}
      <div className="page-header">
        <div className="page-header-inner">
          <div style={{ width: '2rem' }}></div>
          {/* ⭐ 4. 운행 상태에 따라 헤더 타이틀 변경 */}
          <h1 className="page-title">{isDriving ? '운행 중' : 'EveryBus 운행 관리'}</h1>
          <div style={{ width: '2rem' }}></div>
        </div>
      </div>

      {/* 2. 메인 콘텐츠 */}
      <div className="page-content">
        
        {/* ⭐ 5. QR 코드 모달 UI (isDriving이 true일 때만) */}
        {isDriving && showQR && (
          <div className="qr-modal-overlay" onClick={() => setShowQR(false)}>
            <div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="card-subtitle">승객 탑승용 QR 코드</div>
              <div className="qr-placeholder">
                {/* 실제 앱에서는 여기에 'react-qr-code' 같은 라이브러리를 사용해
                  QR 코드를 동적으로 생성합니다. 
                  (예: <QRCode value={`busId=${selectedBus}`} />)
                  지금은 예시 이미지를 사용합니다.
                */}
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=EVERYBUS_${selectedBus}`} 
                  alt="QR Code" 
                />
                <span className="info-text" style={{marginTop: '10px'}}>
                  (학생들이 이 코드를 스캔하면 탑승 처리됩니다)
                </span>
              </div>
              <button className="button-primary start" onClick={() => setShowQR(false)}>
                닫기
              </button>
            </div>
          </div>
        )}
        
        {isDriving ? (
          // ==============================
          //  운행 중 화면 (Driving Screen)
          // ==============================
          <>
            <div className="card">
              <div className="card-subtitle">현재 운행 정보</div>
              <div className="driving-info-list">
                <div className="info-item">
                  <span className="info-label">🚌 버스</span>
                  <span className="info-value">{selectedBus}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">👨‍✈️ 기사</span>
                  <span className="info-value">{selectedDriver}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">🕒 시간</span>
                  <span className="info-value">{selectedTime}</span>
                </div>
              </div>
            </div>

            {/* ⭐ 6. 탑승자 수 카드 UI 수정 */}
            <div className="card">
              <div className="card-subtitle">현재 탑승자 수 (실시간)</div>
              <div className="passenger-counter">
                {/* +/- 버튼이 있던 자리 */}
                <div className="count-display">{passengerCount}</div>
                
                {/* "QR 코드 보기" 버튼으로 교체 */}
                <button 
                  className="button-primary start" 
                  style={{marginTop: '10px'}} // 버튼과 숫자 사이 간격
                  onClick={() => setShowQR(true)}
                >
                  탑승 QR 코드 보기
                </button>
              </div>
            </div>
            
            <button 
              className="button-primary stop"
              onClick={handleToggleDriving} // '운행 종료' 로직 실행
            >
              운행 종료
            </button>
          </>

        ) : (

          // ==============================
          //  운행 선택 화면 (Selection Screen)
          // ==============================
          <>
            <div className="card">
              <div className="card-subtitle">현재 운행 상태</div>
              <p className={'status-display stopped'}>
                운행 대기
              </p>
            </div>
            
            {/* 1. 버스 번호 선택 카드 */}
            <div className="card">
              <div className="card-subtitle">1. 버스 번호 선택</div>
              <div className="selectable-list">
                {busList.map((bus) => (
                  <label 
                    key={bus.id} 
                    className={`selectable-item ${selectedBus === bus.name ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="bus-select"
                      value={bus.name}
                      checked={selectedBus === bus.name}
                      onChange={() => setSelectedBus(bus.name)}
                      disabled={isDriving}
                    />
                    <div className="item-name">{bus.name}</div>
                  </label>
                ))}
              </div>
            </div>
            
            {/* 2. 기사님 이름 선택 카드 */}
            <div className="card">
              <div className="card-subtitle">2. 기사님 이름</div>
              <div className="selectable-list">
                {driverList.map((driver) => (
                  <label 
                    key={driver.id} 
                    className={`selectable-item ${selectedDriver === driver.name ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="driver-select"
                      value={driver.name}
                      checked={selectedDriver === driver.name}
                      onChange={() => setSelectedDriver(driver.name)}
                      disabled={isDriving}
                    />
                    <div className="item-name">{driver.name}</div>
                  </label>
                ))}
              </div>
            </div>

            {/* 3. 시간대 선택 카드 */}
            <div className="card">
              <div className="card-subtitle">3. 시간대 선택</div>
              <div className="selectable-list">
                {timeSlotList.map((time) => (
                  <label 
                    key={time.id} 
                    className={`selectable-item ${selectedTime === time.name ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="time-select"
                      value={time.name}
                      checked={selectedTime === time.name}
                      onChange={() => setSelectedTime(time.name)}
                      disabled={isDriving}
                    />
                    <div className="item-name">{time.name}</div>
                  </label>
                ))}
              </div>
            </div>

            {/* 운행 시작 버튼 */}
            <button 
              className={'button-primary start'}
              onClick={handleToggleDriving}
              disabled={!selectedBus || !selectedDriver || !selectedTime}
            >
              운행 시작
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default BusStop;