# ahwp 사용자 가이드

> AI 어시스턴트가 붙은 한글 (HWP / HWPX) 데스크톱 편집기.
> 이 문서는 베타 사용자를 위한 가이드입니다 — 기능 카탈로그가 아니라
> **자주 막히는 지점** + **사용 흐름 권장안** 위주로 정리했습니다.

---

## 1. 시작하기

### 1-1. 설치

GitHub Releases ([github.com/YEUNU/ahwp/releases](https://github.com/YEUNU/ahwp/releases))
에서 OS별 인스톨러를 받습니다.

- **macOS** — `ahwp-x.y.z.dmg`. notarization 미적용이라 첫 실행 시
  Gatekeeper 가 차단할 수 있습니다 → 시스템 환경설정 → 보안 → "그래도
  열기" 한 번 누르면 이후 정상 실행. (Apple 개발자 계정 등록 후 정식
  서명은 Phase 4 후속.)
- **Windows** — `ahwp-x.y.z-setup.exe` (NSIS). SmartScreen 경고가 뜨면
  "추가 정보 → 실행" — 코드 사이닝 도입 전까지는 같은 흐름.
- **Linux** — AppImage 또는 deb. AppImage 는 `chmod +x` 후 실행.

자동 업데이트는 packaged 빌드 + 인터넷 연결 시에만 동작합니다 (개발
빌드 / `AHWP_DISABLE_UPDATER=1` 일 때 비활성). 새 버전 감지 →
"받기 → 설치 → 재시작" 흐름으로 사용자 동의 후에만 진행됩니다.

### 1-2. 첫 실행

ahwp 는 **단일 워크스페이스 폴더** 모델입니다. 첫 실행에서 좌측
"폴더 열기" 로 작업 폴더를 선택하면 그 경로가 `userData/session.json`
에 저장되고 다음 실행에 자동 복원됩니다.

다른 폴더로 바꾸려면 좌측 패널 상단의 폴더 아이콘 → "폴더 변경".
`session.json` 의 `lastFolderPath` 가 갱신됩니다.

### 1-3. 첫 문서 열기 / 만들기

- **폴더 트리에서** `.hwp` / `.hwpx` 파일을 클릭 → 새 탭으로 열림.
- 메뉴 → 파일 → "새 문서" (`⌘N`) → 빈 문서 + 탭. 임시 path 에 위치하니
  편집 후 "다른 이름으로 저장" (`⌘⇧S`) 로 영구화.
- 메뉴 → 파일 → "파일 열기" (`⌘O`) → OS 다이얼로그 → 워크스페이스
  바깥의 파일도 열 수 있습니다.

---

## 2. 편집 기본

### 2-1. 탭

- 좌측 휠 클릭 / `⌘W` 로 닫기. 마우스 우클릭 → "다른 탭 닫기" / "오른쪽
  닫기" / "고정". 고정된 탭은 닫기 X 가 사라지고 좌측에 모입니다.
- 탭 드래그로 순서 재배치. 워크스페이스 바깥의 일부 외부 동작
  (예: 파인더에서 새 파일 작성) 은 chokidar watcher 가 좌측 트리에
  자동 반영합니다.

### 2-2. 저장 / 자동 저장

- `⌘S` 저장 — atomic write (tmp → rename) 라 도중 크래시에도 원본
  손실 없음. 첫 덮어쓰기 시 한 번 `<file>.bak` 사이드카가 생성되어
  pre-edit-session 본문이 보존됩니다.
- `⌘⇧S` 다른 이름으로 저장 — `.hwpx` 를 선택해도 `@rhwp/core`
  v0.7.x 의 round-trip 한계 (이미지 참조 손실) 때문에 `.hwp` 로
  자동 라우팅됩니다. (lib 수정 후 HWPX 복귀 예정.)
- **60초 자동 초안** — 모든 dirty 탭이 `userData/ahwp-drafts/<sha1>
.ahwp-draft` 에 60초마다 백업. 앱이 비정상 종료되면 다음 실행에서
  복원 옵션 제공.
- **버전 히스토리** (메뉴 → 보기 → "버전 히스토리…" 또는 `⌘K` 명령
  팔레트) —
  명시적 저장 시마다 `userData/versions/<hash>/<ISO>.hwp` 에 50개
  스냅샷 보관. 다이얼로그에서 "복원" 클릭 → 현재 본문은 `.bak` 로
  내려간 뒤 선택 버전이 복원됩니다.

### 2-3. dirty 표시 + 외부 변경 감지

- 탭 라벨 좌측의 점 (●) = 저장되지 않은 변경. `⌘S` 후 사라짐.
- 외부에서 파일을 수정하면:
  - 현재 탭이 **dirty 가 아니면** 조용히 본문 다시 읽음.
  - **dirty 면** 우측 상단에 노란 노티스로 알림 — 사용자가 "다시 읽기"
    또는 무시 선택. 자동 덮어쓰기 안 함.

---

## 3. AI 챗봇

ahwp 는 **BYOK (bring-your-own-key)** 모델입니다. API 키는 OS 키체인
(`safeStorage` 암호화) 에 저장되며 평문이 디스크에 남지 않습니다.
원격 서버는 호출 시점에만 plaintext 키가 필요하고, 키는 메인 프로세스
(Node 측) 에서만 만들어 직접 provider HTTPS 로 보냅니다 — 렌더러는
키를 보지 못합니다.

### 3-1. 키 등록

`⌘,` 로 Settings → "AI 공급자" 탭 → 사용할 provider (OpenAI / NVIDIA
NIM / Custom) 카드에서 키 입력 → "저장". "연결 테스트" 로 즉시 검증
가능합니다.

**Custom (OpenAI 호환)** 슬롯 = baseUrl + key 만 입력하면 Ollama,
vLLM, LM Studio, on-prem 게이트웨이 어디든 사용 가능. Tool calling
지원 여부도 카드에서 토글합니다.

> Anthropic / Google 슬롯은 코드 상 scaffold 만 — 메인테이너 키 결정
> 후 0.3.x 후속 버전에서 활성화 예정.

### 3-2. Manual vs Agent 모드

채팅 패널 상단의 pill 토글:

- **Manual (제안 → 승인)** — AI 가 수정안을 코드 블록 (HTML / `ahwp-tools`
  JSON / `ahwp-patches` JSON 중 하나) 으로 제안하면 화면에
  "문서에 적용" / "도구 실행" / "Accept" 버튼이 뜸. 사용자가 누르기
  전엔 본문 변경 없음. 안전 모드.
- **Agent (자동 실행)** — AI 가 도구를 직접 호출. 한 turn 안에서 read
  → reason → write 루프 (최대 10 turn) 가 자동 진행됩니다. ⌘Z 한 번
  으로 turn 전체 롤백 가능 — 모든 op 가 grouped undo 로 묶입니다.

**언제 어느 쪽**: 처음에는 Manual 로 시작 권장. 도구 사용에 익숙해지면
반복 작업 (양식 메우기 / 표 합계 / 머리말 일괄 변경) 을 Agent 로 전환.

### 3-3. 발췌 첨부 (Manual 모드)

본문 일부만 컨텍스트로 보내고 싶을 때:

1. 에디터에서 텍스트 / 셀 / 여러 단락 선택.
2. 채팅 입력란 위 `📌 발췌 첨부` 버튼 클릭 (또는 selection rect 를
   채팅 입력란으로 드래그).
3. 칩이 생성됨. 여러 발췌 첨부 가능 (multi-paragraph 도 지원).
4. 전송 시 모든 칩의 anchor 가 stale 검증 — 위치가 바뀌었으면 자동
   재바인딩, 사라졌으면 송신 차단 + "다시 선택해 주세요" 안내.

발췌 첨부 시 시스템 프롬프트의 `[현재 문서]:` 전체 HTML 첨부는
**자동 비활성화** 됩니다 (좁은 컨텍스트 우선).

### 3-4. 멀티 문서 컨텍스트

여러 탭이 열려 있으면 채팅 패널 상단에 chip strip 이 뜹니다:

- 🎯 **target** — 현재 활성 탭. 잠금 (Agent write 의 도착지).
- 📚 **reference** — 다른 탭의 체크박스를 켜면 첫 20 단락의 outline
  이 시스템 프롬프트의 `[참조 문서]:` 블록에 첨부됨. **읽기 전용** —
  Agent 가 reference 에 write 시도해도 dispatcher 가 거절합니다.

> mid-turn 에 탭을 전환해도 write 는 **턴 시작 시점의 target** 으로
> 라우팅됩니다 (chunk 50). 의도와 다른 doc 에 변경이 들어가는 사고
> 방지.

### 3-5. Diff Viewer (`ahwp-patches`)

Manual 모드에서 모델이 위치 한정 미세 수정 (오타 / 톤 / 표현) 을
제안할 때 사용하는 세 번째 응답 형식입니다.

- 1개 패치 → 큰 카드 (제목 + 위치 + +/− diff line + reason expander
  - Accept / Reject).
- 2개 이상 → 컴팩트 stack + "모두 Accept" 버튼.
- Accept 후 12초 emerald 토스트 + "되돌리기" 클릭 1회 = ⌘Z 와 동치
  (grouped undo).
- 카드의 "보기 →" 클릭 → 에디터가 해당 단락으로 자동 스크롤.

### 3-6. 채팅 히스토리

`📚` 버튼 → popover 에 활성 문서 기준 대화 목록. 인라인 이름 변경
(✎ 또는 더블클릭). 4 메시지 누적 후 자동 제목 요약 1회 한정.

---

## 4. 단축키 요약

전체 목록은 앱 안에서 `⌘/` 또는 Settings → "단축키" 탭 으로 확인하세요.

| 카테고리        | 단축키                      | 동작                                           |
| --------------- | --------------------------- | ---------------------------------------------- |
| 파일            | `⌘N` `⌘O` `⌘S` `⌘⇧S` `⌘W`   | 새 문서 / 열기 / 저장 / 다른 이름 / 탭 닫기    |
| 편집            | `⌘Z` `⌘⇧Z` `⌘C` `⌘X` `⌘V`   | 실행 취소 / 다시 실행 / 복사·잘라내기·붙여넣기 |
| 컨트롤 클립보드 | `⌘⇧C` `⌘⇧V`                 | 표 / 그림 / 도형 컨트롤 단위 복사·붙여넣기     |
| 찾기            | `⌘F` `⌘H`                   | 찾기 / 찾아 바꾸기                             |
| 서식            | `⌘B` `⌘I` `⌘U`              | 진하게 / 기울임 / 밑줄                         |
| 캐럿            | `← →` `↑ ↓` `⌘← ⌘→`         | 글자 / 시각 라인 / 단어 단위                   |
| 캐럿            | `Home` `End` `⌘Home` `⌘End` | 단락 / 문서 시작·끝                            |
| 네비게이션      | `⌘K` `⌘/` `PageUp/Down`     | 명령 팔레트 / 단축키 도움말 / 페이지           |
| 표              | `Tab` `Shift+Tab`           | 셀 사이 이동 (셀 안에서)                       |

---

## 5. 데이터 위치

OS 별 `userData` 경로:

- **macOS**: `~/Library/Application Support/ahwp/`
- **Windows**: `%APPDATA%\ahwp\`
- **Linux**: `~/.config/ahwp/`

이 폴더 안:

- `session.json` — 마지막 폴더 / 활성 탭 / 열린 탭 목록.
- `secrets.json` — `safeStorage` 로 암호화된 provider 키 (다른 머신
  으로 옮기면 복호화 불가).
- `chat-history.db` — better-sqlite3 + WAL.
- `model-cache.json` — provider `/v1/models` 응답 24h 캐시.
- `recent.json` — 최근 파일 목록 (현재 UI 미노출).
- `ahwp-drafts/<sha1>.ahwp-draft` — 60초 자동 초안.
- `versions/<hash>/<ISO>.hwp` — 명시적 저장 스냅샷 (per-file 50개).
- `error.log` — main / renderer JS 에러 로그 (chunk 63). 로컬 only,
  외부 업로드 없음. 버그 리포트 시 GitHub Issue 에 첨부 권장.
- `Crashpad/` (mac/win) 또는 `Crashes/` (linux) — Electron 의 native
  minidump (GPU / renderer 프로세스 native crash).

전체 초기화는 ahwp 종료 후 위 폴더를 삭제 — 키 / 히스토리 / 세션 모두
사라집니다.

---

## 6. 알려진 한계

자세한 목록은 [docs/KNOWN_ISSUES.md](KNOWN_ISSUES.md) 를 참고하세요.

- **HWPX 저장 시 HWP 자동 라우팅** — `@rhwp/core` v0.7.x 의 round-trip
  이 이미지 참조를 떨굽니다. lib 수정 후 복귀 예정.
- **빈 단락 char-format** — 텍스트가 0 인 단락엔 char shape 변경이
  적용 안 됨 (라이브러리 한계).
- **셀 배경색 / 테두리 setter** — `applyCellStyle` 로 명명 스타일은
  적용 가능하지만 직접 색상 setter 는 lib 미노출.
- **Anthropic / Google 어댑터** — Google Gemini 는 0.3.1 부터 동작.
  Anthropic 은 키 결정 대기.
- **macOS Gatekeeper / Windows SmartScreen** — 코드 사이닝 미적용.
  사용자 한 번 우회 필요.

---

## 7. 피드백

버그 / 제안: [github.com/YEUNU/ahwp/issues](https://github.com/YEUNU/ahwp/issues)
