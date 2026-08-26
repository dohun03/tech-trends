# 임베딩 기반 연관 아티클 추천 기능 구현 플랜

## 0. 목표 및 전제

- 특정 아티클(`id`)의 **상세 요약 모달 하단**에 "연관 아티클" 섹션을 추가하고, 클릭 시 모달 내부에서 해당 아티클 상세로 전환되도록 한다.
- 연관도는 이미 DB에 영구 저장되어 있는 `tbl_tech_trends.embedding` (pgvector, 1536차원, `IDX_tech_trends_embedding` HNSW 인덱스 존재)을 그대로 활용한 **코사인 거리 기반 최근접 검색**으로 계산한다.
  - 새로운 임베딩 생성/배치 작업 불필요 (이미 각 아티클 저장 시점에 임베딩이 생성되어 있음 — `AiService.vectorEmbeddingWithAi`).
  - 별도 DB 마이그레이션 불필요 (컬럼/인덱스 모두 기존에 존재).
- 기존 하이브리드 검색(`searchHybrid`)의 벡터 후보군 쿼리 패턴을 그대로 재사용하는 방향으로 구현하여 컨벤션을 유지한다.

## 1. 전체 아키텍처 흐름

```
[프론트 모달 오픈]
   openDetail(id) → openDetailByUrl(id) → renderModalContent(item)
        └─ (신규) loadRelatedArticles(id) 비동기 호출
                └─ GET /api/trends/:id/related?limit=5
                        └─ TrendsController.getRelatedTrends()
                                └─ TrendsQueryService.getRelatedTrends()
                                        ├─ techTrendRepository.findById(id)  // 원본 embedding 확보
                                        └─ techTrendRepository.findRelatedByEmbedding()  // pgvector <=> 최근접 검색
                └─ 응답을 모달 하단 "연관 아티클" 리스트로 렌더링
                        └─ 클릭 시 openDetail(relatedId) 재호출 → 같은 모달에서 콘텐츠만 전환
```

## 2. 백엔드 변경 사항

### 2.1 `src/trends/repositories/tech-trend.repository.ts`

- 신규 메서드 `findRelatedByEmbedding` 추가. `searchHybrid`의 `vectorSql` 패턴을 재사용하되, 검색어 벡터가 아니라 **원본 아티클 자신의 embedding**을 기준으로 하고, 자기 자신(`excludeId`)은 결과에서 제외한다.

```ts
interface RelatedTrendRow {
  id: number;
  source: string;
  title: string;
  short_summary: string[];
  link_url: string;
  technical_tags: string | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  created_at: Date;
  mined_at: Date;
}

// 임베딩 기반 연관 아티클 조회
async findRelatedByEmbedding(params: {
  excludeId: number;
  embedding: number[];
  limit: number;
}): Promise<RelatedTrendRow[]> {
  const { excludeId, embedding, limit } = params;
  const vectorString = `[${embedding.join(',')}]`;
  const distanceThreshold =
    this.configService.get<number>('RELATED_DISTANCE_THRESHOLD', 0.45);

  const sql = `
    SELECT
      trend.id, trend.source, trend.title, trend.short_summary,
      trend.link_url, trend.technical_tags, trend.view_count,
      trend.like_count, trend.comment_count, trend.created_at, trend.mined_at
    FROM tbl_tech_trends trend
    WHERE
      trend.id != $2
      AND trend.embedding IS NOT NULL
      AND trend.embedding <=> CAST($1 AS vector) <= $3
    ORDER BY
      trend.embedding <=> CAST($1 AS vector) ASC,
      trend.created_at DESC,
      trend.id DESC
    LIMIT $4
  `;

  return this.repository.query(sql, [vectorString, excludeId, distanceThreshold, limit]);
}
```

- `SearchResult`/`ListTrendsParams` 등 **기존 공용 인터페이스는 변경하지 않는다** (요청받지 않은 시그니처 변경 금지 원칙 준수). `RelatedTrendRow`는 이 파일 내부에 새로 선언.
- `RELATED_DISTANCE_THRESHOLD`는 기존 `VECTOR_DISTANCE_THRESHOLD`(검색용, 0.30)와 별도 키로 관리한다. 추천은 검색보다 약간 더 느슨한 임계치가 자연스러우므로 기본값 0.45로 설정하고, `.env`로 튜닝 가능하게 한다 (기존 `SEARCH_CANDIDATE_LIMIT`/`VECTOR_DISTANCE_THRESHOLD` 관리 방식과 동일 컨벤션).

### 2.2 `src/trends/services/trends-query.service.ts`

- 신규 메서드 `getRelatedTrends` 추가. `getTrendById`와 동일한 예외 처리 패턴(NotFound/InternalServerError) 유지.

