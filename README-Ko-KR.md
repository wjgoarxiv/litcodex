<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 일곱 머신의 칸이 차례로 켜지고, 셋째 칸의 LitCodex 머신이 주황 바이저와 테두리를 밝힌 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

# LitCodex

**Keep the work lit.**

요청 앞에 `lit`을 붙이면 Codex CLI가 통과·실패를 가릴 수 있는 기준을 세우고, 기준마다 증거가 남아야 일을 끝냅니다.
증거는 프로젝트 안에 남기 때문에 내일 세션은 오늘 멈춘 자리에서 시작합니다.

<p>
<a href="https://www.npmjs.com/package/@litfamily/litcodex"><img src="https://img.shields.io/npm/v/@litfamily/litcodex?color=FF6337&label=npm" alt="npm 버전" /></a>
<a href="https://www.npmjs.com/package/@litfamily/litcodex"><img src="https://img.shields.io/npm/dm/@litfamily/litcodex?color=FF6337" alt="월간 npm 다운로드" /></a>
<a href="./LICENSE"><img src="https://img.shields.io/npm/l/@litfamily/litcodex?color=A3E635" alt="MIT 라이선스" /></a>
<a href="https://github.com/wjgoarxiv/litcodex/stargazers"><img src="https://img.shields.io/github/stars/wjgoarxiv/litcodex?color=A3E635" alt="GitHub 스타" /></a>
</p>

