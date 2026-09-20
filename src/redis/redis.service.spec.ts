import { RedisService } from './redis.service';

describe('RedisService.incrementThrottle', () => {
  it('Node timer 없이 Redis Lua EVAL에 counter·TTL·block 값을 전달해야 한다', async () => {
    const service = new RedisService({} as any);
    const evalMock = jest.fn().mockResolvedValue([101, 59_001, 1, 2_001]);
    (service as any).client = { eval: evalMock };

    const result = await service.incrementThrottle({
      key: 'throttle:v1:global:TrendsController:getTrends:10.0.0.1',
      ttlMs: 60_000,
      limit: 100,
      blockDurationMs: 60_000,
    });

    expect(result).toEqual({
      totalHits: 101,
      ttlRemainingMs: 59_001,
      isBlocked: true,
      blockTtlRemainingMs: 2_001,
    });
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      2,
      'throttle:v1:global:TrendsController:getTrends:10.0.0.1',
      'throttle:v1:global:TrendsController:getTrends:10.0.0.1:block',
      '60000',
      '100',
      '60000',
    );
  });
});
