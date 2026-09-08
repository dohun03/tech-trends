# Tech-Trends 수집 파이프라인 안정화 계획 (PLAN.md)

> 본 문서는 2026-09-05 ~ 09-07 AWS 로그에서 확인된 **Groq `429`(OTPM 초과) 장애**와,
> **스택오버플로우 소스가 익일부터 영구 정지**된 문제를 해결하기 위한 작업 계획입니다.
>
> 작업은 **Git 커밋 단위(= 1스텝 1커밋)** 로 분할하며, 각 커밋 메시지는 한글로 작성합니다. 그리고 작업이 끝나면 직접 깃 커밋을 진행하지 말고, 커밋 메시지만 제공하세요.

---

## 0. 배경 및 문제 요약 (참고용)

| # | 문제 | 원인 | 대응 스텝 |
|---|---|---|---|
| P0 | Groq `429 "Request too large"` (구조적) 반복 발생 | `max_completion_tokens: 4096` + 상세요약 "1000자" 요구가 무료 티어 **OTPM=1000**(출력 토큰/분) 초과 | 커밋 1 |
| P1 | 구조적 429에 헛재시도(3회) + BullMQ 재시도까지 낭비 | `executeWithRetry`가 모든 429를 동일하게 "재시도 대상"으로 취급 | 커밋 2 |
| P2 | 스택오버플로우가 익일부터 영구 정지 | 고정 `jobId` + `removeOnFail:{count:50}` 실패 Job 잔존 → BullMQ가 `add()` 무시 | 커밋 3 |
| P3 | 재시도 시 전체 소스 재작업(AI 호출·OTPM·비용 낭비) | 배치 진행 상태 체크포인트 부재 | 커밋 4 |

---

## 1. 커밋 분할 요약

| 순서 | 스텝 | 커밋 메시지(요약) | 핵심 파일 |
|---|---|---|---|
| 1 | P0 | `feat(ai): Groq 출력 토큰 한도(OTPM) 초과 방지를 위한 설정 정상화` | ai.service.ts, ai.config.ts, summarize-content.prompt.ts, app.module.ts, .env |
| 2 | P1 | `fix(ai): Groq 429 에러 구조적/일시적 분류에 따른 재시도 분기` | ai.service.ts |
| 3 | P2 | `refactor(trends): 날짜 기반 jobId 도입 및 스크래퍼 Redis 락 제거` | trends-pipeline.service.ts, trends.worker.ts |
| 4 | P3 | `feat(trends): DB 기준 목표치 재계산으로 재시도 시 목표 초과 수집 방지` | trends-pipeline.service.ts, tech-trend.repository.ts, time.util.ts |

> **P0/P1 분리 판단 근거**: P0은 "설정값·프롬프트 데이터 교정"(동작 변경 없음, 안전), P1은 "재시도 제어 흐름 로직 변경"(단위 테스트 신규 필요)로 성격이 다르고, 각각 독립 검증·롤백이 가능하도록 분리하는 것이 유리합니다.

---

## 2. 커밋 1 — P0: Groq 출력 토큰 한도 정상화

### 2-1. 목표
- `max_completion_tokens`를 **OTPM 한도(1000)** 에 맞춰 **1000**으로 설정(제거 아님).
- 그에 맞춰 요약 프롬프트의 출력 분량(한글 자수)을 `300자~500자 내외`로 조정.
- Groq/Gemini(AI) 관련 설정을 `.env` 환경변수로 추출하고 한 곳(`registerAs` `ai`)으로 그룹화.

### 2-2. 한글 토큰 산정 근거 (프롬프트 분량 기준)
- qwen 계열 BPE 토크나이저의 한국어 토큰 효율은 `약 1.5 ~ 2.5 토큰/자` (보수적으로 **2 토큰/자** 가정).
- 출력 예산 1000 토큰에서 JSON 구조 + `title` + `short_summary`(3문장) + `tags` 오버헤드 `약 150 ~ 200 토큰`을 제외하면
  `long_summary`에 할당 가능한 예산은 `약 800 토큰 ≈ 400 ~ 500자`.
