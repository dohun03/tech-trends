import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TrendsCacheService } from './trends-cache.service';
import { RedisService } from 'redis/redis.service';
import {
  trendListCountCacheKey,
  TRENDS_SOURCES_CACHE_KEY,
  TRENDS_SOURCES_CACHE_TTL_ENV_KEY,
} from './trends-cache.constants';

describe('TrendsCacheService', () => {
  let service: TrendsCacheService;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(async () => {
    const mockRedisService = {
      getCache: jest.fn(),
      setCache: jest.fn(),
      delCache: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrendsCacheService,
        { provide: RedisService, useValue: mockRedisService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === TRENDS_SOURCES_CACHE_TTL_ENV_KEY) return 3600;
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<TrendsCacheService>(TrendsCacheService);
    redisService = module.get(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSources', () => {
    it('캐시 히트 시 RedisService.getCache 반환값을 그대로 반환해야 한다', async () => {
      const cached = ['dev.to', 'geeknews'];
      redisService.getCache.mockResolvedValue(cached);

      const result = await service.getSources();

      expect(result).toEqual(cached);
      expect(redisService.getCache).toHaveBeenCalledWith({
        key: TRENDS_SOURCES_CACHE_KEY,
      });
    });

    it('캐시 미스 시 null을 반환해야 한다', async () => {
      redisService.getCache.mockResolvedValue(null);

      const result = await service.getSources();

      expect(result).toBeNull();
    });
  });

  describe('setSources', () => {
    it('올바른 키·값·TTL로 setCache를 호출해야 한다', async () => {
      const sources = ['dev.to', 'stackoverflow'];

      await service.setSources(sources);

      expect(redisService.setCache).toHaveBeenCalledWith({
        key: TRENDS_SOURCES_CACHE_KEY,
        value: sources,
        ttlSeconds: 3600,
      });
    });
  });

  describe('invalidateSources', () => {
    it('소스 목록 캐시 키로 delCache를 호출해야 한다', async () => {
      await service.invalidateSources();

      expect(redisService.delCache).toHaveBeenCalledWith({
        key: TRENDS_SOURCES_CACHE_KEY,
      });
    });
  });

  describe('list count cache', () => {
    it('필터 조합별 키와 3분 TTL로 COUNT를 저장해야 한다', async () => {
      await service.setListCount('github', false, 42);

      expect(redisService.setCache).toHaveBeenCalledWith({
        key: trendListCountCacheKey('github', false),
        value: 42,
        ttlSeconds: 180,
      });
    });

    it('동일 필터 조합의 캐시된 COUNT를 조회해야 한다', async () => {
      redisService.getCache.mockResolvedValue(42);

      await expect(service.getListCount('github', true)).resolves.toBe(42);
      expect(redisService.getCache).toHaveBeenCalledWith({
        key: trendListCountCacheKey('github', true),
      });
    });
  });
});
