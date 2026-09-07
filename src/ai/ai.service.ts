import { Injectable, Logger } from '@nestjs/common';
import Groq from 'groq-sdk';
import { GoogleGenAI } from '@google/genai';
import { BatchEvaluationResult, FilterBatchParams, FinalSummaryResult, SummarizeContentParams, VectorEmbeddingParams } from './interfaces/ai.interface';
import { RedisService } from 'redis/redis.service';
import { ConfigService } from '@nestjs/config';
import { Semaphore } from 'async-mutex';

// 프롬프트 빌더 Import
import { buildFilterBatchPrompt } from './prompts/filter-batch.prompt';
import { buildSummarizeContentPrompt } from './prompts/summarize-content.prompt';

interface ExecuteWithRetryParams<T> {
  operation: () => Promise<T>;
  context: string;
  maxRetries?: number;
  baseDelayMs?: number;
}

interface WaitForCacheParams {
  cacheKey: string;
  maxRetries?: number;
  delayMs?: number;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly semaphore = new Semaphore(3);

  private groq: Groq;
  private gemini: GoogleGenAI;

  private readonly groqModelName: string;
  private readonly maxCompletionTokens: number;
  private readonly embeddingModelName: string;
  private readonly embeddingTtlSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.groqModelName = this.configService.getOrThrow<string>('ai.groq.model');
    this.maxCompletionTokens = this.configService.get<number>('ai.groq.maxCompletionTokens') ?? 1000;
    this.embeddingModelName = this.configService.getOrThrow<string>('ai.gemini.embeddingModel');
    this.embeddingTtlSeconds = Number(this.configService.get<number>('ai.gemini.embeddingTtlSeconds')) || 2592000;

    this.groq = new Groq({
      apiKey: this.configService.get<string>('ai.groq.apiKey'),
    });

