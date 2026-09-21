import { registerAs } from '@nestjs/config';

export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
}

function getRedisConnectionConfig(prefix: 'REDIS_CACHE' | 'REDIS_QUEUE'): RedisConnectionConfig {
  const password = process.env[`${prefix}_PASSWORD`];

  return {
    host: process.env[`${prefix}_HOST`] || 'localhost',
    port: Number(process.env[`${prefix}_PORT`]) || 6379,
    password: password || undefined,
  };
}

export default registerAs('redis', () => ({
  cache: getRedisConnectionConfig('REDIS_CACHE'),
  queue: getRedisConnectionConfig('REDIS_QUEUE'),
}));
