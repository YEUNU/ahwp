# Contributing to ahwp

기여를 환영합니다. 본 문서는 개발 환경, 브랜치·커밋·PR 컨벤션을 정리합니다.

## 개발 환경

- Node.js 20 LTS 이상 (개발은 24.x로도 검증)
- npm 10+
- Git
- macOS / Windows 11 / Linux (Ubuntu 22.04 검증)

```bash
git clone <repo>
cd ahwp
npm install
npm run dev
```

## 브랜치 전략

두 개의 장기(long-lived) 브랜치를 사용합니다.

| 브랜치 | 역할                                                                                                                         | 보호                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `main` | **배포(릴리스)용**. 사용자에게 나가는 빌드의 소스. 릴리스 태그(`v0.1.0` 등)는 항상 이 브랜치에서 찍힘. GitHub default branch | 직접 push 금지. 릴리스 시 `dev`에서 PR로만 머지 |
| `dev`  | **개발 통합 브랜치**. 작업 커밋은 여기로 직접 push. 빌드는 항상 통과                                                         | 작업 커밋 직접 push OK (PR 불필요)              |

작업 브랜치 (선택):

- `feat/<topic>` — 기능 추가 (분기: `dev`, 머지백: `dev`)
- `fix/<topic>` — 버그 수정 (분기: `dev`, 머지백: `dev`)
- `chore/<topic>` — 빌드·문서·의존성 등 (분기: `dev`, 머지백: `dev`)
- `release/<version>` — (선택) 릴리스 직전 안정화. `dev`에서 분기, 안정화 후 `main`과 `dev` 양쪽으로 머지
- `hotfix/<topic>` — 운영 중 긴급 버그. `main`에서 분기, `main`과 `dev` 양쪽으로 머지

> 작업 커밋은 **`dev`로 바로 push** 합니다 (작업 브랜치 + PR 은 선택). `main`은 릴리스 전용 — `dev`→`main` PR(릴리스)과 hotfix 만 들어갑니다.

### 일반 작업 흐름

```bash
# 1. dev에서 시작
git checkout dev
git pull origin dev

# 2. 작업·커밋
git add -A
git commit -m "feat(chat): add OpenAI streaming"

# 3. dev로 바로 push (PR 불필요)
git push origin dev
```

### 릴리스 흐름

1. `dev`가 안정화되면 `release/v0.x.y` 브랜치로 분기 (필요 시)
2. 버전 bump, CHANGELOG 갱신, 베타 검증
3. `main`으로 PR 머지 → 태그 push → CI가 자동 빌드·릴리스
4. 같은 변경을 `dev`로 백머지(back-merge)

> `main`은 항상 "지금 사용자에게 나가있는" 코드. 어느 시점이든 `main`에서 빌드하면 최신 릴리스 산출물이 나와야 함.

### 처음 셋업 (메인테이너)

레포 생성 직후 한 번 실행:

```bash
# main에서 dev 분기
git checkout main
git checkout -b dev
git push -u origin dev

# GitHub repo 설정에서:
# - Default branch는 main 유지 (릴리스 전용)
# - Branch protection: main에 직접 push 금지, dev→main PR(릴리스)로만 머지
# - dev는 작업 커밋 직접 push 허용 (보호 불필요)
```

## 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/) 따름.

```
<type>(<scope>): <subject>

<body>

<footer>
```

`type`: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, `ci`

예시:

- `feat(chat): add OpenAI streaming adapter`
- `fix(hwp): handle missing styles in HWPX conversion`
- `docs: add Phase 2 detail to ROADMAP`

## PR 체크리스트

> 작업 커밋은 `dev`로 바로 push 하므로 PR 은 릴리스(`dev`→`main`) / hotfix(`main`) 때만 필요합니다.

- [ ] 관련 issue 또는 ROADMAP 항목 링크
- [ ] `npm run lint && npm test` 통과
- [ ] UI 변경 시 스크린샷/GIF 첨부
- [ ] 새 IPC 채널 / provider 추가 시 `docs/ARCHITECTURE.md` 또는 `docs/AI_INTEGRATION.md` 갱신
- [ ] 키·민감정보 절대 커밋 금지 (`.env`, 로그 포함)

## 코드 스타일

- ESLint + Prettier (사전 설정. 저장 시 자동 포맷)
- TypeScript strict
- 한 PR = 한 가지 일. 리팩터링 + 기능 추가 섞지 않기
- 메인↔렌더러 공유 타입은 반드시 `shared/`에 정의

## 테스트

- 단위: Vitest (`*.test.ts`)
- E2E: Playwright (`tests/e2e/`)
- 새 provider 어댑터는 mock 응답으로 단위 테스트 필수
- Phase 2 이후 추가되는 IPC 핸들러는 핸들러 단위 테스트 권장

## 이슈 작성

- **버그 리포트**: 재현 단계, 기대/실제, OS/앱 버전, 스크린샷
- **기능 제안**: 사용 시나리오, 대안, ROADMAP 어느 Phase에 어울릴지

## 라이선스

기여한 코드는 [Apache License 2.0](LICENSE) 하에 배포됩니다.
