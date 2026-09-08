import { Test, TestingModule } from '@nestjs/testing';
import { TrendsWorker } from './trends.worker';
import { TrendsPipelineService } from 'trends/services/trends-pipeline.service';

describe('TrendsWorker', () => {
  let worker: TrendsWorker;
  let pipelineService: jest.Mocked<TrendsPipelineService>;

  beforeEach(async () => {
    const mockPipelineService = { executeScraperByName: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrendsWorker,
        { provide: TrendsPipelineService, useValue: mockPipelineService },
      ],
    }).compile();

    worker = module.get<TrendsWorker>(TrendsWorker);
    pipelineService = module.get(TrendsPipelineService);
  });

  it('수집 작업 성공 시 결과를 반환해야 한다 (Redis 락 해제 없음)', async () => {
    const mockJob = { id: '1', data: 'dev.to' } as any;
    pipelineService.executeScraperByName.mockResolvedValue({ processedCount: 5 } as any);

    const result = await worker.process(mockJob);

    expect(result).toEqual({ processedCount: 5 });
    expect(pipelineService.executeScraperByName).toHaveBeenCalledWith('dev.to');
  });

  it('수집 작업 실패 시 에러를 그대로 전파해야 한다', async () => {
    const mockJob = { id: '2', data: 'dev.to' } as any;
    pipelineService.executeScraperByName.mockRejectedValue(new Error('수집 에러'));

    await expect(worker.process(mockJob)).rejects.toThrow('수집 에러');
    expect(pipelineService.executeScraperByName).toHaveBeenCalledWith('dev.to');
  });
});