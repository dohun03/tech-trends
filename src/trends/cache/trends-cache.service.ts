import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'redis/redis.service';
import { TRENDS_SOURCES_CACHE_KEY, TRENDS_SOURCES_CACHE_TTL_DEFAULT_SECONDS, TRENDS_SOURCES_CACHE_TTL_ENV_KEY } from './trends-cache.constants';

@Injectable()
export class TrendsCacheService {
  private readonly sourcesCacheTtlSeconds: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.sourcesCacheTtlSeconds = Number(this.configService.get<number>(TRENDS_SOURCES_CACHE_TTL_ENV_KEY)) || TRENDS_SOURCES_CACHE_TTL_DEFAULT_SECONDS;
  }

  // 소스 목록 캐시 조회
  async getSources(): Promise<string[] | null> {
    return this.redisService.getCache<string[]>({
      key: TRENDS_SOURCES_CACHE_KEY,
    });
  }

  // 소스 목록 캐시 저장
  async setSources(sources: string[]): Promise<void> {
    await this.redisService.setCache({
      key: TRENDS_SOURCES_CACHE_KEY,
      value: sources,
      ttlSeconds: this.sourcesCacheTtlSeconds,
    });
  }

  // 소스 목록 캐시 무효화
  async invalidateSources(): Promise<void> {
    await this.redisService.delCache({ key: TRENDS_SOURCES_CACHE_KEY });
  }
}