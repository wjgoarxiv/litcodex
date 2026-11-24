<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 일곱 머신의 칸이 차례로 켜지고, 셋째 칸의 LitCodex 머신이 주황 바이저와 테두리를 밝힌 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<p align="center">
<a href="#설치"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/badge-version.svg" alt="1.0.47" /></a>
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage-Ko-KR.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/lucide-book-open.svg" width="16" alt="" /> 문서</a> &nbsp; <a href="#설치">설치</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/assets/readme/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitCodex

**Keep the work lit.**

LitCodex는 Codex CLI에 붙이는 추가 기능입니다. Codex가 "다 됐어요"라고 말하기 전에 자기 작업을 직접 확인하게 하고,
다음 세션이 이어서 시작할 수 있도록 기록을 남기게 합니다.

Codex에게 기능을 하나 맡기면 코드를 쓰고 끝났다고 말합니다. 그런데 다음 날 보니 테스트는 한 번도 돌지 않았습니다.
새 세션을 열면 프로젝트 이야기를 처음부터 다시 해야 합니다.

LitCodex가 있으면 같은 요청에 `lit`만 붙이면 됩니다. Codex는 먼저 이 작업에서 "끝났다"가 무슨 뜻인지 적어 두고,
실패하는 테스트를 추가해 통과시킨 다음, 무엇을 확인했고 무엇은 확인하지 못했는지 알려 줍니다. 작업을 멈출 때
`handoff`라고 보내면 Codex가 기록을 남기고, 다음 세션은 그 기록을 읽고 이어서 일합니다.

