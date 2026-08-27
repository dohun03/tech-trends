import { FilterBatchParams } from '../interfaces/ai.interface';

export const buildFilterBatchPrompt = (params: FilterBatchParams): string => {
  const { items } = params;

  return `
  당신은 백엔드 개발자 시각의 IT 트렌드 큐레이터입니다.
  아래 아티클 목록(제목 및 요약)을 읽고, 백엔드/DevOps/CS/개발기술 측면에서 실무에 도움이 되는 가치 있는 글의 ID만 선택하세요.

  [제외 대상]
  - 수필, 개인 회고, 개발 커리어 고민, 소소한 일상, 단순 질문 글
  - 단순 광고/홍보성 글

  [평가 대상]
  ${JSON.stringify(items, null, 2)}

  [응답 포맷 (JSON)]
  {
    "valuable_ids": [12345, 67890]
  }
  `.trim();
};