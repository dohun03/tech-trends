// GET /trends/sources 응답 캐시 키
export const TRENDS_SOURCES_CACHE_KEY = 'trends:sources';

// 소스 목록 캐시 TTL 환경변수 키
export const TRENDS_SOURCES_CACHE_TTL_ENV_KEY =
  'TRENDS_SOURCES_CACHE_TTL_SECONDS';

// 소스 목록 캐시 TTL 기본값 (1일).
export const TRENDS_SOURCES_CACHE_TTL_DEFAULT_SECONDS = 86400;

export const TRENDS_DETAIL_CACHE_TTL_ENV_KEY =
  'TRENDS_DETAIL_CACHE_TTL_SECONDS';
export const TRENDS_RELATED_CACHE_TTL_ENV_KEY =
  'TRENDS_RELATED_CACHE_TTL_SECONDS';
export const TRENDS_DETAIL_CACHE_TTL_DEFAULT_SECONDS = 900;
export const TRENDS_RELATED_CACHE_TTL_DEFAULT_SECONDS = 300;

export const trendDetailCacheKey = (id: number) => `trends:detail:${id}`;
export const trendRelatedCacheKey = (id: number, limit: number) =>
  `trends:related:${id}:limit:${limit}`;