- **결론**: `long_summary` 분량 지시를 `300자 ~ 500자 내외`로 설정(500자는 토큰 효율이 좋을 때의 상한).
- ⚠️ **JSON 잘림 주의**: `max_completion_tokens=1000`은 `title`+`short_summary`+`long_summary`+`tags`+JSON 구조 **전체 출력** 합계 상한이다.
  long_summary가 500자에 근접하면 나머지 필드와 합산해 1000 토큰을 초과하여 **JSON이 중간에 잘리고 `JSON.parse`가 실패**할 수 있다.
  → 프롬프트에 "전체 응답이 1000토큰을 넘지 않도록 필요한 경우 long_summary 길이를 줄여라" 안내를 추가해 방지.
- ⚠️ 정확한 토큰/자 비율은 **구현 단계에서 Groq 토크나이저(또는 테스트 호출)로 실측하여 확정**한다. 위 수치는 보수적 가정.

### 2-3. 변경 대상 파일
| 파일 | 변경 내용 |
|---|---|
| `.env` | `GROQ_MAX_COMPLETION_TOKENS=1000` 추가 |
| `src/ai/config/ai.config.ts` | **신규** — `registerAs('ai', ...)` 로 Groq/Gemini 설정 그룹화 |
| `src/app.module.ts` | `ConfigModule.forRoot`에 `load: [aiConfig]` 등록 |
| `src/ai/ai.service.ts` | 생성자에서 `ai.groq.*`/`ai.gemini.*` 에서 설정 읽도록 수정, `max_completion_tokens: 4096` → 1000 |
| `src/ai/prompts/summarize-content.prompt.ts` | `long_summary: 300자~1000자 이상` → `300자~500자 내외` + 전체 1000토큰 내 안내 추가 |

### 2-4. 세부 변경 사항
1. **ai.config.ts (신규)**
   ```ts
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
   ```
2. **ai.service.ts**
   - 생성자에서 기존 `getOrThrow('GROQ_MODEL')`, `getOrThrow('GEMINI_EMBEDDING_MODEL')`, `get('EMBEDDING_TTL_SECONDS')` 호출을
     `configService.get('ai.groq.model')`, `get('ai.groq.maxCompletionTokens')`, `get('ai.gemini.embeddingModel')`, `get('ai.gemini.embeddingTtlSeconds')` 로 변경.
   - `filterBatchWithAi()` / `summarizeContentWithAi()` 두 곳의
     `max_completion_tokens: 4096` → `max_completion_tokens: this.maxCompletionTokens`(1000).
   - (참고) 필터 배치 출력은 ID 배열뿐이라 실제 출력은 수십 토큰이므로 1000이면 충분. 원하면 필터를 별도로 더 낮게 분리 가능하나, 이번엔 단일 값으로 통일.
3. **summarize-content.prompt.ts**
   - `2. long_summary: ... 300자~1000자 이상 ...` → `... 300자~500자 내외로 간결하게 ...`.
   - "전체 응답(제목·요약·태그 포함)이 1000토큰을 넘지 않도록, 필요한 경우 long_summary 길이를 줄여라" 안내 추가(JSON 잘림 방지).

### 2-5. 테스트 작성/수정
- `src/ai/ai.service.spec.ts`:
  - ConfigService 모킹이 `getOrThrow('GROQ_MODEL')`/`getOrThrow('GEMINI_EMBEDDING_MODEL')` → `get('ai.groq.model')`/`get('ai.groq.maxCompletionTokens')`/`get('ai.gemini.embeddingModel')`/`get('ai.gemini.embeddingTtlSeconds')` 로 변경된 것에 맞춰 수정.
  - `maxCompletionTokens`(1000)가 실제 API 호출 파라미터에 전달되는지 검증 케이스 추가/보강.

### 2-6. 검증
```bash
npm run test
npm run build
```

### 2-7. 커밋 메시지
```
feat(ai): Groq 출력 토큰 한도(OTPM) 초과 방지를 위한 설정 정상화

- max_completion_tokens 4096 → 1000 (env: GROQ_MAX_COMPLETION_TOKENS, 기본값 1000)
- Groq/Gemini 설정을 ai.config.ts(registerAs)로 그룹화
- 요약 프롬프트 long_summary 분량 300~1000자 → 300~500자로 조정
```

