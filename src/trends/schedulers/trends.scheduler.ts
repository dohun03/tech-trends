import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TrendsPipelineService } from '../services/trends-pipeline.service';

@Injectable()
export class TrendsScheduler implements OnModuleInit {
  private readonly logger = new Logger(TrendsScheduler.name);

  constructor(
    private readonly trendsPipelineService: TrendsPipelineService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const cronTime = this.configService.get<string>('CRON_SCHEDULE', '0 1 * * *');
    const timeZone = this.configService.get<string>('TZ', 'Asia/Seoul');

    const job = new CronJob(
      cronTime,
      async () => {
        this.logger.log('[Scheduler] 트렌드 수집 큐 등록 시작');
        await this.trendsPipelineService.dispatchAllScrapersToQueue();
      },
      null,
      true,
      timeZone,
    );

    this.schedulerRegistry.addCronJob('devto-trends-collector', job);
    this.logger.log(`[Scheduler] 크론 스케줄 등록 완료: ${cronTime} (${timeZone})`);
  }
}