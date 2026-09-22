// Redis 중단 중에도 API가 fail-open으로 응답하는지 확인하는 단기 부하 테스트입니다.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000/api/trends').replace(/\/+$/, '');
const http200 = new Counter('http_200');
const http429 = new Counter('http_429');
const http5xx = new Counter('http_5xx');

// 정상 사용자와 같은 고정 IP 풀로 Throttler의 Redis 경로를 계속 호출합니다.
const NORMAL_IPS = [
  '10.20.0.1', '10.20.0.2', '10.20.0.3', '10.20.0.4', '10.20.0.5',
  '10.20.0.6', '10.20.0.7', '10.20.0.8', '10.20.0.9', '10.20.0.10',
];

export default function redisFailoverRequest() {
  const res = http.get(`${BASE_URL}/${((__VU + __ITER) % 20) + 1}`, {
    headers: {
      Accept: 'application/json',
      'X-Forwarded-For': NORMAL_IPS[__VU % NORMAL_IPS.length],
    },
    tags: { endpoint: 'detail' },
  });

  if (res.status === 200) http200.add(1);
  else if (res.status === 429) http429.add(1);
  else if (res.status >= 500) http5xx.add(1);

  // Redis 장애 중 200 또는 rate limit 429만 허용하고 서버 오류를 탐지합니다.
  check(res, { 'status is 200 or 429': (r) => r.status === 200 || r.status === 429 });
}

export const options = {
  scenarios: {
    redis_failover: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '60s', target: 20 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
