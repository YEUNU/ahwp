# ahwp 앱 아이콘

확정 디자인: **9 · ㅏ Flag**

## 컨셉

한글 모음 ㅏ를 단독으로 강조한 깃발 형상. 가장 미니멀하고 알아보기 쉬운 방향으로,
작은 사이즈(16/32px)에서도 형태가 또렷하게 유지됩니다.

## 컬러

- 배경: `#2b6a6b` (브랜드 틸)
- 글리프: `#f6f4ef` (페이퍼)
- 액센트 점: `#5fb4b3` (라이트 틸) — 64px 이상에서만 표시

## 파일

| 파일 | 용도 |
|---|---|
| `ahwp-icon.svg` | 마스터 벡터 (1024 base) — 무한 확대 가능 |
| `ahwp-icon-small.svg` | 작은 사이즈용 (액센트 점 제거) |
| `ahwp-icon-16.png` | 트레이 / 메뉴바 |
| `ahwp-icon-32.png` | 작은 dock / 탭 favicon |
| `ahwp-icon-64.png` | 표준 dock 작은 모드 |
| `ahwp-icon-128.png` | 표준 dock |
| `ahwp-icon-256.png` | 큰 dock / Finder |
| `ahwp-icon-512.png` | Retina dock / Finder 미리보기 |
| `ahwp-icon-1024.png` | App Store / 패키징 마스터 |

## 플랫폼별 패키징 (참고)

- **macOS (.icns)** — 1024/512/256/128/64/32/16 PNG를 `iconutil -c icns ahwp.iconset/`
- **Windows (.ico)** — 256/128/64/32/16 PNG 멀티-사이즈 ICO
- **Linux** — `ahwp-icon-256.png`을 `~/.local/share/icons/`에 배치
- **Web favicon** — `ahwp-icon-32.png` 또는 `ahwp-icon-small.svg`
