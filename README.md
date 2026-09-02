# 🚀 [Tech Trends Backend] 매일 새로운 IT/테크 아티클을 스크래핑하고, AI가 핵심만 요약해 드립니다.

## 📋 프로젝트 개요

**Tech Trends Backend**는 매일 새로운 IT/테크 아티클을 스크래핑하고, AI가 핵심만 요약해서 제공하는 서비스입니다.

Dev.to, GeekNews, StackOverflow 등 여러 기술 커뮤니티의 아티클을 주기적으로 자동 수집하며, **LLM**을 활용해 기술적 가치 평가, 요약, 벡터 임베딩을 수행합니다.

PostgreSQL의 Full-Text Search(키워드)와 pgvector(시맨틱)를 결합한 **RRF(Reciprocal Rank Fusion) 하이브리드 검색**을 통해 검색 품질을 대폭 향상시켰으며, **BullMQ + Redis 비동기 큐**를 구축하여 외부 API의 Rate Limit을 안정적으로 관리하고 시스템 처리 가용성을 극대화했습니다.

* **진행 기간**: 2026.07 ~ 2026.08
* **참여 인원**: 1명 (개인 프로젝트)

---

## 🛠️ 기술 스택

### Language & Framework
<div align="left">
  <img src="https://img.shields.io/badge/NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
</div>

### Data & Messaging
<div align="left">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white"/>
  <img src="https://img.shields.io/badge/pgvector-336791?style=flat-square&logo=postgresql&logoColor=white"/>
  <img src="https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/BullMQ-FF4500?style=flat-square&logo=redis&logoColor=white" />
</div>

### Infra & DevOps
<div align="left">
  <img src="https://img.shields.io/badge/AWS_Lightsail-FF9900?style=flat-square&logo=amazon-aws&logoColor=white" />
  <img src="https://img.shields.io/badge/Nginx-009639?style=flat-square&logo=nginx&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/GitHub_Actions-2088FF?style=flat-square&logo=github-actions&logoColor=white"/>
</div>

### 세부 기술 스택 상세 (Tech Stack Details)

| 기술 | 용도 및 역할 |
| :--- | :--- |
| **NestJS / TypeScript** | 모듈화된 백엔드 서버 |
| **PostgreSQL (pgvector)** | 아티클 영구 저장, 1536차원 벡터 저장 |
| **Redis & BullMQ** | 비동기 작업 큐 파이프라인 관리, 분산 락, 검색어&임베딩 결과 캐싱 |
| **AWS Lightsail** | 클라우드 가상 서버 호스팅 및 서비스 인프라 운영 |
| **Nginx** | 리버스 프록시 설정 |
| **Docker** | 컨테이너 환경 구성 및 배포 편의성 확보 |
| **GitHub Actions** | CI/CD 자동화 파이프라인 구축 |

---

## ✨ 핵심 기능

- **🤖 AI 기반 아티클 가치 평가 및 자동 요약**
  - Dev.to, GeekNews 등의 기술 아티클을 수집한 후 LLM 기반 가치 평가 수행
  - 3줄 핵심 요약, 상세 요약, 기술 태그 자동 추출
  - 1536차원 벡터 임베딩 생성 및 PostgreSQL 저장

- **🔍 RRF 하이브리드 검색**
  - PostgreSQL 키워드 검색과 pgvector 시맨틱 벡터 검색을 융합
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

## ⚡ 성능 개선 및 트러블슈팅

<details>
<summary><b>🔥 이슈 #1: BullMQ 비동기 큐 도입 및 수집 파이프라인 내결함성 확보</b></summary>

