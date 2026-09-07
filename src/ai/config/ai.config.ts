import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  groq: {
    model: process.env.GROQ_MODEL,
    apiKey: process.env.GROQ_API_KEY,
    maxCompletionTokens: Number(process.env.GROQ_MAX_COMPLETION_TOKENS ?? 1000),
  },
  gemini: {
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL,
    apiKey: process.env.GEMINI_API_KEY,
    embeddingTtlSeconds: Number(process.env.EMBEDDING_TTL_SECONDS ?? 2592000),
  },
}));