```ts
async getRelatedTrends(id: number, limit: number) {
  try {
    const article = await this.techTrendRepository.findById(id);

    if (!article) {
      throw new NotFoundException(`ID가 ${id}인 아티클을 찾을 수 없습니다.`);
    }

    // 임베딩이 없는 아티클(초기 실패 케이스 등)은 연관 아티클 없이 빈 배열 반환
    if (!article.embedding || article.embedding.length === 0) {
      return { data: [] };
    }

    const data = await this.techTrendRepository.findRelatedByEmbedding({
      excludeId: id,
      embedding: article.embedding,
      limit,
    });

    return { data };
  } catch (error) {
    if (error instanceof HttpException) throw error;
    this.logger.error(`[getRelatedTrends] 연관 아티클 조회 에러 (ID: ${id}): ${error}`);
    throw new InternalServerErrorException(
      '연관 아티클을 불러오는 중 에러가 발생했습니다.',
    );
  }
}
```

- 응답 포맷은 `listTrends`/`searchTrends`와 달리 페이지네이션이 없는 고정 개수 리스트이므로 `{ data: [...] }` 형태로 단순화 (meta 불필요).

### 2.3 `src/trends/dto/get-related-trends-query.dto.ts` (신규 파일)

- `BaseTrendsQueryDto`를 상속하지 않고, `limit`만 별도로 검증하는 작은 DTO를 신설 (연관 아티클은 `source`/`isNew` 필터가 필요 없음).

```ts
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetRelatedTrendsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit는 정수여야 합니다.' })
  @Min(1, { message: 'limit는 최소 1 이상이어야 합니다.' })
  @Max(20, { message: 'limit는 최대 20까지 설정할 수 있습니다.' })
  limit?: number = 5;
}
```


### 2.4 `src/trends/trends.controller.ts`

- `getTrendById` 아래에 `GET :id/related` 라우트를 추가한다.
  - `/:id`(1-세그먼트)와 `/:id/related`(2-세그먼트, 리터럴 `related` 포함)는 세그먼트 구성이 달라 라우트 매칭이 겹치지 않으므로, `sources`/`search`처럼 순서를 앞으로 옮길 필요는 없다. 다만 가독성을 위해 `getTrendById` 바로 아래에 배치.

```ts
import { GetRelatedTrendsQueryDto } from './dto/get-related-trends-query.dto';
// ... 기존 import 유지

  // 단일 아티클 조회
  @Get(':id')
  getTrendById(@Param('id', ParseIntPipe) id: number) {
    return this.trendsQueryService.getTrendById(id);
  }

  // 임베딩 기반 연관 아티클 조회
  @Get(':id/related')
  getRelatedTrends(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetRelatedTrendsQueryDto,
  ) {
    return this.trendsQueryService.getRelatedTrends(id, query.limit ?? 5);
  }
```

### 2.5 `.env` (신규 키 추가)

```
RELATED_DISTANCE_THRESHOLD=0.45
```

(별도 `RELATED_ARTICLES_LIMIT` env는 두지 않고, 컨트롤러 DTO 기본값 5 + 쿼리 파라미터로 프론트에서 명시 전달하는 방식을 기본으로 함. 필요 시 추후 env화 가능.)

### 2.6 모듈 등록 관련 확인

- `TechTrendRepository`, `TrendsQueryService`, `TrendsController` 모두 이미 `trends.module.ts`에 등록되어 있으므로 **DI 관련 추가 작업 없음**. 신규 DTO는 별도 프로바이더가 아니므로 모듈 등록 대상 아님.


## 3. 프론트엔드 변경 사항 (`frontend/index.html`)

### 3.1 모달 마크업 수정 (약 548~562번째 줄 부근)

- `modal-body`와 `modal-footer` 사이에 연관 아티클 섹션을 추가한다.

```html
<div class="modal-body" id="modalBody"></div>

<!-- 연관 아티클 섹션 (신규) -->
<div class="related-section" id="modalRelatedSection" style="display:none;">
  <h3 class="related-title">🔗 연관 아티클</h3>
  <div class="related-list" id="modalRelatedList"></div>
</div>

<div class="modal-footer">
  ...
</div>
```

### 3.2 CSS 추가 (`<style>` 블록, `.modal-footer` 정의 부근에 이어 추가)

```css
.related-section {
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
}

.related-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted);
  margin: 0 0 10px 0;
}

.related-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.related-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  background-color: var(--card-bg);
  transition: background-color 0.15s, border-color 0.15s;
}

.related-item:hover {
  background-color: var(--bg-color);
  border-color: var(--accent);
}

.related-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.related-item-source {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
}

.related-empty {
  font-size: 13px;
  color: var(--text-muted);
  padding: 4px 0;
}
```


