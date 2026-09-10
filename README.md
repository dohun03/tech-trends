# 🚀 [Tech Trends] 매일 새로운 IT/테크 아티클 수집 및 AI 요약 서비스


## 📋 프로젝트 개요

Dev.to, GeekNews 등 주요 기술 커뮤니티 아티클을 주기적으로 자동 수집하고, LLM 기반의 기술 가치 평가·3줄 요약·1536차원 벡터 임베딩을 수행합니다.

RRF(Reciprocal Rank Fusion) 하이브리드 검색을 적용하여 검색 품질을 향상시켰으며, 시맨틱 유사도 기반 연관 아티클 추천을 제공합니다.

BullMQ + Redis 비동기 큐를 도입해 외부 API Rate Limit 제어 및 서버 타임아웃 문제를 안정적으로 해결했습니다.

* **진행 기간**: 2026.07 ~ 2026.08
* **참여 인원**: 1명 (개인 프로젝트)
* [Live Demo](http://43.203.27.240)

---

## 🛠️ 기술 스택

<div align="left">
  <img src="https://img.shields.io/badge/NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white"/>
  <img src="https://img.shields.io/badge/pgvector-336791?style=flat-square&logo=postgresql&logoColor=white"/>
  <img src="https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/BullMQ-FF4500?style=flat-square&logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/AWS_Lightsail-FF9900?style=flat-square&logo=amazon-aws&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" />
</div>

| 기술 | 용도 및 역할 |
| :--- | :--- |
| **NestJS / TypeScript** | 모듈화된 백엔드 서버 |
| **PostgreSQL (pgvector)** | 아티클 영구 저장, 1536차원 벡터 저장 |
| **Redis & BullMQ** | 비동기 작업 큐, 분산 락, 검색/임베딩 결과 캐싱 |
| **AWS Lightsail / Nginx / Docker** | 호스팅, 리버스 프록시, 컨테이너 배포 |
| **GitHub Actions** | CI/CD 자동화 |

---

## ✅ 성능 검증 결과 (k6 부하 테스트)

> 자세한 시나리오와 디테일한 내용은 **[부하 테스트 전체 리포트](./LOAD_TEST_RESULT.md)** 참고

| 검증 항목 | 결과 |
|---|---|
| Cache Stampede 방지 | 동일 키워드 50명 동시 요청에도 외부 임베딩 API **1회만 호출**, 실패율 0% |
| 동시성 제어 (Semaphore) | 20건 동시 캐시 MISS 상황에서 외부 API 호출 3개로 제한, 실패율 0% |
| Rate Limit | IP당 10초 5회 정책이 설계값과 정확히 일치 (100건 중 5건 통과 / 95건 429 차단) |
| 하이브리드 검색 성능 (순수 DB) | p95 **125.8ms**, p99 **160.4ms**, 최대 **313 TPS**, 실패율 0% |
| AI 장애 복원력 | 외부 임베딩 API 완전 장애 상황에서도 FTS로 자동 폴백, **가용성 100%** 유지 |

---

## ✨ 핵심 기능

- **🤖 AI 기반 아티클 가치 평가 및 자동 요약**
  - Dev.to, GeekNews 등의 기술 아티클을 수집한 후 LLM 기반 가치 평가 수행
  - 3줄 핵심 요약, 상세 요약, 기술 태그 자동 추출
  - 1536차원 벡터 임베딩 생성 및 PostgreSQL 저장

- **🔍 RRF 하이브리드 검색**
  - PostgreSQL의 Full-Text Search(키워드)와 pgvector(시맨틱) 검색을 융합
  - 키워드 매칭의 정확도와 문맥 이해도를 동시에 반영하는 RRF 랭킹 알고리즘 구현

- **🔗 코사인 유사도 기반 연관 아티클 추천**
  - 아티클 간 벡터 거리 계산을 통해 유사도 높은 연관 콘텐츠 추천

- **⚡ BullMQ 기반 비동기 파이프라인 및 중복 제어**
  - 비동기 작업 큐 구조를 도입하여 외부 AI API 제한 및 서버 타임아웃 차단
  - Redis 분산 락을 적용하여 동시 수집 요청 시 중복 작업 완전 차단

- **📊 실시간 큐 모니터링 및 웹훅 알림**
  - Bull-Board 대시보드를 활용해 수집·처리 작업 상태 실시간 추적
  - Discord 웹훅 연동으로 파이프라인 수행 결과 및 에러 알림 자동 수신

---

## ⚡ 핵심 트러블슈팅

<details>
<summary><b>1. 검색 레이턴시 ~500ms → ~50ms (90% 단축)</b></summary>

검색 시마다 임베딩 API를 동기 호출해 레이턴시와 토큰 비용이 높았음 → 검색어 정규화 + Redis 벡터 캐싱 도입 → 레이턴시 98% 단축, 토큰 비용 100% 절감.
</details>

<details>
<summary><b>2. Cache Stampede 방지</b></summary>

동일 키워드에 대한 동시 요청이 몰리면 외부 API가 N번 중복 호출될 위험 → Redis 분산 락(SET NX) + Polling 대기 도입 → 50건 동시 요청에도 API 호출 1회로 제한
</details>

<details>
<summary><b>3. 외부 AI API 장애 시 서비스 마비 위험</b></summary>

AI API 장애 시 검색 기능 전체 마비 위험 → 일시적 장애에 대해서 지수 백오프 재시도를 적용 -> 최종 실패 시 PostgreSQL FTS로 자동 전환하는 폴백 구조 설계 → 장애 상황에서도 가용성 100% 유지
</details>

<details>
<summary><b>4. 수집/요약 파이프라인 HTTP 타임아웃 및 작업 유실</b></summary>

메모리 기반 동기 처리로 장시간 실행될 경우 HTTP 타임아웃 및 작업 내용 유실 문제 발생 ➔ **BullMQ 비동기 큐** 도입으로 즉시 응답(~50ms) 반환 ➔ **타임아웃 전면 해결 및 에러 or 서버 재시작 시 자동 작업 재개**
</details>

<details>
<summary><b>5. 수집/요약 파이프라인 내 외부 API 효율성 및 장애 격리</b></summary>

개별 처리의 API 비효율과 일괄 처리의 단일 장애 유실 위험 ➔ **[개별 수집/요약 ↔ 배치 필터/임베딩] 혼합 구조** 도입 ➔ **API 호출·토큰 비용 최적화 및 개별 오류 스킵·배치 재시도로 장애 격리 완벽 구현**
</details>
---

## 🏗️ 서비스 아키텍처

<img width="100%" alt="Image" src="https://github.com/user-attachments/assets/b0cb5c14-6a4b-447b-868f-ec48180f84ae" />

## 🔄 수집/요약 파이프라인 흐름

<img width="534" height="1728" alt="Image" src="https://github.com/user-attachments/assets/008f8767-15a9-46a5-8bb4-9b2a8fe6c61e" />

---

## 📖 API 명세서

| 엔드포인트 | 메서드 | 핵심 기능 |
| :--- | :---: | :--- |
| `/api/trends` | `GET` | 트렌드 아티클 목록 조회 (페이지네이션, 필터, 정렬) |
| `/api/trends/search` | `GET` | RRF 하이브리드 검색 수행 |
| `/api/trends/sources` | `GET` | 수집된 고유 출처 목록 조회 |
| `/api/trends/:id` | `GET` | 단일 아티클 상세 정보 및 AI 요약 조회 |
| `/api/trends/:id/related` | `GET` | 벡터 코사인 거리 기반 연관 아티클 추천 |
| `/admin/queues` | `GET` | Bull-Board 기반 비동기 큐 실시간 모니터링 |

---

## 🗄️ DB 스키마

### 테이블명: `tbl_tech_trends`

| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| **id** (PK) | `bigint` | 기본 키 (자동 증가) |
| **source** | `varchar(50)` | 수집 출처 (예: dev.to, geeknews) |
| **source_id** | `varchar(100)` | 출처별 고유 아이디 |
| **title** | `varchar(255)` | 아티클 제목 |
| **short_summary** | `jsonb` | AI 3줄 핵심 요약 (문자열 배열) |
| **long_summary** | `text` | AI 상세 요약 본문 (선택) |
| **link_url** | `varchar(512)` | 원본 아티클 링크 (유니크) |
| **technical_tags** | `varchar(255)` | AI 추출 기술 태그 (선택) |
| **view_count** | `integer` | 조회수 (선택) |
| **like_count** | `integer` | 좋아요 수 (선택) |
| **comment_count** | `integer` | 댓글 수 (선택) |
| **embedding** | `vector(1536)` | Gemini 생성 1536차원 벡터 (선택) |
| **search_document** | `tsvector` | Full-Text Search 전용 인덱스 컬럼 |
| **created_at** | `date` | 원본 아티클 작성일 |
| **mined_at** | `timestamp` | 시스템 수집 일시 (자동 생성) |

### 적용된 인덱스 및 제약 조건

* **유니크 제약 조건 (Unique):** `UQ_source_source_id` (`source`, `source_id`), `link_url`
* **벡터 인덱스 (Vector Index):** `IDX_tech_trends_embedding` (`embedding` USING `hnsw`)
* **전문 검색 인덱스 (Full-Text Index):** `IDX_tech_trends_fts` (`search_document` USING `gin`)
* **복합 인덱스 (Composite Index):** `IDX_source_created_at` (`source`, `created_at`)
* **단일 인덱스 (Single Index):** `IDX_created_at` (`created_at`), `IDX_mined_at` (`mined_at`)

---

## 💭 회고

#### 📌 하이브리드 검색 채택 이유
- **처리량(TPS)보다 검색 정확도와 사용자 경험(UX)을 우선시했습니다.**
- 순수 FTS(621 req/s) 대비 처리량은 절반(313 req/s)으로 단축되지만, 오타·동의어 매칭 및 문맥 기반 탐색이 핵심인 테크 아티클 서비스 특성을 고려해 하이브리드 검색을 채택했습니다.

#### 📌 Semaphore(3) 동시성 제어 근거
- **외부 API 429 에러 0%와 사용자 대기 지연 최적화 사이의 트레이드오프입니다.**
- Gemini 무료 한도(100 RPM) 환경에서 동시성을 1로 낮추면 순차 대기 지연으로 UX가 저하되고, 5 이상은 429 에러 위험이 급증합니다. 이에 대기 지연(p95 3.35s)을 최적으로 제어하는 `Semaphore(3)`을 안티패턴 방지용 안전장치로 선택했습니다.

#### 📌 가장 어려웠던 의사결정
- **수집/요약 파이프라인 재시도 시 복잡한 단계별 체크포인트 테이블 구축 vs 단순한 내결함성 구조 도입**
- 일일 수집량(블로그 당 약 5~10건) 대비 과도한 체크포인트 테이블 설계는 오버엔지니어링이라 판단했습니다. 이에 **BullMQ 재시도 + 당일 저장량 계산 + UNIQUE 제약** 조합을 통해 데이터 정합성을 보장하면서 운영 복잡도를 최적화했습니다.

#### 📌 향후 개선 과제
- **가변 세마포어 & 서킷 브레이커**: Gemini API 상태(Latency, 429 비율)에 따라 동시성 한도를 실시간으로 동적 조절하는 로직 구축
- **동적 캐시 TTL**: 검색어 유입 빈도에 따라 인기 키워드의 TTL을 다르게 가져가는 전략 적용

---

## 🚀 실행 방법

본 프로젝트는 Docker 환경에서 가장 쉽고 빠르게 실행할 수 있습니다.

### 1. 실행 명령어

```bash
git clone https://github.com/dohun03/tech-trends.git
cd tech-trends
docker-compose up -d --build

```

### 2. 환경 변수 설정 (.env 파일 생성)

```
# Server (운영: production, 개발: development)
PORT=3000
NODE_ENV=development

# DB 정보
DB_HOST=
DB_PORT=
DB_USERNAME=
DB_PASSWORD=
DB_DATABASE=

# REDIS 정보
REDIS_HOST=
REDIS_PORT=
REDIS_PASSWORD=

# CORS 허용할 주소 (쉼표로 구분)
CORS_ORIGIN=

# 검색 API Rate Limit (IP당 요청 제한, 부하테스트 시 SEARCH_THROTTLE_LIMIT 를 크게 올려 사용)
SEARCH_THROTTLE_LIMIT=5
SEARCH_THROTTLE_TTL=10000

# 벡터 관련 상수 값
SEARCH_CANDIDATE_LIMIT=50
VECTOR_DISTANCE_THRESHOLD=0.30
RELATED_DISTANCE_THRESHOLD=0.45

# 수집 파이프라인
SCRAPER_TARGET_SAVE_COUNT=5
SCRAPER_BATCH_SIZE=10
SCRAPER_REDIS_LOCK_TTL_MS=600000
SCRAPER_AI_DELAY_SECONDS=3
SCRAPER_TEXT_SNIPPET_LENGTH=600
SCRAPER_TEXT_CONTENT_LENGTH=5000

# 스케쥴러 주기 설정 (분 시 일 월 요일)
CRON_SCHEDULE="0 2 * * *"

# 임베딩 TTL 값 (30일)
EMBEDDING_TTL_SECONDS=2592000

# GEMINI 임베딩 모델명
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
# GEMINI API 키
GEMINI_API_KEY=

# GROQ 모델명
GROQ_MODEL=qwen/qwen3.6-27b
# GROQ 최대 출력 토큰 수 (OTPM=1000 대응)
GROQ_MAX_COMPLETION_TOKENS=1000
# GROQ API 키
GROQ_API_KEY=

#DISCORD 알림 URL (운영: 서버 IP or 도메인, 개발: http://localhost)
CLIENT_URL=http://localhost

#DISCORD 웹훅 URL
DISCORD_ADMIN_WEBHOOK_URL=
DISCORD_USER_WEBHOOK_URL=

```