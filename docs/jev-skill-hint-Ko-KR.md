# Jev 스킬 힌트 (선택)

[README](../README-Ko-KR.md) · [English](./jev-skill-hint.md)

평범하게 쓴 요청 중에는 번들 스킬 하나가 딱 맞는 경우가 있습니다. 이 기능을 켜면 LitCodex가 TypeSafe(typesafe.ai)의
호스팅 모델 Jev에게 어떤 스킬이 맞는지 물어봅니다. Jev가 충분히 확신하면 `UserPromptSubmit` 훅이 그 스킬 이름을
담은 한 줄을 이번 턴 컨텍스트에 덧붙입니다. 어디까지나 제안입니다. 스킬을 불러올지는 Codex가 정하고, 힌트는
권한을 주지도 도구를 실행하지도 않습니다.

기본값은 꺼짐이며, 각 상태가 화면에서 어떻게 보이는지는 아래 [화면에 나타나는 모습](#화면에-나타나는-모습)에 있습니다. 켜려면 Codex를 실행하는 환경에 두 변수를 모두 설정한 뒤 Codex를 다시 시작하세요.

```sh
export LITCODEX_JEV=1
export TYPESAFE_API_KEY=<본인의 TypeSafe 키>
```

- **켜면 조건에 맞는 프롬프트가 매번 TypeSafe(typesafe.ai)로 전송됩니다.** 먼저 2,000자로 자르고 홈 경로,
  이메일 주소, 토큰 형태의 문자열을 가립니다. 파일, 도구 출력, 대화 기록 같은 세션의 다른 내용은 보내지
  않습니다. 슬래시 명령, `$skill` 언급, 이미 lit 경로를 시작하는 프롬프트도 보내지 않습니다.
- 토큰 형태가 아닌 내용은 그대로 전송됩니다. 호스트 이름, 고객 이름, `password=…` 형식으로 쓰지 않은 비밀번호가
  그 예입니다.
- `TYPESAFE_API_KEY`는 Codex를 시작하는 셸에서 export되므로 Codex의 도구도 이 값을 읽을 수 있습니다. 이 기능에만
  쓰는 키를 따로 만들고 사용 한도를 낮게 잡아 두세요.
- 비용은 본인 키로 TypeSafe에 청구되며 입력 토큰 100만 개당 약 0.04달러입니다. 요청에는 프롬프트와 스킬 목록이
  함께 들어가고, 세션당 요청은 최대 200회입니다(`LITCODEX_JEV_MAX_CALLS`).
- 힌트는 모델에게만 가고 평소에는 화면에 보이지 않습니다. 보고 싶다면 `LITCODEX_JEV_SHOW=1`도 설정하세요. 힌트가
  붙은 턴마다 Codex 대화 화면에 `Jev → lit-humanizer (0.37s)` 같은 한 줄이 나타납니다.
- 켜져 있는지 알 수 있도록, 세션마다 lit 경로를 시작하지 않는 첫 프롬프트에서 `✦ Jev skill hint ON`이 한 번
  나타납니다.
- 요청마다 최대 1.5초까지만 기다립니다. 시간 초과나 다른 실패가 나면 힌트 없이 평소처럼 진행하고, 짧은 안내를
  세션당 한 번만 보여 줍니다.
- `litcodex doctor`는 `Jev skill hint: off`, `on`, `flag on but TYPESAFE_API_KEY missing` 중 하나를 보여 줍니다.
- 끄려면 `LITCODEX_JEV`를 지운 뒤(`1`이 아닌 값이어도 꺼집니다) Codex를 다시 시작하세요.
  [개인정보 안내](./privacy.md#optional-jev-skill-hint)도 참고하세요.

## 화면에 나타나는 모습

Jev가 화면에 더하는 것은 아주 적어서, 켜기 전에 각 상태가 어떻게 보이는지 알아 두면 좋습니다. 사진은 LitCodex 훅을 설치한
Codex CLI 0.158에서 만든 것입니다. Codex 버전에 따라 훅 줄의 표현이나 위치가 조금 다를 수 있습니다. 사진마다 설명에 실제 실행
화면인지, 미리 준비한 Jev 응답으로 만든 것인지 적어 두었고, 예시에 나온 스킬 이름은 말 그대로 예시입니다.

Jev를 끈 상태(LitCodex의 기본값)에서는 입력한 프롬프트가 그대로 Codex로 갑니다. LitCodex는 대화 화면에 아무 줄도 더하지 않고
TypeSafe에 요청도 보내지 않습니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-off-dark.webp" /><img src="./assets/jev/jev-off-light.webp" width="638" alt="터미널 창에 "› fix the flaky login test" 한 줄만 있고, 그 뒤에 Jev 줄은 없습니다." /></picture><br /><sub>실제 Codex 세션에서 Jev를 끄고 캡처했습니다. 모델의 답변은 사진에서 뺐습니다.</sub></p>

Jev를 켜면 세션의 첫 프롬프트에 짧은 한 줄, <code>✦ Jev skill hint ON</code>이 나타납니다. 세션당 한 번만 나오고, 이제부터 조건에 맞는
프롬프트가 TypeSafe로 간다는 사실을 알려 줍니다. lit 경로를 시작하는 프롬프트는 Jev를 거치지 않으므로, 이 줄은 그렇지 않은 첫
프롬프트에서 나옵니다. 이 사진에서는 Jev가 제안할 만한 스킬을 찾지 못해서 안내 줄만 보입니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-on-notice-dark.webp" /><img src="./assets/jev/jev-on-notice-light.webp" width="638" alt="Codex 터미널 창에서 프롬프트 "fix the flaky login test" 뒤에 "Hook · ✦ Jev skill hint ON" 줄이 나옵니다." /></picture><br /><sub>예시 출력입니다. 실제 Codex 세션에서 LitCodex 훅이 돌고, Jev 자리는 미리 준비한 응답이 맡았습니다. 그래서 컴퓨터 밖으로 나간 것은 없습니다.</sub></p>

`LITCODEX_JEV_SHOW=1`을 함께 설정하면 힌트가 붙은 턴마다 스킬 이름과 Jev가 걸린 시간이 한 줄로 나타납니다. Jev가 내 작업에 맞는지
살펴보는 동안 어떤 프롬프트에 제안이 붙었고 얼마나 빨랐는지 볼 수 있어서 편합니다. 세션의 첫 프롬프트에는 안내 줄과 힌트 줄이 함께
나오고, 그다음 프롬프트에는 힌트 줄만 나옵니다. 이 변수가 없어도 힌트는 Codex에 전달되며, 대화 화면은 위의 안내 줄 사진처럼
조용합니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-hint-shown-dark.webp" /><img src="./assets/jev/jev-hint-shown-light.webp" width="638" alt="Codex 터미널 창에 프롬프트 두 개가 있습니다. 첫 번째 "fix the flaky login test" 뒤에는 "Hook · ✦ Jev skill hint ON"과 "Jev → debugging (0.30s)"가, 두 번째 "add a retry to the upload step" 뒤에는 "Hook · Jev → debugging (0.30s)"가 나옵니다." /></picture><br /><sub>같은 설정에서 만든 예시 출력이고, 여기서도 Jev 응답은 미리 준비한 것입니다. 스킬 이름 debugging과 0.30초는 자리를 채운 값이며, 실제 힌트에는 다른 스킬 이름과 다른 시간이 나옵니다.</sub></p>

`LITCODEX_JEV=1`만 설정하고 키를 빠뜨리면 LitCodex가 한 줄로 딱 한 번 알려 주고, 힌트 없이 그대로 진행합니다. 프롬프트는 평소처럼
Codex로 가고, TypeSafe에는 아무것도 전송되지 않습니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-key-missing-dark.webp" /><img src="./assets/jev/jev-key-missing-light.webp" width="638" alt="Codex 터미널 창에서 프롬프트 "fix the flaky login test" 뒤에 "Hook · LitCodex skill hint unavailable (key-missing); continuing normally." 줄이 나옵니다." /></picture><br /><sub>실제 Codex 세션에서 LITCODEX_JEV=1만 설정하고 캡처했습니다.</sub></p>

Codex를 열지 않고도 설정을 확인할 수 있습니다. `litcodex doctor`는 Jev 줄을 하나 출력하고, 위의 상태에 맞춰 `off`, `on`,
`flag on but TYPESAFE_API_KEY missing` 중 하나로 나옵니다.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-doctor-dark.webp" /><img src="./assets/jev/jev-doctor-light.webp" width="638" alt="터미널 창에 litcodex doctor를 세 번 실행한 결과가 Jev 줄만 남긴 채 보입니다. "Jev skill hint: off", LITCODEX_JEV=1과 키를 설정했을 때의 "Jev skill hint: on", LITCODEX_JEV=1만 설정했을 때의 "Jev skill hint: flag on but TYPESAFE_API_KEY missing"입니다." /></picture><br /><sub>임시 홈에서 실행한 litcodex doctor 출력입니다. 각 보고서의 나머지는 뺐고, 키는 자리 표시로 바꿨습니다.</sub></p>

사진과 만든 방법은 [미디어 안내](./assets/jev/README.md)에 정리했습니다.