---

## 3. 커밋 2 — P1: Groq 429 구조적/일시적 분기

### 3-1. 목표
- 두 가지 429를 구분하여, **구조적 `Request too large`는 재시도하지 않고 즉시 중단**, **일시적 `Rate limit reached`만 백오프 재시도**하도록 개선.

### 3-2. 에러 구분 기준
| 구분 | 메시지 키워드 | 처리 |
|---|---|---|
| 구조적 | `Request too large` | 즉시 throw (재시도 X) |
| 일시적 | `Rate limit reached` | 기존 백오프 재시도 유지 |

- 두 에러 모두 `type: "tokens"`, `code: "rate_limit_exceeded"` 로 동일하므로 **`message` 문자열로 2차 분기**한다.

### 3-3. 변경 대상 파일
| 파일 | 변경 내용 |
|---|---|
| `src/ai/ai.service.ts` | `executeWithRetry()` 내에 `Request too large` 감지 분기 추가 |

### 3-4. 세부 변경 사항 (`executeWithRetry`)
```ts
} catch (error: any) {
  const status = error?.status || error?.response?.status || error?.statusCode;
  const msg = String(error?.message ?? error?.error?.message ?? '');

  // 구조적 429(Request too large): max_tokens/예상 출력 자체가 한도 초과 → 재시도로 해결 불가
  const isStructuralOverflow = status === 429 && msg.includes('Request too large');
  if (isStructuralOverflow) {
    this.logger.error(`[Retry:${context}] 구조적 한도 초과(Request too large). 재시도 중단. | error=${error.message}`);
    throw error;
  }

  const isNonRetryable = status && status >= 400 && status < 500 && status !== 429;
  // ... (기존 로직 유지)
}
```
- **일시적 429에 `retry-after` 반영(필수)**: `Rate limit reached`는 응답 헤더 `retry-after`(초) 또는 `x-ratelimit-reset-tokens`(리셋까지 남은 시간)를 제공하므로,
  고정 백오프(2s/6s) 대신 **이 값을 읽어 그 시간만큼 대기**하도록 변경한다. (예: 로그의 "Please try again in 9.36s" → 9.36초 대기)

### 3-4 (보충). OTPM 페이싱(호출 간격) 판단
- **현황 문제**: `SCRAPER_AI_DELAY_SECONDS=3`는 요약 호출 간 간격으로, `maxCompletionTokens=1000` 기준 **OTPM=1000(분당 출력 토큰)에 불충분**.
  요약 1회가 약 500~800 토큰을 소모하므로 같은 1분 윈도우에 2회 이상 호출되면 `Rate limit reached`가 발생한다.
  (실제 로그 `2:01:54 Rate limit reached ... Used 443, Requested 713` 에서 확인)
- **권장(정확·우선 적용)**: 일시적 429의 `retry-after`/`x-ratelimit-reset-tokens`를 활용한 백오프(위 3-4 필수 항목). 이 한 가지만으로 레이트 리밋 초과를 안전하게 복구 가능.
- **사전 페이싱(정교)**: Groq 응답의 `usage.completion_tokens`를 누적해 60초 롤링 윈도우 기준으로 토큰 예산을 관리하고, 호출 전 잔여 예산이 부족하면 대기.
  다만 구현 복잡도가 있어 **후속 개선(P3 이후)** 으로 분리.
- **사전 페이싱(단순 대안)**: 사용자 제안 "딜레이 = 60초 - 직전 AI 소요시간" 은 "1분당 최대 1회 호출"을 보장하는 **시간 기반 근사**로,
  구현이 간단하고 실무적으로 안전하지만, OTPM이 **토큰 기준**이라는 점에서 정확하진 않고(짧은 요약도 1분으로 묶여 처리량 감소) 단점이 있음.
- **결정**: ① `retry-after` 반영(필수) + ② `SCRAPER_AI_DELAY_SECONDS`를 환경변수로 유지하되 기본값 상향(예: 10~30초) 검토.
  정교한 토큰 기반 페이싱은 후속(별도 커밋)으로.

