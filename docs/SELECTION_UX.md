# Selection UX 설계 문서

본문 / 표 / 이미지 / 도형이 섞인 HWP 문서에서 마우스 드래그로
selection을 만드는 동작을 한컴 한글의 reference 동작에 맞춰 정의하고,
ahwp 구현을 phase로 나눠 추적한다.

작성: 2026-05-02 (0.2.74 follow-up)

## 1. Reference: 한컴 한글 (Hancom Office Hangul) 공식 동작

[표 — 셀 블록 <F5>](<https://help.hancom.com/hoffice/multi/ko_kr/hwp/table/table(cell).htm>),
[블록 (본문)](https://help.hancom.com/hoffice/multi/ko_kr/hwp/edit/block.htm),
[모두 선택](https://help.hancom.com/hoffice/multi/ko_kr/hwp/edit/select_all.htm),
[개체 선택](<https://help.hancom.com/hoffice/multi/ko_kr/hwp/draw/drawing(select).htm>)
공식 도움말 발췌.

### 1.1 본문 블록 (텍스트 드래그)

> "마우스 왼쪽 단추를 누른 채로 블록으로 설정할 내용의 끝 부분까지
> 마우스를 끕니다."
> — Hancom 공식 도움말, "블록"

> "<Esc>를 눌러 블록을 해제합니다."

본문 mousedown → drag → mouseup으로 텍스트 범위가 선택되고,
ESC로 언제든 (드래그 중이든 드래그 후든) 해제. 본문 드래그가
표/이미지/도형 같은 개체를 통과할 때의 동작은 공식 문서에
명시 안 됨 — 한글 실사용 관찰 + Word/Pages reference로 보완.

### 1.2 셀 블록 (표 안)

> "셀 안에 커서를 놓고 <F5>를 누르면 커서가 있던 셀이 역상으로
> 변하면서 셀 블록이 설정됩니다."
> — Hancom 공식 도움말, "셀 블록"

> "셀 블록을 시작할 셀에 마우스 포인터를 놓고 마우스 왼쪽 단추를
> 누른 채 마우스를 끌면 마우스가 지나간 셀이 모두 셀 블록으로
> 설정됩니다."

> "<Esc>를 눌러 셀 블록 상태를 해제합니다."

핵심:

- 셀 안 마우스 드래그가 다른 셀로 넘어가면 → **셀 단위 multi-cell
  block** 선택 (글자가 아닌 셀이 selection unit).
- F5 → 1셀, F5×2 → 확장 모드, F5×3 → 표 전체.
- Ctrl+클릭으로 불연속 셀 추가 가능.
- ESC / Enter로 해제.

### 1.3 개체 선택 (도형 / 이미지)

> "[도형] 탭에서 [개체 선택] 아이콘을 누르면 마우스를 끌어 이미
> 그려진 개체를 완전히 포함하는 직사각형의 선택 영역을 만들 수
> 있으며, 점선 종류의 직사각형 안에 포함된 개체들이 선택됩니다."
> — Hancom 공식 도움말, "개체 선택"

> "Shift를 누른 채로 마우스의 왼쪽 단추를 눌러 개체를 선택"

개체 선택은 **별도 모드** (도형 탭의 "개체 선택" 도구). 일반
텍스트 모드에선 도형/이미지를 클릭으로 단일 선택, Shift+클릭으로
다중 선택.

### 1.4 문서 모두 선택

> "Ctrl+A → 본문 전체"
> — 한컴 단축키 일람

본문 모드에선 Ctrl+A가 현재 섹션의 본문 전체. 셀 블록 모드에선
표 전체가 됨.

## 2. Reference: 다른 워드프로세서 (참고)

| 동작                             | Word                                                                 | Pages | Hancom                                       | ahwp 채택                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------- | ----- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 본문 드래그 → 인라인 이미지 통과 | 이미지를 selection에 포함 (이미지가 한 글자처럼)                     | 동일  | 명시 안 됨 (관찰: 단락 단위로 포함)          | **Word 모델 채택** — 인라인 control은 단락에 포함되면 selection에 포함, 시각적으로 highlight                        |
| 본문 드래그 → 표 통과            | 표 위로 드래그 시 표 셀 일부 선택, 표 밖으로 나가면 본문 모드로 복귀 | 동일  | 명시 안 됨 (관찰: 표 진입 시 셀 모드로 전환) | **Hancom 모델 채택** — 표 진입 직전 본문 단락까지 selection, 표 통과는 표가 속한 단락 단위 포함 + 표 자체 highlight |
| 셀 안 드래그 (셀 경계 안)        | 셀 안 글자 선택                                                      | 동일  | 명시 안 됨 (관찰: 글자 단위)                 | **셀 안 글자 선택** (0.2.73 v1)                                                                                     |
| 셀 안 드래그 (셀 경계 넘음)      | 셀 단위 multi-cell block                                             | 동일  | **셀 단위 multi-cell block**                 | **Hancom 모델 채택** — 셀 경계 넘으면 셀 단위 block 모드로 전환                                                     |
| ESC                              | 항상 selection 해제                                                  | 동일  | 항상 해제                                    | 0.2.70에서 추가 ✅                                                                                                  |

## 3. 현재 ahwp 구현 상태 (0.2.74 시점)

| 항목                                                         | 상태         | commit     |
| ------------------------------------------------------------ | ------------ | ---------- |
| 본문 텍스트 드래그                                           | ✅           | (chunk 5b) |
| ESC 해제 (드래그 중 + 드래그 후)                             | ✅           | 0.2.70     |
| 본문 드래그 → 페이지 전체 highlight 버그 (native selection)  | ✅ fix       | 0.2.70     |
| Wrapped paragraph 두 번째 줄 rect 누락 (lib 버그 workaround) | ✅ fix       | 0.2.71     |
| 본문 드래그가 control 통과 시 control 부모 단락 포함         | ✅           | 0.2.72     |
| 셀 안 글자 드래그 (같은 셀 + 같은 cellParaIndex)             | ✅ v1        | 0.2.73     |
| 표 bbox 시각 highlight (control 영역도 selection 색상)       | ✅ v1 (표만) | 0.2.74     |
| 셀 경계 넘는 드래그 → 셀 단위 multi-cell block               | ❌           | —          |
| F5 셀 블록 단축키                                            | ❌           | —          |
| 이미지/도형 bbox highlight                                   | ❌           | —          |
| Ctrl+클릭 불연속 셀 추가                                     | ❌           | —          |
| 개체 선택 모드 (도형 탭)                                     | ❌           | —          |

## 4. 갭 분석 — 한글 reference 기준

Hancom 동작과 차이가 있는 항목:

### 4.1 (높음) 셀 경계 넘는 드래그

**현재**: 드래그가 다른 셀로 가면 focus freeze (cellDragRef 가드).
**Hancom**: 첫 셀에서 드래그 시작 → 다른 셀로 진입 순간 셀 단위
multi-cell block으로 전환, 통과한 모든 셀이 block.

→ **Phase A 작업**.

### 4.2 (중간) F5 셀 블록 단축키

**현재**: F5 핸들러 없음.
**Hancom**: F5 = 현재 셀 block, F5×2 = 확장 모드 (arrow keys 동작
바뀜), F5×3 = 표 전체.

→ **Phase B 작업** (확장 모드는 별도).

### 4.3 (낮음) 이미지 / 도형 bbox highlight

**현재**: `getTableBBox`만 사용해서 표만 highlight.
**Hancom**: 이미지/도형도 인라인 단락 포함 시 시각적 강조 필요.

→ **Phase C 작업** — `@rhwp/core`에서 이미지/도형 bbox API
publish 후 (현재는 `getShapeProperties`에 일부 포함될 가능성 있음 —
조사 필요).

### 4.4 (낮음) Ctrl+클릭 불연속 셀 / F8/F7 행·열 셀 블록

**현재**: 없음.
**Hancom**: Ctrl+클릭으로 불연속, F8 = 행, F7 = 열.

→ **Phase D** — power user 기능.

## 5. 구현 phase 계획

### Phase A: 셀 경계 넘는 드래그 (multi-cell block)

목표: 드래그가 셀 A에서 셀 B로 진입하는 순간 anchor·focus를 cell-
block 모드로 전환. 통과한 모든 셀의 bbox를 highlight.

작업:

1. selection state에 `mode: 'body' | 'cell-text' | 'cell-block'`
   필드 추가 또는 anchor.cell ↔ focus.cell mismatch로 derive.
2. `applyPointerToSelection`의 `cellDragRef` 분기 확장:
   - 같은 셀: 현재처럼 char-level
   - 다른 셀로 진입: cell-block 모드로 전환, focus.cell 업데이트
3. `getTableCellBboxes`로 각 셀 bbox 받아서 anchor 셀 ~ focus 셀
   직사각형 영역 안의 셀들을 highlight 대상으로 산출.
4. 새 state `cellBlockBboxes` (또는 selectionRectsByPage에 통합)
   로 그려서 표시.
5. 셀 block 상태에서 ESC → 해제, ENTER → 해제 + caret 첫 셀
   첫 위치.

위험: 표가 페이지 경계를 넘는 케이스. 중첩 셀 (`cellPath`).
이건 phase A scope에서 단일 표 + 비중첩만 지원, 중첩은 phase E.

### Phase B: 한글 호환 단축키

[표 관련 단축키](<https://help.hancom.com/hoffice/multi/ko_kr/hwp/view/toolbar/shortcut(table).htm>)
공식 도움말 기준. ahwp가 현재 가지고 있는 단축키는
`docs/ARCHITECTURE.md` / `electron/menu.ts` 참고.

#### B-1. 본문 블록 단축키 (F3 시리즈)

| 단축키 | 한글 동작                                               | ahwp 매핑 결정                                                                     |
| ------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| F3     | 블록 시작/확장 모드 진입 (이후 화살표가 selection 확장) | **선택**: 구현 (확장 모드 indicator 필요) / 미구현 (Shift+화살표가 이미 동일 효과) |
| F3×2   | 현재 단어 block                                         | 더블 클릭과 같음. 키보드 진입로 추가                                               |
| F3×3   | 현재 단락 block                                         | 트리플 클릭과 같음                                                                 |
| F3×4   | 문서 전체 block                                         | ⌘A와 같음                                                                          |

ahwp는 ⌘A / 더블·트리플 클릭이 이미 있으므로 F3 mapping은 **호환
편의용**. 우선순위 낮음.

#### B-2. 셀 / 표 블록 단축키 (F5 / F7 / F8)

| 단축키               | 한글 동작                                  | ahwp 작업                                 |
| -------------------- | ------------------------------------------ | ----------------------------------------- |
| F5 (셀 caret 시)     | 현재 셀을 block 처리                       | 신규: cell-block selection 설정           |
| F5 재입력 / Shift+F5 | 셀 block 확장 모드 (화살표가 셀 단위 확장) | 신규: 확장 모드                           |
| F5×3                 | 표 전체 block                              | 신규: `getTableDimensions`로 모든 셀 마크 |
| F7                   | 칸(열) 전체 block                          | 신규                                      |
| F8                   | 줄(행) 전체 block                          | 신규                                      |

위 모두 **셀 안 또는 셀 block 활성** 상태에서만 동작. 본문에선
no-op. ahwp의 F-key는 현재 미사용이라 충돌 없음 (F8은 한글에서
"맞춤법"이지만 ahwp는 미구현).

#### B-3. 표 navigation 단축키

| 단축키              | 한글 동작                                     | ahwp 작업 |
| ------------------- | --------------------------------------------- | --------- |
| Tab (셀 안)         | 다음 셀로 이동                                | 신규      |
| Shift+Tab (셀 안)   | 이전 셀로 이동                                | 신규      |
| Ctrl+Tab (셀 안)    | 셀 안에 탭 문자 삽입                          | 신규      |
| Alt+화살표 (셀 안)  | 셀 단위 커서 이동 (선택 확장 X)               | 신규      |
| Shift+ESC (셀 안)   | 표 빠져나가기 (caret을 표 밖 다음 단락으로)   | 신규      |
| Enter (셀 block 중) | 편집 모드로 전환 (block 해제 + caret 첫 위치) | 신규      |

#### B-4. 표 편집 단축키 (셀 block 활성 후)

| 단축키                 | 한글 동작              | ahwp 작업                   |
| ---------------------- | ---------------------- | --------------------------- |
| Ctrl+Enter (셀 안)     | 줄(행) 추가            | 신규 — IR API 있으면 라우트 |
| Ctrl+Backspace (셀 안) | 줄(행) 삭제            | 신규                        |
| Alt+Insert (셀 block)  | 줄/칸 추가             | 신규                        |
| Alt+Delete (셀 block)  | 줄/칸 삭제             | 신규                        |
| H / W (셀 block)       | 줄 높이 / 줄 너비 같게 | 후순위                      |
| M / S (셀 block)       | 셀 합치기 / 나누기     | 신규                        |

#### B-5. 본문 도움 단축키

| 단축키   | 한글 동작              | ahwp 매핑                            |
| -------- | ---------------------- | ------------------------------------ |
| Alt+L    | 글자 모양 다이얼로그   | 신규                                 |
| Alt+T    | 문단 모양 다이얼로그   | 신규                                 |
| Alt+P    | 인쇄                   | 신규 (⌘P가 표준이므로 둘 다 mapping) |
| F6       | 스타일 다이얼로그      | 후순위                               |
| Ctrl+F10 | 문자표 (특수문자 입력) | 후순위                               |

#### Phase B 작업 순서 (제안)

1. **B-2 핵심**: F5 / F7 / F8 (셀·행·열 block) — Phase A의 cell-
   block 모드 기반.
2. **B-3 navigation**: Tab / Shift+Tab / Alt+화살표 — 셀 진입 후
   탐색 UX 핵심.
3. **B-4 편집**: 행/열 추가·삭제·합치기·나누기 — 표 편집 워크플로
   완성.
4. **B-5 본문**: Alt+L / Alt+T 다이얼로그 — 한글 reflex 사용자
   호환.
5. **B-1 F3 시리즈**: 호환성 편의 — 가장 마지막.

각 단축키는 `electron/menu.ts`의 accelerator 등록 + `handleKeyDown`
의 keydown 처리 둘 다 필요 (메뉴는 단축키 표시용, keydown은 컨텍스트
의존 동작용).

### Phase C: 이미지/도형 bbox highlight

작업:

1. `@rhwp/core`에서 이미지/도형 bbox API 사용 가능한지 조사
   (`getShapeProperties` 반환에 width/height 있는지).
2. 적합 API 있으면 `getTableBBox`와 같은 패턴으로 selectedControlBboxes
   에 추가.
3. lib에 미스터리한 부분이 있으면 `KNOWN_ISSUES`에 적어두고
   blocked 표시.

### Phase D: Ctrl+click 불연속 / F8 / F7

(power user 기능, 후순위)

### Phase E: 중첩 표 (cellPath 기반)

(현재 본문 ↔ 표 셀 1단계만 지원. 셀 안에 다시 표가 있는 케이스는
v2 이후)

## 6. 결정 사항 (2026-05-02 confirmed)

| #   | 결정                                                | 비고                                                                                                  |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | Phase 순서: **A → B-2 → B-3 → B-1**                 | A의 cell-block 모델 위에 B-2가 올라가는 의존 관계. B-1은 호환 편의용으로 마지막.                      |
| 2   | Mac 단축키: **옵션 ③ (F-key + ⌘⌥ 변환 둘 다)**      | electron menu에 두 accelerator 동시 등록. 한글 reflex 사용자(F5)와 Mac native 사용자(⌘⌥B) 모두 cover. |
| 3   | F3 본문 block 단축키 (B-1): **구현**                | ⌘A / 더블·트리플 클릭과 중복이지만 한글 reflex 호환.                                                  |
| 4   | Phase C 이미지·도형 bbox: **KNOWN_ISSUES에 박제만** | 우리 repo issue 없이 `docs/KNOWN_ISSUES.md`에 기록, `@rhwp/core`가 publish하면 unblock.               |

확장 모드 indicator (#5 미정) — Phase B-2 진입 시 결정. Status bar
에 "셀 블록 모드" 라벨이 가장 깔끔할 듯, 일단 그 방향으로.

### Mac 매핑 표 (Phase B 적용 시)

| 한글 동작          | PC              | Mac (⌘⌥)               |
| ------------------ | --------------- | ---------------------- |
| 셀 block           | F5              | ⌘⌥B (Block)            |
| 셀 block 확장 모드 | Shift+F5 / F5×2 | ⌘⌥⇧B                   |
| 표 전체 block      | F5×3            | ⌘⌥A                    |
| 칸(열) 전체 block  | F7              | ⌘⌥C (Column)           |
| 줄(행) 전체 block  | F8              | ⌘⌥R (Row)              |
| 표 빠져나가기      | Shift+Esc       | ⌘⌥Esc                  |
| 본문 단어 block    | F3×2            | (더블 클릭으로 대체)   |
| 본문 단락 block    | F3×3            | (트리플 클릭으로 대체) |
| 본문 모두 선택     | F3×4            | ⌘A (기존)              |

위 매핑은 작업하면서 microsoft Word for Mac / Pages 컨벤션과
충돌 없는지 final check 후 확정.

## 7. 회귀 방지 (E2E)

각 phase 마무리에 e2e 추가:

- `tests/e2e/studio-cell-drag.spec.ts` (Phase A)
  - 셀 안 char drag (동일 셀)
  - 셀 경계 넘는 drag → multi-cell block
  - ESC로 해제
- `tests/e2e/studio-cell-block-shortcut.spec.ts` (Phase B)
  - F5 1회 → 셀 block
  - F5×2 + arrow → 확장
  - F5×3 → 표 전체
- `tests/e2e/studio-control-highlight.spec.ts` (Phase C)
  - 표/이미지/도형 bbox overlay 그려짐 검증
- `tests/e2e/studio-table-shortcuts.spec.ts` (Phase B)
  - F5 / F7 / F8 셀·행·열 block 동작
  - Tab / Shift+Tab 셀 이동
  - Shift+ESC 표 빠져나가기

## 8. 참고 (Sources)

- [한컴 한글 — 셀 블록 <F5>](<https://help.hancom.com/hoffice/multi/ko_kr/hwp/table/table(cell).htm>)
- [한컴 한글 — 블록 (본문)](https://help.hancom.com/hoffice/multi/ko_kr/hwp/edit/block.htm)
- [한컴 한글 — 모두 선택](https://help.hancom.com/hoffice/multi/ko_kr/hwp/edit/select_all.htm)
- [한컴 한글 — 개체 선택](<https://help.hancom.com/hoffice/multi/ko_kr/hwp/draw/drawing(select).htm>)
- [한컴 한글 — 표 단축키 일람](<https://help.hancom.com/hoffice/multi/ko_kr/hwp/view/toolbar/shortcut(table).htm>)
- [한컴 한글 — Cell Block <F5> (영문)](<https://help.hancom.com/hoffice100/en-US/Hwp/table/table(cell).htm>)
