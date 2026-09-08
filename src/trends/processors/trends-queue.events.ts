import { OnQueueEvent, QueueEventsHost, QueueEventsListener } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ScrapeJobResult, SavedArticleInfo } from '../interfaces/scraper.interface';
import { TechTrendRepository } from '../repositories/tech-trend.repository';
import { getTodayStartUtc } from '../../common/utils/time.util';

@QueueEventsListener('trend-scraper-queue')
export class TrendQueueEventsListener extends QueueEventsHost {
  private readonly logger = new Logger(TrendQueueEventsListener.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly techTrendRepository: TechTrendRepository,
  ) {
    super();
  }

  // 작업 성공 시 실행
  @OnQueueEvent('completed')
  async onCompleted(event: { jobId: string; returnvalue: string | ScrapeJobResult }) {
    this.logger.log(`[Queue Success] Job ${event.jobId} 완료`);

    let result: ScrapeJobResult | null = null;
    try {
      result = typeof event.returnvalue === 'string'
        ? JSON.parse(event.returnvalue)
        : event.returnvalue;
    } catch (_) {
      result = null;
    }

    const baseUrl = this.configService.get<string>('CLIENT_URL', 'http://localhost:3000');

    // 최종 완료 시점에 "오늘 이 소스로 저장된 전체"를 DB에서 조회해 노출한다.
    const sourceName = result?.sourceName ?? null;
    let todaySavedArticles: SavedArticleInfo[] = [];
    if (sourceName) {
      try {
        todaySavedArticles = await this.techTrendRepository.findSavedSince(sourceName, getTodayStartUtc());
      } catch (error: any) {
        this.logger.error(`[Queue Success] 오늘 누적 아티클 조회 실패 | source=${sourceName}, error=${error.message}`);
        todaySavedArticles = [];
      }
    }
    const savedCount = todaySavedArticles.length;

    // 관리자용 모니터링 알림 메시지
    let adminMessage = `✅ **[BullMQ 스크래퍼 성공]**\n- Job ID: \`${event.jobId}\``;
    if (sourceName) {
      adminMessage += `\n- 수집 출처: \`${sourceName}\``;
      adminMessage += `\n- 저장 건수(오늘 누계): **${savedCount}개**`;
    }

    // 유저용 아티클 알림 메시지 (오늘 누계)
    let userMessage = '';
    if (sourceName && todaySavedArticles.length > 0) {
      userMessage = `📢 **[${sourceName}] 새로운 트렌드 아티클이 도착했습니다!**\n`;

      for (let idx = 0; idx < todaySavedArticles.length; idx++) {
        const article = todaySavedArticles[idx];
        const detailUrl = `${baseUrl}/?id=${article.id}`;

        // 디스코드 문법 파괴 기호에 백슬래시(\) 이스케이프 적용
        const safeTitle = article.title
          .replace(/[\r\n]+/g, ' ')
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`')
          .replace(/\[/g, '\\[')
          .replace(/\]/g, '\\]')
          .replace(/\(/g, '\\(')
          .replace(/\)/g, '\\)');

        const appendStr = `\n${idx + 1}. [${safeTitle}](<${detailUrl}>)`;

        if (userMessage.length + appendStr.length > 1800) {
          userMessage += `\n\n...외 **${todaySavedArticles.length - idx}개**의 아티클이 더 있습니다.`;
          break;
        }

        userMessage += appendStr;
      }
    }

    // 관리자 채널 발송
    await this.sendNotification(adminMessage, 'ADMIN');

    // 유저 채널 발송
    if (userMessage) {
      await this.sendNotification(userMessage, 'USER');
    }
  }

  // 작업 실패 시 실행
  @OnQueueEvent('failed')
  async onFailed(event: { jobId: string; failedReason: string }) {
    this.logger.error(`[Queue Error] Job ${event.jobId} 실패: ${event.failedReason}`);

    const adminMessage = `🚨 **[BullMQ 스크래퍼 실패]**\n- Job ID: \`${event.jobId}\`\n- 사유: \`${event.failedReason}\``;
    await this.sendNotification(adminMessage, 'ADMIN');
  }

  // 공통 디스코드 발송 함수
  private async sendNotification(message: string, target: 'ADMIN' | 'USER') {
    const envKey = target === 'ADMIN' ? 'DISCORD_ADMIN_WEBHOOK_URL' : 'DISCORD_USER_WEBHOOK_URL';
    const webhookUrl = this.configService.get<string>(envKey);

    if (!webhookUrl) {
      this.logger.warn(`Discord Webhook URL이 설정되지 않았습니다: ${envKey}`);
      return;
    }

    let safeMessage = message;
    if (safeMessage.length > 2000) {
      safeMessage = safeMessage.substring(0, 1950) + '\n\n... (길이 초과로 절삭됨)';
    }

    try {
      await axios.post(webhookUrl, { content: safeMessage });
    } catch (err: any) {
      this.logger.error(`Discord (${target}) 발송 실패: ${err.message}`);
    }
  }
}