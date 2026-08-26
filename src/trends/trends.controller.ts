import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { TrendsPipelineService } from './services/trends-pipeline.service';
import { ListTrendsQueryDto } from './dto/list-trends-query.dto';
import { TrendsQueryService } from './services/trends-query.service';
import { Throttle } from '@nestjs/throttler';
import { SearchTrendsQueryDto } from './dto/search-trends-query.dto';
import { GetRelatedTrendsQueryDto } from './dto/get-related-trends-query.dto';

@Controller('trends')
export class TrendsController {
  constructor(
    private readonly trendsQueryService: TrendsQueryService,
    private readonly trendsPipelineService: TrendsPipelineService,
  ) {}

  // 트렌드 목록
  @Get()
  getTrends(@Query() query: ListTrendsQueryDto) {
    return this.trendsQueryService.listTrends(query);
  }

  // 검색
  @Throttle({ global: { limit: 5, ttl: 10000 } })
  @Get('search')
  searchTrends(@Query() query: SearchTrendsQueryDto) {
    return this.trendsQueryService.searchTrends(query);
  }

  // 출처 목록 조회
  @Get('sources')
  async getSources() {
    return this.trendsQueryService.getUniqueSources();
  }

  // 스크래핑 테스트용 엔드포인트
  @Get('test-scraping')
  async runScrapingTest() {
    await this.trendsPipelineService.dispatchAllScrapersToQueue();

    return {
      success: true,
      message: '백엔드 터미널 콘솔을 확인해보세요!',
    };
  }

  // 단일 아티클 조회
  @Get(':id')
  getTrendById(@Param('id', ParseIntPipe) id: number) {
    return this.trendsQueryService.getTrendById(id);
  }

  // 임베딩 기반 연관 아티클 조회
  @Get(':id/related')
  getRelatedTrends(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetRelatedTrendsQueryDto,
  ) {
    return this.trendsQueryService.getRelatedTrends(id, query.limit ?? 5);
  }
}
