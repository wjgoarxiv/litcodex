status: "pending"
deferred_label: "to be determined separately"
allowed_states: ["pending", "보류 중", "to be determined separately"]

| status | description |
| --- | --- |
| pending | 대기 상태 |
| 보류 중 | 상태 열거 |
| to be determined separately | 상태 열거 |

```yaml
status: 보류 중
next_state: to be determined separately
```
