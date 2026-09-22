// =============================================================================
// Tech-Trends 목록/상세/연관 API 부하 테스트 스크립트 (k6) — 검색 API 제외
// -----------------------------------------------------------------------------
// 대상 엔드포인트:
//   GET /api/trends             (필터/정렬/페이지네이션 목록 조회)
//   GET /api/trends/sources     (DISTINCT source 집계)
//   GET /api/trends/:id         (PK 단건 조회)
//   GET /api/trends/:id/related (임베딩 기반 연관 글 — embedding NULL 시 빈 배열)
//
// 시나리오(모두 ramping-vus, startTime 으로 순차 실행 — 동시 자원 경합 방지):
//   1. list_only      : /trends 목록 단건 (sort/source/page/limit 조합 순환)
//   2. sources_only   : /trends/sources 단건
//   3. detail_only    : /trends/:id  단건 (시딩에서 고정된 id 1~20 셋만 사용)
//   4. related_only   : /trends/:id/related 단건 (동일 id 1~20 셋)
//   5. user_journey   : 목록 조회 → (응답에서 id 추출) → 상세 → 연관 흐름
//
// 실행 방법:
//   # 본 테스트 (ramp 1->50 VU)
//   k6 run \
//     -e BASE_URL=http://localhost/api/trends \
//     --summary-export=load_test/list_load_test/result-low.json \
//     load_test/list-load-test.js
//
//   # tier 별 저장 파일명 예시: result-low.json / result-mid.json / result-high.json
//
//   # 스모크 테스트 (Phase 3, VU 1~5 / ~30초 이내로 축소)
//   k6 run -e SMOKE=true -e BASE_URL=http://localhost/api/trends \
//     load_test/list-load-test.js
// =============================================================================

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// -----------------------------------------------------------------------------
// 1) 커스텀 메트릭
// -----------------------------------------------------------------------------
// journey_duration : user_journey 한 흐름(목록->상세->연관)의 총 소요시간(ms)
const journeyDuration = new Trend('journey_duration', true);
const http200 = new Counter('http_200'); // 정상(200)
const http429 = new Counter('http_429'); // Rate Limit 차단(429)
const http4xx = new Counter('http_4xx'); // 잘못된 요청/미존재(4xx)
const http5xx = new Counter('http_5xx'); // 서버 오류(5xx)

// -----------------------------------------------------------------------------
// 2) 설정 상수
// -----------------------------------------------------------------------------
const SMOKE = __ENV.SMOKE === 'true';
const BASE_URL = (__ENV.BASE_URL || 'http://localhost/api/trends').replace(/\/+$/, '');
// 기본값 spoofed는 기존 요청별 유니크 IP 부하 조건을 그대로 유지한다.
const TRAFFIC_MODE = __ENV.TRAFFIC_MODE === 'normal' ? 'normal' : 'spoofed';

// 정상 트래픽 모드에서 재사용할 3,000개 고정 사설 IP 풀을 생성한다.
const NORMAL_IPS = Array.from({ length: 3_000 }, (_, index) => {
  const thirdOctet = Math.floor(index / 250);
  const fourthOctet = (index % 250) + 1;
  return `10.0.${thirdOctet}.${fourthOctet}`;
});

// 시드 스크립트가 순환 삽입한 고정 source 목록 (단건/필터 조합용)
const SOURCES = [
  'github', 'hn', 'reddit', 'devto', 'stackoverflow',
  'geeknews', 'medium', 'producthunt', 'lobsters', 'techcrunch',
];

// ListTrendsQueryDto 가 허용하는 정렬 옵션
const SORT_OPTIONS = [
  'CREATED_DESC', 'CREATED_ASC', 'MINED_DESC', 'MINED_ASC',
  'LIKE_DESC', 'VIEW_DESC', 'COMMENT_DESC',
];

// Phase 1 시딩에서 RESTART IDENTITY + 순차 삽입으로 고정 보장된 id 셋 (1~20)
const DETAIL_IDS = Array.from({ length: 20 }, (_, i) => i + 1);

// ramping 스테이지: 본 테스트(1->50 VU) / 스모크(1->3 VU, ~4초)
const SCENARIO_STAGES = SMOKE
  ? [
      { duration: '2s', target: 3 },
      { duration: '2s', target: 0 },
    ]
  : [
      { duration: '30s', target: 1 },
      { duration: '30s', target: 5 },
      { duration: '30s', target: 10 },
      { duration: '30s', target: 25 },
      { duration: '1m', target: 50 },
      { duration: '30s', target: 0 },
    ];

// 순차 실행 시 시나리오 간 여유 간격(graceful ramp-down 안정화용)
const GAP_SECONDS = SMOKE ? 2 : 5;

// "30s"/"1m" 형식 문자열을 초 단위로 변환
function parseDuration(dur) {
  const m = /^(\d+)(m|s)$/.exec(dur);
  if (!m) return 0;
  return m[2] === 'm' ? Number(m[1]) * 60 : Number(m[1]);
}

const SCENARIO_DURATION_SECONDS = SCENARIO_STAGES.reduce(
  (sum, s) => sum + parseDuration(s.duration),
  0,
);

// -----------------------------------------------------------------------------
// 3) 공통 유틸
// -----------------------------------------------------------------------------