[English](./README.md) · [설치](#설치) · [첫 작업](#lit으로-시작하기) · [할 수 있는 일](#할-수-있는-일) · [명령어](#명령어) · [더 알아보기](#더-알아보기)

바로 써 보려면 Node.js 22 이상과 Codex CLI를 준비하고 이 명령을 실행하세요.

```sh
npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex install
```

그다음 프로젝트에서 Codex를 열고, Codex가 LitCodex 훅 검토를 요청하면 승인한 뒤 `lit`을 넣어 요청하면 됩니다.

```text
lit 회원가입 폼에 입력 검증을 추가해줘
```

아래 짧은 영상은 실제 한 턴을 그대로 담았습니다. 테스트를 먼저 쓰고, 실패를 확인하고, 코드를 고치고, 테스트가
통과한 뒤 Codex가 턴을 마칩니다.

<p><img src="./docs/assets/demo.webp" width="960" alt="Codex CLI에서 LitCodex를 쓰는 모습을 담은 짧은 영상입니다. LIT 마크와 함께 LitCodex, The lit workflow for Codex CLI라고 적힌 제목 화면으로 시작하고, 이어서 번호 붙은 설명이 작은 Node 프로젝트에서 진행되는 한 턴을 따라갑니다. 1: &quot;lit add a --shout flag that prints the greeting in capitals, with a test&quot;를 입력하면 LitCodex가 켜집니다. 2: 훅 블록에 LIT 마크와 &quot;🔥 LIT IGNITED · lit-loop 🔥&quot;가 나타납니다. 3: 마크 아래 줄 &quot;🔨 WORK › 🔍 · › 🏁 ·&quot;은 지금 어디쯤인지 보여 주는 지도입니다. 지금은 작업 단계이고, 검토와 완료가 뒤에 옵니다. 4: Codex가 먼저 계획을 세우고 lit-code 지침을 읽습니다(Read SKILL.md (litcodex:lit-code skill)). 5: 고치기 전에 테스트부터 씁니다. Edited test/greet.test.js가 나오고 npm test가 exit 1로 실패합니다. 6: greet.js를 고친 뒤 --shout로 CLI를 직접 실행해 보고 npm test를 다시 돌립니다. 7: 정리에 테스트와 CLI 직접 확인이 통과했다고 적히고, Stop 훅이 &quot;✨ turn done&quot;을 덧붙입니다. 영상은 설치 명령이 적힌 화면으로 마칩니다." /></p> <!-- demo-gif -->

## LitCodex란

Codex CLI는 바로 다음 한 걸음을 빨리 내딛습니다. 곤란해지는 건 작업이 대화 한 번보다 커질 때입니다.
컨텍스트가 차거나 세션이 끝나면, 다음 세션은 무엇을 정했고 무엇을 확인했고 무엇이 반쯤 남았는지를 처음부터
다시 짚어야 합니다. 그러다 보면 아무도 실제로 확인하지 않은 변경이 어느새 끝난 일로 처리되기도 합니다.

LitCodex는 그 흐름을 붙잡아 두는 Codex CLI 플러그인입니다. 요청에 `lit`을 넣으면 통과·실패를 가릴 수 있는
기준이 붙은 목표가 됩니다. 모든 기준에 증거가 기록돼야 목표가 끝난 것으로 인정되고, 그 기록은 프로젝트 안에
남아서 나중에 어느 세션에서든 읽을 수 있습니다. 멈추기 전에 `handoff` 한 단어만 보내 두면, 다음 세션은 어디까지
왔는지 적힌 메모에서 출발합니다.

이 루프와 함께 계획, 코드 리뷰, 조사, 디버깅, Word·PowerPoint 파일, 영어·한국어 글 다듬기를 맡는 스킬이 마흔
개 넘게 들어 있습니다. 작업은 내 컴퓨터의 Codex 안에서, 내 로그인과 내 모델로 돌아갑니다.

이미 Codex CLI를 쓰고 있고, 한 번에 끝나지 않는 일을 맡기는 분께 잘 맞습니다. 며칠 걸리는 기능 개발, 손대기
전에 계획부터 세우고 싶은 리팩터링, 출처가 꼭 필요한 조사, 실제 파일로 나와야 하는 보고서나 발표자료 같은
일이 그렇습니다. 한 줄로 소개하면 이렇습니다. Codex가 확인하지 않은 일을 끝났다고 하지 않고, 같은 프로젝트를 두 번
설명할 필요도 없습니다.

## 설치

Node.js 22 이상과 Codex CLI가 있으면 아래 명령 하나로 설치합니다.

```sh
npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex install
```

설치기는 세 가지를 묻습니다. 어떤 모델이 작업을 이끌지, 어떤 모델이 거들지, 답변을 어떤 스타일로 받을지입니다.
Enter만 누르면 권장 모델과 지금 쓰는 출력 스타일이 그대로 골라집니다. 이어서 쓰려는 경로를 보여 주고, Enter를
한 번 더 누르기 전까지는 아무것도 건드리지 않습니다. 플러그인과 훅, 에이전트 역할을 등록하고,
`~/.codex/config.toml`에서는 자기가 관리하는 항목만 고칩니다. 영수증에 `Status Ready for Codex`가 보이면 doctor
검사까지 이미 통과한 것입니다.

먼저 계획만 보고 싶다면 `npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex --dry-run install`을
실행하세요. 모든 단계를 출력하고 아무것도 쓰지 않습니다. 묻는 단계 없이 기본값으로 설치하려면 `install` 뒤에
`--yes`를 붙이면 됩니다.

`litcodex`를 `PATH`에서 바로 부르고 싶다면 다음을 실행합니다.

```sh
npm install -g @litfamily/litcodex
litcodex install
```

전역으로 설치하면 영상 스킬이 쓸 렌더링 도구도 미리 준비하느라 버전이 고정된 파일 몇 개를 내려받습니다.
무엇을 받는지와 건너뛰는 방법은 [설치 안내](./docs/install-Ko-KR.md#전역-명령으로-쓰기)에 있습니다.

> 전역 설치가 없다면 `npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex <command>` 형식을 사용하세요. 예: `npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex doctor`.

[설치 안내](./docs/install-Ko-KR.md)에는 기존 설정과 떼어 놓고 써 보는 법, Windows, 설치기가 보여 주는 화면
사진도 모두 있습니다. 예전 패키지 이름(`litcodex-ai`)으로 설치했다면 [기존 설치 이전 안내](./docs/npm-migration.md)를
먼저 읽어 주세요.

### 코딩 에이전트에게 설치 맡기기

Codex 같은 코딩 에이전트에게 설치를 맡길 수도 있습니다. 아래 프롬프트를 에이전트에 붙여 넣으세요. 에이전트는
필요한 도구가 있는지 확인하고, 계획을 보여 준 뒤 사용자가 허락할 때까지 아무것도 바꾸지 않습니다. 설치가 끝나면
doctor 검사를 돌리고 그 결과를 알려 줍니다.

```text
이 컴퓨터에 Codex CLI용 플러그인 LitCodex를 설치해 줘. 아래 순서를 그대로 따라 줘.

1. Node.js 22 이상과 Codex CLI가 설치되어 있는지 확인해 (node --version, codex --version).
   하나라도 없으면 멈추고 무엇을 설치해야 하는지 알려 줘.
2. 공식 npm 패키지 @litfamily/litcodex만 사용해. 이름이 비슷한 다른 패키지를 설치하거나
   다른 곳에서 설치 스크립트를 내려받지 마.
3. 먼저 계획을 보여 줘. 아래 명령은 모든 단계를 출력하고 아무것도 쓰지 않아:
   npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex --dry-run install
   무엇이 바뀌는지 요약한 뒤 계속할지 물어봐. 내가 좋다고 하기 전에는 진행하지 마.
4. 내가 좋다고 하면 아래 명령을 실행해:
   npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex install --yes
   (--yes는 권장 모델과 지금 쓰는 출력 스타일을 그대로 써.)
5. 검사를 실행하고 결과를 알려 줘. 문제(issue)나 경고(warning)가 있으면 그대로 옮겨 줘:
   npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex doctor
6. 플러그인을 불러오도록 Codex를 다시 시작하고, Codex가 LitCodex 훅을 검토해 달라고 하면
   승인하라고 나에게 알려 줘.
```

## lit으로 시작하기

프로젝트에서 Codex를 엽니다. 처음에는 Codex가 LitCodex 훅을 검토해 달라고 하니 승인해 주세요. 그다음 이렇게
입력합니다.

```text
lit 회원가입 폼에 입력 검증을 추가해줘
```

모델보다 훅이 먼저 답합니다. 5행짜리 LIT 마크가 뜨는데, `UserPromptSubmit` 훅이 일반 텍스트로 보내는 것입니다.
이어서 답변이 `🔥 **LIT IGNITED · <discipline>** 🔥` 한 줄로 시작합니다. 여기서부터 요청은 작업 루프(내부 이름은
`<lit-loop-mode>`)에서 돌아갑니다. 목표와 그 확인 기준이 생기고, 기준을 통과할 때마다 증거가 기록됩니다.

마크 아래에는 작은 LIT 카드가 붙어서, 일이 어디까지 왔는지 한눈에 보입니다.

```text
┃ 🔥 LIT · lit-loop  turn started
┃ ✓ INTERVIEW  ›  ✓ PLAN  ›  🔨 WORK ▰▰▰▱▱▱▱ 3/7  ›  🔍 REVIEW  ›  🏁 DONE
┃ ✓ Render the map
┃ ▸ Show the map in the terminal
┃ · Write the docs
```

둘째 줄이 지도입니다. 왼쪽부터 인터뷰, 계획, 작업(끝낸 계획 항목을 막대로 표시), 검토, 완료 순서입니다. 끝난
단계에는 ✓가 붙고, 카드 색을 켜면 지금 단계는 굵은 주황, 남은 단계는 흐리게 보입니다. 그 아래에는 계획 항목이나 lit-loop 목표를 최대 세 줄 보여 줍니다. 마지막으로 끝낸 것, 지금 하는 것,
다음 것입니다. 카드는 프로젝트에 실제로 저장된 기록을 읽어 그리기 때문에, 근거가 없는 단계는 짐작으로 채우지 않고
뺍니다. 조사에는 분해, 웨이브, 검증, 종합으로 이어지는 지도가 따로 있는데, 진행 중인 조사 기록이 있으면 그 지점부터,
없으면 분해 단계부터 보여 줍니다.

LIT 턴이 끝나면 Stop 훅이 같은 카드를 그리고, 첫 줄에 `✨ turn done · 2 tasks ✓ · next ▸ Write the docs` 같은 요약을
붙입니다. `lit start work`가 중간 점검 지점에 닿은 뒤 같은 턴 안에서 계속 진행할 때는 요약이
`⏳ 3/7 tasks ✓ · continuing ▸ Write the docs`로 바뀝니다. Codex 데스크톱 앱과 IDE는 훅 문구의 색 코드를 글자
그대로 보여 주므로, 카드는 기본으로 색 없이 나옵니다.

LitCodex는 `lit`이 따로 떨어진 단어일 때만 알아듣습니다. `split`, `literal`, `litmus`처럼 글자만 섞인 단어나
코드 스팬, 코드 블록 안의 `lit`은 그냥 지나갑니다. 슬래시 명령도 건드리지 않는데, `/litresearch` 하나만
예외로 조사를 시작합니다.

메시지 전체가 그 한 단어일 때만 동작하는 단어가 두 개 있습니다. 세션을 마치기 전에 `handoff`만 보내면 다음
세션이 이어받을 인수인계 문서를 씁니다. 출판용 그래프가 필요할 때 `lit-scientific-visualization`만 보내면
시각화 작업 모드(`<lit-scientific-visualization-mode>`)로 바뀌고, Python 패키지는 설치하지 않습니다.

### 작은 결과물 하나부터

직접 판단할 수 있는 첫 작업이 필요하다면 빈 폴더에서 이렇게 시작해 보세요.

```text
lit 현재 폴더에 HTML 파일 하나로 할 일 목록을 만들어줘. 외부 의존성은 설치하지 마.
할 일 추가와 완료 처리를 확인하고, 확인하지 못한 부분은 따로 남겨줘.
```

끝나면 세 가지를 보세요. 페이지 자체(열어서 할 일을 하나 추가해 보세요), 실제로 돌린 확인, 아직 남은 일입니다.
`lit recap`은 기록된 내용을 다시 읽어 줍니다. 세션을 닫기 전에 `handoff`만 따로 보내 두고, 다음 세션에서는
그 문서와 프로젝트 목표부터 읽게 하면 됩니다.

## 할 수 있는 일

### 정말로 끝나는 작업

`lit`은 요청을 확인 기준이 붙은 목표로 바꿉니다. 모든 기준에 통과 증거가 있어야 목표를
완료할 수 있고, Codex가 확인하지 못한 부분은 눈에 띄는 곳에 적어 둡니다.

```text
lit 자꾸 깨지는 로그인 테스트를 고치고, 고쳐졌다는 실행 결과도 보여줘
```

### 고치기 전에 계획부터

`lit plan`은 번호 붙은 단계와 성공 기준을 담은 계획을 `.litcodex/plans/`에 쓰고, 그
밖에는 아무것도 고치지 않습니다. 계획을 승인하면 `lit start work <계획 이름>`이 각 단계를 다섯 관문(계획 재확인,
자동 검증, 수동 QA, 적대적 QA, 정리)에 통과시키고, 다섯 리뷰가 모두 통과해야 마칩니다.

```text
lit plan 설정 페이지를 새 폼 라이브러리로 옮기기
```

### 거절할 줄 아는 리뷰

`lit review`는 계획이나 끝난 변경을 놓고 리뷰 다섯 개를 따로 돌립니다. 하나라도
통과하지 못하면 승인이 나지 않습니다.

### 출처가 붙는 조사

`lit research`는 여러 갈래로 증거를 모은 뒤 출처를 단 종합을 씁니다. 사실과 가설, 아직
풀리지 않은 질문은 따로 적습니다.

```text
lit research Node 22에서 PKCE를 지원하는 OAuth 라이브러리를 출처와 함께 정리해줘
```

### Word와 PowerPoint 파일

`lit`으로 보고서나 발표자료를 부탁하면 맞는 스킬(`lit-docx`, `lit-pptx`)이 자료를
읽고 디자인 방향을 고릅니다. 고른 방향과 대안 두 가지를 밝힌 뒤, 편집할 수 있는 파일을 Markdown 원본과 함께
만듭니다.

```text
lit notes.md로 월요일 회의용 열 장짜리 발표자료를 만들어줘
```

### 영어·한국어 글 다듬기

`$litcodex:lit-humanizer`는 사실과 단서는 남기고 딱딱한 AI 문장을 다시 씁니다. 파일에
쓰기 직전에는 훅이 누가 봐도 초안 티가 나는 표현 몇 가지를 막아 줍니다.

### 그 밖의 스킬

모든 스킬은 Codex skill picker에서 고르거나 `$litcodex:debugging`처럼 이름으로 부를 수 있습니다. 스킬마다 그림과
한 줄 설명은 [스킬 안내](./docs/skills-Ko-KR.md)에 있습니다.

| 분야 | 스킬 |
| --- | --- |
| 코드 | `debugging`, `refactor`, `lit-code`, `lit-commit`, `lit-burnoff`, `lit-burnoff-file`, `structural-search`, `lsp-setup`, `lit-init` |
| 계획과 팀 작업 | `deep-interview`, `lit-brainstorm`, `lit-crucible`, `litgoal`, `litwork`, `lit-team` |
| 조사와 지식 | `autoresearch`, `autoconference`, `wikify`, `lit-fetch`, `coding-session-audit`, `lit-comprehend`, `lit-hijack`, `lit-adhd` |
| 화면, 그림, 영상 | `frontend-ui-ux`, `visual-qa`, `browser-drive`, `readme-studio`, `lit-diagram-drawer`, `lit-schematic`, `lit-scientific-visualization`, `lit-typographic-motion` |
| LitCodex 관리 | `litcodex-doctor`, `litcodex-report-bug`, `litcodex-contribute-bug-fix` |
| 알아서 도는 검사 | `rules`, `lsp`, `comment-checker`: 프롬프트마다 프로젝트 규칙을 넣고, 수정 뒤에는 LSP와 주석을 확인 |

## 만들 수 있는 것

번들 스킬의 스크립트를 이 컴퓨터에서 직접 돌려 만든 그림 네 장입니다. 그림 속 수치는 모두 예시 자료입니다.

### 어디까지 했더라

```text
lit adhd
```

`lit-adhd`는 최근 Codex 세션을 읽어 내게 답을 기다리는 일, 돌아가는 일, 끝난 일과 다음 한 걸음을 펼칩니다. 이 브리핑은 예시 세션으로 만들었고 Codex 터미널이 그렸습니다.

<p align="center"><img src="./docs/assets/gallery/adhd-brief.webp" width="720" alt="Codex 터미널에 나온 lit adhd 브리핑. 세션 여섯 개 중 하나는 답을 기다리고 하나는 실행 중이라는 제목, 세션마다 목표와 단계와 다음 걸음이 든 카드, 진행 막대가 있는 로드맵, 끝난 세션 네 개의 표, 상자에 담은 추천 다음 단계가 보인다." /></p>

### 발표자료

```text
lit 구 주거 실태 설문을 10장 브리핑 덱으로, 뉴스룸 스타일로
```

`lit-pptx`는 Markdown을 PowerPoint에서 바로 고칠 수 있는 덱으로 만들고, Pretendard를 넣은 뒤 넘침, 대비, 빈 슬라이드를 검사합니다. 스킬에 들어 있는 뉴스룸 예시를 쪽 이미지로 그린 것입니다.

<p align="center"><img src="./docs/assets/gallery/deck-newsroom.webp" width="720" alt="열한 장짜리 한국어 뉴스룸 스타일 덱의 한눈 보기. 핵심 수치 세 개가 있는 표지, 목차, 선과 막대 차트, 설문 쪽, 동별 표, 타임라인, 출처 쪽, 마무리 요약이 따뜻한 흰 바탕에 주황색 계열 하나로 이어진다." /></p>

### 웹 페이지

```text
lit 주간 대중교통 이용 브리핑 서비스 랜딩 페이지를 네오 브루탈리즘으로 만들어줘
```

`frontend-ui-ux`는 먼저 하우스 스타일을 잠그고 키트로 만든 뒤, 320, 390, 768, 1440픽셀에서 페이지를 점검합니다. 1440픽셀과 390픽셀로 보여 줍니다.

<p align="center"><img src="./docs/assets/gallery/page-landing.webp" width="720" alt="이용 브리핑 서비스의 네오 브루탈리즘 랜딩 페이지. 1440픽셀 너비에서는 노란색에서 연보라로 번지는 히어로에 큰 1.28M 수치와 테두리 있는 통계 카드 두 개가 있고, 그 옆에 390픽셀 너비에서 한 열로 쌓인 같은 히어로가 있다." /></p>

### P&ID

```text
lit 차아염소산나트륨 주입 스키드 P&ID를 A3 한 장으로 그려줘
```

`lit-schematic`은 ISA 기호, 태그가 붙은 배관, 범례, 표제란을 그리며, 이 도면은 QA 검사를 통과했습니다.

<p align="center"><img src="./docs/assets/gallery/pid-dosing-skid.webp" width="720" alt="A3 한 장짜리 주입 스키드 P&ID. 저장 탱크, 필터와 체크 밸브가 붙은 주입 펌프 두 대(운전·예비), 안전 밸브, 압력·유량 계기가 있고 오른쪽에 범례 열, 아래에 표제란이 있다." /></p>

## 핸드오프를 LitCodex에 맡기기

긴 세션은 컨텍스트 창을 채우고, 다음 컨텍스트는 이번에 배운 내용을 모른 채 시작합니다. `handoff`를 직접 보내도
되지만, 제때 알아차려야 합니다. 자동 핸드오프는 그 시점을 대신 알아차립니다. 직접 켜기 전까지는 꺼져 있고, 언제
동작할지는 컨텍스트 창의 몇 퍼센트인지로 정합니다. 아래 문장을 프롬프트 전체로 보내세요.

```text
lit-handoff auto on 60
```

LitCodex가 바로 답하고, 이 프롬프트는 모델에게 가지 않습니다. 이 명령은 프로젝트의 `.codex/config.toml`에도
퍼센트를 적어 두기 때문에, Codex에서 신뢰한 프로젝트라면 핸드오프가 저장된 직후 Codex가 스스로 대화를 압축합니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/auto-handoff/auto-handoff-on-dark.webp" /><img src="./docs/assets/auto-handoff/auto-handoff-on-light.webp" width="764" alt="Codex 터미널 창입니다. &quot;lit-handoff auto on 60&quot; 프롬프트 아래에 &quot;Blocked by hook&quot;과 답장 &quot;Automatic handoff is ON at 60%. When a conversation reaches 60% of the context window, Codex is asked to save a handoff. Codex compacts the conversation as soon as the turn that saved the handoff ends.&quot;가 보입니다." /></picture></p>

`lit-handoff auto status`는 지금 설정을 알려 주고, `lit-handoff auto off`는 기능을 끄면서 숫자는 다음을 위해
남겨 둡니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/auto-handoff/auto-handoff-status-off-dark.webp" /><img src="./docs/assets/auto-handoff/auto-handoff-status-off-light.webp" width="764" alt="프롬프트 두 개가 있는 Codex 터미널 창입니다. &quot;lit-handoff auto status&quot; 아래에 &quot;Automatic handoff is ON at 60% (set by command). Codex compacts the conversation as soon as the turn that saved the handoff ends.&quot;가 나오고, 이어서 &quot;lit-handoff auto off&quot; 아래에 &quot;Automatic handoff is OFF. Your last percent (60%) is kept for next time.&quot;가 나옵니다." /></picture></p>

턴이 정한 퍼센트 이상에서 끝나면 모델이 핸드오프를 저장하고, 다른 일은 시작하지 않은 채 한 줄로 알려 줍니다.
Codex가 스스로 압축하지 않는 경우라면 그 한 줄이 `/compact`를 실행하라고 안내합니다. 압축이 끝나면 다음
컨텍스트는 방금 저장한 핸드오프에서 시작합니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/auto-handoff/auto-handoff-saved-dark.webp" /><img src="./docs/assets/auto-handoff/auto-handoff-saved-light.webp" width="764" alt="Codex 터미널 창입니다. 모델이 남긴 &quot;Handoff saved. Run /compact now.&quot; 줄 아래에 &quot;/compact&quot; 프롬프트가 보입니다." /></picture></p>

환경 변수, doctor 줄, 아직 신뢰하지 않은 프로젝트에서 일어나는 일은 [자동 핸드오프 안내](./docs/auto-handoff-Ko-KR.md)에
있습니다.

## Codex 앱에서 LIT 진행 보기

Codex 데스크톱 앱에서는 LitCodex가 스레드 안에 작은 LIT 카드를 보여 줄 수 있습니다. 카드에는 지금 돌아가는 LIT 스킬,
워크플로 지도와 현재 단계, 그리고 지금 실행 중인 도구와 경과 시간이 나옵니다. 에이전트가 일하는 동안 카드는 저절로
새로 고쳐지고, 아무 일도 없을 때는 천천히 확인합니다.

앱은 카드를 처음 그린 자리에 그대로 두기 때문에, 대화가 길어지면 카드가 화면 위로 밀려 올라갑니다. 그래서 LIT를 시작하는
프롬프트마다 가장 최근 턴 옆에 새 카드가 열리고, 앞선 카드는 그 턴이 어떻게 끝났는지만 담은 한 줄로 접힌 뒤 더는
새로 고치지 않습니다. LIT를 시작하지 않는 프롬프트에는 카드가 따로 열리지 않고, 가장 최근 카드가 계속 진행을 보여 줍니다.

<p><img src="./docs/assets/app-card/app-card-thread.webp" width="764" alt="Codex 데스크톱 앱의 스레드. &quot;lit add a --version flag that prints the package version, with a test&quot; 프롬프트 아래에 &quot;Worked for 48s&quot;와 LIT 카드가 있고, 그 아래에 에이전트의 요약이 이어진다. 카드에는 LIT · lit-loop와 오른쪽의 DONE ✓, 지도 work ✓, review, done ✓, &quot;✓ turn done in 49s&quot; 줄, 그리고 컨텍스트 사용량, 주간 사용량, git 브랜치, 프로젝트 이름이 담긴 아랫줄이 보인다." /></p>

<p><img src="./docs/assets/app-card/app-card-done.webp" width="760" alt="턴이 끝난 뒤 LIT 카드를 가까이 본 모습. 머리에 LIT · lit-loop와 DONE ✓, 워크플로 지도 work ✓, review, done ✓, &quot;✓ turn done in 49s&quot; 줄, 아랫줄에 ctx 16%, 1w 7%, git master, lit-card-demo가 있다." /></p>

카드는 앱의 MCP Apps 기능이 있어야 보입니다. OpenAI는 이 기능을 아직 개발 중으로 표시하고 있고, LitCodex가 대신
켜지는 않습니다. 터미널 `codex`는 카드를 그릴 수 없으므로 같은 요청이 지도를 글로 보여 주고, `litcodex doctor`에는
`card:` 줄이 나옵니다.

## 두 번째 창에서 LIT 지켜보기

터미널 `codex`를 쓰는 동안에도 LIT 카드를 옆 창에 띄워 둘 수 있습니다. 터미널 창이나 탭을 하나 더 열고, 아무 폴더에서나
이렇게 실행하세요.

```bash
litcodex hud
```

LIT가 가장 최근에 움직인 Codex 세션을 찾아 그 카드를 실시간으로 보여 줍니다. 지금 돌아가는 LIT 스킬, 워크플로 지도와 현재 단계,
다음에 할 작업, 그리고 지금 실행 중인 도구와 경과 시간이 나옵니다. 맨 윗줄에는 세션 id 앞부분, 프로젝트 폴더, 마지막으로
소식이 온 시각이 적힙니다. 다른 LIT 세션에서 작업하면 HUD도 그 세션으로 옮겨 갑니다. 한 세션만 계속 보려면
`--session <id>`를 붙이고, 화면 하나만 찍고 끝내려면 `--once`를 붙이세요.

HUD는 LIT가 카드용으로 남겨 두는 작은 기록만 읽습니다. 파일은 하나도 쓰지 않으니 언제 닫아도 Codex 세션은 그대로
이어집니다. 읽을 수 없는 기록이 있으면 `cannot read …` 한 줄로 알려 줍니다. 끝낼 때는 Ctrl-C를 누르면 되고, 터미널
화면도 원래대로 돌아옵니다. 색은 `NO_COLOR` 설정을 따릅니다. macOS에서 확인했고, Linux와 Windows 터미널은 아직
확인하기 전입니다.

## LIT 카드에 색 넣기

훅이 찍는 LIT 카드는 기본으로 색 없이 나옵니다. 터미널 `codex`(0.162 이상)는 카드를 색으로 그릴 수 있습니다. 끝난 단계는
초록, 지금 단계는 굵은 주황, 남은 단계는 흐리게 보입니다.

```bash
litcodex screen-status on
```

색은 터미널 `codex`만 그립니다. Codex 데스크톱 앱과 IDE 확장은 색 코드를 훅 줄에 글자 그대로 보여 주고, 훅은 어느
클라이언트가 보여 주는지 알 수 없으므로, 터미널 `codex`를 쓸 때만 켜세요. 색을 끄면 카드는 같은 줄을 색 없이 보여 줍니다.
`litcodex screen-status off`로 끄고 `status`로 확인합니다. 설정은 `$CODEX_HOME/litcodex/screen-status.json`에 남고,
`LITCODEX_SCREEN_STATUS=1` 또는 `0`이 그보다 먼저 적용되며, `NO_COLOR`가 있으면 카드는 색 없이 나옵니다.

`litcodex statusline`은 같은 상태를 `🔥 LIT · lit-loop  🔨 WORK › 🔍 REVIEW › 🏁 DONE  ⠹ Bash 0:12`처럼 한 줄로 출력합니다.
명령을 실행해 상태 줄을 채우는 터미널이나 도구에 쓰면 됩니다. Codex 자체는 아직 그런 명령을 실행하지 못합니다.

## 한 터미널에서 Codex 아래에 LIT 띄우기

```bash
litcodex run
```

같은 터미널에서 Codex를 띄우면서 맨 아래 네 줄을 LIT 패널 자리로 남겨 둡니다. 패널에는 지금 돌아가는 LIT 스킬과 턴이
시작된 뒤 지난 시간, 워크플로 지도, 지금 실행 중인 도구와 경과 시간, 지금 할 체크리스트 항목이 실시간으로 나옵니다.
Codex는 네 줄 짧은 가상 터미널에서 돌기 때문에 그 위 공간에 화면 전체를 맞추고, 입력하거나 스크롤하거나 창 크기를
바꿔도 패널은 제자리에 있습니다. Codex에 넘길 인자는 `litcodex run -- resume --last`처럼 `--` 뒤에 쓰면 그대로
전달됩니다.

패널은 `litcodex run`을 시작한 뒤 이 폴더에서 움직이기 시작한 가장 최근 LIT 세션을 따라갑니다. 그 전에는 LIT 턴을
기다린다고 흐리게 알려 줍니다. `litcodex hud`와 같은 작은 기록만 읽고 파일은 쓰지 않습니다. Codex가 끝나면 패널 줄을
지우고 터미널을 원래대로 돌려놓으며, 종료 코드는 Codex의 것을 그대로 돌려줍니다. 여기서는 Ctrl-Z로
Codex를 일시 정지할 수 없습니다(macOS, Codex 0.163.0에서 확인). Ctrl-C로 끝내거나, 작업 제어가 필요하면 그냥 `codex`를
실행하세요.

가상 터미널은 선택 패키지 `node-pty`로 만듭니다. 미리 빌드된 바이너리가 있는 환경이면 npm이 LitCodex와 함께
설치합니다. 이 패키지가 없거나, 터미널이 아닌 곳에서 실행했거나, 터미널이 40칸×12줄보다 작으면 안내 한 줄을 남기고
Codex를 평소처럼 띄웁니다. macOS에서 확인했고, Linux와 Windows 터미널은 아직 확인하기 전입니다.

## 어떻게 동작하나요

Codex가 플러그인을 불러오고 훅을 실행합니다. 훅은 요청이 어떤 모드에 속하는지 가리고 맥락을 보태며,
스킬은 에이전트가 일하는 절차를 안내합니다. 루프 CLI는 프로젝트 기록을 관리하고, Codex의 native goal 도구를
쓸 때 따를 지침을 출력합니다.

```mermaid
flowchart TD
    P["설치된 LitCodex 플러그인"] --> H["Codex 훅: UserPromptSubmit 및 생명주기"]
    P --> S["번들 스킬"]
    U["Codex에 입력한 요청"] --> H
    H --> A["Codex 에이전트"]
    S --> A
    A --> L["lit-loop CLI: 목표·증거·체크포인트"]
    L --> R["프로젝트 기록: .litcodex/lit-loop/"]
    L -. "목표 도구 사용 지침" .-> A
    A -. "호스트가 제공할 때 사용" .-> G["Codex native /goal"]
    R -. "작업을 이어갈 때 읽기" .-> A
```

Codex 목표 도구로 이어지는 점선은 도구가 있을 때 에이전트가 따르는 지침이고, LitCodex가 그 도구를 직접 부르는
일은 없습니다. 로그인, 모델 접근, 권한, 모든 실행은 내 컴퓨터의 Codex 안에서 일어납니다. 그러니 작업은
결과물과 실제로 돌린 확인을 보고 판단하세요. 더 자세한 내용은 [실행·상태 참고서](./docs/usage-Ko-KR.md)에 있습니다.

## 명령어

### Codex 작성창에서

| 입력 | 모드 | 하는 일 |
| --- | --- | --- |
| `lit` 또는 `lit-loop` | **lit-loop** | 오래 이어지는 루프에서 작업하며 증거를 체크포인트로 남김 |
| `litwork` | **litwork** | 결과 중심 작업, 수동 QA 증거 포함 |
| `lit-plan` 또는 `lit plan` | **lit-plan** | 계획만 작성: 증거와 마지막 완료 주장이 담긴 범위 있는 계획 |
| `deep-interview` 또는 `lit deep interview` | **deep-interview** | 계획만 작성: 모호한 요구를 질문으로 좁힘 |
| `lit brainstorm`, `lit ideation` 또는 `lit idea` | **lit-brainstorm** | 서로 다른 선택지를 많이 낸 뒤 고를 수 있는 짧은 목록으로 좁힘, 만들지는 않음 |
| `lit schematic` 또는 `lit-schematic` | **lit-schematic** | 실제 장비를 SVG, PDF, PNG로 그림: P&ID, PFD, 실험 장치 그림, 아이소메트릭 컷어웨이. 이런 요청을 담은 단독 `lit`도 이 스킬로 이어짐 |
| `lit hijack` 또는 `lit-hijack` | **lit-hijack** | 다른 사람이 공개한 기법(게시물, 아티클, 저장소, PDF)을 내 스킬로 옮김: 출처와 라이선스를 먼저 적고, 원문 표현 없는 명세를 쓰고, 따로 구현한 뒤 전후 비교로 증명함. `lit` 뒤에 하이재킹, 하이잭도 가능 |
| `lit adhd` 또는 `lit rewind` | **lit-adhd** | 읽기 전용 "나 어디까지 했지": 최근 Codex 세션 전체를 한 번에 정리함. 각 세션의 요청, 나를 기다리는 것, 진행 게이지, 멈춘 작업, 다음 한 걸음(`go`라고 입력하면 실행). `lit continue`는 멈춘 루프를 그 단계 그대로 되살림 |
| `litgoal` 또는 `lit goal` | **litgoal** | 완료 기준을 정하고 유지: 목표와 기준을 lit-loop와 Start Work가 향해 가는 루프 상태에 연결 |
| `lit-recap` 또는 `lit recap` | **lit-recap** | `.litcodex` 원장을 읽기 전용으로 요약 |
| `lit-comprehend` 또는 `comprehend` | **lit-comprehend** | 작업 트리 밖에 자체 완결형 설명 자료 생성 |
| `review-work` 또는 `lit review` | **review-work** | 읽기 전용 검토: Start Work 전에는 계획 검토, 뒤에는 작업 검토. 있는 것을 보고 모드를 고르며, `lit review plan` 또는 `lit review work`로 직접 지정 |
| `litresearch`, `/litresearch` 또는 `lit research` | **litresearch** | 사실·가설·출처·불확실성을 나눠 적는 연구 저널 |
| `lit start work <plan-name>` | **Start Work** | 승인된 계획을 실행하고 증거를 남김 |
| 정확히 단독으로 입력한 `handoff` | **lit-handoff** | 비밀값을 빼고 인수인계 문서를 만들거나 갱신 |
| 정확히 단독으로 입력한 `lit-scientific-visualization` | **lit-scientific-visualization** | 훅을 통해 출판용 시각화 어댑터를 불러옴 |

세션의 첫 `lit …`은 전체 활성화를 보냅니다. 같은 모드를 다시 입력하면 그 모드가 이미 켜져 있다는 짧은 안내만 가고,
스킬 파일을 다시 읽거나 새 계획·목표를 만들거나 단계를 초기화하지 않습니다. `lit` 다음에 `lit plan`을 입력하면
모드가 바뀌므로 계획 활성화를 한 번 전체로 보냅니다. 단독 `lit`이나 `lit continue`는 모드를 바꾸지 않고 켜져 있는 모드를 이어 갑니다. 진행 중인 Start Work 계획, 발행된 계획, 열린 목표가 있을 때
단독 `lit` 또는 `lit continue`를 입력하면 그 작업을 이어 간다고 알리고 새 계획을 만들지 않습니다. `lit new …`,
`lit restart …`, 새 세션, 압축 직후의 첫 `lit`은 처음부터 전체로 보냅니다. 작업도 진행 중인 일도 없이 단독으로
입력한 `lit`은 무엇을 시작할지 되묻습니다. Start Work는 프롬프트에 권한 부여가 들어 있으므로 항상 전체 활성화를 보냅니다.

### CLI 명령어

| 명령 | 하는 일 |
| --- | --- |
| `litcodex install` | LitCodex 플러그인과 훅 등록 |
| `litcodex doctor` | 설치, 루프 상태, 호스트 기능, 실제 적용된 설정 진단 |
| `litcodex uninstall` | 플러그인과 LitCodex가 관리하는 설정 제거 |
| `litcodex config migrate` | 관리되는 Codex 설정을 미리 보거나 적용 |
| `litcodex office-runtime install` 또는 `status` | Word·PowerPoint 파일에 쓰는 고정 버전 도구를 준비하거나 확인 |
| `litcodex motion-runtime install` 또는 `status` | 영상 렌더러 도구를 준비하거나 확인 |
| `litcodex hud` | 가장 최근 세션의 LIT 카드를 두 번째 터미널 창에 실시간으로 표시 |
| `litcodex screen-status on`, `off` 또는 `status` | 터미널 `codex`에서 LIT 카드에 색 넣기 |
| `litcodex statusline` | 상태 줄 명령에 쓸 수 있게 LIT 상태를 한 줄로 출력 |
| `litcodex run` | 같은 터미널 아래쪽에 LIT 패널을 띄운 채 Codex 실행 |
| `litcodex loop create` | 브리프에서 목표와 성공 기준 도출 |
| `litcodex loop status --json` | 루프 상태를 JSON으로 확인 |
| `litcodex loop run` | 다음에 실행할 수 있는 목표 선택 |
| `litcodex loop record-evidence` | 기준 하나의 통과·실패·차단 결과 기록 |
| `litcodex loop checkpoint` | 모든 기준을 통과했을 때만 목표 완료 처리 |
| `litcodex loop doctor` | 루프 상태 진단 또는 복구 |

## 작업 기록이 남는 곳

프로젝트의 루프 상태는 `.litcodex/lit-loop/` 아래에 있습니다. 기록 파일은 `brief.md`, `goals.json`,
`ledger.jsonl`이고, 증거는 `evidence/` 폴더에 쌓입니다. 파일은 한 번에 통째로 써서 중간에 끊긴 상태로 남지 않고,
목표 파일이 손상되면 버리지 않고 `.bak`으로 남겨 되살릴 수 있게 합니다. 이 기록은 이 컴퓨터에만 있고 Git과 패키지에는 들어가지 않습니다.
[상태·복구 참고서](./docs/usage-Ko-KR.md#루프-상태)에서 자세히 볼 수 있습니다.

## 설치 확인

```sh
npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex doctor
```

`litcodex doctor`는 등록·훅·설정·호스트 기능을 확인하고, 문제가 없으면 All checks passed로 끝납니다.
`litcodex loop doctor`는 현재 프로젝트의 루프 상태를 확인합니다. 둘 다 설치 상태를 보는 검사입니다. 로그인한
모델 작업과 자식 에이전트가 실제로 도는지는 작은 작업을 하나 맡겨 보면 알 수 있습니다.

상태 줄과 터미널 제목은 Codex가 직접 그리고, 플러그인은 여기에 항목을 더할 수 없습니다. 검사를 모두
통과했는데 설정에 둘 중 하나라도 없으면 doctor가 붙여 넣을 `[tui]` 블록을 알려 줍니다. 이 블록을 넣으면
입력창 아래에는 모델과 추론 강도, 사용한 컨텍스트, 5시간·주간 한도, 작업 진행률, Git 브랜치가 뜨고, 창
제목에는 작업 중 스피너와 프로젝트 이름이 뜹니다. Codex
안에서 `/statusline`과 `/title`로 직접 고를 수도 있습니다. doctor는 제안만 보여 주고 설정은 고치지 않습니다.

## 업데이트

`npm exec` 형식으로 설치했다면 새 버전 번호를 넣어 설치 명령을 다시 실행하세요. 전역 설치는 대화형 명령 뒤에
스스로 업데이트할 수 있고, 대화형으로 실행한 `litcodex doctor`가 새 버전을 알려 줄 수도 있습니다. 둘 다 끄려면
`LITCODEX_NO_UPDATE_CHECK=1`을 설정하세요. 자세한 내용은 [개인정보 안내](./docs/privacy.md#registry-traffic-and-updates)에
있습니다.

Codex 안에서는 세션을 시작할 때도 하루에 한 번 정도 확인합니다. 이 확인은 Codex 훅 검토에서 LitCodex 훅을 승인한
뒤에만 돌고, `codex exec`는 그 검토 화면을 띄우지 않습니다. 새 버전은 다음 Codex 세션부터 적용됩니다. 지금 어떤
상태인지, 무엇을 하면 되는지는 `litcodex doctor`가 알려 줍니다.

## 문제 해결

- 터미널 창이 바로 닫힌다면 계속 열려 있는 터미널을 열고 도움말, 설치, doctor를 하나씩 실행해 각 종료 코드를
  적어 두세요. 그다음 [단계별 확인](./docs/npm-migration.md#isolated-local-trial)을 따르되, Codex는 직접
  실행하세요.
- `lit`을 넣어도 반응이 없다면 `litcodex doctor`를 실행하고 Codex에서 훅을 승인했는지 확인하세요.
- `litcodex` 명령을 찾지 못한다면 위의 `npm exec` 형식을 쓰거나, npm 전역 bin 경로가 `PATH`에 있는지
  확인하세요.
- Codex 목표가 멈췄거나(paused) 막혔다면(blocked) `/goal resume`으로 재개하고 활성 상태인지 확인한 뒤
  `litcodex loop run --retry-failed`로 다시 시도하세요. 미완료 목표는 지우지 말고 남겨 두세요. 자세한 내용은
  [복구 참고서](./docs/usage-Ko-KR.md#문제-해결)에 있습니다.

## 제거

```sh
npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex uninstall
```

`litcodex uninstall`은 플러그인과 LitCodex가 관리하는 설정을 지우고, 관련 없는 설정은 그대로 둡니다.

## 더 알아보기

- [설치 안내](./docs/install-Ko-KR.md): 설치 방식별 차이, 전역 설치 때 받는 파일, Windows, 설치기 화면 사진,
  설치가 바꾸는 것과 바꾸지 않는 것.
- [스킬 안내](./docs/skills-Ko-KR.md): 번들 스킬 전체를 그림과 함께 소개하고, 이름을 알아 두면 편한 스킬을 설명합니다.
- [자동 핸드오프](./docs/auto-handoff-Ko-KR.md): 컨텍스트가 정해 둔 퍼센트에 이르면 핸드오프를 대신 써 줍니다.
  기본값은 꺼짐입니다.
- [사용 참고서](./docs/usage-Ko-KR.md): 모든 경로, 모델 설정, 플랫폼 제약, 복구 방법.
- [개인정보와 네트워크 동작](./docs/privacy.md), [기존 설치 이전 안내](./docs/npm-migration.md).
- [영상과 브랜드](./docs/media-Ko-KR.md): 영상, 로고, 이름에 담은 이야기.
- 기여하는 분께: [LitCodex 계약서](./docs/spec/litcodex-contract.md), [레퍼런스 분석](./docs/reference-analysis.md),
  [릴리스 출처](./docs/release/provenance.md), [배포 체크리스트](./docs/release/publish-checklist.md),
  [CHANGELOG.md](./CHANGELOG.md). 테스트, 픽스처, 테스트 헬퍼, Vitest 설정은 이 저장소에만
  있습니다. npm 패키지와 설치된 마켓플레이스 플러그인에는 들어가지 않습니다.
- [LitFamily 허브](https://github.com/wjgoarxiv/litfamily): 다른 코딩 에이전트에서 쓰는 같은 lit 워크플로.

같은 프로젝트를 두 번 설명하는 수고를 LitCodex가 덜어 줬다면, 스타 하나가 다른 Codex 사용자가 이 저장소를
찾는 데 도움이 됩니다.

[기여 안내](./CONTRIBUTING.md) · [보안](./SECURITY.md) · [행동 강령](./CODE_OF_CONDUCT.md) · [지원](./SUPPORT.md)

## 라이선스

[MIT](./LICENSE). LitCodex와 LitFamily 이름과 그림은 [상표 정책](./TRADEMARK.md)을 따릅니다.
