export const TRENDS_SOURCES_CACHE_TTL_ENV_KEY = 'TRENDS_SOURCES_CACHE_TTL_SECONDS';
export const TRENDS_DETAIL_CACHE_TTL_ENV_KEY = 'TRENDS_DETAIL_CACHE_TTL_SECONDS';
export const TRENDS_RELATED_CACHE_TTL_ENV_KEY = 'TRENDS_RELATED_CACHE_TTL_SECONDS';

// TTL 상수
export const TRENDS_SOURCES_CACHE_TTL_DEFAULT_SECONDS = 86400;
export const TRENDS_DETAIL_CACHE_TTL_DEFAULT_SECONDS = 900;
export const TRENDS_RELATED_CACHE_TTL_DEFAULT_SECONDS = 300;
export const TRENDS_LIST_COUNT_CACHE_TTL_SECONDS = 180;

// 키 상수
export const TRENDS_SOURCES_CACHE_KEY = 'trends:sources';
export const trendDetailCacheKey = (id: number) => `trends:detail:${id}`;
export const trendRelatedCacheKey = (id: number, limit: number) => `trends:related:${id}:limit:${limit}`;
export const trendListCountCacheKey = (source: string, isNew: boolean) => `trends:count:${source}:${isNew}`; // COUNT는 실제 결과를 바꾸는 필터만 키에 포함한다. (source, isNew)