### 3.3 JS 로직 추가/수정

**(1) `els` 객체에 DOM 참조 추가** (612번째 줄 부근 `els` 선언부)

```js
modalRelatedSection: document.getElementById('modalRelatedSection'),
modalRelatedList: document.getElementById('modalRelatedList'),
```

**(2) 연관 아티클 조회/렌더링 함수 신규 추가** (`renderModalContent` 함수 근처, 960번째 줄 이전)

```js
let relatedRequestToken = 0; // 빠른 연속 클릭 시 stale 응답 방지용 토큰

async function loadRelatedArticles(id) {
  const token = ++relatedRequestToken;
  els.modalRelatedSection.style.display = '';
  els.modalRelatedList.innerHTML = '<div class="related-empty">불러오는 중...</div>';

  try {
    const res = await fetch(`${API_BASE_URL}/${id}/related?limit=5`);
    if (token !== relatedRequestToken) return; // 이미 다른 아티클로 전환된 경우 무시

    if (!res.ok) throw new Error('연관 아티클 조회 실패');
    const { data } = await res.json();

    renderRelatedList(data);
  } catch (e) {
    console.error('연관 아티클 로드 실패:', e);
    if (token === relatedRequestToken) {
      els.modalRelatedList.innerHTML = '<div class="related-empty">연관 아티클을 불러오지 못했습니다.</div>';
    }
  }
}

function renderRelatedList(items) {
  if (!items || items.length === 0) {
    els.modalRelatedList.innerHTML = '<div class="related-empty">연관 아티클이 없습니다.</div>';
    return;
  }

  els.modalRelatedList.innerHTML = items.map(item => `
    <div class="related-item" onclick="openDetail('${item.id}')">
      <span class="related-item-title">${item.title}</span>
      <span class="related-item-source" style="${getSourceStyle(item.source)}">${item.source || '알 수 없음'}</span>
    </div>
  `).join('');
}
```

**(3) `renderModalContent` 함수 끝에 호출 추가** (960~978번째 줄)

```js
function renderModalContent(item) {
  document.getElementById('modalTitle').textContent = item.title;
  document.getElementById('modalBody').textContent = item.long_summary || '내용 없음';

  els.modalMetrics.innerHTML = ` ... (기존 유지) `;

  const linkEl = document.getElementById('modalOriginLink');
  linkEl.href = item.link_url || '#';
  linkEl.style.display = item.link_url ? 'inline-flex' : 'none';

  document.getElementById('detailModal').classList.add('show');
  document.body.classList.add('modal-open');

  loadRelatedArticles(item.id); // (신규) 연관 아티클 비동기 로드
}
```


**(4) `closeModal`은 별도 수정 불필요** (섹션이 `display:none`으로 숨겨지지 않아도 다음 모달 오픈 시 `loadRelatedArticles`가 내용을 새로 덮어씀 — 다만 닫힘 애니메이션 중 이전 목록이 잠깐 보이는 것을 막기 위해 `closeModal`에서 `els.modalRelatedList.innerHTML = ''`로 초기화하는 것을 권장):

```js
function closeModal() {
  document.getElementById('detailModal').classList.remove('show');
  document.body.classList.remove('modal-open');
  els.modalRelatedList.innerHTML = ''; // (신규) 다음 오픈 시 잔상 방지

  if (state.articleId) {
    state.articleId = null;
    updateUrl();
  }
}
```

### 3.4 클릭 시 전환 동작 설명

- 연관 아티클 클릭 → `openDetail(relatedId)` 호출 → 기존 로직 그대로 `state.articleId` 갱신, URL 갱신(`?id=`), `openDetailByUrl(relatedId)` 실행.
- `openDetailByUrl`은 `state.data`(현재 페이지 목록)에 해당 id가 있으면 로컬 데이터로 즉시 렌더링, 없으면(연관 아티클은 대부분 현재 목록 밖에 있으므로) `GET /api/trends/:id`로 단건 fetch 후 렌더링 — **기존 코드 변경 없이 그대로 재사용 가능**.
- 모달은 닫히지 않고 내용만 교체되며, `loadRelatedArticles`가 재귀적으로 다시 호출되어 새 아티클 기준 연관 리스트로 갱신됨.
- `scrollToCard(relatedId)`는 카드가 현재 리스트에 없으면 `querySelector`가 null이라 조용히 무시됨 (기존 동작과 동일, 에러 없음).

## 4. 테스트 계획

### 4.1 `src/trends/services/trends-query.service.spec.ts` (기존 파일 수정)

`describe('getRelatedTrends', ...)` 블록 신규 추가, `mockRepository`에 `findRelatedByEmbedding: jest.fn()` 추가:

1. **정상 케이스**: `findById`가 embedding이 있는 아티클을 반환 → `findRelatedByEmbedding`이 올바른 파라미터(`excludeId`, `embedding`, `limit`)로 호출되고 `{ data: [...] }` 반환하는지 검증.
2. **원본 아티클 없음**: `findById`가 `null` 반환 → `NotFoundException` throw, `findRelatedByEmbedding` 미호출 검증.
3. **embedding이 null/빈 배열인 경우**: `findRelatedByEmbedding` 호출 없이 `{ data: [] }` 즉시 반환하는지 검증.
4. **DB 에러 케이스**: `findById` 또는 `findRelatedByEmbedding`이 reject → `InternalServerErrorException` throw 검증 (기존 `getTrendById` 테스트 패턴과 동일하게 작성).

### 4.2 `src/trends/trends.controller.spec.ts` (선택, 낮은 우선순위)

- 기존 파일은 Throttler 동작 검증에 특화되어 있어 구조를 크게 건드리지 않음.
- 필요 시 `mockTrendsQueryService`에 `getRelatedTrends: jest.fn().mockResolvedValue({ data: [] })` 를 추가해 두면, 향후 이 컨트롤러의 다른 라우트에 대한 회귀 테스트 확장 시 참고 가능 (필수 아님, 현재 스펙 파일 목적상 생략 가능).

### 4.3 리포지토리 단위 테스트

- 현재 `TechTrendRepository`는 다른 메서드(`searchHybrid`, `searchKeyword` 등)도 별도 단위 테스트 파일 없이 서비스 레벨 mock으로만 검증되는 기존 컨벤션을 따름 → `findRelatedByEmbedding`도 동일하게 **별도 spec 파일 신설하지 않고** `trends-query.service.spec.ts`의 mock을 통해 간접 검증.


## 5. 변경/신규 파일 요약

| 구분 | 경로 | 작업 |
|---|---|---|
| 수정 | `src/trends/repositories/tech-trend.repository.ts` | `findRelatedByEmbedding` 메서드 추가 |
| 수정 | `src/trends/services/trends-query.service.ts` | `getRelatedTrends` 메서드 추가 |
| 신규 | `src/trends/dto/get-related-trends-query.dto.ts` | `limit` 검증용 DTO |
| 수정 | `src/trends/trends.controller.ts` | `GET :id/related` 라우트 추가 |
| 수정 | `.env` | `RELATED_DISTANCE_THRESHOLD=0.45` 추가 |
| 수정 | `src/trends/services/trends-query.service.spec.ts` | `getRelatedTrends` 테스트 4건 추가 |
| 수정 | `frontend/index.html` | 모달 마크업/CSS/JS 수정 (연관 아티클 섹션) |

## 6. 구현 후 실행할 CLI 명령어 (검증 단계)

```bash
npm run lint
npm run test -- trends-query.service.spec.ts
npm run test
npm run build
```

- `npm run test`에서 전체 스펙(스크래퍼/워커/파이프라인 포함) 회귀 확인.
- `npm run build`로 TypeScript strict 모드 컴파일 에러(any 미사용 등) 최종 확인.
- 로컬 실행 시 `GET /api/trends/:id/related?limit=5` 를 curl 또는 프론트에서 직접 호출해 실제 pgvector 검색 결과가 반환되는지 수동 확인 권장.

## 7. 리스크 및 고려사항

1. **임베딩 없는 초기 데이터**: 과거 저장된 일부 아티클에 `embedding`이 `NULL`인 경우 연관 아티클이 빈 배열로 나올 수 있음 → 프론트에서 "연관 아티클이 없습니다" 안내로 자연스럽게 처리(3.3-(2) 참고).
2. **거리 임계치 튜닝**: `RELATED_DISTANCE_THRESHOLD` 기본값(0.45)은 임의 추정치이므로, 실 데이터 기준 결과가 너무 많거나(임계치가 느슨함) 아예 없는 경우(임계치가 타이트함) 배포 후 `.env` 값만 조정하면 되도록 설계.
3. **연속 클릭 race condition**: 연관 아티클을 빠르게 연속 클릭할 때 이전 fetch 응답이 늦게 도착해 화면을 덮어쓰는 문제를 `relatedRequestToken` 카운터로 방지.
4. **라우트 순서**: `:id`와 `:id/related`는 세그먼트 수가 달라 매칭 충돌 없음(2.4 설명) — 별도 순서 조정 불필요.
5. **기존 공용 인터페이스 미변경**: `TechTrend` 엔티티, `SearchResult`, `ListTrendsParams` 등 기존 시그니처는 그대로 유지하고, 신규 기능은 신규 메서드/DTO로만 추가하여 회귀 리스크 최소화.