// normal은 고정 IP 풀을 사용하고, spoofed는 기존 유니크 IP 방식을 유지한다.
function buildForwardedFor() {
  if (TRAFFIC_MODE === 'normal') {
    // VU만 사용하면 최대 50개 IP에 집중되므로 반복 번호도 섞어 풀 전체를 순환한다.
    return NORMAL_IPS[(__VU * 1_009 + __ITER) % NORMAL_IPS.length];
  }

  // spoofed: ThrottleGuard 우회용 유니크 IP를 기존 방식으로 생성한다.
  const idx = __ITER * 1000 + __VU;
  const a = Math.floor(idx / (250 * 250)) % 250 + 1;
  const b = Math.floor(idx / 250) % 250 + 1;
  const c = idx % 250 + 1;
  return `10.${a}.${b}.${c}`;
}

function buildHeaders() {
  return {
    Accept: 'application/json',
    'X-Forwarded-For': buildForwardedFor(),
  };
}

// 요청 1회 수행: 상태별 계수 + check. endpoint 태그로 threshold 분리.
function doGet(url, endpoint) {
  const res = http.get(url, {
    headers: buildHeaders(),
    tags: { endpoint },
  });

  if (res.status === 200) http200.add(1);
  else if (res.status === 429) http429.add(1);
  else if (res.status >= 500) http5xx.add(1);
  else http4xx.add(1);

  check(res, {
    [`[${endpoint}] status 200`]: (r) => r.status === 200,
  });
  return res;
}

// /trends 목록 쿼리스트링 조립
function buildListUrl(opts = {}) {
  const p = Object.assign(
    { page: '1', limit: '5', source: 'ALL', isNew: 'false', sort: 'CREATED_DESC' },
    opts,
  );
  const qs =
    `page=${p.page}` +
    `&limit=${p.limit}` +
    `&source=${p.source}` +
    `&isNew=${p.isNew}` +
    `&sort=${p.sort}`;
  return `${BASE_URL}?${qs}`;
}

// 고정 id 1~20 을 VU/iter 조합으로 골고루 순환 (detail/related 전용)
function fixedId() {
  return DETAIL_IDS[(__VU - 1 + __ITER) % DETAIL_IDS.length];
}

// -----------------------------------------------------------------------------
// 4) 시나리오 exec 함수 (scenarios.exec 에 문자열로 참조)
// -----------------------------------------------------------------------------

// 목록 조회: sort/source/page/limit/isNew 를 VU 기반으로 변주해 여러 조합 실행
export function listOnly() {
  const sort = SORT_OPTIONS[__VU % SORT_OPTIONS.length];
  const useSourceFilter = (__VU + __ITER) % 3 === 0;
  const source = useSourceFilter ? SOURCES[__VU % SOURCES.length] : 'ALL';
  const page = String((__VU % 5) + 1);
  const limit = String([5, 10, 20, 50, 100][__VU % 5]);
  const isNew = (__VU + __ITER) % 10 === 0 ? 'true' : 'false';

  doGet(buildListUrl({ sort, source, page, limit, isNew }), 'list');
}

// 출처 목록(DISTINCT source) 조회
export function sourcesOnly() {
  doGet(`${BASE_URL}/sources`, 'sources');
}

// PK 단건 조회 (고정 id 셋만 사용 — O(1) 비교용)
export function detailOnly() {
  doGet(`${BASE_URL}/${fixedId()}`, 'detail');
}

// 연관 글 조회 (embedding NULL 이므로 빈 배열 경로 성능 측정)
export function relatedOnly() {
  doGet(`${BASE_URL}/${fixedId()}/related`, 'related');
}

// 유저 저니: 목록 → id 추출 → 상세 → 연관 (총 소요시간 기록)
export function userJourney() {
  const start = Date.now();

  const listRes = doGet(buildListUrl(), 'list');

  let id = null;
  try {
    const body = listRes.json();
    if (body && Array.isArray(body.data) && body.data.length > 0) {
      id = body.data[0].id;
    }
  } catch (_) {
    id = null;
  }
  if (!id) id = fixedId();

  doGet(`${BASE_URL}/${id}`, 'detail');
  doGet(`${BASE_URL}/${id}/related`, 'related');

  journeyDuration.add(Date.now() - start);
}

// -----------------------------------------------------------------------------
// 5) options: 5개 시나리오를 startTime 으로 순차 실행
// -----------------------------------------------------------------------------
const SCENARIO_DEFS = [
  { name: 'list_only', exec: 'listOnly' },
  { name: 'sources_only', exec: 'sourcesOnly' },
  { name: 'detail_only', exec: 'detailOnly' },
  { name: 'related_only', exec: 'relatedOnly' },
  { name: 'user_journey', exec: 'userJourney' },
];

const scenarios = {};
SCENARIO_DEFS.forEach((def, idx) => {
  scenarios[def.name] = {
    executor: 'ramping-vus',
    startVUs: 1,
    stages: SCENARIO_STAGES,
    startTime: `${idx * (SCENARIO_DURATION_SECONDS + GAP_SECONDS)}s`,
    gracefulRampDown: SMOKE ? '1s' : '10s',
    gracefulStop: SMOKE ? '1s' : '5s',
    exec: def.exec,
  };
});

export const options = {
  scenarios,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    // 전체 실패율(4xx/5xx/네트워크) 1% 미만
    http_req_failed: ['rate<0.01'],
    // 임시 기준 — 실제 측정 후 조정 가능 (Phase 4 결과 기준 재조정 예정)
    'http_req_duration{endpoint:list}': ['p(95)<500'], // /trends 목록
    'http_req_duration{endpoint:sources}': ['p(95)<500'], // /trends/sources
    'http_req_duration{endpoint:detail}': ['p(95)<50'], // /trends/:id (엄격)
    'http_req_duration{endpoint:related}': ['p(95)<500'], // /trends/:id/related
  },
};
