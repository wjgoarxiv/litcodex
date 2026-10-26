# JetBrains Mono — 번들 폰트 출처/공급망

- 폰트: JetBrains Mono, 제작 JetBrains Mono Project Authors
- 버전: v2.304
- 라이선스: **SIL Open Font License 1.1** — 사용·수정·재배포·임베딩 허용, Reserved Font Name 없음. 파일은 수정 없이 그대로 싣는다.
- 레포: https://github.com/JetBrains/JetBrainsMono
- 릴리스 압축 파일: https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip
- **SHA256 (릴리스 zip, 공급망 핀):** `6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf`

## 번들 파일 (zip의 `fonts/ttf/`와 바이트 단위로 같다)

| 파일 | 바이트 | SHA256 |
|---|---|---|
| JetBrainsMono-Regular.ttf | 273900 | `a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f` |
| JetBrainsMono-Bold.ttf | 277828 | `5590990c82e097397517f275f430af4546e1c45cff408bde4255dad142479dcb` |
| OFL.txt | 4399 | `30f0c136e3c88e422d0791acd97238870f9054a9729bc34cf2ff0d4ed8cac4ad` |

## 쓰임
- 라틴 전용 면이다. Computational Brutalism의 제목·라벨·숫자에만 쓰고, 한글이 든 런은 `<a:ea typeface="Pretendard">`로 Pretendard가 받는다. 본문(`faces.body`)은 항상 한글 면이다.
- Regular 400과 Bold 700만 싣는다. 팩은 굵기를 `bold` 플래그로 고른다.
- 서브셋하거나 이름을 바꾸지 않는다. 파일을 바꾸면 `scripts/generate-skill-payload-hashes.mjs`가 막는다.