- **① [비동기 전환 및 작업 영속성] HTTP 타임아웃 방지 및 작업 보존**
  - **문제**: 메모리 기반 동기 처리 방식 사용 시, 장시간 실행되는 파이프라인 작업에서 HTTP 타임아웃이 발생하거나 서버 재시작 시 진행 중이던 요청이 유실되는 현상 발생
  - **해결**: BullMQ 비동기 큐 구조로 전환하여 즉시 응답(50ms 이내)을 반환하고, Redis 영속성에 Job 상태를 저장하여 프로세스 재시작 시 잔여 작업이 자동 재시도되도록 구현.
  - **성과**: HTTP 타임아웃 전면 해결 및 서버 재시작 시 작업 유실 방지

- **② [격리 및 동시성 제어] 독립 큐 분리 및 Redis 분산 락 적용**
  - **문제**: 특정 수집처의 장애가 전체 작업 큐로 전파되거나, 동일한 스크래핑 작업이 중복 요청되어 서버에 과부하가 발생하는 현상
  - **해결**: 수집처별로 독립된 큐를 구성해 장애 영역을 격리하고, Redis 분산 락을 적용하여 동일 수집 작업의 중복 요청을 원천 차단
  - **성과**: 특정 수집처 오류 발생 시에도 전체 파이프라인 정상 가동 및 중복 수집 작업 완전 제어

- **③ [API 한도 및 예외 격리] 에러 코드별 분기 처리 및 개별 예외 격리**
  - **문제**: AI API 요청 제한 초과 에러 발생 문제 및 배치 처리 중 1건의 오류로 인해 전체 수집 작업이 취소되는 현상
  - **해결**: AI API 호출에 지수 백오프 및 요청 간격을 적용하고, 에러 코드별(재시도 가능 여부) 분기 처리를 구현. 배치 루프 내 개별 예외 처리를 추가하여 실패한 항목만 스킵하고 작업을 계속 진행하도록 구현
  - **성과**: API 요청 한도 초과 에러 방지 및 일부 항목 실패 시에도 유효 데이터 정상 저장 완료
</details>

<details>
<summary><b>🔥 이슈 #2: 외부 AI 임베딩 API 검색 성능 개선 및 문제 해결</b></summary>

- **① [검색 품질] RRF 하이브리드 검색 도입**
  - **문제**: 단일 키워드 검색은 동의어/오타에 취약하고, 단일 벡터 검색은 전문 기술명 매칭 정확도가 떨어지는 문제 발생
  - **해결**: PostgreSQL 전문 검색 점수와 pgvector 코사인 유사도 순위를 융합하는 RRF(Reciprocal Rank Fusion) 알고리즘 구현
  - **성과**: 키워드 정확도와 AI의 문맥 이해도를 모두 확보하여 검색 연관성 대폭 향상

- **② [조회 속도] GIN / HNSW 전용 인덱스 적용**
  - **문제**: 데이터 누적 시 Full-Text Search 및 1536차원 고차원 벡터 연산으로 인한 DB 조회 성능 저하 예상
  - **해결**: 키워드 검색 전용 `tsvector` 컬럼에 GIN 인덱스, 1536차원 벡터 컬럼에 HNSW 인덱스를 각각 적용
  - **성과**: 데이터 증가 환경에서도 안정적인 검색 속도를 유지할 수 있도록 조회 성능 최적화

- **② [속도/비용] Redis 벡터 캐싱 및 검색어 정규화**
  - **문제**: 검색 요청 시마다 외부 임베딩 API를 동기 호출하여 높은 레이턴시(~500ms) 및 불필요한 토큰 비용 지속 발생.
  - **해결**: 불용어 정제 로직(`normalizeKeyword`)으로 검색어를 정규화하여 캐시 히트율을 높이고, 정규화된 키워드의 벡터 값을 Redis에 캐싱.
  - **성과**: 최초 호출 ~500ms ➔ Redis 캐시 조회 ~10ms (**약 98% 성능 향상**) 및 동일 키워드 재검색 시 **토큰 소모량 100% 절감**.