### 3-5. 테스트 작성/수정
- `src/ai/ai.service.spec.ts`:
  - `Request too large` 429 → **재시도 0회**, 즉시 throw 되는지 검증.
  - `Rate limit reached` 429 → **재시도 진행**되는지 검증(기존 케이스 유지).
  - 5xx → 기존 재시도 동작 유지 확인.

### 3-6. 검증
```bash
npm run test
npm run build
```

### 3-7. 커밋 메시지
```
fix(ai): Groq 429 에러 구조적/일시적 분류에 따른 재시도 분기

- Request too large(구조적 한도 초과)는 재시도 없이 즉시 중단
- Rate limit reached(일시적)는 기존 백오프 재시도 유지
```

---

## 4. 커밋 3 — P2: 날짜 기반 jobId + 스크래퍼 락 제거 + 등록 검증 로그

### 4-1. 목표
- 실패 Job이 큐에 잔존하여 익일 재등록이 무시되는 문제를 해결.
- Job 데이터에 실려가던 Redis 락(`lockValue`) 구조를 정리.

### 4-2. 핵심 설계 판단
1. **jobId를 날짜 기반으로 변경**: `devto-2026-09-05` 형태.
   - 실패 Job(`removeOnFail:{count:50}`)이 남아도 익일은 다른 ID라 충돌 없음.
   - 실패 이력(감사)과 수동 재시도 가능성을 유지하면서 재등록 보장.
   - 완료 Job은 `removeOnComplete: true` 로 즉시 삭제되므로 완료 쪽 누적 없음.
2. **스크래퍼 Redis 락 제거** (아래 4-4에서 판단 근거 제시).
3. **등록 결과 검증 로그**: `add()` 전 기존 Job 존재 여부를 확인하여 "신규 등록 / 기존 존재" 를 정확히 로깅.

### 4-3. 변경 대상 파일
| 파일 | 변경 내용 |
|---|---|
| `src/trends/services/trends-pipeline.service.ts` | `dispatchAllScrapersToQueue()` 에서 날짜 jobId 생성, 락 제거, 등록 검증 로그 |
| `src/trends/processors/trends.worker.ts` | `lockValue`/`releaseLock` 제거, 미사용 시 `RedisService` 주입 제거 |

### 4-4. Redis 락 제거 결정 근거
- 현재 락 목적은 "동일 소스 중복 등록 방지"이나, **BullMQ의 jobId dedup이 이미 이를 보장**.
- 락은 "스케줄러가 획득 → 워커가 해제" 구조라, `add()`가 무시(no-op)되는 경우 **락이 고아(orphan)로 남아 TTL(10분)까지 해제되지 않는 버그**가 있음.
- 1일 1회 크론 + `concurrency: 1` 단일 워커 환경에서 동시 실행 가능성이 사실상 없음.
- 날짜 jobId 도입으로 dedup이 더 견고해지므로 락은 불필요. **제거 권장**.

### 4-5. 세부 변경 사항
1. **trends-pipeline.service.ts — dispatchAllScrapersToQueue()**
   ```ts
   public async dispatchAllScrapersToQueue(): Promise<void> {
     for (const sourceName of this.scraperFactory.getAllSourceNames()) {
       const jobId = `${sourceName}-${this.todayString()}`;  // 예: devto-2026-09-05

       const existing = await this.scraperQueue.getJob(jobId);
       if (existing) {
         const state = await existing.getState();
         this.logger.log(`[Queue] ${jobId} 기존 Job 존재(state=${state}). 재등록 생략.`);
         continue;
       }

       await this.scraperQueue.add('scrape-articles',
         { sourceName },            // lockValue 제거
         { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 },
           removeOnComplete: true, removeOnFail: { count: 50 } },
       );
       this.logger.log(`[Queue] ${jobId} 작업 신규 등록 완료`);
     }
   }
   ```
   - `todayString()` 헬퍼는 `2026-09-05` 형식의 로컬(Asia/Seoul) 날짜 문자열을 반환(공통 유틸 또는 내부 private 메서드).
2. **trends.worker.ts — process()**
   - `job.data` 타입을 `{ sourceName: string }` 으로 간소화.
   - `finally` 블록의 `releaseLock` 호출 제거.
   - `RedisService` 주입이 오직 `releaseLock` 에만 쓰였다면 생성자에서 제거.
   - (인터페이스 `scraper.interface.ts` 의 job 페이로드 타입이 별도로 있다면 함께 수정)

