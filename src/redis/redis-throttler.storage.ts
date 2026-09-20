import { Injectable, Logger } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service';

const REDIS_THROTTLE_KEY_PREFIX = 'throttle:v1';
const MAX_TRACKER_LENGTH = 64;
const REDIS_FAILURE_LOG_INTERVAL_MS = 30_000;

// Express가 trust proxy로 정규화한 IP만 사용하고, 외부 입력 길이를 제한한다.
export function getRedisThrottleTracker(req: Record<string, unknown>): string {
  const ip = typeof req.ip === 'string' ? req.ip : 'unknown';
  return ip.slice(0, MAX_TRACKER_LENGTH);
}

// 동기 SHA-256 대신 route와 tracker를 Redis 키에 직접 조합한다.
export function createRedisThrottleKey(
  context: ExecutionContext,
  tracker: string,
  throttlerName: string,
): string {
  const controller = context.getClass().name;
  const handler = context.getHandler().name;
  return `${REDIS_THROTTLE_KEY_PREFIX}:${throttlerName}:${controller}:${handler}:${tracker}`;
}

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastRedisFailureLogAt = 0;

  constructor(private readonly redisService: RedisService) {}

  // Counter와 block key의 TTL은 Redis가 정리하므로 Node 메모리에 timer가 누적되지 않는다.
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    try {
      const result = await this.redisService.incrementThrottle({
        key,
        ttlMs: ttl,
        limit,
        blockDurationMs: blockDuration,
      });

      return {
        totalHits: result.totalHits,
        timeToExpire: Math.ceil(result.ttlRemainingMs / 1000),
        isBlocked: result.isBlocked,
        timeToBlockExpire: Math.ceil(result.blockTtlRemainingMs / 1000),
      };
    } catch (error) {
      this.logRedisFailure(error);

      // Rate limit 의존성 장애가 API 가용성을 막지 않도록 요청을 허용한다.
      return {
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  // Redis 장애 중 요청별 로그 폭증을 방지하면서 fail-open 사실을 남긴다.
  private logRedisFailure(error: unknown): void {
    const now = Date.now();
    if (now - this.lastRedisFailureLogAt < REDIS_FAILURE_LOG_INTERVAL_MS) return;

    this.lastRedisFailureLogAt = now;
    this.logger.warn(`Redis throttle 실패로 요청을 허용합니다: ${error}`);
  }
}
