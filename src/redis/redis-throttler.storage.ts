import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service';

const REDIS_THROTTLE_KEY_PREFIX = 'throttle:v1';
const MAX_TRACKER_LENGTH = 64;

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
  }
}
