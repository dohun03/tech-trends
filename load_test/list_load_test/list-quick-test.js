// =============================================================================
// Tech-Trends 목록 API 단독 퀵 테스트 (Step 1 — 인덱스 개선 검증용)
// -----------------------------------------------------------------------------
// list_only 시나리오만 2분 30초(30s ramp → 90s @50VU → 30s ramp-down) 실행.
// 전체 5-시나리오 스위트(list-load-test.js)와 동일한 정렬/필터 분포를 재현.
// =============================================================================
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000/api/trends').replace(/\/+$/, '');

const SOURCES = [
  'github', 'hn', 'reddit', 'devto', 'stackoverflow',
  'geeknews', 'medium', 'producthunt', 'lobsters', 'techcrunch',
];
const SORT_OPTIONS = [
  'CREATED_DESC', 'CREATED_ASC', 'MINED_DESC', 'MINED_ASC',
  'LIKE_DESC', 'VIEW_DESC', 'COMMENT_DESC',
];

const http200 = new Counter('http_200');
const http429 = new Counter('http_429');
const http4xx = new Counter('http_4xx');
const http5xx = new Counter('http_5xx');

// ThrottleGuard(100 req/min/IP) 우회용 유니크 X-Forwarded-For
function buildForwardedFor() {
  const idx = __ITER * 1000 + __VU;
  const a = Math.floor(idx / (250 * 250)) % 250 + 1;
  const b = Math.floor(idx / 250) % 250 + 1;
  const c = idx % 250 + 1;
  return `10.${a}.${b}.${c}`;
}

function buildListUrl() {
  const sort = SORT_OPTIONS[__VU % SORT_OPTIONS.length];
  const useSourceFilter = (__VU + __ITER) % 3 === 0;
  const source = useSourceFilter ? SOURCES[__VU % SOURCES.length] : 'ALL';
  const page = String((__VU % 5) + 1);
  const limit = String([5, 10, 20, 50, 100][__VU % 5]);
  const isNew = (__VU + __ITER) % 10 === 0 ? 'true' : 'false';
  const qs = `page=${page}&limit=${limit}&source=${source}&isNew=${isNew}&sort=${sort}`;
  return `${BASE_URL}?${qs}`;
}

export function listOnly() {
  const res = http.get(buildListUrl(), {
    headers: { Accept: 'application/json', 'X-Forwarded-For': buildForwardedFor() },
    tags: { endpoint: 'list' },
  });

  if (res.status === 200) http200.add(1);
  else if (res.status === 429) http429.add(1);
  else if (res.status >= 500) http5xx.add(1);
  else http4xx.add(1);

  check(res, { '[list] status 200': (r) => r.status === 200 });
}

export const options = {
  scenarios: {
    list_quick: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        // 목록 쿼리만 충분히 안정화해 전후 비교가 가능하도록 2.5분간 실행한다.
        { duration: '30s', target: 50 },
        { duration: '90s', target: 50 },
        { duration: '30s', target: 0 },
      ],
      exec: 'listOnly',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:list}': ['p(95)<500'],
  },
};