- **③ [동일 키워드] 순간 동시 요청 시 Cache Stampede 방지**
  - **문제**: 동일한 키워드로 순간 동시 요청이 폭주할 경우, 캐시 생성 전 여러 요청이 중복으로 외부 API를 호출해 Rate Limit 초과 및 과부하 발생.
  - **해결**: Redis 분산 락을 선점한 1건만 API를 호출하고, 후속 요청은 Polling(`waitForCache`)으로 대기 후 생성된 캐시를 공유하도록 구현.
  - **성과**: 동일 키워드 50건 동시 요청 부하 테스트 시 **단 1회만 API 호출** 처리 확인.

- **④ [다중 트래픽] 서로 다른 키워드 폭주 및 도배 요청 차단**
  - **문제**: 서로 다른 키워드의 검색 요청이 한꺼번에 몰리거나 무분별한 연속 검색 요청 시 AI API 제한 초과 및 서버 마비 위험.
  - **해결**: `Semaphore(3)`를 적용해 임베딩 API 동시 실행을 최대 3개로 제한(이후 요청은 순차 대기)하고, NestJS Throttler(10초 내 5회)로 연속 요청 차단.
  - **성과**: 외부 API 호출 한도 초과 방지 및 다중 동시 요청 환경에서 서버 인프라 안정성 확보.

- **⑤ [가용성] 외부 AI API 장애 대비 자동 폴백(Fallback) 구축**
  - **문제**: 외부 AI API 서비스 장애 발생 시 검색 기능 전체가 마비되는 위험 존재.
  - **해결**: API 호출 최종 실패 시 전체 검색이 중단되지 않고 Full-Text Search(키워드 검색)로 자동 전환되는 폴백 로직 구현.
  - **성과**: 외부 API 장애 상황에서도 서비스 중단 없이 키워드 검색으로 정상 응답을 유지하는 고가용성 확보.
</details>

---

## 🏗️ 서비스 아키텍처

<img width="100%" alt="Image" src="https://github.com/user-attachments/assets/b0cb5c14-6a4b-447b-868f-ec48180f84ae" />

## 🔄 수집/요약 파이프라인 흐름

백그라운드 수집부터 AI 요약, 벡터 임베딩, 저장까지의 데이터 처리 흐름입니다.

<img width="534" height="1728" alt="Image" src="https://github.com/user-attachments/assets/008f8767-15a9-46a5-8bb4-9b2a8fe6c61e" />

---

## 📖 API 명세서

본 프로젝트는 RESTful API 표준을 준수하여 작성되었습니다.

| 엔드포인트 (Endpoint) | 메서드 | 핵심 기능 (Core Logic) |
| :--- | :---: | :--- |
| **📰 /api/trends** | `GET` | 트렌드 아티클 목록 조회 (페이지네이션, 필터, 정렬) |
| **🔍 /api/trends/search** | `GET` | RRF 하이브리드 검색 수행 |
| **🌐 /api/trends/sources** | `GET` | 수집된 고유 출처(플랫폼) 목록 조회 |
| **📄 /api/trends/:id** | `GET` | 단일 아티클 상세 정보 및 AI 요약 본문 조회 |
| **🔗 /api/trends/:id/related** | `GET` | 벡터 코사인 거리 기반 연관 아티클 추천 목록 조회 |
| **📊 /admin/queues** | `GET` | Bull-Board 대시보드 기반 비동기 큐 실시간 모니터링 |

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

## 🚀 실행 방법

본 프로젝트는 Docker 환경에서 가장 쉽고 빠르게 실행할 수 있습니다.

### 1. 실행 명령어

```
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

# CORS 허용할 주소(쉼표로 구분)
CORS_ORIGIN=

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
# GROQ API 키
GROQ_API_KEY=

#DISCORD 알림 URL (운영: 서버 IP or 도메인, 개발: http://localhost)
CLIENT_URL=

#DISCORD 웹훅 URL
DISCORD_ADMIN_WEBHOOK_URL=
DISCORD_USER_WEBHOOK_URL=

```