### 4-6. 테스트 작성/수정
- `src/trends/services/trends-pipeline.service.spec.ts`:
  - 날짜 jobId 형식(`{source}-YYYY-MM-DD`)으로 등록되는지 검증.
  - 기존 Job 존재 시 `add()` 호출되지 않고 로그만 남기는지 검증.
- `src/trends/processors/trends.worker.spec.ts`:
  - `releaseLock` 호출이 없어졌고, 작업 처리 후 정상 반환하는지 검증.

### 4-7. 검증
```bash
npm run test
npm run build
```

### 4-8. 커밋 메시지
```
refactor(trends): 날짜 기반 jobId 도입 및 스크래퍼 Redis 락 제거

- jobId를 {source}-{YYYY-MM-DD}로 변경해 실패 Job 잔존으로 인한 재등록 불가 문제 해결
- BullMQ jobId dedup과 중복되는 스크래퍼 분산락 제거(고아 락 버그 해소)
- 큐 등록 결과를 검증해 신규/기존 여부를 정확히 로깅
```

---

## 5. 커밋 4 — P3: DB 기준 목표치 재계산

### 5-1. 목적 (무엇을 위해)
BullMQ 재시도(`attempts: 3`) 시 **목표 저장 개수(예: 5개)를 초과해서 중복 수집·저장하는 문제**를 해결한다.

| # | 문제 | 원인 | 해결 방향 |
|---|---|---|---|
| A | 재시도 시 목표 저장 개수를 초과해서 모아버림 | `processSource()`의 저장 개수 카운터가 **런타임 로컬 변수**라 재시도(process() 재호출) 시 0부터 다시 시작 → 이미 DB에 저장된 개수를 모름 | 매 실행 시작 시 **오늘 DB에 실제 저장된 개수**(`mined_at` 기준)를 조회해 기준선으로 사용 |

> ⚠️ P0/P1 적용 후 "Request too large" 구조적 실패 자체는 대부분 사라지므로, P3는 **정합성 최적화** 성격이며 우선순위는 P0~P2보다 낮다.
>
> ❗ **설계 최종 결정(중간 상태 체크포인트/캐싱 미도입)**: 하루 30개 미만의 소수 글을 수집·요약하는 서비스 특성상, 배치/글 순서가 보장되지 않고 스크래퍼가 반환하는 글 목록 자체가 시시각각 변하므로 체크포인트·캐시의 히트율이 낮고 무의미하다. 따라서 "오늘 몇 개 저장했는지 DB 조회"만으로 목표치를 재계산하고, **중복 여부는 기존 방식 그대로 DB의 글(`source_id`)과 대조**(`excludeExistingArticles`)하여 판별하는 방식을 유지한다. 중간 체크포인트 저장 구조나 AI 요약 캐시는 도입하지 않는다.

### 5-2. 설계 확정

| 항목 | 결정 |
|---|---|
| 목표치 기준 데이터 | `TechTrend.mined_at`(수집 시각, `@CreateDateColumn`) 기준 "오늘(Asia/Seoul) 이 소스로 저장된 행 개수" |
| 조회 시점 | `processSource()` 진입 시 **최초 1회** (배치 루프 시작 전) |
| 목표 이미 달성 시 | 스크래핑(`getArticles`)조차 호출하지 않고 즉시 `{ savedCount: 0, savedArticles: [] }` 반환 |
| `ScrapeJobResult.savedCount` 의미 | 기존과 동일하게 **"이번 실행에서 새로 저장한 개수"** (디스코드 알림 로직 호환 유지). 목표치 판단용 기준선(baseline)과는 별도 변수로 관리 |
| 중복 판별 | 기존 `excludeExistingArticles()`(DB `source_id` 기반 dedup) 유지 — 별도 변경 없음 |

### 5-3. 변경 대상 파일

