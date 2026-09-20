import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

export interface LockParams {
  key: string;
  ttlMs?: number;
}

export interface GetCacheParams {
  key: string;
}

export interface SetCacheParams {
  key: string;
  value: any;
  ttlSeconds?: number;
}

export interface DelCacheParams {
  key: string;
}

export interface IncrementThrottleParams {
  key: string;
  ttlMs: number;
  limit: number;
  blockDurationMs: number;
}

export interface ThrottleIncrementResult {
  totalHits: number;
  ttlRemainingMs: number;
  isBlocked: boolean;
  blockTtlRemainingMs: number;
}

// Redis가 카운터 증가·TTL 설정·차단 상태를 한 번에 처리
const THROTTLE_INCREMENT_LUA = `
  local blockTtl = redis.call('PTTL', KEYS[2])
  if blockTtl > 0 then
    local currentHits = tonumber(redis.call('GET', KEYS[1]) or '0')
    return { currentHits, redis.call('PTTL', KEYS[1]), 1, blockTtl }
  end

  local totalHits = redis.call('INCR', KEYS[1])
  if totalHits == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end

  local ttlRemaining = redis.call('PTTL', KEYS[1])
  if totalHits > tonumber(ARGV[2]) then
    redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
    return { totalHits, ttlRemaining, 1, tonumber(ARGV[3]) }
  end

  return { totalHits, ttlRemaining, 0, 0 }
`;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST') || 'localhost';
    const port = Number(this.configService.get<number>('REDIS_PORT')) || 6379;
    const password =
      this.configService.get<string>('REDIS_PASSWORD') || undefined;

    this.client = new Redis({
      host,
      port,
      password,
      // Redis 장애 시 요청을 오프라인 큐에 쌓지 않고 즉시 호출자에게 실패를 알린다.
      enableOfflineQueue: false,
      // 명령 재시도 대기는 storage의 fail-open 폴백을 지연시키므로 비활성화한다.
      maxRetriesPerRequest: 0,
      connectTimeout: 1000,
      // 연결 자체는 짧은 backoff로 계속 재시도해 Redis 복구 후 자동 재연결한다.
      retryStrategy: (attempt) => Math.min(attempt * 100, 1000),
    });

    this.client.on('connect', () => {
      this.logger.log('Redis 서버에 성공적으로 연결되었습니다.');
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis 연결 에러: ${err.message}`, err.stack);
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  // 분산락을 획득합니다
  async acquireLock(params: {
    key: string;
    ttlMs: number;
  }): Promise<string | null> {
    const { key, ttlMs } = params;
    const lockValue = randomUUID();

    const result = await this.client.set(key, lockValue, 'PX', ttlMs, 'NX');
    return result === 'OK' ? lockValue : null;
  }

  // 분산락을 해제합니다
  async releaseLock(params: { key: string; value: string }): Promise<boolean> {
    const { key, value } = params;

    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.client.eval(luaScript, 1, key, value);
    return result === 1;
  }

  // 캐시 데이터를 조회합니다
  async getCache<T>(params: GetCacheParams): Promise<T | null> {
    const { key } = params;
    const data = await this.client.get(key);
    if (!data) return null;

    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  }

  // 데이터를 캐싱합니다
  async setCache(params: SetCacheParams): Promise<void> {
    const { key, value, ttlSeconds = 2592000 } = params;
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);

    if (ttlSeconds > 0) {
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
  }

  // 특정 캐시 키를 삭제합니다
  async delCache(params: DelCacheParams): Promise<void> {
    const { key } = params;
    await this.client.del(key);
  }

  // 특정 키의 존재 여부를 확인합니다
  async exists(params: { key: string }): Promise<boolean> {
    const { key } = params;
    const result = await this.client.exists(key);
    return result === 1;
  }

  // Redis 원자 연산으로 throttle 카운터와 차단 TTL을 갱신
  async incrementThrottle(params: IncrementThrottleParams): Promise<ThrottleIncrementResult> {
    const { key, ttlMs, limit, blockDurationMs } = params;
    const result = (await this.client.eval(
      THROTTLE_INCREMENT_LUA,
      2,
      key,
      `${key}:block`,
      String(Math.max(1, ttlMs)),
      String(limit),
      String(Math.max(1, blockDurationMs)),
    )) as number[];

    return {
      totalHits: Number(result[0]),
      ttlRemainingMs: Math.max(0, Number(result[1])),
      isBlocked: Number(result[2]) === 1,
      blockTtlRemainingMs: Math.max(0, Number(result[3])),
    };
  }
}
