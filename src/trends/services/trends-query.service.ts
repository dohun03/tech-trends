import {
  Injectable,
  Logger,
  InternalServerErrorException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { AiService } from 'ai/ai.service';
import { ListTrendsQueryDto } from 'trends/dto/list-trends-query.dto';
import { SearchTrendsQueryDto } from 'trends/dto/search-trends-query.dto';
import { TechTrend } from 'trends/entities/tech-trend.entity';
import { RelatedTrendRow, TechTrendRepository } from 'trends/repositories/tech-trend.repository';
import { TrendsCacheService } from 'trends/cache/trends-cache.service';

@Injectable()
export class TrendsQueryService {
  private readonly logger = new Logger(TrendsQueryService.name);
  // 동일 key의 캐시 미스를 한번의 DB 조회로 끝냄
  private readonly detailLoads = new Map<number, Promise<TechTrend>>();
  private readonly relatedLoads = new Map<string, Promise<{ data: RelatedTrendRow[] }>>();

  constructor(
    private readonly techTrendRepository: TechTrendRepository,
    private readonly aiService: AiService,
    private readonly trendsCacheService: TrendsCacheService,
  ) {}

  // 일반 목록 조회
  async listTrends(query: ListTrendsQueryDto) {
    try {
      const {
        page = 1,
        limit = 5,
        source = 'ALL',
        isNew = false,
        sort = 'CREATED_DESC',
      } = query;
      const result = await this.techTrendRepository.listTrends({
        page,
        limit,
        source,
        isNew,
        sort,
      });

      return {
        data: result.data,
        meta: {
          totalCount: result.totalCount,
          totalPages: Math.ceil(result.totalCount / limit),
          itemsPerPage: limit,
          currentPage: page,
        },
      };
    } catch (error) {
      this.logger.error(`[listTrends] 조회 에러: ${error}`);
      throw new InternalServerErrorException(
        '트렌드 목록 조회 중 에러가 발생했습니다.',
      );
    }
  }

  // 검색 분기 처리
  async searchTrends(query: SearchTrendsQueryDto) {
    const {
      page = 1,
      limit = 5,
      search,
      source = 'ALL',
      isNew = false,
      searchType = 'hybrid',
      sort = 'RELEVANCE',
    } = query;

    let result: { data: TechTrend[]; totalCount: number };

    // 단순 키워드 검색 (정렬 선택 가능)
    if (searchType === 'keyword') {
      result = await this.techTrendRepository.searchKeyword({
        page,
        limit,
        search: search.trim(),
        source,
        isNew,
        sort,
      });
    }
    // 하이브리드 검색 (RRF 점수 기반이므로 정확도순 고정)
    else {
      const vector = await this.aiService.embedSearchQuery(search.trim());

      result =
        vector && vector.length > 0
          ? await this.techTrendRepository.searchHybrid({
              page,
              limit,
              search: search.trim(),
              source,
              isNew,
              vector,
            })
          : await this.techTrendRepository.searchKeyword({
              page,
              limit,
              search: search.trim(),
              source,
              isNew,
              sort,
            });
    }

    return {
      data: result.data,
      meta: {
        totalCount: result.totalCount,
        totalPages: Math.ceil(result.totalCount / limit),
        itemsPerPage: limit,
        currentPage: page,
      },
    };
  }

  // 출처 목록 조회
  async getUniqueSources(): Promise<string[]> {
    try {
      // 캐시 조회: Redis 장애는 조회 API를 막지 않고 DB 조회로 폴백
      const cached = await this.trendsCacheService
        .getSources()
        .catch(() => null);
      if (cached) return cached;

      // 캐시 미스: DB 조회
      const sources = await this.techTrendRepository.findUniqueSources();

      // 캐시 저장 결과와 상관 없이 DB 결과 바로 반환
      this.writeCache(
        'getUniqueSources',
        this.trendsCacheService.setSources(sources),
      );

      return sources;
    } catch (error) {
      this.logger.error(`[getUniqueSources] 소스 목록 조회 에러: ${error}`);
      throw new InternalServerErrorException('출처 목록을 불러오지 못했습니다.');
    }
  }

  // 특정 아티클 조회
  async getTrendById(id: number) {
    try {
      // 캐시 조회
      const cached = await this.trendsCacheService
        .getDetail<TechTrend>(id)
        .catch(() => null);
      if (cached) return cached;

      // 캐시 미스: 락 걸기
      const pending = this.detailLoads.get(id);
      if (pending) return await pending;

      // 캐시 미스: 아무도 없으면 내가 DB 조회
      const load = this.loadDetail(id);
      this.detailLoads.set(id, load);
      const article = await load;

      if (!article) {
        throw new NotFoundException(`ID가 ${id}인 아티클을 찾을 수 없습니다.`);
      }

      return article;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`[getTrendById] 단건 조회 에러 (ID: ${id}): ${error}`);
      throw new InternalServerErrorException('아티클 상세 정보를 불러오는 중 에러가 발생했습니다.');
    }
  }

  // getTrendById: DB 작업
  private async loadDetail(id: number): Promise<TechTrend> {
    try {
      const article = await this.techTrendRepository.findById(id);
      if (!article) {
        throw new NotFoundException(`ID가 ${id}인 아티클을 찾을 수 없습니다.`);
      }

      // 캐시 저장 결과와 상관 없이 DB 결과 바로 반환
      this.writeCache(
        'getTrendById',
        this.trendsCacheService.setDetail(id, article),
      );

      return article;
    } finally {
      this.detailLoads.delete(id);
    }
  }

  // 연관 아티클 조회
  async getRelatedTrends(id: number, limit: number) {
    try {
      // 캐시 조회
      const cached = await this.trendsCacheService
        .getRelated<{ data: RelatedTrendRow[] }>(id, limit)
        .catch(() => null);
      if (cached) return cached;
      
      // 캐시 미스: 락 걸기
      const key = `${id}:${limit}`;
      const pending = this.relatedLoads.get(key);
      if (pending) return await pending;

      // 캐시 미스: 아무도 없으면 내가 DB 조회
      const load = this.loadRelated(id, limit);
      this.relatedLoads.set(key, load);

      return await load;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`[getRelatedTrends] 연관 아티클 조회 에러 (ID: ${id}): ${error}`);
      throw new InternalServerErrorException('연관 아티클을 불러오는 중 에러가 발생했습니다.');
    }
  }

  // getRelatedTrends: DB 작업
  private async loadRelated(id: number, limit: number): Promise<{ data: RelatedTrendRow[] }> {
    try {
      // 본문 먼저 조회
      const article = await this.getTrendById(id);
      if (!article) {
        throw new NotFoundException(`ID가 ${id}인 아티클을 찾을 수 없습니다.`);
      }

      if (!article.embedding || article.embedding.length === 0) {
        const result = { data: [] };
        // 빈 결과도 캐싱
        this.writeCache(
          'getRelatedTrends',
          this.trendsCacheService.setRelated(id, limit, result),
        );
        return result;
      }

      // DB 임베딩 연산
      const data = await this.techTrendRepository.findRelatedByEmbedding({
        excludeId: id,
        embedding: article.embedding,
        limit,
      });

      const result = { data };
      this.writeCache(
        'getRelatedTrends',
        this.trendsCacheService.setRelated(id, limit, result),
      );
      return result;
    } finally {
      this.relatedLoads.delete(`${id}:${limit}`);
    }
  }

  // Redis 캐시 저장 공통 로직 (실패는 기록하되 결과는 이미 확보한 DB 결과로 반환)
  private writeCache(operation: string, write: Promise<void>): void {
    void write.catch((error) => {
      this.logger.warn(`[${operation}] 캐시 저장 실패(무시): ${error}`);
    });
  }
}