| 파일 | 변경 내용 |
|---|---|
| `src/common/utils/time.util.ts` | `getTodayDateString()`(YYYY-MM-DD), `getTodayStartUtc()`(Date, Asia/Seoul 기준 오늘 00:00 UTC) 추가. 기존 `trends-pipeline.service.ts`의 private `todayString()`을 `getTodayDateString()`으로 대체(중복 제거) |
| `src/trends/repositories/tech-trend.repository.ts` | `countSavedSince(source: string, sinceDate: Date): Promise<number>` 신규 — `mined_at >= sinceDate` + `source` 조건으로 `count()` |
| `src/trends/services/trends-pipeline.service.ts` | `processSource()`: 진입 시 `countSavedSince` 조회 → 기준선(baseline) 계산, 목표 달성 시 조기 반환, 배치 루프의 `remainingQuota`를 `baseline + newlySavedCount` 기준으로 재계산 (변수 `totalSavedCount` → `newlySavedCount`로 의미 재정의) |
| `src/trends/services/trends-pipeline.service.spec.ts` | `repository.countSavedSince` mock 추가(기본값 0, 기존 테스트 하위호환) + 신규 테스트 2건 |

> `tech-trend.repository.spec.ts`(신규 스펙 파일)는 생성하지 않음 — `countSavedSince`는 TypeORM `count()`를 얇게 감싸는 메서드로, 파이프라인 스펙에서 mock을 통해 사용 여부를 충분히 검증할 수 있어 별도 파일 추가는 과도하다고 판단.

### 5-4. 테스트 작성/수정 (`trends-pipeline.service.spec.ts`)

1. `[목표기달성]` 오늘 이미 목표치만큼 저장돼 있으면 스크래핑 자체를 하지 않고 `savedCount: 0` 반환 (`getArticles` 미호출 검증)
2. `[목표치부분달성]` 오늘 3개 저장돼 있고 목표가 5개면, 이번 실행은 2개만 채우고 멈추는지(`saveTrend` 정확히 2회 호출) 검증

### 5-5. 시나리오별 검증

| # | 시나리오 | 기대 동작 |
|---|---|---|
| 1 | 배치1에서 4개 저장 후 배치2에서 실패 → BullMQ 재시도 | 재시도 시 `countSavedSince=4` → `remainingQuota=1`로 시작 → 총 5개에서 멈춤(목표 오버 없음). 저장 완료된 4개는 `excludeExistingArticles`가 걸러 재수집 안 함 |
| 2 | 목표(5개) 이미 완전 달성 후 재시도 | `countSavedSince=5` → 스크래핑 자체 스킵, `savedCount:0` |
| 3 | 날짜 변경(익일) | `getTodayStartUtc()` 기준일이 바뀌어 `countSavedSince`가 자연 초기화(0) |
| 4 | DB 저장 개별 실패(`saveTrends` 내부 catch) | 저장 실패 항목은 `mined_at`이 생성되지 않아 `countSavedSince`에 미반영 → 재시도 시 재저장 시도 가능 |

### 5-6. 검증
```bash
npm run test
npm run build
```

### 5-7. 커밋 메시지
```
feat(trends): DB 기준 목표치 재계산으로 재시도 시 목표 초과 수집 방지

- 목표 저장 개수를 런타임 로컬 변수 대신 오늘 DB 실제 저장 개수(mined_at 기준)로 재계산
- BullMQ 재시도 시에도 목표 초과 없이 정확히 목표치까지만 수집·저장
- 중복 판별은 기존 DB 대조(excludeExistingArticles) 방식 유지
```

---

## 6. 전체 커밋 메시지 요약

1. `feat(ai): Groq 출력 토큰 한도(OTPM) 초과 방지를 위한 설정 정상화`
2. `fix(ai): Groq 429 에러 구조적/일시적 분류에 따른 재시도 분기`
3. `refactor(trends): 날짜 기반 jobId 도입 및 스크래퍼 Redis 락 제거`
4. `feat(trends): DB 기준 목표치 재계산으로 재시도 시 목표 초과 수집 방지`

---

## 7. 공통 검증 계획
- 각 커밋 종료 시점에 아래 명령을 **반드시** 실행하여 통과 확인.
```bash
npm run test   # Jest 단위 테스트
npm run build  # TypeScript 빌드
```
- 빌드/테스트 실패 시 원인을 분석해 스스로 수정 후 재실행한다.