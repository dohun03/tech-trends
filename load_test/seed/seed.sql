-- ============================================================================
-- tbl_tech_trends 더미 데이터 시딩 스크립트 (순수 SQL, generate_series 기반)
-- ----------------------------------------------------------------------------
-- 실행 (tier별 row 수를 psql 변수 count로 전달):
--   psql "postgresql://postgres:1234@localhost:5432/tech_trends" \
--        -v count=1000  -f load_test/seed/seed.sql   # low  (1,000)
--        -v count=10000 -f load_test/seed/seed.sql   # mid  (10,000)
--        -v count=50000 -f load_test/seed/seed.sql   # high (50,000)
--
-- 동작:
--   1) TRUNCATE ... RESTART IDENTITY 로 테이블/SERIAL 시퀀스 초기화
--   2) generate_series(1, :count) 로 단일 INSERT..SELECT (루프 없음)
--   3) id 1~20 은 항상 동일 내용이 되도록 모든 값이 i 의 결정적 함수로 생성됨
--      (RESTART IDENTITY 후 삽입 순서가 곧 id 순서이므로 1~20 고정 보장)
--   4) embedding 은 NULL (컬럼 생략), search_document 는 STORED GENERATED 자동 채움
-- ----------------------------------------------------------------------------
\set ON_ERROR_STOP on

-- :count 변수 미지정 시 기본값(low) 설정
\if :{?count}
\else
\set count 1000
\endif

\echo '>>> seeding:' :count 'rows'

BEGIN;

TRUNCATE tbl_tech_trends RESTART IDENTITY;

INSERT INTO tbl_tech_trends
  ( source,
    source_id,
    title,
    short_summary,
    long_summary,
    link_url,
    technical_tags,
    view_count,
    like_count,
    comment_count,
    created_at,
    mined_at )
SELECT
  -- source: 고정 10개 문자열 순환 (DISTINCT 결과 10개 검증용)
  (ARRAY['github','hn','reddit','devto','stackoverflow',
         'geeknews','medium','producthunt','lobsters','techcrunch'])
      [((g.i - 1) % 10) + 1]                         AS source,
  'seed-' || g.i                                     AS source_id,
  'Seed Article ' || g.i                             AS title,
  '["dummy summary"]'::jsonb                         AS short_summary,
  'Dummy long summary for seed article ' || g.i      AS long_summary,
  'https://example.com/seed/' || g.i                 AS link_url,
  'seed-tag-' || (g.i % 20)                          AS technical_tags,
  ((g.i * 7) % 1000)                                 AS view_count,
  ((g.i * 13) % 500)                                 AS like_count,
  ((g.i * 3) % 200)                                  AS comment_count,
  -- 최근 2년(730일) 범위로 고르게 분산 (i%730 => 각 날짜 균등 배치)
  CURRENT_DATE - ((g.i % 730) * INTERVAL '1 day')    AS created_at,
  -- mined_at 은 created_at 근처(정오)로 분산
  CURRENT_DATE - ((g.i % 730) * INTERVAL '1 day') + INTERVAL '12 hours' AS mined_at
FROM generate_series(1, :count) AS g(i);

COMMIT;

\echo '== done'