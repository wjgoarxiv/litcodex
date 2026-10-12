# 자동 핸드오프 (선택)

[README](../README-Ko-KR.md) · [English](./auto-handoff.md)

긴 세션은 언젠가 컨텍스트가 가득 차고, 다음 컨텍스트는 이번에 배운 내용을 모른 채 시작합니다. 핸드오프 파일은 그
내용을 다음 컨텍스트로 넘겨 줍니다. 이 기능은 대화가 정해 둔 크기에 이르면 핸드오프를 대신 써 주므로, 컨텍스트
사용량을 계속 지켜보지 않아도 됩니다.

직접 켜기 전까지는 꺼져 있고, 컨텍스트 창의 몇 퍼센트에서 동작할지도 직접 고릅니다. LitCodex에는 기본 퍼센트가
없습니다. 대화가 정한 퍼센트에 이르면 Stop 훅이 모델에게 핸드오프를 저장하게 하고, 그 턴에는 다른 일을 시작하지
않게 합니다. 그다음 Codex가 스스로, 또는 사용자가 `/compact`로 대화를 압축하고, 다음 컨텍스트는 방금 저장한
핸드오프를 들고 시작합니다.

## 켜기

아래 문장을 프롬프트 전체로 보내세요. 60은 예시이며 1에서 99 사이의 정수면 됩니다.

```text
lit-handoff auto on 60
```

LitCodex가 바로 답하고, 이 프롬프트는 모델에게 가지 않습니다. Codex는 훅이 스스로 답한 프롬프트를 "Blocked by
hook" 아래에 보여 줍니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/auto-handoff/auto-handoff-on-dark.webp" /><img src="./assets/auto-handoff/auto-handoff-on-light.webp" width="764" alt="Codex 터미널 창입니다. &quot;lit-handoff auto on 60&quot; 프롬프트 아래에 &quot;Blocked by hook&quot;과 답장 &quot;Automatic handoff is ON at 60%. When a conversation reaches 60% of the context window, Codex is asked to save a handoff. Codex compacts the conversation as soon as the turn that saved the handoff ends.&quot;가 보입니다." /></picture></p>

이 명령은 프로젝트의 `.codex/config.toml` 맨 위에도 표시가 붙은 블록으로 퍼센트를 적어 둡니다.

```toml
# litcodex automatic handoff (managed by `lit-handoff auto`; `lit-handoff auto off` removes it)
model_post_turn_compact_threshold_percent = 60
```

이 키가 있으면 Codex는 60% 이상에서 턴이 끝나자마자 압축합니다. 그래서 핸드오프를 저장한 턴 바로 뒤에 아무것도
입력하지 않아도 압축이 이어집니다. Codex CLI 0.158 이상이 필요하고, Codex는 프로젝트를 신뢰한 뒤에만 그 프로젝트의
`.codex/config.toml`을 읽습니다. LitCodex는 Codex 설정에서 신뢰 여부를 확인하며, 아직 신뢰하지 않은 프로젝트에서는
답장 끝부분이 이렇게 바뀝니다: "Codex reads the project .codex/config.toml only after you trust this project, so
until then you will be asked to run /compact yourself." 프로젝트 파일에 그 키를 직접 적어 두었다면 LitCodex는 그
줄을 건드리지 않고, 답장에서 그렇다고 알려 줍니다.

## 상태 보기와 끄기

`lit-handoff auto status`는 지금 설정, 그 설정이 어디서 왔는지, 압축이 어떻게 일어날지를 알려 줍니다.
`lit-handoff auto off`는 기능을 끄고 숫자는 다음을 위해 남겨 둡니다. 나중에 숫자 없이 `lit-handoff auto on`을
보내면 그 숫자로 다시 켜집니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/auto-handoff/auto-handoff-status-off-dark.webp" /><img src="./assets/auto-handoff/auto-handoff-status-off-light.webp" width="764" alt="프롬프트 두 개가 있는 Codex 터미널 창입니다. &quot;lit-handoff auto status&quot; 아래에 &quot;Blocked by hook&quot;과 &quot;Automatic handoff is ON at 60% (set by command). Codex compacts the conversation as soon as the turn that saved the handoff ends.&quot;가 나오고, 이어서 &quot;lit-handoff auto off&quot; 아래에 &quot;Blocked by hook&quot;과 &quot;Automatic handoff is OFF. Your last percent (60%) is kept for next time.&quot;가 나옵니다." /></picture></p>

끄면 `.codex/config.toml`에서 표시가 붙은 블록만 지우고, 파일에 다른 내용이 없었다면 파일도 지웁니다.
`LITCODEX_AUTO_HANDOFF=0`이나 삭제된 설정 파일처럼 다른 이유로 꺼진 경우에도 같은 정리가 일어납니다. 다음 훅
실행이나 `lit-handoff auto` 프롬프트가 블록을 지우며, 블록이 남아 있는 동안에는 `litcodex doctor`가 경고합니다.

숫자를 한 번도 정하지 않은 채 `lit-handoff auto on`을 보내면 LitCodex가 숫자를 물어봅니다. 1에서 99를 벗어나거나
정수가 아닌 숫자는 아무것도 바꾸지 않고, `lit-handoff auto` 뒤에 다른 말을 붙이면 사용법 한 줄이 돌아옵니다.

