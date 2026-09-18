import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { TechTrend } from '../trends/entities/tech-trend.entity';
import { InitTechTrendSchema1785067830260 } from './migrations/1785067830260-InitTechTrendSchema';
import { AddTechTrendSearchIndexes1785074539944 } from './migrations/1785074539944-AddTechTrendSearchIndexes';
import { AddMetricsToTechTrend1786259764774 } from './migrations/1786259764774-AddMetricsToTechTrend';
import { AddTrendSortIndexes1789888000000 } from './migrations/1789888000000-AddTrendSortIndexes';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),
        entities: [TechTrend],
        synchronize: false,
        migrationsRun: true,
        migrations: [
          InitTechTrendSchema1785067830260,
          AddTechTrendSearchIndexes1785074539944,
          AddMetricsToTechTrend1786259764774,
          AddTrendSortIndexes1789888000000,
        ],
        logging: false,
        extra: {
          max: 5, // 최대 커넥션 수
          connectionTimeoutMillis: 2000, // 커넥션 획득 대기 타임아웃 (2초)
          options: '-c timezone=Asia/Seoul',
        },
      }),
    }),
  ],
})
export class DatabaseModule {}