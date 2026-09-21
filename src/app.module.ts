import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { TrendsModule } from 'trends/trends.module';
import { BullModule } from '@nestjs/bullmq';
import { WinstonModule } from 'nest-winston';
import { winstonLoggerOptions } from './common/config/logger.config';
import aiConfig from './ai/config/ai.config';
import { RedisModule } from './redis/redis.module';
import {
  createRedisThrottleKey,
  getRedisThrottleTracker,
  RedisThrottlerStorage,
} from './redis/redis-throttler.storage';
import redisConfig, { RedisConnectionConfig } from './redis/redis.config';

@Module({
  imports: [
    WinstonModule.forRoot(winstonLoggerOptions),
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [aiConfig, redisConfig],
    }),

    // BullMQ는 캐시와 분리된 전용 Redis를 사용한다.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const connection =
          configService.getOrThrow<RedisConnectionConfig>('redis.queue');

        return {
          connection: {
            ...connection,
            // BullMQ의 blocking connection이 재시도 한도를 자체 관리하므로
            // ioredis 재시도 한도는 반드시 null이어야 한다.
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    // 트렌드 수집용 큐 등록
    BullModule.registerQueue({
      name: 'trend-scraper-queue',
    }),

    // 전역 설정은 1분에 100번으로 요청 제한
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        // Redis TTL 기반 storage와 가벼운 raw key 생성으로 in-memory timer를 제거한다.
        storage,
        getTracker: getRedisThrottleTracker,
        generateKey: createRedisThrottleKey,
        throttlers: [
          {
            name: 'global',
            ttl: 60000,
            limit: 100,
          },
        ],
      }),
    }),
    DatabaseModule,
    TrendsModule,
  ],
  providers: [
    // 모든 컨트롤러에 Throttler 자동 적용
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
