import { RedisService } from './redis.service';
import {
  createRedisThrottleKey,
  getRedisThrottleTracker,
  RedisThrottlerStorage,
} from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  const redisService = {
    incrementThrottle: jest.fn(),
  } as unknown as jest.Mocked<RedisService>;
  const storage = new RedisThrottlerStorage(redisService);

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('Redis 원자 증가 결과를 Throttler storage record로 변환해야 한다', async () => {
    redisService.incrementThrottle.mockResolvedValue({
      totalHits: 101,
      ttlRemainingMs: 59_001,
      isBlocked: true,
      blockTtlRemainingMs: 2_001,
    });

    await expect(
      storage.increment(
        'throttle:v1:global:TrendsController:getTrends:10.0.0.1',
        60_000,
        100,
        60_000,
      ),
    ).resolves.toEqual({
      totalHits: 101,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 3,
    });

    expect(redisService.incrementThrottle).toHaveBeenCalledWith({
      key: 'throttle:v1:global:TrendsController:getTrends:10.0.0.1',
      ttlMs: 60_000,
      limit: 100,
      blockDurationMs: 60_000,
    });
  });

  it('IP tracker 길이를 제한하고 crypto 없이 route 포함 키를 생성해야 한다', () => {
    const tracker = getRedisThrottleTracker({ ip: '1'.repeat(80) });
    const context = {
      getClass: () => ({ name: 'TrendsController' }),
      getHandler: () => ({ name: 'getTrends' }),
    } as any;

    expect(tracker).toHaveLength(64);
    expect(createRedisThrottleKey(context, tracker, 'global')).toBe(
      `throttle:v1:global:TrendsController:getTrends:${tracker}`,
    );
  });

  it('Redis 장애 시 요청을 차단하지 않고 fail-open 결과를 반환해야 한다', async () => {
    redisService.incrementThrottle.mockRejectedValue(new Error('Redis unavailable'));

    await expect(
      storage.increment(
        'throttle:v1:global:TrendsController:getTrends:10.0.0.1',
        60_000,
        100,
        60_000,
      ),
    ).resolves.toEqual({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });
});
