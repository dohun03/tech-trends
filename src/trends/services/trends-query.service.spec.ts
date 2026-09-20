import { Test, TestingModule } from '@nestjs/testing';
import { TrendsQueryService } from './trends-query.service';
import { TechTrendRepository } from '../repositories/tech-trend.repository';
import { TrendsCacheService } from '../cache/trends-cache.service';
import { AiService } from 'ai/ai.service';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

describe('TrendsQueryService', () => {
  let service: TrendsQueryService;
  let repository: jest.Mocked<TechTrendRepository>;
  let aiService: jest.Mocked<AiService>;
  let trendsCacheService: jest.Mocked<TrendsCacheService>;

  beforeEach(async () => {
    const mockRepository = {
      listTrends: jest.fn(),
      countTrends: jest.fn(),
      searchHybrid: jest.fn(),
      searchKeyword: jest.fn(),
      findUniqueSources: jest.fn(),
      findById: jest.fn(),
      findRelatedByEmbedding: jest.fn(),
    };

    const mockAiService = {
      embedSearchQuery: jest.fn(),
    };

    const mockTrendsCacheService = {
      getSources: jest.fn(),
      setSources: jest.fn().mockResolvedValue(undefined),
      invalidateSources: jest.fn(),
      getDetail: jest.fn(),
      setDetail: jest.fn().mockResolvedValue(undefined),
      getRelated: jest.fn(),
      setRelated: jest.fn().mockResolvedValue(undefined),
      getListCount: jest.fn(),
      setListCount: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrendsQueryService,
        { provide: TechTrendRepository, useValue: mockRepository },
        { provide: AiService, useValue: mockAiService },
        { provide: TrendsCacheService, useValue: mockTrendsCacheService },
      ],
    }).compile();

    service = module.get<TrendsQueryService>(TrendsQueryService);
    repository = module.get(TechTrendRepository);
    aiService = module.get(AiService);
    trendsCacheService = module.get(TrendsCacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listTrends', () => {
    it('listTrends를 호출하고 페이지네이션 메타데이터를 계산하여 반환해야 한다', async () => {
      const mockData = [{ id: 1, title: '테스트 아티클' }];
      repository.listTrends.mockResolvedValue(mockData as any);
      trendsCacheService.getListCount.mockResolvedValue(12);

      const result = await service.listTrends({});

      expect(repository.listTrends).toHaveBeenCalledWith({
        page: 1,
        limit: 5,
        source: 'ALL',
        isNew: false,
        sort: 'CREATED_DESC',
      });
      expect(result).toEqual({
        data: mockData,
        meta: {
          totalCount: 12,
          totalPages: 3,
          itemsPerPage: 5,
          currentPage: 1,
        },
      });
      expect(repository.countTrends).not.toHaveBeenCalled();
    });

    it('COUNT 캐시 미스 시 DB COUNT 후 캐시 저장을 요청해야 한다', async () => {
      repository.listTrends.mockResolvedValue([]);
      trendsCacheService.getListCount.mockResolvedValue(null);
      repository.countTrends.mockResolvedValue(12);

      await expect(
        service.listTrends({ source: 'github' }),
      ).resolves.toMatchObject({
        meta: { totalCount: 12 },
      });

      expect(repository.countTrends).toHaveBeenCalledWith({
        source: 'github',
        isNew: false,
      });
      expect(trendsCacheService.setListCount).toHaveBeenCalledWith(
        'github',
        false,
        12,
      );
    });

    it('캐시된 COUNT가 0이어도 유효한 값으로 사용해야 한다', async () => {
      repository.listTrends.mockResolvedValue([]);
      trendsCacheService.getListCount.mockResolvedValue(0);

      await expect(
        service.listTrends({ source: 'unknown' }),
      ).resolves.toMatchObject({
        meta: { totalCount: 0 },
      });

      expect(repository.countTrends).not.toHaveBeenCalled();
    });

    it('COUNT 캐시 조회 실패 시 DB COUNT로 폴백해야 한다', async () => {
      repository.listTrends.mockResolvedValue([]);
      trendsCacheService.getListCount.mockRejectedValue(
        new Error('Redis 다운'),
      );
      repository.countTrends.mockResolvedValue(7);

      await expect(service.listTrends({})).resolves.toMatchObject({
        meta: { totalCount: 7 },
      });

      expect(repository.countTrends).toHaveBeenCalledWith({
        source: 'ALL',
        isNew: false,
      });
    });

    it('처리 중 에러 발생 시 InternalServerErrorException을 던져야 한다', async () => {
      repository.listTrends.mockRejectedValue(new Error('DB 에러'));
      trendsCacheService.getListCount.mockResolvedValue(0);

      await expect(service.listTrends({})).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('searchTrends', () => {
    it('검색어가 존재하고 AI 벡터 임베딩이 있으면 searchHybrid를 호출해야 한다', async () => {
      const mockVector = [0.1, 0.2, 0.3];
      const mockResult = { data: [{ id: 1 }], totalCount: 1 };

      aiService.embedSearchQuery.mockResolvedValue(mockVector);
      repository.searchHybrid.mockResolvedValue(mockResult as any);

      const result = await service.searchTrends({
        search: '   NestJS   ',
        page: 2,
        limit: 10,
      });

      expect(aiService.embedSearchQuery).toHaveBeenCalledWith('NestJS');
      expect(repository.searchHybrid).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
        search: 'NestJS',
        source: 'ALL',
        isNew: false,
        vector: mockVector,
      });
      expect(repository.searchKeyword).not.toHaveBeenCalled();
      expect(result.meta.totalPages).toBe(1);
    });

    it('검색어가 존재하지만 AI 벡터 결과가 없거나 빈 배열이면 searchKeyword를 호출해야 한다', async () => {
      const mockResult = { data: [{ id: 2 }], totalCount: 5 };

      aiService.embedSearchQuery.mockResolvedValue([]); // 빈 벡터
      repository.searchKeyword.mockResolvedValue(mockResult as any);

      const result = await service.searchTrends({ search: 'Redis' });

      expect(aiService.embedSearchQuery).toHaveBeenCalledWith('Redis');
      expect(repository.searchKeyword).toHaveBeenCalledWith({
        page: 1,
        limit: 5,
        search: 'Redis',
        source: 'ALL',
        isNew: false,
        sort: 'RELEVANCE',
      });
      expect(repository.searchHybrid).not.toHaveBeenCalled();
      expect(result.meta.totalPages).toBe(1);
    });

    it('AI 임베딩 결과가 null(API 실패/타임아웃)이면 searchKeyword를 호출해야 한다', async () => {
      aiService.embedSearchQuery.mockResolvedValue(null);
      repository.searchKeyword.mockResolvedValue({
        data: [],
        totalCount: 0,
      } as any);

      await service.searchTrends({ search: 'Redis' });

      expect(repository.searchKeyword).toHaveBeenCalled();
      expect(repository.searchHybrid).not.toHaveBeenCalled();
    });

    it('searchType이 "keyword"일 경우 AI 임베딩을 생략하고 바로 searchKeyword를 호출해야 한다', async () => {
      const mockResult = {
        data: [{ id: 3, title: '키워드 검색 테스트' }],
        totalCount: 1,
      };

      repository.searchKeyword.mockResolvedValue(mockResult as any);

      const result = await service.searchTrends({
        search: ' NestJS ',
        searchType: 'keyword',
        page: 1,
        limit: 5,
      });

      expect(aiService.embedSearchQuery).not.toHaveBeenCalled();

      expect(repository.searchKeyword).toHaveBeenCalledWith({
        page: 1,
        limit: 5,
        search: 'NestJS',
        source: 'ALL',
        isNew: false,
        sort: 'RELEVANCE',
      });

      expect(repository.searchHybrid).not.toHaveBeenCalled();

      expect(result.data).toEqual(mockResult.data);
      expect(result.meta.totalCount).toBe(1);
    });
  });

  describe('getUniqueSources', () => {
    it('성공: 캐시 HIT 시 DB 조회 없이 캐시값을 반환해야 한다', async () => {
      const mockSources = ['dev.to', 'geeknews', 'stackoverflow'];
      trendsCacheService.getSources.mockResolvedValue(mockSources);

      const result = await service.getUniqueSources();

      expect(result).toEqual(mockSources);
      expect(trendsCacheService.getSources).toHaveBeenCalledTimes(1);
      expect(repository.findUniqueSources).not.toHaveBeenCalled();
      expect(trendsCacheService.setSources).not.toHaveBeenCalled();
    });

    it('성공: 캐시 MISS 시 DB 조회 후 캐시를 저장하고 반환해야 한다', async () => {
      const mockSources = ['dev.to', 'geeknews', 'stackoverflow'];
      trendsCacheService.getSources.mockResolvedValue(null);
      repository.findUniqueSources.mockResolvedValue(mockSources);

      const result = await service.getUniqueSources();

      expect(result).toEqual(mockSources);
      expect(repository.findUniqueSources).toHaveBeenCalledTimes(1);
      expect(trendsCacheService.setSources).toHaveBeenCalledWith(mockSources);
    });

    it('캐시 조회 실패 시 DB로 폴백하여 정상 반환해야 한다', async () => {
      const mockSources = ['dev.to'];
      trendsCacheService.getSources.mockRejectedValue(new Error('Redis 다운'));
      repository.findUniqueSources.mockResolvedValue(mockSources);

      const result = await service.getUniqueSources();

      expect(result).toEqual(mockSources);
      expect(repository.findUniqueSources).toHaveBeenCalledTimes(1);
    });

    it('캐시 저장 실패가 DB 조회 응답을 실패시키지 않아야 한다', async () => {
      const mockSources = ['dev.to'];
      trendsCacheService.getSources.mockResolvedValue(null);
      repository.findUniqueSources.mockResolvedValue(mockSources);
      trendsCacheService.setSources.mockRejectedValue(new Error('Redis 다운'));

      await expect(service.getUniqueSources()).resolves.toEqual(mockSources);
      await new Promise((resolve) => setImmediate(resolve));

      expect(trendsCacheService.setSources).toHaveBeenCalledWith(mockSources);
    });

    it('실패: InternalServerErrorException을 던져야 한다', async () => {
      trendsCacheService.getSources.mockResolvedValue(null);
      repository.findUniqueSources.mockRejectedValue(new Error('DB 에러'));

      await expect(service.getUniqueSources()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('getTrendById', () => {
    it('캐시 HIT 시 DB 조회 없이 detail을 반환해야 한다', async () => {
      const mockArticle = { id: 1, title: '캐시된 단건' };
      trendsCacheService.getDetail.mockResolvedValue(mockArticle as any);

      await expect(service.getTrendById(1)).resolves.toEqual(mockArticle);
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('detail 캐시 조회 실패 시 DB로 폴백해야 한다', async () => {
      const mockArticle = { id: 1, title: 'DB 단건' };
      trendsCacheService.getDetail.mockRejectedValue(new Error('Redis 다운'));
      repository.findById.mockResolvedValue(mockArticle as any);

      await expect(service.getTrendById(1)).resolves.toEqual(mockArticle);
      expect(repository.findById).toHaveBeenCalledWith(1);
    });

    it('성공: ID에 해당하는 아티클 단건을 반환해야 한다', async () => {
      const mockArticle = { id: 1, title: '단건 테스트' };
      repository.findById.mockResolvedValue(mockArticle as any);
      trendsCacheService.getDetail.mockResolvedValue(null);

      const result = await service.getTrendById(1);

      expect(result).toEqual(mockArticle);
      expect(repository.findById).toHaveBeenCalledWith(1);
    });

    it('아티클이 존재하지 않을 경우 NotFoundException을 던져야 한다', async () => {
      repository.findById.mockResolvedValue(null);
      trendsCacheService.getDetail.mockResolvedValue(null);

      await expect(service.getTrendById(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('DB 접근 중 원인 불명의 에러 발생 시 InternalServerErrorException을 던져야 한다', async () => {
      repository.findById.mockRejectedValue(new Error('DB 다운'));
      trendsCacheService.getDetail.mockResolvedValue(null);

      await expect(service.getTrendById(1)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('getRelatedTrends', () => {
    it('캐시 HIT 시 detail 및 related DB 조회 없이 반환해야 한다', async () => {
      const cached = { data: [{ id: 2, title: '캐시된 연관 글' }] };
      trendsCacheService.getRelated.mockResolvedValue(cached as any);

      await expect(service.getRelatedTrends(1, 5)).resolves.toEqual(cached);
      expect(repository.findById).not.toHaveBeenCalled();
      expect(repository.findRelatedByEmbedding).not.toHaveBeenCalled();
    });

    it('성공: embedding이 존재하면 findRelatedByEmbedding을 호출하고 결과를 반환해야 한다', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockArticle = {
        id: 1,
        title: '기준 아티클',
        embedding: mockEmbedding,
      };
      const mockRelated = [
        { id: 2, title: '연관 아티클 1' },
        { id: 3, title: '연관 아티클 2' },
      ];

      repository.findById.mockResolvedValue(mockArticle as any);
      repository.findRelatedByEmbedding.mockResolvedValue(mockRelated as any);
      trendsCacheService.getRelated.mockResolvedValue(null);
      trendsCacheService.getDetail.mockResolvedValue(null);

      const result = await service.getRelatedTrends(1, 5);

      expect(repository.findById).toHaveBeenCalledWith(1);
      expect(repository.findRelatedByEmbedding).toHaveBeenCalledWith({
        excludeId: 1,
        embedding: mockEmbedding,
        limit: 5,
      });
      expect(result).toEqual({ data: mockRelated });
    });

    it('아티클이 존재하지 않을 경우 NotFoundException을 던져야 한다', async () => {
      repository.findById.mockResolvedValue(null);
      trendsCacheService.getRelated.mockResolvedValue(null);
      trendsCacheService.getDetail.mockResolvedValue(null);

      await expect(service.getRelatedTrends(999, 5)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.findRelatedByEmbedding).not.toHaveBeenCalled();
    });

    it('아티클의 embedding이 null이거나 빈 배열이면 findRelatedByEmbedding 호출 없이 빈 배열을 반환해야 한다', async () => {
      const mockArticleWithoutEmbedding = {
        id: 1,
        title: '임베딩 없음',
        embedding: null,
      };
      repository.findById.mockResolvedValue(mockArticleWithoutEmbedding as any);
      trendsCacheService.getRelated.mockResolvedValue(null);
      trendsCacheService.getDetail.mockResolvedValue(null);

      const result = await service.getRelatedTrends(1, 5);

      expect(repository.findById).toHaveBeenCalledWith(1);
      expect(repository.findRelatedByEmbedding).not.toHaveBeenCalled();
      expect(result).toEqual({ data: [] });
    });

    it('DB 조회 중 에러 발생 시 InternalServerErrorException을 던져야 한다', async () => {
      repository.findById.mockRejectedValue(new Error('DB 에러'));
      trendsCacheService.getRelated.mockResolvedValue(null);
      trendsCacheService.getDetail.mockResolvedValue(null);

      await expect(service.getRelatedTrends(1, 5)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
