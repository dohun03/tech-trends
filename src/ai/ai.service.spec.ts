import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'redis/redis.service';

describe('AiService', () => {
  let service: AiService;
  let redisService: jest.Mocked<RedisService>;

  let mockGroqCreate: jest.Mock;
  let mockGeminiEmbed: jest.Mock;
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(async () => {
    const mockRedisServiceProvider = {
      provide: RedisService,
      useValue: {
        getCache: jest.fn(),
        setCache: jest.fn(),
        acquireLock: jest.fn(),
        releaseLock: jest.fn(),
        exists: jest.fn(),
      },
    };

    const mockConfigServiceProvider = {
      provide: ConfigService,
      useValue: {
        getOrThrow: jest.fn((key: string) => {
          if (key === 'ai.groq.model') return 'llama3-8b-8192';
          if (key === 'ai.gemini.embeddingModel') return 'text-embedding-004';
          return 'mock-key';
        }),
        get: jest.fn((key: string) => {
          if (key === 'ai.groq.maxCompletionTokens') return 1000;
          if (key === 'ai.gemini.embeddingTtlSeconds') return 3600;
          return 'mock-key';
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AiService, mockConfigServiceProvider, mockRedisServiceProvider],
    }).compile();

    service = module.get<AiService>(AiService);
    redisService = module.get(RedisService);

    mockGroqCreate = jest.fn();
    (service as any).groq = {
      chat: { completions: { create: mockGroqCreate } },
    };

    mockGeminiEmbed = jest.fn();
    (service as any).gemini = {
      models: { embedContent: mockGeminiEmbed },
    };

    // setTimeout 모킹 (비동기 루프 보장)
    setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
      setImmediate(cb);
      return 0 as any;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('filterBatchWithAi', () => {
    it('성공: AI 응답을 JSON으로 파싱하여 valuable_ids를 반환해야 한다', async () => {
      const mockResponse = {
        choices: [{ message: { content: '{"valuable_ids": [1, 2, 3]}' } }],
      };
      mockGroqCreate.mockResolvedValue(mockResponse);

      const result = await service.filterBatchWithAi({ items: [] as any });

      expect(result).toEqual([1, 2, 3]);
      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
    });

    it('성공: 설정된 maxCompletionTokens(1000)이 API 호출 파라미터에 전달되어야 한다', async () => {
      const mockResponse = {
        choices: [{ message: { content: '{"valuable_ids": []}' } }],
      };
      mockGroqCreate.mockResolvedValue(mockResponse);

      await service.filterBatchWithAi({ items: [] as any });

      expect(mockGroqCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_completion_tokens: 1000 }),
      );
    });

    it('실패: 400 Bad Request 에러 발생 시 재시도 없이 즉시 에러를 던져야 한다', async () => {
      const error400: any = new Error('Invalid Request');
      error400.status = 400;

      mockGroqCreate.mockRejectedValue(error400);

      await expect(service.filterBatchWithAi({ items: [] as any })).rejects.toThrow('Invalid Request');
      expect(mockGroqCreate).toHaveBeenCalledTimes(1); // 재시도 없이 1번만 호출
    });

    it('실패: 429 Rate Limit 발생 시 3번 재시도 후 에러를 던져야 한다', async () => {
      const error429: any = new Error('Rate Limit Exceeded');
      error429.status = 429;

      mockGroqCreate.mockRejectedValue(error429);

      await expect(service.filterBatchWithAi({ items: [] as any })).rejects.toThrow('Rate Limit Exceeded');
      expect(mockGroqCreate).toHaveBeenCalledTimes(3); // 3번 재시도 확인
    });

    it('실패: 구조적 429(Request too large)는 재시도 없이 즉시 에러를 던져야 한다', async () => {
      const error429: any = new Error('Request too large, please reduce max_completion_tokens');
      error429.status = 429;

      mockGroqCreate.mockRejectedValue(error429);

      await expect(service.filterBatchWithAi({ items: [] as any })).rejects.toThrow(
        'Request too large, please reduce max_completion_tokens',
      );
      expect(mockGroqCreate).toHaveBeenCalledTimes(1); // 재시도 없이 1번만 호출
    });

    it('성공: 일시적 429의 retry-after 헤더를 반영해 해당 시간만큼 대기해야 한다', async () => {
      const error429: any = new Error('Rate limit reached');
      error429.status = 429;
      error429.headers = {
        get: (name: string) => (name === 'retry-after' ? '9.36' : undefined),
      };

      mockGroqCreate.mockRejectedValue(error429);

      await expect(service.filterBatchWithAi({ items: [] as any })).rejects.toThrow(
        'Rate limit reached',
      );

      const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
      expect(delays[0]).toBe(9360); // 9.36초 → 9360ms 반영 확인
    });
  });

  describe('summarizeContentWithAi', () => {
    it('성공: 응답을 파싱하여 정해진 포맷으로 반환해야 한다 (short_summary 배열 처리 등)', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: '테스트 제목',
                short_summary: '문장 하나뿐인 요약',
                long_summary: '긴 요약입니다.',
                tags: ['NestJS', 'Redis'],
              }),
            },
          },
        ],
      };
      mockGroqCreate.mockResolvedValue(mockResponse);

      const result = await service.summarizeContentWithAi({
        title: '원본 제목',
        content: '내용',
      });

      expect(result).toEqual({
        title: '테스트 제목',
        short_summary: ['문장 하나뿐인 요약'],
        long_summary: '긴 요약입니다.',
        tags: 'NestJS, Redis',
      });
    });
  });

  describe('vectorEmbeddingWithAi', () => {
    it('입력값이 없으면 API를 호출하지 않고 빈 배열을 반환해야 한다', async () => {
      const result = await service.vectorEmbeddingWithAi({ texts: [] });
      expect(result).toEqual([]);
      expect(mockGeminiEmbed).not.toHaveBeenCalled();
    });

    it('성공: Gemini API를 호출하고 벡터 배열을 반환해야 한다', async () => {
      mockGeminiEmbed.mockResolvedValue({
        embeddings: [{ values: [0.1, 0.2, 0.3] }, { values: [0.4, 0.5, 0.6] }],
      });

      const result = await service.vectorEmbeddingWithAi({
        texts: ['text1', 'text2'],
      });

      expect(result).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
    });
  });

  describe('embedSearchQuery', () => {
    const query = '  NestJS    Redis  ';
    const cacheKey = 'emb:text-embedding-004:nestjs redis';

    it('시나리오 A: 캐시가 존재하면 API 호출 없이 캐시값을 반환해야 한다 (Cache Hit)', async () => {
      const cachedVector = [0.9, 0.8, 0.7];
      redisService.getCache.mockResolvedValue(cachedVector);

      const result = await service.embedSearchQuery(query);

      expect(result).toEqual(cachedVector);
      expect(mockGeminiEmbed).not.toHaveBeenCalled();
      expect(redisService.acquireLock).not.toHaveBeenCalled();
    });

    it('시나리오 B: 캐시가 없고 락을 획득하면, API를 호출하고 캐시를 저장한 뒤 락을 해제해야 한다', async () => {
      redisService.getCache.mockResolvedValue(null);
      redisService.acquireLock.mockResolvedValue('mock-uuid-lock');
      mockGeminiEmbed.mockResolvedValue({ embeddings: [{ values: [0.1, 0.1, 0.1] }] });

      const result = await service.embedSearchQuery(query);

      expect(result).toEqual([0.1, 0.1, 0.1]);
      expect(redisService.setCache).toHaveBeenCalledWith(
        expect.objectContaining({ key: cacheKey, value: [0.1, 0.1, 0.1] }),
      );
      expect(redisService.releaseLock).toHaveBeenCalledWith({
        key: `lock:${cacheKey}`,
        value: 'mock-uuid-lock',
      });
    });

    it('시나리오 C: 락 획득에 실패하면, 대기(waitForCache) 후 생성된 캐시를 반환해야 한다', async () => {
      redisService.getCache
        .mockResolvedValueOnce(null) // 최초 캐시 조회 (miss)
        .mockResolvedValueOnce(null) // waitForCache poll 1 (miss)
        .mockResolvedValueOnce([0.2, 0.2, 0.2]); // poll 2 (hit)

      redisService.acquireLock.mockResolvedValue(null);
      redisService.exists.mockResolvedValue(true); // poll 1에서 락이 여전히 존재 → 계속 대기

      const result = await service.embedSearchQuery(query);

      expect(result).toEqual([0.2, 0.2, 0.2]);
      expect(mockGeminiEmbed).not.toHaveBeenCalled();
      expect(redisService.setCache).not.toHaveBeenCalled();
    });

    it('시나리오 D: API 호출 중 에러가 발생하면 에러를 던지지 않고 null을 반환해야 한다', async () => {
      redisService.getCache.mockResolvedValue(null);
      redisService.acquireLock.mockResolvedValue('mock-lock');
      
      const error500: any = new Error('Gemini API quota exceeded');
      error500.status = 500;
      mockGeminiEmbed.mockRejectedValue(error500);

      const result = await service.embedSearchQuery(query);

      expect(result).toBeNull();
    });

    it('시나리오 E: 락 대기 중 선점 요청이 실패해 락이 해제되면, 최대 대기 없이 즉시 null을 반환해야 한다 (Early Exit)', async () => {
      redisService.getCache.mockResolvedValue(null); // 캐시는 계속 없음
      redisService.acquireLock.mockResolvedValue(null); // 락 획득 실패 → 대기 진입
      redisService.exists.mockResolvedValue(false); // 락이 이미 해제됨 (선점 요청 실패)

      const result = await service.embedSearchQuery(query);

      expect(result).toBeNull();
      expect(mockGeminiEmbed).not.toHaveBeenCalled();
      expect(redisService.exists).toHaveBeenCalledWith({ key: `lock:${cacheKey}` });
    });
  });
});