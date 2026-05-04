# Release Flow

ahwp 의 release 절차. 메인테이너 (YEUNU) 가 dev 에 누적된 변경을 안정적
으로 사용자에게 배포하는 통일된 흐름.

---

## 0. 준비물

- `main` push 권한 + tag push 권한 (GitHub repo)
- macOS / Windows 에서 직접 빌드 검증 필요 시 로컬 환경
- electron-updater 를 통해 사용자 앱이 자동 업데이트 받으려면 **GitHub
  Release 가 public** 이어야 함 (private repo 의 release 는 token 필요)

CI 가 모든 OS 빌드를 매트릭스로 만들어주므로 메인테이너는 **태그 push만**
하면 GitHub Releases 에 빌드 결과 + `latest.yml` (electron-updater 메타)
이 자동 업로드됨.

---

## 1. dev 누적 → main merge

- dev 브랜치에 모든 feature/fix 가 PR 머지됨
- 충분한 안정성 확인 (테스트 통과 + 직접 dogfood)
- 메인테이너가 dev → main fast-forward 또는 no-ff merge

```bash
git checkout main
git pull origin main
git merge dev --no-ff -m "release: vX.Y.Z 변경사항 요약"
```

---

## 2. 버전 태그 생성

`package.json` 의 version 은 dev 작업 시 청크/단계별로 이미 bump 됨.
release 시점에선 그 버전과 일치하는 annotated tag 만 생성.

```bash
git tag v0.3.6 -m "Phase 4 chunks 52~54 — About / electron-updater / release flow"
git push origin main
git push origin v0.3.6
```

태그 명명 규칙: `v<MAJOR>.<MINOR>.<PATCH>` (Semantic Versioning).

---

## 3. CI 자동 빌드 + GitHub Release 업로드

`.github/workflows/release.yml` 이 `v*` 태그 push 트리거됨:

1. **Matrix**: macos-latest / windows-latest / ubuntu-latest 각 OS 에서
2. `npm ci` → `npx vite build` (renderer + main 번들) → `npx electron-builder --publish always`
3. electron-builder 가 `package.json` 의 `build.publish` (GitHub provider)
   를 보고 GitHub Releases 에 직접 upload:
   - macOS: `ahwp-X.Y.Z.dmg` + `ahwp-X.Y.Z-mac.zip` + `latest-mac.yml`
   - Windows: `ahwp-X.Y.Z-setup.exe` + `latest.yml`
   - Linux: `ahwp-X.Y.Z.AppImage` + `ahwp-X.Y.Z.deb` + `latest-linux.yml`
4. Release 는 draft 로 시작 — 메인테이너가 GitHub web UI 에서 release
   notes 작성 후 publish

Tag push 후 5~15 분 정도 (3 OS 매트릭스).

---

## 4. Release notes 작성

GitHub web UI → Releases → draft 에서 편집:

- 한 줄 요약: "Phase X chunk YY — 핵심 기능 한 줄"
- 카테고리별 변경 (Added / Changed / Fixed / Removed)
- 사용자 영향 변경은 [`CHANGELOG.md`](../CHANGELOG.md) 의 해당 버전
  섹션 그대로 복사하면 됨 (CHANGELOG 가 release notes 의 single source
  of truth)
- 새 기능 스크린샷 / GIF (선택)
- breaking change 가 있으면 별도 섹션

publish 클릭 시 사용자 앱들이 다음 launch 5초 후 `latest.yml` 을
GitHub 에서 fetch → 새 버전 발견 → background download → 다음 quit 시
auto install (`autoUpdater.autoInstallOnAppQuit = true`).

---

## 5. 사용자 측 동작 (electron-updater)

- 첫 launch: 5초 후 `autoUpdater.checkForUpdates()` 호출
- 업데이트 없음: silent
- 업데이트 발견: `update-available` 이벤트 emit (현재 console 만)
- 다운로드: `autoDownload = false` 라 사용자 트리거 필요 (chunk 56 후속:
  in-app dialog "새 버전 X 다운로드?" → 클릭 시 `downloadUpdate()`)
- 다운로드 완료: 다음 quit 시 자동 install

dev 모드에선 `app.isPackaged === false` 라 updater 가 활성화되지 않음.
QA 시 `AHWP_DISABLE_UPDATER=1` 으로도 비활성 가능.

---

## 6. 비상 시 — release 회수 / hotfix

- **잘못된 release 회수**: GitHub web UI 에서 "Delete release" + "Delete
  tag" + 새 release 발급. 이미 다운로드한 사용자에겐 영향 없음 (다음
  release 가 더 높은 버전이면 자동 update 로 덮어씀)
- **Hotfix**: `main` 에서 cherry-pick 후 `vX.Y.(Z+1)` tag

---

## 7. 검증 체크리스트

태그 push 전 필수 확인:

- [ ] `npm run typecheck` 청정
- [ ] `npm run lint` 0 errors
- [ ] `npm test` 통과 (단위)
- [ ] `npm run e2e` — studio + chat 270+ 케이스 통과
- [ ] 라이브 smoke (`tests/e2e/{nvidia,gemini,ollama}-live.spec.ts`)
- [ ] `package.json` version === tag version
- [ ] `CHANGELOG.md` 의 [Unreleased] → 현재 버전 섹션 정리
- [ ] `docs/PROGRESS.md` 현재 스냅샷 업데이트
- [ ] `docs/ROADMAP.md` 청크 체크박스 갱신

---

## 8. 알려진 제약

- **macOS notarization 미적용** — 사용자가 Gatekeeper 우회 (System
  Settings → Privacy & Security → "Open Anyway") 필요. notarization 은
  유료 Apple Developer 계정 + entitlements 필요해서 보류 (Phase 4
  잔여 항목)
- **Windows code signing 미적용** — SmartScreen 경고 표시 가능. 코드
  사이닝 인증서 비용 issue
- **Linux signing 무관** — AppImage / deb 둘 다 unsigned distribution
  관행 표준