    this.gemini = new GoogleGenAI({
      apiKey: this.configService.get<string>('ai.gemini.apiKey'),
    });
  }

  // [공통 재시도 로직]
  private async executeWithRetry<T>(params: ExecuteWithRetryParams<T>): Promise<T> {
    const { operation, context, maxRetries = 3, baseDelayMs = 2000 } = params;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        const status = error?.status || error?.response?.status || error?.statusCode;
        const msg = String(error?.message ?? error?.error?.message ?? '');

        const isStructuralOverflow = status === 429 && msg.includes('Request too large');
        if (isStructuralOverflow) {
          this.logger.error(
            `[Retry:${context}] 구조적 한도 초과(Request too large). 재시도 중단. | error=${error.message}`,
          );
          throw error;
        }

        const isNonRetryable = status && status >= 400 && status < 500 && status !== 429;
        if (isNonRetryable) {
          this.logger.error(
            `[Retry:${context}] 복구 불가능한 에러 (Status: ${status}). 즉시 중단합니다. | error=${error.message}`,
          );
          throw error;
        }

        if (attempt === maxRetries) {
          this.logger.error(
            `[Retry:${context}] 최종 실패 (Status: ${status || 'Unknown'}, ${attempt}회 초과) | error=${error.message}`,
          );
          throw error;
        }

        // 재시도 대상 에러 (일시적 429, 5xx)
        const multiplier = status === 429 ? 3 : 2;
        const fallbackDelay = baseDelayMs * Math.pow(multiplier, attempt - 1);
        const retryAfterMs = this.extractRetryAfterMs(error);
        const delay = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : fallbackDelay;

        this.logger.warn(
          `[Retry:${context}] 일시적 오류 (Status: ${status || 'Unknown'}). ${delay}ms 후 재시도 (${attempt}/${maxRetries}) | error=${error.message}`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error('Unreachable code');
  }

  // 일시적 429 응답의 재시도 대기 시간(ms) 추출 (retry-after / x-ratelimit-reset-tokens)
  private extractRetryAfterMs(error: any): number | null {
    const headers = error?.headers ?? error?.response?.headers ?? error?.error?.headers;
    if (!headers) return null;

    const get = (name: string): string | undefined => {
      if (typeof headers.get === 'function') return headers.get(name);
      return headers[name] ?? headers[name.toLowerCase()];
    };

    // retry-after(초): Groq "Please try again in Xs" 값
    const retryAfter = get('retry-after');
    if (retryAfter) {
      const seconds = parseFloat(retryAfter);
      if (!Number.isNaN(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
    }

    // x-ratelimit-reset-tokens(초): 리셋까지 남은 시간
    const resetTokens = get('x-ratelimit-reset-tokens');
    if (resetTokens) {
      const seconds = parseFloat(resetTokens);
      if (!Number.isNaN(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
    }

    return null;
  }

  // AI 필터 평가
  async filterBatchWithAi(params: FilterBatchParams): Promise<string[]> {
    const { items } = params;

    const prompt = buildFilterBatchPrompt(params);

    this.logger.debug(`[AI:Groq-Filter] 가치 평가 API 호출 | 대상=${items.length}개, 프롬프트길이=${prompt.length}자`);

    try {
      const parsed = await this.executeWithRetry({
        operation: async () => {
          const startTime = Date.now();
          const response = await this.groq.chat.completions.create({
            model: this.groqModelName,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_completion_tokens: this.maxCompletionTokens,
            reasoning_effort: 'none',
          });

          this.logger.debug(`[AI:Groq-Filter] API 응답 수신 완료 | 소요시간=${Date.now() - startTime}ms`);

          const raw = response.choices[0]?.message?.content;
          if (!raw) throw new Error('AI 응답이 비어 있습니다.');

          return JSON.parse(raw) as BatchEvaluationResult;
        },
        context: 'Groq-FilterBatch',
      });

      return parsed.valuable_ids || [];
    } catch (error: any) {
      this.logger.error(`[AI:Groq] 배치 가치 평가 최종 실패. | error=${error.message}`);
      throw error;
    }
  }

  // AI 요약
  async summarizeContentWithAi(params: SummarizeContentParams): Promise<FinalSummaryResult | null> {
    const { title, content } = params;

    const prompt = buildSummarizeContentPrompt(params);

    this.logger.debug(`[AI:Groq-Summarize] 요약 API 호출 | 제목="${title.substring(0, 30)}...", 본문길이=${content.length}자`);

    try {
      const parsed = await this.executeWithRetry({
        operation: async () => {
          const startTime = Date.now();
          const response = await this.groq.chat.completions.create({
            model: this.groqModelName,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.2,
            max_completion_tokens: this.maxCompletionTokens,
            reasoning_effort: 'none',
          });

          this.logger.debug(`[AI:Groq-Summarize] API 응답 수신 완료 | 소요시간=${Date.now() - startTime}ms`);

          const raw = response.choices[0]?.message?.content;
          if (!raw) throw new Error('AI 응답이 비어 있습니다.');

          return JSON.parse(raw);
        },
        context: `Groq-Summarize:${title.substring(0, 20)}`,
      });

      return {
        title: parsed.title || title,
        short_summary: Array.isArray(parsed.short_summary)
          ? parsed.short_summary
          : [parsed.short_summary],
        long_summary: parsed.long_summary || '',
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.join(', ')
          : parsed.tags || null,
      };
    } catch (error: any) {
      this.logger.error(`[AI:Groq] 단일 아티클 요약 최종 실패. | title="${title}", error=${error.message}`);
      throw error;
    }
  }

  // AI 벡터 임베딩
  async vectorEmbeddingWithAi({
    texts,
    taskType = 'RETRIEVAL_DOCUMENT',
  }: VectorEmbeddingParams): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    this.logger.debug(`[AI:Gemini-Embedding] 일괄 임베딩 요청 | 요청 개수=${texts.length}개`);

    try {
      const embeddings = await this.executeWithRetry({
        operation: async () => {
          const startTime = Date.now();
          const response = await this.gemini.models.embedContent({
            model: this.embeddingModelName,
            contents: texts,
            config: {
              outputDimensionality: 1536,
              taskType,
            },
          });

          this.logger.debug(`[AI:Gemini-Embedding] API 응답 수신 완료 | 소요시간=${Date.now() - startTime}ms`);

          if (!response.embeddings || response.embeddings.length === 0) {
            throw new Error('임베딩 결과가 비어 있습니다.');
          }

          return response.embeddings;
        },
        context: 'Gemini-Embedding',
        baseDelayMs: 3000,
      });

      return embeddings.map((embedding) => embedding.values || []);
    } catch (error: any) {
      this.logger.error(`[AI:Gemini] 임베딩 일괄 생성 최종 실패. | error=${error.message}`);
      throw error;
    }
  }

  // AI 벡터 임베딩 검색
  async embedSearchQuery(query: string): Promise<number[] | null> {
    if (!query || !query.trim()) return null;

    const normalizedQuery = this.normalizeKeyword(query);
    const cacheKey = `emb:${this.embeddingModelName}:${normalizedQuery}`;
    const lockKey = `lock:${cacheKey}`;

    try {
      const cachedVector = await this.redisService.getCache<number[]>({ key: cacheKey });
      if (cachedVector && Array.isArray(cachedVector) && cachedVector.length > 0) {
        this.logger.debug(`[Embedding Cache HIT] key="${cacheKey}"`);
        return cachedVector;
      }

      const lockValue = await this.redisService.acquireLock({
        key: lockKey,
        ttlMs: 10000,
      });

      if (!lockValue) {
        this.logger.debug(`[Embedding Lock Waiting] 다른 요청이 캐시 생성 중입니다. key="${cacheKey}"`);
        return await this.waitForCache({ cacheKey });
      }

      try {
        this.logger.debug(`[Embedding Cache MISS] API 호출 진행 (락 선점) key="${cacheKey}"`);

        const vectors = await this.semaphore.runExclusive(async () => {
          return await this.vectorEmbeddingWithAi({
            texts: [normalizedQuery],
            taskType: 'RETRIEVAL_QUERY',
          });
        });

        const vector = vectors.length > 0 && vectors[0].length > 0 ? vectors[0] : null;

        if (vector) {
          await this.redisService.setCache({
            key: cacheKey,
            value: vector,
            ttlSeconds: this.embeddingTtlSeconds,
          });
        }

        return vector;
      } finally {
        await this.redisService.releaseLock({
          key: lockKey,
          value: lockValue,
        });
      }
    } catch (error: any) {
      this.logger.error(`[embedSearchQuery] 처리 중 에러 발생: ${error.message}`);
      return null;
    }
  }

  // 검색 키워드 정규화
  private normalizeKeyword(keyword: string): string {
    if (!keyword) return '';

    return keyword
      .toLowerCase()
      .replace(/(에 대해|대해서|알려줘|뭐야|무엇인가요|검색해줘|찾아줘|설명해줘|알려주세요)$/g, '')
      .replace(/[^\w\sㄱ-ㅎ가-힣+#.-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 검색 중복 요청시 대기
  private async waitForCache(params: WaitForCacheParams): Promise<number[] | null> {
    const { cacheKey, maxRetries = 25, delayMs = 200 } = params;

    for (let i = 0; i < maxRetries; i++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const cachedVector = await this.redisService.getCache<number[]>({ key: cacheKey });
      if (cachedVector && Array.isArray(cachedVector) && cachedVector.length > 0) {
        this.logger.debug(`[Embedding Lock Resolved] 대기 후 캐시 획득 성공! key="${cacheKey}"`);
        return cachedVector;
      }
    }

    this.logger.warn(`[Embedding Lock Timeout] 대기 시간 초과. fallback 처리 key="${cacheKey}"`);
    return null;
  }
}