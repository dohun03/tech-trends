# 마크다운(Markdown) 렌더링 적용 기획 및 변경 계획

## 1. 개요 및 목적
- 백엔드 AI 요약 파이프라인(`summarizeContentWithAi`)에서 아티클의 상세 요약(`long_summary`)은 마크다운 문법(`## 기술 개요 및 배경`, `- 주요 내용`, `**강조**` 등)으로 생성 및 저장되고 있습니다.
- 현재 `frontend/index.html`에서는 모달 바디(`modalBody`)를 단순 텍스트(`textContent` 및 `white-space: pre-wrap;`)로 렌더링하고 있어, 마크다운 기호가 그대로 노출되고 구조화된 문서 형태로 보이지 않는 문제가 있습니다.
- 오픈소스 마크다운 파서 라이브러리인 **marked.js**와 스타일 라이브러리인 **github-markdown-css**를 조합하여, 벨로그나 GitHub Readme처럼 정갈하고 가독성 높은 형태로 렌더링되도록 개선합니다.

---

## 2. 변경 대상 파일
- `frontend/index.html`

---

## 3. 세부 변경 사항

### 3.1 CDN 라이브러리 로드 추가
1. **GitHub Markdown CSS (CSS CDN)**
   - `<head>` 태그 내에 GitHub Markdown 스타일 시트 추가:
     ```html
     <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown.min.css">
     ```
2. **Marked.js (JavaScript CDN)**
   - `<body>` 하단 스크립트 실행 전 마크다운 파서 스크립트 추가:
     ```html
     <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
     ```

### 3.2 마크업 및 CSS 스타일 조정
1. **모달 본문 HTML 클래스 부여**
   - 기존 `<div class="modal-body" id="modalBody"></div>`에 `markdown-body` 클래스를 추가하여 마크다운 전용 스타일링이 적용되도록 수정:
     ```html
     <div class="modal-body markdown-body" id="modalBody"></div>
     ```
2. **CSS 스타일 최적화**
   - 기존 `.modal-body`에 설정된 `white-space: pre-wrap;`을 제거하여 HTML 파싱된 마크다운 요소(문단, 리스트 등)의 불필요한 줄바꿈/여백 중복 현상 방지.
   - `github-markdown-css`가 부모/루트 폰트나 배경을 덮어쓰지 않도록, `.modal-body.markdown-body`에 `background-color: transparent;`, `color: var(--text-color);`, `font-family: inherit;`을 지정하여 기존 모달 디자인 테마와 자연스럽게 융화되도록 설정.
   - 마크다운 본문 내 `h1`, `h2`, `h3`, `ul`, `ol`, `p`, `pre`, `code` 등의 상하 마진 및 가독성 최적화.

### 3.3 자바스크립트 렌더링 로직 수정 (`renderModalContent`)
- 기존:
  ```javascript
  document.getElementById('modalBody').textContent = item.long_summary || '내용 없음';
  ```
- 변경:
  ```javascript
  const rawMarkdown = item.long_summary || '상세 요약 내용이 없습니다.';
  const modalBodyEl = document.getElementById('modalBody');
  if (typeof marked !== 'undefined' && marked.parse) {
    modalBodyEl.innerHTML = marked.parse(rawMarkdown);
  } else {
    modalBodyEl.textContent = rawMarkdown;
  }
  ```

---

## 4. 검증 계획
1. **HTML/JS 정적 검증**: CDN 스크립트 로드 위치, 클래스 지정, ID 매핑 확인.
2. **테스트 및 빌드 검증**:
   - `npm run test`
   - `npm run build`
