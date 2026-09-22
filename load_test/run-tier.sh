#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Phase 4 본 테스트용 티어 실행 스크립트
#   사용: bash load_test/run-tier.sh <tier> <count>
#     tier  : low | mid | high  (결과/로그 파일 접미사)
#     count : 시드 row 수 (1000 | 10000 | 50000)
#
#   동작: 시딩 -> 백엔드 기동 -> 메모리(시작 직전) -> k6 본 테스트
#         (백그라운드 10초 간격 메모리 샘플링) -> 메모리(직후) -> 정리
#   산출물: load_test/list_load_test/result-<tier>.json
# -----------------------------------------------------------------------------
set -u
TIER="${1:?tier(low|mid|high)}"
COUNT="${2:?count(1000|10000|50000)}"

cd "$(dirname "$0")/.." || exit 1
mkdir -p logs load_test/list_load_test

echo "[$(date +%H:%M:%S)] === tier=$TIER count=$COUNT start ==="

# 1) 시딩 (TRUNCATE RESTART IDENTITY + generate_series)
PGPASSWORD=1234 psql -h localhost -p 5432 -U postgres -d tech_trends \
  -v count="$COUNT" -f load_test/seed/seed.sql > "logs/seed-$TIER.log" 2>&1
echo "seed_rc=$?"

# 2) 백엔드 기동
node dist/main.js > "logs/backend-$TIER.log" 2>&1 &
BPID=$!
echo "backend_pid=$BPID"

ready=000
for i in $(seq 1 40); do
  c=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/trends/sources 2>/dev/null)
  if [ "$c" = "200" ]; then ready=200; break; fi
  sleep 1
done
echo "backend_ready=$ready"

# 3) 메모리 기록 (시작 직전)
echo "before: $(ps -o rss= -p $BPID 2>/dev/null) kB" > "logs/mem-$TIER.txt"

# 4) 메모리 샘플러 (10초 간격, k6 진행 내내 기록)
(
  while kill -0 $BPID 2>/dev/null; do
    echo "$(date +%H:%M:%S) $(ps -o rss= -p $BPID 2>/dev/null) kB" >> "logs/mem-$TIER.txt"
    sleep 10
  done
) &
SAMPLER=$!

# 5) k6 본 테스트 (ramp 1->50, summary-export 저장)
/home/leenohoon/bin/k6 run \
  -e BASE_URL=http://localhost:3000/api/trends \
  --summary-export="load_test/list_load_test/result-$TIER.json" \
  load_test/list-load-test.js > "logs/k6-$TIER.log" 2>&1
K6_EXIT=$?

# 6) 메모리 기록 (직후)
echo "after: $(ps -o rss= -p $BPID 2>/dev/null) kB" >> "logs/mem-$TIER.txt"

# 7) 정리
kill "$SAMPLER" 2>/dev/null
kill "$BPID" 2>/dev/null

echo "[$(date +%H:%M:%S)] === tier=$TIER done k6_exit=$K6_EXIT ==="