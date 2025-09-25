-- `everybus` 라는 이름의 데이터베이스를 생성하고, 한글 사용을 위해 utf8mb4 문자셋을 사용합니다.
CREATE SCHEMA IF NOT EXISTS `everybus` DEFAULT CHARACTER SET utf8mb4;

-- `everybus` 데이터베이스를 사용하겠다고 지정합니다.
USE `everybus`;


-- -----------------------------------------------------
-- 2. 테이블 생성
-- -----------------------------------------------------
-- `stops` 테이블 (정류장 정보)
CREATE TABLE IF NOT EXISTS `stops` (
  `id` INT NOT NULL AUTO_INCREMENT,     -- 정류장 고유 ID (자동으로 1씩 증가)
  `name` VARCHAR(100) NOT NULL,         -- 정류장 이름
  `lat` DECIMAL(10, 8) NOT NULL,        -- 위도 (높은 정밀도를 위해 DECIMAL 사용)
  `lng` DECIMAL(11, 8) NOT NULL,        -- 경도
  PRIMARY KEY (`id`)                    -- id를 기본 키로 지정하여 중복 방지 및 빠른 조회
);

-- `vehicles` 테이블 (버스 위치 정보)
CREATE TABLE IF NOT EXISTS `vehicles` (
  `id` VARCHAR(50) NOT NULL,            -- 버스 고유 ID (차량 번호 등)
  `route` VARCHAR(50) NULL,             -- 노선 이름 (예: '77번 버스')
  `lat` DECIMAL(10, 8) NOT NULL,        -- 현재 위도
  `lng` DECIMAL(11, 8) NOT NULL,        -- 현재 경도
  `heading` INT NULL,                   -- 진행 방향 (0~359 사이의 각도)
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- 위치 정보가 마지막으로 업데이트된 시간
  PRIMARY KEY (`id`)
);


-- -----------------------------------------------------
-- 3. 테스트용 데이터 삽입
-- -----------------------------------------------------
-- 테이블에 데이터가 이미 있다면 비우고 시작합니다.
TRUNCATE `stops`;
TRUNCATE `vehicles`;

-- `stops` 테이블에 샘플 데이터 삽입
INSERT INTO `stops` (`name`, `lat`, `lng`) VALUES
('안산대학교', 37.29821234, 126.83595678),
('상록수역', 37.29311111, 126.86242222),
('중앙역', 37.31683333, 126.83984444);

-- `vehicles` 테이블에 샘플 데이터 삽입
INSERT INTO `vehicles` (`id`, `route`, `lat`, `lng`, `heading`) VALUES
('경기71사1234', '셔틀 A', 37.2975, 126.8370, 45),
('경기71사5678', '셔틀 B', 37.3000, 126.8400, 210);

-- -----------------------------------------------------
-- 4. 데이터 확인
-- -----------------------------------------------------
SELECT * FROM `stops`;
SELECT * FROM `vehicles`;