## 정한 퍼센트에 이르면

턴이 끝날 때마다 Stop 훅이 마지막 모델 요청이 컨텍스트 창을 얼마나 썼는지 읽습니다. Codex가 자체 압축 설정과
비교하는 값과 같은 수치라서, 언제 선을 넘었는지에 대한 판단이 서로 어긋나지 않습니다.

정한 퍼센트 이상이면 훅이 턴을 붙잡아 두고 모델에게 이렇게 요청합니다. lit-handoff 스킬로 지금 핸드오프를
저장하고, 다음 컨텍스트가 이 세션의 파일을 찾을 수 있게 `Auto-handoff session: <session id>` 줄을 넣고, 파일을 다시
읽어 확인한 뒤 사용자에게 한 줄만 말하라는 요청입니다. 모델은 그 턴에 다른 일을 시작하지 않습니다. 요청은 선을
넘을 때마다 한 번이며, 컨텍스트가 퍼센트 아래로 내려갔다가 다시 올라온 뒤에야 다시 요청합니다.

보이는 한 줄은 누가 압축하느냐에 따라 다릅니다. Codex가 스스로 압축한다면 "Handoff saved. Codex compacts the
conversation next."이고, 그렇지 않다면 "Handoff saved. Run /compact now."이므로 `/compact`를 입력하면 됩니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/auto-handoff/auto-handoff-saved-dark.webp" /><img src="./assets/auto-handoff/auto-handoff-saved-light.webp" width="764" alt="Codex 터미널 창입니다. 모델이 남긴 &quot;Handoff saved. Run /compact now.&quot; 줄 아래에 &quot;/compact&quot; 프롬프트가 보입니다." /></picture></p>

압축이 끝나면 LitCodex가 이 세션이 방금 저장한 핸드오프의 앞부분과 경로를 모델에게 한 번 건네고, 이어서 일하기
전에 파일 전체를 읽으라고 요청합니다. 트리거보다 앞서 쓰인 핸드오프나 다른 세션을 가리키는 핸드오프는 제외합니다.

Codex가 스스로 압축하는 지점보다 낮은 퍼센트를 고르세요. 그렇지 않으면 핸드오프를 저장하기 전에 Codex가 먼저
압축할 수 있고, 퍼센트가 그 지점에 닿으면 `litcodex doctor`가 경고합니다.

## 환경 변수로 켜기

셸마다 따로 정하고 싶다면 두 변수를 붙여 Codex를 시작하세요.

```sh
LITCODEX_AUTO_HANDOFF=1 LITCODEX_AUTO_HANDOFF_PERCENT=60 codex
```

두 변수가 설정돼 있는 동안에는 명령보다 우선하고, `lit-handoff auto on`도 답장에서 그렇다고 알려 줍니다.
`LITCODEX_AUTO_HANDOFF=0`은 기능을 끕니다. 환경 변수는 프로젝트의 `.codex/config.toml`에 아무것도 쓰지 않으므로,
그 파일이 이미 압축을 요청하고 있지 않다면 핸드오프 뒤에 `/compact`를 직접 실행합니다. 퍼센트가 1에서 99 사이의
정수가 아니면 기능은 꺼진 채로 있고, `litcodex doctor`가 그 이유를 알려 줍니다.

## 셸에서 확인하기

`litcodex doctor`는 프롬프트가 알려 주는 상태와 같은 `automatic handoff` 줄을 하나 출력합니다. 아래는 같은
프로젝트에서 세 번 실행한 결과입니다. 기능을 켜기 전, 신뢰한 프로젝트에서 `lit-handoff auto on 60`을 보낸 뒤,
다시 끈 다음 환경 변수를 붙였을 때입니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/auto-handoff/auto-handoff-doctor-dark.webp" /><img src="./assets/auto-handoff/auto-handoff-doctor-light.webp" width="836" alt="litcodex doctor를 세 번 실행하고 각각 한 줄만 남긴 터미널 창입니다. &quot;automatic handoff: off&quot;, 이어서 &quot;automatic handoff: on at 60% (command; Codex compacts after the handoff turn)&quot;, 마지막으로 LITCODEX_AUTO_HANDOFF=1 LITCODEX_AUTO_HANDOFF_PERCENT=60 litcodex doctor로 실행한 &quot;automatic handoff: on at 60% (environment; you run /compact after the handoff)&quot;가 보입니다." /></picture></p>

doctor는 퍼센트가 Codex 자체 압축 지점 이상일 때, 프로젝트 파일이 정한 퍼센트보다 낮은 곳에서 압축할 때, 기능을
끈 뒤에도 표시가 붙은 블록이 남아 있을 때도 경고합니다.

선택한 값과 세션별 기록은 프로젝트 안의 `.litcodex/auto-handoff/`에 남으며, 내 컴퓨터에만 있고 Git에는 들어가지
않습니다. [개인정보 안내](./privacy.md#automatic-handoff)를 참고하세요. 그림과 만든 방법은
[미디어 노트](./assets/auto-handoff/README.md)에 정리해 두었습니다.