**[GitHub에서 전체 안내 보기](https://github.com/wjgoarxiv/litcodex/blob/main/README-Ko-KR.md)** · [English](https://github.com/wjgoarxiv/litcodex#readme)

## 설치

Node.js 22 이상과 Codex CLI가 필요합니다.

```sh
npm exec --yes --package @litfamily/litcodex@1.0.47 -- litcodex install
```

설치기는 어떤 모델이 이끌지, 어떤 모델이 거들지, 답변 스타일은 무엇으로 할지 묻고, 쓰려는 내용을 먼저 보여 준 뒤
`~/.codex/config.toml`에서 자기가 관리하는 항목만 고칩니다. 계획만 먼저 보려면
`npm exec --yes --package @litfamily/litcodex@1.0.47 -- litcodex --dry-run install`을 실행하고, 묻는 단계 없이
설치하려면 `install` 뒤에 `--yes`를 붙이세요.

설치기와 `litcodex doctor`, `litcodex --help`는 터미널 폭에 맞춘 신스웨이브 LIT 마크로 시작합니다. 색이 꺼져 있으면
블록 문자만으로 그리고, 파이프나 CI 로그, UTF-8을 쓰지 않는 터미널에는 `LIT · codex cli` 한 줄만 나옵니다.

```sh
npm install -g @litfamily/litcodex
litcodex install
```

전역으로 설치하면 영상 스킬이 쓸 도구를 미리 준비하느라 버전이 고정된 파일 몇 개를 내려받습니다. 무엇을 받는지와
건너뛰는 방법은 [설치 안내](https://github.com/wjgoarxiv/litcodex/blob/main/docs/install-Ko-KR.md#전역-명령으로-쓰기)에 있습니다.

> 전역 설치가 없다면 `npm exec --yes --package @litfamily/litcodex@1.0.47 -- litcodex <command>` 형식을 사용하세요.

## 두 가지 사용법

**간단하게.** 평소처럼 요청을 쓰고, 앞이나 끝에 `lit`을 붙입니다.

```text
src/dates.js의 날짜 파싱 버그 고쳐줘 lit
```

Codex가 목표를 정하고, 실패하는 테스트를 쓰고, 버그를 고치고, 결과를 확인한 뒤 무엇을 확인했는지 알려 줍니다.
웬만한 작업은 이걸로 충분합니다.

`lit`은 앞에 붙이든 끝에 붙이든 똑같이 움직입니다. 끝에 붙이면 그 앞의 말이 목표가 되고, 테스트 명령이 있는
프로젝트라면 훅이 먼저 `Set goal for this lit-loop: /goal <조건>? (yes / no)`라고 묻습니다. 끝에 붙인 `lit-loop`이나
`litwork`도 앞에 쓴 것과 같은 모드로 갑니다.

**본격적으로.** 큰 작업은 한 단계씩 밟아 갑니다. 앞 단계의 결과를 다음 단계가 이어받고, 필요 없는 단계는 건너뛰어도 됩니다.

| 단계 | 입력 | 하는 일 |
| --- | --- | --- |
| 1. 넓게 보기 | `lit brainstorm <질문>` | 선택지를 많이 낸 뒤 점수를 매겨 고를 만한 몇 개로 추립니다 |
| 2. 구체화 | `lit deep interview <아이디어>` | 목표가 분명해질 때까지 Codex가 질문합니다 |
| 3. 계획 | `lit-crucible <접근법>` 또는 `lit plan <작업>` | crucible은 접근법의 약점부터 찌르고 살아남은 내용을 lit-plan에 넘깁니다. lit-plan은 단계를 적고 승인을 기다립니다 |
| 4. 실행 | 계획에 `yes`, 또는 `lit <작업>` | 테스트와 확인을 거치며 작업합니다 |
| 5. 검토 | `lit review` | 다섯 갈래로 검토하고, 찾은 문제부터 알려 줍니다 |
| 6. 넘겨주기 | `handoff` | 내린 결정과 다음 할 일을 파일로 남깁니다 |

## 첫 작업

프로젝트에서 Codex를 열고, 시작 검토에서 LitCodex 훅을 승인한 뒤 다음을 입력하세요.

```text
lit 회원가입 폼에 입력 검증을 추가해줘
```

답변이 `🔥 **LIT IGNITED · <discipline>** 🔥` 한 줄로 시작하고, 그때부터 요청은 확인 기준이 붙은 목표가 됩니다.
모든 기준에 통과 증거가 있어야 완료되고, 기록은 프로젝트의 `.litcodex/lit-loop/` 아래에 남아 `lit adhd recap`으로 다시
읽을 수 있습니다. 세션을 마치기 전에 `handoff`만 따로 보내면 다음 세션이 시작할 인수인계 문서가 생깁니다. 출판용
그래프가 필요할 때 `lit-scientific-visualization`만 보내면 시각화 어댑터를 불러오고, Python 패키지는 설치하지 않습니다.

## 스킬

모든 스킬은 Codex skill picker에서 고르거나 `$litcodex:lit-humanizer`, `$litcodex:lit-fetch`,
`$litcodex:lit-handoff`, `$litcodex:lit-scientific-visualization`처럼 이름으로 부를 수 있습니다. 스킬마다 그림은
[스킬 안내](https://github.com/wjgoarxiv/litcodex/blob/main/docs/skills-Ko-KR.md)에 있습니다.

- 루프와 계획: `lit-loop`(`lit`), `litwork`, `lit-plan`, Start Work(`lit start work <승인된 계획>`), `litgoal`,
  `deep-interview`, `lit-brainstorm`, `lit-crucible`, `lit-team`, `ultra-brainstorm`, `lit-handoff`.
- 검토와 조사: `review-work`, `litresearch`, `autoresearch`, `autoconference`, `lit-fetch`, `wikify`,
  `coding-session-audit`, `lit-comprehend`, `lit-hijack`, `lit-adhd`.
- 문서, 그림, 화면: `lit-docx`, `lit-pptx`, `lit-diagram-drawer`, `lit-schematic`, `lit-scientific-visualization`,
  `lit-typographic-motion`, `lit-humanizer`, `readme-studio`, `frontend-ui-ux`, `visual-qa`, `browser-drive`.
  `lit-humanizer`와 `browser-drive`를 뺀 나머지는 이제 wjgoarxiv-skills에 있고, 여기 있는 이름은 `~/.codex/skills/`에
  복사하는 명령을 알려 주는 스텁입니다.
- 코드: `debugging`, `refactor`, `lit-code`, `lit-commit`, `lit-burnoff`, `lit-burnoff-file`,
  `structural-search`, `lsp-setup`, `lit-init`.
- 관리: `litcodex-doctor`, `litcodex-report-bug`, `litcodex-contribute-bug-fix`. `rules`, `lsp`,
  `comment-checker`는 알아서 돌아갑니다.

## 확장

LitCodex에는 LitFamily 코어가 들어 있고, 이 코어는 혼자서도 완결되어 동작합니다. 파일을 만드는 스킬 아홉
개(발표자료, 문서, 그림, 디자인, 영상과 커버)는 LitFamily 확장이며 확장 선반인
[wjgoarxiv-skills](https://github.com/wjgoarxiv/wjgoarxiv-skills)에 있습니다. 쓰는 것만 LitCodex 옆에 설치하면
LitFamily를 온전히 쓸 수 있습니다. 설치는 LitCodex가 대신 해 줄 수 있고, 명령마다 `--yes`를 붙이기 전까지는 할
일만 보여 줍니다.

```bash
litcodex extensions list
litcodex extensions install lit-docx --yes
litcodex extensions install --family figures --yes
litcodex extensions check
litcodex extensions update --yes
```

`install`은 `~/.agents/skills`나 프로젝트 스킬 폴더에 같은 이름의 스킬이 있으면 멈추고, 아니면 예전 복사본을
통째로 `~/.codex/extension-backups/`로 옮긴 뒤 복사하고 영수증을 남깁니다. `--from <받아 둔 경로>`가 없으면
`~/.cache/litcodex/extensions-src`에 선반의 작은 클론을 둡니다. `remove`는 직접 만든 폴더를 거절하고, `check`는
문제마다 고치는 명령을 한 줄씩 보여 주며, `prune-backups --yes`는 오래된 백업을 지웁니다.

손으로 하려면 선반을 한 번 받아 두고 프로젝트 폴더에서 네 줄을 실행하세요. 자리표시자 대신 받아 둔 경로를
넣습니다. `lit-docx`라면 이렇습니다.

```bash
git clone https://github.com/wjgoarxiv/wjgoarxiv-skills
cx="${CODEX_HOME:-$HOME/.codex}"; p="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; for d in "$cx/skills" "$HOME/.agents/skills" "$p/.agents/skills" "$p/.codex/skills"; do [ -e "$d/lit-docx" ] && echo "found: $d/lit-docx"; done; echo "check done"
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/lit-docx" ]; then b="$cx/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$b" && [ ! -e "$b/lit-docx" ] && mv "$cx/skills/lit-docx" "$b/lit-docx" && echo "moved aside: $b/lit-docx"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/lit-docx" ]; then echo "stopped: $cx/skills/lit-docx still exists"; else mkdir -p "$cx/skills" && cp -R "<path to your wjgoarxiv-skills clone>/variants/litcodex/lit-docx" "$cx/skills/lit-docx"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; [ -f "$cx/skills/lit-docx/SKILL.md" ] && printf '{"id":"lit-docx","source":"%s","variant":"litcodex","installed_at":"%s"}\n' "<path to your wjgoarxiv-skills clone>/variants/litcodex/lit-docx" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$cx/skills/lit-docx/.litfamily-extension.json"
```

네 줄은 Codex가 읽는 모든 폴더에서 같은 이름의 스킬을 찾고, 예전 복사본을 통째로
`~/.codex/extension-backups/<날짜-시각>/lit-docx`로 옮기고(Codex는 이곳을 읽지 않습니다), 빈 자리에 복사한 뒤
폴더 안에 영수증을 남깁니다. 다시 실행하면 업데이트되고, 둘째 줄만 실행하면 확장이 백업 폴더로 빠집니다. `$litcodex:lit-pptx` 같은
스텁마다 자기 네 줄을 보여 줍니다. 업그레이드는 LitCodex 스킬 폴더에 추가하거나
고친 파일을 먼저 `~/.codex/litcodex-backups/<날짜>/`에 저장합니다. 1.0.38까지 쓰던 런타임은
`~/.cache/litcodex/office`와 `~/.cache/litcodex/motion-runtime`에 남아 있으니, 확장을 설치하지 않는다면 지워도
됩니다.

## 설치하면 달라지는 것

- Codex에 플러그인·훅·에이전트가 등록되고 `~/.codex/config.toml`의 관리 항목이 갱신됩니다. 관련 없는 Codex
  설정은 그대로 둡니다.
- 프로젝트마다 `.litcodex/lit-loop/` 아래에 로컬 기록이 생기며, Git과 패키지에서는 제외됩니다.
- [자동 핸드오프](https://github.com/wjgoarxiv/litcodex/blob/main/docs/auto-handoff-Ko-KR.md)는 기본으로 켜져 있고
  컨텍스트 창의 80%에서 동작하며, `lit-handoff auto off`로 끌 수 있습니다.
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
npm exec --yes --package @litfamily/litcodex@1.0.47 -- litcodex doctor
```

`litcodex doctor`는 등록·훅·설정·호스트 기능을, `litcodex loop doctor`는 현재 프로젝트의 루프 상태를 확인합니다.
`lit`을 입력해도 반응이 없다면 doctor를 실행하고 Codex에서 훅을 승인했는지 확인하세요. 죽은 프로세스가 남긴
상태 잠금은 알아서 풀립니다. 다른 해결 방법은
[문제 해결](https://github.com/wjgoarxiv/litcodex/blob/main/README-Ko-KR.md#문제-해결)에 있습니다.

```sh
npm exec --yes --package @litfamily/litcodex@1.0.47 -- litcodex uninstall
```

플러그인과 LitCodex가 관리하는 설정을 지우고, 관련 없는 설정은 그대로 둡니다.

## 링크

[사용 참고서](https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage-Ko-KR.md) ·
[기존 설치 이전](https://github.com/wjgoarxiv/litcodex/blob/main/docs/npm-migration.md) ·
[CHANGELOG.md](https://github.com/wjgoarxiv/litcodex/blob/main/CHANGELOG.md) ·
[개인정보](https://github.com/wjgoarxiv/litcodex/blob/main/docs/privacy.md) ·
[이슈](https://github.com/wjgoarxiv/litcodex/issues) · MIT 라이선스 ·
[상표 정책](https://github.com/wjgoarxiv/litcodex/blob/main/TRADEMARK.md)
