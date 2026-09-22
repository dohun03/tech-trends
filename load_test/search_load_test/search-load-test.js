// =============================================================================
// Tech-Trends 검색 API 부하 테스트 스크립트 (k6)
// -----------------------------------------------------------------------------
// 대상 엔드포인트 : GET /api/trends/search  (NestJS + PostgreSQL FTS/pgvector RRF 하이브리드 검색)
// 검증 대상 로직   : Redis 임베딩 캐시 / 분산락 / Polling (Cache Stampede 방지)
//                    Semaphore(3) 외부 API 동시성 제어 / Throttle(Rate Limit) / FTS 폴백
//
// 실행 방법 (시나리오 선택은 __ENV.SCENARIO):
//   SCENARIO=A  : Cache Stampede 검증           (동일 키워드 50 VU 동시)
//   SCENARIO=B  : 동시성 제어(Semaphore) 검증   (서로 다른 키워드 20 VU, IP 분산)
//   SCENARIO=B2 : Rate Limit 검증               (동일 IP 로 Throttle 차단 확인)
//   SCENARIO=C1 : 하이브리드 Cold 종단 latency  (유니크 키워드 30건, 캐시 초기화 후 단발성)
//   SCENARIO=C2 : 하이브리드 검색 순수 DB 성능   (캐시 warm-up 후 Ramp 1->50)
//   SCENARIO=D  : AI 장애 시 FTS 폴백 검증      (Gemini API 키 훼손 후 소규모 실행)
//   SCENARIO=E  : keyword-only(FTS) 베이스라인  (Ramp 1->50)
//
// 예시:
//   k6 run -e SCENARIO=A -e BASE_URL=http://localhost/api/trends/search \
//     load_test/search-load-test.js
// =============================================================================

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// -----------------------------------------------------------------------------
// 1) 커스텀 메트릭 정의
// -----------------------------------------------------------------------------
// search_latency : 시나리오별 응답 지연(ms) -> summary 에 p(90)/p(95)/p(99) 모두 노출됨
const searchLatency = new Trend('search_latency', true);
const non2xx = new Counter('non_2xx'); // 2xx 가 아닌 응답 (429/5xx 외 기타)
const http429 = new Counter('http_429'); // Rate Limit 차단(429) 건수
const http5xx = new Counter('http_5xx'); // 서버 오류(5xx) 건수
const http200 = new Counter('http_200'); // 정상(200) 건수

// -----------------------------------------------------------------------------
// 2) 설정 상수
// -----------------------------------------------------------------------------
const SCENARIO = __ENV.SCENARIO || 'A';
const BASE_URL = (__ENV.BASE_URL || 'http://localhost/api/trends/search').replace(/\/+$/, '');

// 테스트 키워드 풀 (실 Gemini API 쿼터 소진 방지를 위해 고정 목록 사용.
// 필요 시 실제 DB 에 존재하는 키워드로 교체/보강할 것)
const KEYWORDS = [
  'AI',
  '인프라',
  'Kubernetes',
  '프로덕션',
  'React',
  'Docker',
  'TypeScript',
  'Python',
  'Machine Learning',
  'PostgreSQL',
  'Redis',
  'Node.js',
  'LLM',
  'RAG',
  'Microservices',
  'GraphQL',
  'NestJS',
  'DevOps',
  'Cloud',
  'Rust',
  'Vector Database',
  'LangChain',
];

// C1(Cold 종단 latency) 전용 유니크 키워드 풀.
// 캐시에 절대 존재하지 않는 고유 키워드 30개로, 모든 요청이 캐시 MISS를 보장하여
// "외부 임베딩 API 호출 + DB 조회"의 실제 Cold 지연을 왜곡 없이 측정한다.
const COLD_KEYWORDS = [
  'cold_probe_001',
  'cold_probe_002',
  'cold_probe_003',
  'cold_probe_004',
  'cold_probe_005',
  'cold_probe_006',
  'cold_probe_007',
  'cold_probe_008',
  'cold_probe_009',
  'cold_probe_010',
  'cold_probe_011',
  'cold_probe_012',
  'cold_probe_013',
  'cold_probe_014',
  'cold_probe_015',
  'cold_probe_016',
  'cold_probe_017',
  'cold_probe_018',
  'cold_probe_019',
  'cold_probe_020',
  'cold_probe_021',
  'cold_probe_022',
  'cold_probe_023',
  'cold_probe_024',
  'cold_probe_025',
  'cold_probe_026',
  'cold_probe_027',
  'cold_probe_028',
  'cold_probe_029',
  'cold_probe_030',
];

// 성능 측정(C/E) 공통 램핑 스테이지 (Ramping VUs 1 -> 50)
const RAMP_STAGES = [
  { duration: '30s', target: 1 },
  { duration: '30s', target: 5 },
  { duration: '30s', target: 10 },
  { duration: '30s', target: 25 },
  { duration: '1m', target: 50 },
  { duration: '30s', target: 0 },
];

// -----------------------------------------------------------------------------
// 3) 공통 유틸
// -----------------------------------------------------------------------------

