import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { startPerfMonitor } from './common/perf/perf-monitor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);

  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');

  const corsOriginEnv = configService.get<string>('CORS_ORIGIN');
  const allowedOrigins = corsOriginEnv
    ? corsOriginEnv.split(',').map((origin) => origin.trim())
    : ['http://localhost:8080', 'http://127.0.0.1:8080'];

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);

  // 이벤트 루프/메모리 모니터링 (ENABLE_PERF_LOG=true 일 때만 동작)
  startPerfMonitor();
}
bootstrap();