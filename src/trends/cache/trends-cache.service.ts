import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'redis/redis.service';
import {
  TRENDS_DETAIL_CACHE_TTL_DEFAULT_SECONDS,
  TRENDS_DETAIL_CACHE_TTL_ENV_KEY,
  TRENDS_RELATED_CACHE_TTL_DEFAULT_SECONDS,
  TRENDS_RELATED_CACHE_TTL_ENV_KEY,
  TRENDS_SOURCES_CACHE_KEY,
  TRENDS_SOURCES_CACHE_TTL_DEFAULT_SECONDS,
  TRENDS_SOURCES_CACHE_TTL_ENV_KEY,
  trendDetailCacheKey,
  trendRelatedCacheKey,
} from './trends-cache.constants';

@Injectable()
export class TrendsCacheService {
  private readonly sourcesCacheTtlSeconds: number;
  private readonly detailCacheTtlSeconds: number;
  private readonly relatedCacheTtlSeconds: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.sourcesCacheTtlSeconds =
      Number(
        this.configService.get<number>(TRENDS_SOURCES_CACHE_TTL_ENV_KEY),
      ) || TRENDS_SOURCES_CACHE_TTL_DEFAULT_SECONDS;
    this.detailCacheTtlSeconds =
      Number(this.configService.get<number>(TRENDS_DETAIL_CACHE_TTL_ENV_KEY)) ||
      TRENDS_DETAIL_CACHE_TTL_DEFAULT_SECONDS;
    this.relatedCacheTtlSeconds =
      Number(
        this.configService.get<number>(TRENDS_RELATED_CACHE_TTL_ENV_KEY),
      ) || TRENDS_RELATED_CACHE_TTL_DEFAULT_SECONDS;
  }

  // 아티클 소스 목록 캐시
  async getSources(): Promise<string[] | null> {
    return this.redisService.getCache<string[]>({
      key: TRENDS_SOURCES_CACHE_KEY,
    });
  }

  async setSources(sources: string[]): Promise<void> {
    await this.redisService.setCache({
      key: TRENDS_SOURCES_CACHE_KEY,
      value: sources,
      ttlSeconds: this.sourcesCacheTtlSeconds,
    });
  }

  async invalidateSources(): Promise<void> {
    await this.redisService.delCache({ key: TRENDS_SOURCES_CACHE_KEY });
  }

  // 아티클 디테일(내용) 캐시
  async getDetail<T>(id: number): Promise<T | null> {
    return this.redisService.getCache<T>({ key: trendDetailCacheKey(id) });
  }

  async setDetail<T>(id: number, value: T): Promise<void> {
    await this.redisService.setCache({
      key: trendDetailCacheKey(id),
      value,
      ttlSeconds: this.detailCacheTtlSeconds,
    });
  }

  // 연관 아티클 캐시
  async getRelated<T>(id: number, limit: number): Promise<T | null> {
    return this.redisService.getCache<T>({
      key: trendRelatedCacheKey(id, limit),
    });
  }

  async setRelated<T>(id: number, limit: number, value: T): Promise<void> {
    await this.redisService.setCache({
      key: trendRelatedCacheKey(id, limit),
      value,
      ttlSeconds: this.relatedCacheTtlSeconds,
    });
  }
}