// VU 별로 서로 다른 클라이언트 IP 를 만들어 Throttle(10초 5회) 충돌을 회피.
// nginx($proxy_add_x_forwarded_for)가 뒤에 실제 k6 IP 를 append 하고,
// 백엔드는 trust proxy=1 이므로 이 값이 클라이언트 IP 로 인식된다.
function buildForwardedFor(vuId) {
  const a = Math.floor(vuId / 250) + 1; // 10.x.y.z 의 x
  const b = (vuId % 250) + 1; // y
  const c = ((vuId * 7) % 250) + 1; // z (분산도 향상)
  return `10.${a}.${b}.${c}`;
}

// USE_XFF=false 인 경우(예: B2 Rate Limit 검증) 헤더를 생략해 모든 VU 가 동일 IP 로 취급되게 함.
function buildHeaders(vuId) {
  const headers = { Accept: 'application/json' };
  if (__ENV.USE_XFF !== 'false') {
    headers['X-Forwarded-For'] = buildForwardedFor(vuId);
  }
  return headers;
}

// 검색 쿼리스트링을 조립한다.
function buildSearchUrl(search, opts = {}) {
  const p = Object.assign(
    {
      searchType: 'hybrid',
      source: 'ALL',
      isNew: 'false',
      page: '1',
      limit: '5',
      sort: 'RELEVANCE',
    },
    opts,
  );
  const qs =
    `search=${encodeURIComponent(search)}` +
    `&searchType=${p.searchType}` +
    `&source=${p.source}` +
    `&isNew=${p.isNew}` +
    `&page=${p.page}` +
    `&limit=${p.limit}` +
    `&sort=${p.sort}`;
  return `${BASE_URL}?${qs}`;
}

// 요청 1회를 수행하고 응답 상태를 계수/기록한다. (공통)
function doSearch(url, vuId) {
  const res = http.get(url, {
    headers: buildHeaders(vuId),
    tags: { scenario: SCENARIO },
  });

  searchLatency.add(res.timings.duration);

  if (res.status === 200) {
    http200.add(1);
  } else if (res.status === 429) {
    http429.add(1);
  } else if (res.status >= 500) {
    http5xx.add(1);
  } else {
    non2xx.add(1);
  }

  // 5xx(서버 내부 오류)가 없으면 통과로 간주. 429 는 B2 에서 정상 신호이므로
  // check 로 실패 처리하지 않고 별도 Counter 로만 기록한다.
  check(res, { 'no 5xx server error': (r) => r.status < 500 });
}

// 키워드 풀에서 랜덤 1개 선택 (C/E 시나리오용)
function randomKeyword() {
  return KEYWORDS[Math.floor(Math.random() * KEYWORDS.length)];
}

// -----------------------------------------------------------------------------
// 4) 각 시나리오 exec 함수 (이름은 scenarios.exec 에 문자열로 참조됨)
// -----------------------------------------------------------------------------

// A: Cache Stampede 검증 — 동일 키워드 50 VU 동시 요청
// [사전 체크리스트]
//   1) 실행 전 `docker exec tech-trends-redis redis-cli --scan --pattern "emb:*" | xargs ... DEL {}` 로 캐시 비우기
//   2) 실행 후 서버 로그에서 `[Embedding Cache MISS]` = 정확히 1회 인지 확인 (외부 API 1회 호출 증거)
//      - `[Embedding Lock Waiting]` 다수 + `[Embedding Lock Resolved]` 나머지 건수 = 캐시 공유 정상
export function scenarioA() {
  doSearch(buildSearchUrl('AI', { searchType: 'hybrid' }), __VU);
  // 동시성 극대화를 위해 sleep 없음
}

// B: 동시성 제어(Semaphore) 검증 — 서로 다른 키워드 20 VU
export function scenarioB() {
  // 각 VU 가 담당할 고정 키워드 (VU 번호 기준, 풀 순환)
  const kw = KEYWORDS[(__VU - 1) % KEYWORDS.length];
  doSearch(buildSearchUrl(kw, { searchType: 'hybrid' }), __VU);
}

// B2: Rate Limit 검증 — 동일 IP(USE_XFF=false 실행 시), 429 유도
export function scenarioB2() {
  const kw = KEYWORDS[(__VU - 1) % KEYWORDS.length];
  doSearch(buildSearchUrl(kw, { searchType: 'hybrid' }), __VU);
}

// C1: 하이브리드 검색 Cold 종단 latency (유니크 키워드로 캐시 MISS 보장)
//   - Semaphore(3) 정렬을 위해 VUs=3 → 외부 API 동시 호출 3개로만 진행(불필요한 큐잉 배제)
//   - 각 VU는 고유 키워드를 할당받아 모든 요청이 실제 임베딩 API 호출을 유발
export function scenarioC1() {
  const coldVus = 3;
  const idx = (__VU - 1) + __ITER * coldVus; // VU/iteration 조합으로 고유 키워드 매핑
  const kw = COLD_KEYWORDS[idx];
  doSearch(buildSearchUrl(kw, { searchType: 'hybrid' }), __VU);
}

