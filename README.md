# 🚀 Tech Trends

> 매일 새로운 IT/테크 아티클을 수집하고 AI가 핵심만 요약해주는 개인 프로젝트

---

## 📋 프로젝트 개요

* **진행 기간**: 2026.07 ~ 2026.09
* **참여 인원**: 1명 (개인 프로젝트)
* **접속 URL**: [https://techtrends.devsystem.fyi](https://techtrends.devsystem.fyi)

---

## ✨ 핵심 기능

- **🤖 AI 기반 아티클 가치 평가 및 자동 요약**: LLM으로 가치 평가 후 3줄 요약, 상세 요약, 기술 태그 자동 추출 + 1536차원 벡터 임베딩 생성
- **🔍 RRF 하이브리드 검색**: PostgreSQL FTS(키워드)와 pgvector(시맨틱) 검색을 RRF로 융합
- **🔗 연관 아티클 추천**: 벡터 코사인 거리 기반 유사 콘텐츠 추천
- **⚡ BullMQ 기반 비동기 파이프라인**: 외부 AI API 제한/타임아웃 방지, Redis 분산 락으로 중복 수집 차단
- **📊 실시간 모니터링**: Bull-Board 대시보드 + Discord 웹훅 알림

---

## ⚡ 핵심 트러블슈팅 및 성과 (부하테스트 기반)
<details>
<summary><b>1. [처리량 3.4배 개선] 복합 인덱스 + 캐싱으로 RPS 422→1,447, p95 지연 63% 단축</b></summary>

- **문제**: 데이터가 5만 건으로 늘어나며 정렬 쿼리가 Seq Scan으로 빠져 목록 조회 지연 및 DB I/O 부하 발생.
- **해결**: 복합 인덱스 3종 생성 + `COUNT(*)` 집계 분리·Redis 캐싱 + Request Coalescing 적용.
- **성과**: RPS 3.4배(422→1,447 req/s), 목록 조회 p95 63% 단축(250ms→92ms).
</details>

<details>
<summary><b>2. [장애 근본원인 규명] 이벤트루프 71초 스톨의 진짜 원인 추적 및 해결</b></summary>

- **문제**: 부하 테스트 중 다량의 유니크 IP가 유입될 때 Node.js 이벤트루프가 최대 71초간 멈추는 현상 발생. 처음엔 DB/메모리 문제로 의심.
- **원인 추적**: 로그 분석 결과, 원인은 DB가 아니라 `@nestjs/throttler`의 기본 in-memory 저장소가 IP별 타이머를 대량 생성한 것이었음. 실제 IP 로테이션 공격과 유사한 패턴이라 잠재적 DoS 취약점으로 해석.
- **해결**: Rate Limiter 저장소를 Redis 기반으로 교체 + fail-open 폴백 적용.
- **성과**: 이벤트루프 스톨 211회→0회 완전 해결, Redis 장애 시에도 5xx/timeout 0건.
</details>

<details>
<summary><b>3. [AI 장애 복원력] 1차 테스트에서 발견한 5초 지연 원인 분석 및 Early Exit 개선</b></summary>

- **문제**: 외부 AI API(Gemini) 장애 시 FTS로 자동 전환되긴 했으나, 1차 테스트에서 p95 응답 지연이 5.17초로 급증하는 것을 발견.
- **원인 추적**: 락 보유자(선점 요청)가 장애로 실패해도, 대기 요청들이 최대 5초(25회×200ms) 폴링을 다 채운 뒤에야 폴백하는 구조였음.
- **해결**: 폴링 중 락 해제 여부를 추가 검증해 "락 해제 + 캐시 미생성" 감지 시 즉시 폴백하는 Early Exit 로직 도입.
- **성과**: 가용성 100% 유지하며 장애 시 지연 5.17s→511.7ms (약 10배 단축).
</details>

<details>
<summary><b>4. [외부 API 호출 최적화] Cache Stampede 방지 및 Semaphore(3) 동시성 제어</b></summary>

- **문제**: 동시 요청 폭주 시 외부 AI API 중복 호출로 인한 토큰 비용 폭증 및 Rate Limit(429) 에러 발생 위험.
- **해결**: Redis 분산 락(SET NX) + Polling 대기 구조로 Cache Stampede 차단 및 `Semaphore(3)` 기반 동시 호출 제어.
- **성과**: 50건 동시 요청 시 **외부 API 호출 정확히 1회로 제한**, 20건 동시 캐시 Miss 상황에서도 **429/5xx 에러 0건** 달성.
</details>

<details>
<summary><b>5. [파이프라인 내결함성] BullMQ 기반 비동기 큐 전환 및 장애 격리</b></summary>

- **문제**: 수집/요약 파이프라인의 동기 처리로 인한 HTTP 타임아웃 및 작업 유실 발생.
- **해결**: BullMQ 기반 비동기 큐 도입(즉시 응답 ~50ms) + 개별 수집/요약 ↔ 배치 필터/임베딩 혼합 파이프라인 설계.
- **성과**: HTTP 타임아웃 차단, 개별 오류 스킵 및 자동 재시도(Retry)를 통한 완벽한 장애 격리 및 서버 재시작 시 자동 작업 재개.
</details>

> 그 외 세부 내용은 아래 보고서에서 확인하실 수 있습니다.
> - [검색 API 부하 테스트 보고서](./SEARCH_LOAD_TEST_RESULT.md)
> - [목록/상세/연관 API 부하 테스트 보고서](./LIST_LOAD_TEST_RESULT.md)

---

## 🏗️ 서비스 아키텍처

<img width="100%" alt="Image" src="https://github.com/user-attachments/assets/64d96543-0c20-46af-b005-5f7ef123430b" />


<details>
<summary><b>1. 인스턴스를 물리적으로 2개(Front / Back)로 분리한 이유</b></summary>

OOM으로 인한 웹 서비스 중단을 막고 VPC 내부 격리로 DB 보안성과 시스템 가용성을 극대화하기 위함.

</summary>
</details>

<details>
<summary><b>2. 스케일업 대신 물리적 분리를 선택한 이유</b></summary>

단일 서버 장애가 전체 서비스로 전이되는 것을 방지하고 향후 영역별 독립적 확장이 가능한 구조를 만들기 위함.

</summary>
</details>

<details>
<summary><b>3. Redis 이중화 (Cache vs Queue)</b></summary>

메모리 방출 정책이 다른 웹 캐시와 작업 큐를 분리하여 데이터 유실 없는 안정적인 백그라운드 처리를 보장하기 위함.

</summary>
</details>

## 🔄 수집/요약 파이프라인 흐름

<details>
<summary><b>이미지 보기</b></summary>
<img width="534" height="1728" alt="Image" src="https://github.com/user-attachments/assets/008f8767-15a9-46a5-8bb4-9b2a8fe6c61e" />
</summary>
</details>

---

## 🛠️ 기술 스택

### BE
<img src="https://img.shields.io/badge/NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white" /> <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" /> <img src="https://img.shields.io/badge/BullMQ-FF4500?style=flat-square&logo=redis&logoColor=white" />

### DB
<img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white"/> <img src="https://img.shields.io/badge/pgvector-336791?style=flat-square&logo=postgresql&logoColor=white"/> <img src="https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white" />

### Dev-Ops
<img src="https://img.shields.io/badge/AWS_Lightsail-FF9900?style=flat-square&logo=amazon-aws&logoColor=white" /> <img src="https://img.shields.io/badge/Amazon_S3-569A31?style=flat-square&logo=amazons3&logoColor=white" /> <img src="https://img.shields.io/badge/Nginx-009639?style=flat-square&logo=nginx&logoColor=white" /> <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" /> <img src="https://img.shields.io/badge/GitHub_Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white" />

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
