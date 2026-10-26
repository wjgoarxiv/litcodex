<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.30/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.30/readme-assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 일곱 머신의 칸이 차례로 켜지고, 셋째 칸의 LitCodex 머신이 주황 바이저와 테두리를 밝힌 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<p align="center">
<a href="#설치"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.30/readme-assets/badge-version.svg" alt="1.0.30" /></a>
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.30/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage-Ko-KR.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.30/readme-assets/lucide-book-open.svg" width="16" alt="" /> 문서</a> &nbsp; <a href="#설치">설치</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/assets/readme/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.30/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.30/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitCodex

**Keep the work lit.**

요청 앞에 `lit`을 붙이면 Codex CLI가 통과·실패를 가릴 수 있는 기준을 세우고, 기준마다 증거가 남아야 일을 끝냅니다.
증거는 프로젝트 안에 남기 때문에 내일 세션은 오늘 멈춘 자리에서 시작합니다.

**[GitHub에서 전체 안내 보기](https://github.com/wjgoarxiv/litcodex/blob/main/README-Ko-KR.md)** · [English](https://github.com/wjgoarxiv/litcodex#readme)

## 설치

Node.js 22 이상과 Codex CLI가 필요합니다.

```sh
npm exec --yes --package @litfamily/litcodex@1.0.30 -- litcodex install
```

설치기는 어떤 모델이 이끌지, 어떤 모델이 거들지, 답변 스타일은 무엇으로 할지 묻고, 쓰려는 내용을 먼저 보여 준 뒤
`~/.codex/config.toml`에서 자기가 관리하는 항목만 고칩니다. 계획만 먼저 보려면
`npm exec --yes --package @litfamily/litcodex@1.0.30 -- litcodex --dry-run install`을 실행하고, 묻는 단계 없이
설치하려면 `install` 뒤에 `--yes`를 붙이세요.

```sh
npm install -g @litfamily/litcodex
litcodex install
```

전역으로 설치하면 영상 스킬이 쓸 도구를 미리 준비하느라 버전이 고정된 파일 몇 개를 내려받습니다. 무엇을 받는지와
건너뛰는 방법은 [설치 안내](https://github.com/wjgoarxiv/litcodex/blob/main/docs/install-Ko-KR.md#전역-명령으로-쓰기)에 있습니다.

> 전역 설치가 없다면 `npm exec --yes --package @litfamily/litcodex@1.0.30 -- litcodex <command>` 형식을 사용하세요.

## 첫 작업

프로젝트에서 Codex를 열고, 시작 검토에서 LitCodex 훅을 승인한 뒤 다음을 입력하세요.

```text
lit 회원가입 폼에 입력 검증을 추가해줘
```

답변이 `🔥 **LIT IGNITED · <discipline>** 🔥` 한 줄로 시작하고, 그때부터 요청은 확인 기준이 붙은 목표가 됩니다.
모든 기준에 통과 증거가 있어야 완료되고, 기록은 프로젝트의 `.litcodex/lit-loop/` 아래에 남아 `lit recap`으로 다시
읽을 수 있습니다. 세션을 마치기 전에 `handoff`만 따로 보내면 다음 세션이 시작할 인수인계 문서가 생깁니다. 출판용
그래프가 필요할 때 `lit-scientific-visualization`만 보내면 시각화 어댑터를 불러오고, Python 패키지는 설치하지 않습니다.

## 스킬

모든 스킬은 Codex skill picker에서 고르거나 `$litcodex:lit-humanizer`, `$litcodex:lit-fetch`,
`$litcodex:lit-handoff`, `$litcodex:lit-scientific-visualization`처럼 이름으로 부를 수 있습니다. 스킬마다 그림은
[스킬 안내](https://github.com/wjgoarxiv/litcodex/blob/main/docs/skills-Ko-KR.md)에 있습니다.

- 루프와 계획: `lit-loop`(`lit`), `litwork`, `lit-plan`, Start Work(`lit start work <승인된 계획>`), `litgoal`,
  `deep-interview`, `lit-brainstorm`, `lit-crucible`, `lit-team`, `lit-recap`, `lit-handoff`.
- 검토와 조사: `review-work`, `litresearch`, `autoresearch`, `autoconference`, `lit-fetch`, `wikify`,
  `coding-session-audit`, `lit-comprehend`.
- 문서, 그림, 화면: `lit-docx`, `lit-pptx`, `lit-diagram-drawer`, `lit-scientific-visualization`,
  `lit-typographic-motion`, `lit-humanizer`, `readme-studio`, `frontend-ui-ux`, `visual-qa`, `browser-drive`.
- 코드: `debugging`, `refactor`, `lit-code`, `lit-commit`, `lit-burnoff`, `lit-burnoff-file`,
  `structural-search`, `lsp-setup`, `lit-init`.
- 관리: `litcodex-doctor`, `litcodex-report-bug`, `litcodex-contribute-bug-fix`. `rules`, `lsp`,
  `comment-checker`는 알아서 돌아갑니다.

## 설치하면 달라지는 것

- Codex에 플러그인·훅·에이전트가 등록되고 `~/.codex/config.toml`의 관리 항목이 갱신됩니다. 관련 없는 Codex
  설정은 그대로 둡니다.
- 프로젝트마다 `.litcodex/lit-loop/` 아래에 로컬 기록이 생기며, Git과 패키지에서는 제외됩니다.
- [자동 핸드오프](https://github.com/wjgoarxiv/litcodex/blob/main/docs/auto-handoff-Ko-KR.md)는 선택 기능이며
  기본값은 꺼짐입니다.
- 테스트, 픽스처, 테스트 헬퍼, Vitest 설정은 저장소에만 있습니다. npm 패키지와 설치된 마켓플레이스 플러그인에는
  들어가지 않습니다.

업데이트 확인은 이렇게 동작합니다. doctor 진단은 Codex 설정, 설치 상태, 플러그인 상태를 살펴보기만 하고 바꾸지 않습니다.
조건에 맞는 대화형 doctor 실행 뒤에는 캐시해 둔 새 버전 안내가 뜰 수 있습니다. 이 안내는 백그라운드 작업이 정해진
레지스트리만 조회해 `~/.litcodex/update-check.json`에 적어 둔 내용이며, 이 작업은 아무것도 설치하지 않습니다. 이와
별개로 조건에 맞는 대화형 관리 명령 뒤에는 업데이트 실행기가 새 전역 패키지를 설치할 수 있습니다. 둘 다 끄려면
`LITCODEX_NO_UPDATE_CHECK=1`을 설정하세요. 실패했거나 `--json`·`--dry-run`으로 돌렸거나, 비TTY·CI 환경이거나
이 설정으로 끈 doctor 실행은 아무것도 바꾸지 않습니다.

## 확인, 문제 해결, 제거

```sh
npm exec --yes --package @litfamily/litcodex@1.0.30 -- litcodex doctor
```

`litcodex doctor`는 등록·훅·설정·호스트 기능을, `litcodex loop doctor`는 현재 프로젝트의 루프 상태를 확인합니다.
`lit`을 입력해도 반응이 없다면 doctor를 실행하고 Codex에서 훅을 승인했는지 확인하세요. 다른 해결 방법은
[문제 해결](https://github.com/wjgoarxiv/litcodex/blob/main/README-Ko-KR.md#문제-해결)에 있습니다.

```sh
npm exec --yes --package @litfamily/litcodex@1.0.30 -- litcodex uninstall
```

플러그인과 LitCodex가 관리하는 설정을 지우고, 관련 없는 설정은 그대로 둡니다.

## 링크

[사용 참고서](https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage-Ko-KR.md) ·
[기존 설치 이전](https://github.com/wjgoarxiv/litcodex/blob/main/docs/npm-migration.md) ·
[CHANGELOG.md](https://github.com/wjgoarxiv/litcodex/blob/main/CHANGELOG.md) ·
[개인정보](https://github.com/wjgoarxiv/litcodex/blob/main/docs/privacy.md) ·
[이슈](https://github.com/wjgoarxiv/litcodex/issues) · MIT 라이선스