// C2: 하이브리드 검색 순수 DB 성능 (setup() 에서 캐시 warm-up 완료 상태)
export function scenarioC2() {
  // page/sort 를 일부 변주해 매번 다른 쿼리가 실행되도록 함
  const page = String((__VU % 5) + 1);
  const sort = ['RELEVANCE', 'CREATED_DESC', 'LIKE_DESC'][__VU % 3];
  doSearch(
    buildSearchUrl(randomKeyword(), { searchType: 'hybrid', page, sort }),
    __VU,
  );
}

// D: AI 장애 시 FTS 폴백 검증 (Gemini 키 훼손 후 실행 가정)
export function scenarioD() {
  // 캐시에 없을 것이 거의 확실한 별도 키워드로 폴백을 강제
  doSearch(buildSearchUrl('FallbackProbeKeyword', { searchType: 'hybrid' }), __VU);
}

// E: keyword-only(FTS) 베이스라인
export function scenarioE() {
  doSearch(buildSearchUrl(randomKeyword(), { searchType: 'keyword' }), __VU);
}

// -----------------------------------------------------------------------------
// 5) setup(): C2 전용 캐시 warm-up (임베딩 캐시를 미리 채워 순수 DB 성능만 측정)
//    setup() 은 init 단계에서 실행되며 __VU 가 없으므로 루프로 직접 헤더 부여
// -----------------------------------------------------------------------------
export function setup() {
  if (SCENARIO !== 'C2') {
    return {};
  }
  // 키워드별로 서로 다른 X-Forwarded-For 를 부여해 warm-up 단계에서 Throttle 에 걸리지 않게 함
  for (let i = 0; i < KEYWORDS.length; i++) {
    const url = buildSearchUrl(KEYWORDS[i], { searchType: 'hybrid' });
    const res = http.get(url, {
      headers: { Accept: 'application/json', 'X-Forwarded-For': `10.9.9.${i + 1}` },
      tags: { scenario: 'C2-warmup' },
    });
    if (res.status !== 200) {
      // warm-up 실패는 결과 해석에 영향줄 수 있으므로 로그로 남김
      console.warn(`[C2 warmup] keyword=${KEYWORDS[i]} status=${res.status}`);
    }
  }
  return { warmedKeywords: KEYWORDS.length };
}

// -----------------------------------------------------------------------------
// 6) options: __ENV.SCENARIO 에 따라 단 하나의 시나리오만 등록
// -----------------------------------------------------------------------------
export const options = (() => {
  const scenarios = {};

  if (SCENARIO === 'A') {
    scenarios.cache_stampede = {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 50,
      startTime: '0s',
      exec: 'scenarioA',
    };
  } else if (SCENARIO === 'B') {
    // iterations:1 로 순수 "동시 캐시 MISS 20건" 케이스만 측정.
    // (반복하면 2차~n차가 캐시 HIT 이 되어 p95 통계를 좋게 오염시키고,
    //  iterations>=5 는 라우트 Throttle(10초 5회) 경계에 걸려 429 가 섞일 수 있음)
    scenarios.concurrency_control = {
      executor: 'per-vu-iterations',
      vus: 20,
      iterations: 1,
      startTime: '0s',
      exec: 'scenarioB',
    };
  } else if (SCENARIO === 'B2') {
    scenarios.rate_limit = {
      executor: 'per-vu-iterations',
      vus: 20,
      iterations: 5,
      startTime: '0s',
      exec: 'scenarioB2',
    };
  } else if (SCENARIO === 'C1') {
    // Cold 종단 latency: Semaphore(3) 정렬(VUs=3) + 고유 키워드 30건 단발성 부하.
    // (기존 ramping 방식은 22개 고정 키워드 반복으로 초반 이후 warm 상태로 전환되어 지표 왜곡)
    scenarios.hybrid_cold = {
      executor: 'per-vu-iterations',
      vus: 3,
      iterations: 10,
      startTime: '0s',
      exec: 'scenarioC1',
    };
  } else if (SCENARIO === 'C2') {
    scenarios.hybrid_db = {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: RAMP_STAGES,
      exec: 'scenarioC2',
    };
  } else if (SCENARIO === 'D') {
    scenarios.fallback = {
      executor: 'shared-iterations',
      vus: 5,
      iterations: 5,
      startTime: '0s',
      exec: 'scenarioD',
    };
  } else if (SCENARIO === 'E') {
    scenarios.fts_baseline = {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: RAMP_STAGES,
      exec: 'scenarioE',
    };
  }

  return {
    scenarios,
    // 콘솔 요약에 p(99) 까지 노출되도록 명시 (k6 기본값은 p(90)/p(95) 까지만 표시)
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    // SLA 임계치 (abortOnFail 기본 false — 초과해도 테스트 중단 없음, 콘솔에 pass/fail 만 표기)
    // 이력서용 p90/p95/p99 는 내장 http_req_duration + 커스텀 search_latency 요약에서 모두 확인 가능.
    thresholds: {
      http_req_duration: [
        SCENARIO === 'C2' ? 'p(95)<800' : 'p(95)<5000', // 순수 DB 조회는 좀 더 타이트하게
        'p(99)<10000',
      ],
    },
  };
})();