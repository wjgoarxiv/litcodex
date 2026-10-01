<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.15/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.15/readme-assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitCodex 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<p align="center">
<a href="#설치"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.15/readme-assets/badge-version.svg" alt="1.0.15" /></a>
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.15/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage-Ko-KR.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.15/readme-assets/lucide-book-open.svg" width="16" alt="" /> 문서</a> &nbsp; <a href="#설치">설치</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/assets/readme/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.15/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.15/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitCodex

**Keep the work lit.**

LitCodex는 Codex CLI 플러그인입니다. 계획, 검토, 조사와 오래 이어지는 실행 루프를 더해서, 한 번 시작한
작업이 대화가 끝난 뒤에도 이어지게 합니다. 요청에 `lit`을 붙이면 목표와 확인 기준, 결과가 프로젝트에 남고,
다음 세션에 그 기록을 읽게 해서 이어갈 수 있습니다.

**[전체 안내와 스킬 갤러리는 GitHub에서](https://github.com/wjgoarxiv/litcodex/blob/main/README-Ko-KR.md)** · [English](https://github.com/wjgoarxiv/litcodex#readme)

## 설치

Node.js 22 이상과 Codex CLI가 필요합니다.

```sh
npm exec --yes --package @litfamily/litcodex@1.0.15 -- litcodex install
```

설치기는 플러그인과 훅, 에이전트를 등록하고 `~/.codex/config.toml`에서는 자기가 관리하는 항목만 고칩니다.
설치 중에 어떤 모델이 작업을 이끌지(리드), 어떤 모델이 거들지(헬퍼), 답변 스타일은 무엇으로 할지 묻습니다.
새로 설치하면 리드는 `gpt-6-astra`/`xhigh`, 헬퍼는 `gpt-6-luna`/`max`로 시작합니다. 바뀔 내용을 먼저 보려면
`npm exec --yes --package @litfamily/litcodex@1.0.15 -- litcodex --dry-run install`을 실행하고, 묻는 단계 없이
설치하려면 `install` 뒤에 `--yes`를 붙이세요.

전역 명령으로 쓰려면 다음을 실행합니다.

```sh
npm install -g @litfamily/litcodex
litcodex install
```

전역으로 설치하면 `CI`가 설정되어 있지 않은 한 짧은 설치 스크립트가 환영 문구를 보여 주고, 영상 스킬
`lit-typographic-motion`이 쓸 도구를 미리 받아 둡니다. 처음 영상을 요청할 때 렌더링 도구가 이미 준비되어 있게
하려는 것입니다. 그래서 인터넷을 조금 씁니다. 버전이 고정된 npm 패키지는 레지스트리에서, 고정된 글꼴·라이선스 파일은 GitHub와 apache.org에서
받아 모두 `${XDG_CACHE_HOME:-~/.cache}/litcodex/motion-runtime/`에 둡니다. 브라우저는 받지 않습니다. 이 단계가
끝나지 않아도 LitCodex 설치는 그대로 남고, 나중에 `litcodex motion-runtime install`로 다시 해 보면 됩니다.

전역 설치 때 이 스크립트를 빼려면 `--ignore-scripts`를 붙이거나 그 명령에만 `CI=1`을 설정하세요.
다만 이렇게 빼도 내려받기가 뒤로 미뤄질 뿐입니다. `litcodex install`이 설치에 성공한 뒤 같은 도구를 준비하고,
이 단계는 끌 수 없습니다.

> 전역 설치가 없다면 `npm exec --yes --package @litfamily/litcodex@1.0.15 -- litcodex <command>` 형식을 사용하세요.

기존 설정과 떼어 놓고 써 보려면
[격리된 체험 안내](https://github.com/wjgoarxiv/litcodex/blob/main/docs/npm-migration.md#isolated-local-trial)를
따르세요. 체험용 홈 디렉터리를 통째로 따로 만드는 방법인데, `CODEX_HOME` 하나만 바꾸면 기존 설정이 여전히
읽힐 수 있기 때문입니다. Windows에서도 설치기와 CLI shim은 동작하고, POSIX가 필요한 Python 경로만
`BLOCKED_UNSUPPORTED_PYTHON_POSIX_RUNTIME`으로 멈춥니다.

## 첫 작업

프로젝트에서 Codex를 열고, 시작 검토에서 LitCodex 훅을 승인한 뒤 다음을 입력하세요.

```text
lit 회원가입 폼에 입력 검증을 추가해줘
```

답변이 `🔥 **LIT IGNITED · <discipline>** 🔥` 한 줄로 시작하면 요청이 LitCodex에 닿은 것입니다. 목표는 성공
기준을 모두 통과해야 완료되고, 기록은 프로젝트의 `.litcodex/lit-loop/` 아래에 남습니다.

직접 판단할 수 있는 첫 작업이 필요하다면 빈 폴더에서 이렇게 시작해 보세요.

```text
lit 현재 폴더에 HTML 파일 하나로 할 일 목록을 만들어줘. 외부 의존성은 설치하지 마.
할 일 추가와 완료 처리를 확인하고, 확인하지 못한 부분은 따로 남겨줘.
```

끝나면 결과물, 실제로 돌린 확인, 아직 남은 일을 살펴보세요. `lit recap`은 기록된 상태를 다시 읽어 주고,
세션을 마치기 전에 `handoff`만 따로 보내 두면 다음 세션이 거기서 시작할 수 있습니다.

## 자주 쓰는 경로

| 입력 | 하는 일 |
| --- | --- |
| `lit` | 프로젝트에 목표와 확인 기준을 남기며 범위가 정해진 작업을 시작합니다. |
| `handoff` 또는 `/lit-handoff` | 확인한 결과와 다음 할 일을 다음 세션으로 넘깁니다. |
| `lit-plan` | 무엇이든 고치기 전에 계획과 성공 기준부터 씁니다. |
| `lit start work <승인된 계획>` | 승인한 계획을 실행합니다. |
| `review-work` | 변경과 그 근거를 검토합니다. |
| `litresearch` | 출처를 달아 조사하고, 아직 불확실한 부분을 따로 적어 둡니다. |

메시지 전체가 그 한 단어일 때만 동작하는 단어가 두 개 있습니다. `handoff`만 보내면 인수인계 문서를 만들고,
`lit-scientific-visualization`만 보내면 시각화 어댑터를 불러옵니다. Python 패키지는 설치하지 않습니다.

## 패키지에 들어 있는 스킬

아래 스킬은 Codex skill picker에서 고를 수 있고, `$litcodex:lit-humanizer`, `$litcodex:lit-fetch`,
`$litcodex:lit-handoff`, `$litcodex:lit-scientific-visualization`처럼 `$litcodex:` 접두어를 붙인 이름으로 불러도 됩니다. 스킬마다 그림을
곁들인 설명은 GitHub에 있습니다.

**작업을 계획하고 실행하기**

- `lit-loop`(`lit`): 세션이 바뀌어도 이어지는 루프 안에서 일하고, 확인하지 못한 것은 그대로 적어 둡니다.
- `litwork`: 처음부터 끝까지 꼼꼼한 구현이나 수정입니다. 실패하는 테스트 먼저, 그다음 실제 화면에서 증명합니다.
- `lit-plan`: `.litcodex/plans/`에 번호 붙은 승인 계획을 만듭니다. 계획만 세웁니다.
- Start Work(`lit start work <승인된 계획>`): 승인된 계획을 다섯 관문으로 실행합니다.
- `litgoal`: 관찰 가능한 기준을 붙인 목표 하나를 루프에 묶습니다.
- `deep-interview`: 만들 수 있을 만큼 분명해질 때까지 한 번에 한 질문씩 묻습니다.
- `lit-crucible`: 계획 전에 요구사항을 반박해 보고, 반박을 견딘 위험만 계획으로 넘깁니다.
- `lit-team`: 여러 작업자에게 겹치지 않는 몫을 나누고, 각자 증거와 함께 보고하게 합니다.
- `lit-recap`, `lit-handoff`: 지금 상태를 읽기 전용으로 요약하고, 다음 세션이 이어받을 파일을 만듭니다.

**검토, 조사, 지식**

- `review-work`: 리뷰 다섯 개가 따로 돌고, 하나라도 통과하지 못하면 승인이 나지 않습니다.
- `litresearch`: 조사를 요청할 때만 움직이며, 여러 갈래로 증거를 모아 출처와 함께 종합합니다.
- `autoresearch`: 승인된 예산 안에서 실험을 반복합니다.
- `autoconference`: 예산을 정해 두고 연구 회의를 엽니다.
- `lit-fetch`: 보통 방법으로 부족할 때 주소·DNS·본문 안전 검사를 거쳐 공개 페이지를 읽습니다.
- `wikify`: 검토를 거친 프로젝트 지식을 디스크에 두고, 나중 질문에 출처와 함께 답합니다.
- `coding-session-audit`: 지난 Codex 세션을 기록으로 읽고 어디서 멈췄는지 보여 줍니다.
- `lit-comprehend`: 에이전트가 쓴 작업을 이해하도록 돕는 설명 페이지를 만들고, 짧은 퀴즈로 마무리합니다.

**문서, 그림, 화면**

- `lit-docx`, `lit-pptx`: 서식을 갖춘 Word 파일이나 편집 가능한 PowerPoint 파일을 원고 Markdown과 함께 만듭니다.
- `lit-diagram-drawer`: 편집 가능한 다이어그램을 그리고 검사한 뒤 PNG와 Office용 SVG로 내보냅니다.
- `lit-scientific-visualization`: 학술지 규격 그림을 벡터와 600 DPI로 내보냅니다.
- `lit-typographic-motion`: 트리트먼트부터 쓰고 짧은 영상을 만듭니다.
- `lit-humanizer`: 딱딱한 AI 문장을 한국어나 영어로 다시 씁니다. 사실과 단서는 남깁니다.
- `readme-studio`: 사실에 맞는 README와 움직이는 커버를 만듭니다.
- `frontend-ui-ux`, `visual-qa`, `browser-drive`: 화면을 만들고, 실제 화면을 폭별로 확인하고, 브라우저
  드라이버를 확인한 뒤 실제 페이지를 조작합니다.

**코드**

- `debugging`: 버그를 재현하고, 가설을 세 개 이상 세워 확인한 뒤, 확인된 원인만 고칩니다.
- `refactor`: 동작을 테스트로 고정한 채 코드 구조를 바꿉니다.
- `lit-code`: 테스트 먼저, 경계에서 타입 확인 같은 엄격한 구현 규칙입니다.
- `lit-commit`: 변경을 저장소 스타일에 맞는 작은 커밋으로 나눕니다.
- `lit-burnoff`, `lit-burnoff-file`: 변경분 전체나 파일 하나에서 AI식 군더더기를 걷어냅니다.
- `structural-search`: 문법 구조로 코드를 찾고, 바꾸기 전에 결과를 미리 보여 줍니다.
- `lsp-setup`, `lit-init`: 언어 서버 설정을 확인하고, 필요한 곳에만 짧은 AGENTS.md 안내를 만듭니다.

**LitCodex 관리**

- `litcodex-doctor`, `litcodex-report-bug`, `litcodex-contribute-bug-fix`: 설치 상태 점검, 출처를 단 버그 보고서,
  테스트가 붙은 수정 PR입니다.
- `rules`, `lsp`, `comment-checker`는 알아서 돌아갑니다. 프롬프트마다 프로젝트 규칙을 넣고, 수정 뒤에는 LSP와
  주석을 확인합니다.

## 설치하면 달라지는 것

Codex가 플러그인을 불러오고 훅을 실행합니다. 훅은 요청이 어떤 모드에 속하는지 가리고, 스킬은 에이전트의 작업
절차를 안내하며, 루프 CLI는 프로젝트 기록을 관리합니다. Codex 목표 도구는 LitCodex가 직접 부르지 않고, 도구가
있을 때 에이전트가 씁니다. 멈췄거나(paused) 막힌(blocked) 목표는 아래 복구 절차를 따르세요.

- Codex에 플러그인·훅·에이전트가 등록되고 `~/.codex/config.toml`의 관리 항목이 갱신됩니다. 관련 없는 Codex
  설정은 그대로 둡니다. `--reconfigure` 전에는 바뀔 내용을 먼저 확인하세요.
- 고른 모델은 설정 파일에 적히는 값입니다. 그 모델을 실제로 쓸 수 있는지, 실제로 도는지는 Codex와 사용자 계정에 달려 있습니다.
- 프로젝트마다 `.litcodex/lit-loop/` 아래에 로컬 기록이 생기며, Git과 패키지에서는 제외됩니다.
- doctor 진단은 Codex 설정, 설치 상태, 플러그인 상태를 바꾸지 않고 살펴보기만 합니다. 터미널에서 직접 실행해
  성공적으로 끝난 doctor처럼 조건에 맞는 실행이면 캐시해 둔 새 버전 안내가 뜰 수 있고, 백그라운드 작업이 정해진
  레지스트리만 조회해 `~/.litcodex/update-check.json`에 적어 둡니다. 이 작업은 아무것도 설치하지 않습니다. 이와
  별개로, 조건에 맞는 대화형 관리 명령 뒤에는 업데이트 실행기가 새 전역 패키지를 설치할 수 있습니다.
  `LITCODEX_NO_UPDATE_CHECK=1`을 설정하면 둘 다 꺼집니다. 실패했거나 `--json`·`--dry-run`으로 돌렸거나,
  비TTY·CI 환경이거나 이 설정으로 끈 doctor 실행은 부수 효과가 없습니다.
- 테스트, 픽스처, 테스트 헬퍼, Vitest 설정은 저장소에만 있습니다. npm 패키지와 설치된 마켓플레이스 플러그인에는
  들어가지 않습니다.

선택 기능인 Jev 스킬 힌트는 평범한 요청에 맞는 번들 스킬을 제안해 주며, 기본값은 꺼짐입니다.
켜면(`LITCODEX_JEV=1`과 본인의 `TYPESAFE_API_KEY`) 조건에 맞는 프롬프트가 매번 TypeSafe(typesafe.ai)로 갑니다.
2,000자로 자르고 홈 경로, 이메일 주소, 토큰 형태의 문자열을 가린 뒤 나머지는 그대로 보냅니다. 파일, 도구 출력,
대화 기록은 보내지 않습니다. 켜기 전에
[전체 설명](https://github.com/wjgoarxiv/litcodex/blob/main/README-Ko-KR.md#jev-스킬-힌트-선택)(각 상태가 화면에서 어떻게 보이는지도 나옵니다)과
[개인정보 안내](https://github.com/wjgoarxiv/litcodex/blob/main/docs/privacy.md#optional-jev-skill-hint)를 읽어 주세요.

선택 기능인 자동 핸드오프는 대화가 정해 둔 퍼센트에 이르면 핸드오프를 대신 써 주며, 기본값은 꺼짐입니다.
`lit-handoff auto on 60`(1에서 99 사이의 정수)을 프롬프트 전체로 보내면 켜지고, `lit-handoff auto off`로 끕니다.
Codex에서는 모델이 핸드오프를 저장하고 그 턴이 끝나면 Codex가 압축합니다(Codex CLI 0.158 이상, 신뢰한 프로젝트).
Codex가 압축하도록 설정되어 있지 않으면 `/compact`를 실행하라는 한 줄이 나오고, 이후 핸드오프는 저절로 다시
불러옵니다. 각 단계는 [전체 설명](https://github.com/wjgoarxiv/litcodex/blob/main/README-Ko-KR.md#자동-핸드오프-선택)을 읽어 주세요.

## 확인, 문제 해결, 제거

```sh
npm exec --yes --package @litfamily/litcodex@1.0.15 -- litcodex doctor
```

`litcodex doctor`는 등록·훅·설정·호스트 기능을, `litcodex loop doctor`는 현재 프로젝트의 루프 상태를 확인합니다.
둘 다 설치 상태를 보는 검사이고, 로그인한 모델 작업이 실제로 도는지는 작은 작업을 하나 맡겨 보면 알 수 있습니다.

- **`lit`을 입력해도 반응이 없다면.** `litcodex doctor`를 실행하고 Codex에서 훅을 승인했는지 확인하세요.
- **명령을 찾지 못한다면.** 위의 `npm exec` 형식을 쓰거나, npm 전역 bin 경로를 `PATH`에 넣으세요.
- **Codex 목표가 멈췄거나(paused) 막혔다면(blocked).** `/goal resume`으로 재개하고 활성 상태인지 확인한 뒤
  `litcodex loop run --retry-failed`로 다시 시도하세요. 미완료 목표는 지우지 말고 남겨 두세요.
- **아무 출력 없이 창(pane)이 닫힌다면.** 어느 단계가 문제인지부터 찾습니다. 열린 터미널에서 도움말, 설치,
  doctor를 하나씩 실행해 각 종료 코드를 적어 두고
  [문제 해결](https://github.com/wjgoarxiv/litcodex/blob/main/README-Ko-KR.md#문제-해결)을 참고하세요.

```sh
npm exec --yes --package @litfamily/litcodex@1.0.15 -- litcodex uninstall
```

플러그인과 LitCodex가 관리하는 설정을 지우고, 관련 없는 설정은 그대로 둡니다.

## 링크

[사용 참고서](https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage-Ko-KR.md) ·
[기존 설치 이전](https://github.com/wjgoarxiv/litcodex/blob/main/docs/npm-migration.md) ·
[CHANGELOG.md](https://github.com/wjgoarxiv/litcodex/blob/main/CHANGELOG.md) ·
[개인정보](https://github.com/wjgoarxiv/litcodex/blob/main/docs/privacy.md) ·
[이슈](https://github.com/wjgoarxiv/litcodex/issues) · MIT 라이선스
