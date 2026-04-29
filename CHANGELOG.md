# Changelog

이 파일은 ahwp의 사용자 영향 변경사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), 버전은 [Semantic Versioning](https://semver.org/lang/ko/) 을 따릅니다.

## [Unreleased]

### Added — Phase 0 부트스트랩

- Electron + Vite + React + TypeScript 프로젝트 셸
- 3-Pane 더미 레이아웃 (좌: 파일 placeholder / 중: 에디터 placeholder / 우: 챗봇 placeholder)
- Main ↔ Renderer IPC 핑·퐁 (`ipc:ping`)
- 보안 격리 (sandbox: true, contextIsolation: true, nodeIntegration: false)
- `shared/api.ts` — 메인↔렌더러 공유 IPC 타입 정의
- Tailwind CSS 3.4 셋업 (한글 폰트 폴백 포함)
- ESLint 10 flat config (typescript-eslint + react-hooks + react-refresh + prettier)
- Prettier 3.8 + .editorconfig
- Vitest 4 + Testing Library + jsdom (`App.test.tsx` 2 passing)
- Husky pre-commit + lint-staged
- electron-builder 설정 (mac dmg / win NSIS / linux AppImage·deb)
- GitHub Actions CI (`.github/workflows/ci.yml`) — PR·push 시 lint·typecheck·test·format:check
- GitHub Actions Release (`.github/workflows/release.yml`) — `v*` 태그 시 3 OS 매트릭스 빌드
- PR 템플릿 (`.github/PULL_REQUEST_TEMPLATE.md`)
- 진행 상황 문서 (`docs/PROGRESS.md`)
- `.gitignore`에 Electron 빌드 산출물 추가 (`dist`, `dist-electron`, `release`)

### Changed

- 패키지 매니저: pnpm → npm (corepack EPERM 이슈 회피, single package 구조라 차이 미미)

### Notes

- 브랜치(`main`/`dev`) 분리는 메인테이너가 수동 적용 필요. 명령은 [CONTRIBUTING.md](CONTRIBUTING.md) 참고
- shadcn/ui CLI 초기화는 Phase 1에서 첫 컴포넌트 도입 시점에 진행
