---
description: NestJS 및 TypeScript 작성 규칙
paths:
  - "src/**"
---

# NestJS & TypeScript 코딩 가이드

- **ALWAYS** 비즈니스 로직은 Service에만 작성하고 Controller는 요청/응답 전달 및 DTO 검증만 담당한다.
- **ALWAYS** TypeScript strict 모드를 준수하며, `any` 또는 `unknown` 타입 사용을 엄격히 금지한다.
- **ALWAYS** 새로운 서비스나 모듈 추가 시 의존성 주입(DI)이 정상 작동하도록 `*.module.ts` 등록 상태를 확인한다.
- **ALWAYS** 비즈니스 로직 수정 시 해당 서비스의 Jest 단위 테스트(`*.spec.ts`)를 함께 작성하거나 업데이트한다.
- **NEVER** 요청받지 않은 기존 라이브러리를 임의로 다른 라이브러리로 대체하지 않는다.
- **ALWAYS** 기존 코드의 공통 인터페이스(Type, DTO 시그니처)를 변경해야 할 경우 개발자의 사전 승인을 받는다.