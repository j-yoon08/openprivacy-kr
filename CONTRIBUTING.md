# 기여하기

## 규칙 고치기

| 파일 | 내용 |
| --- | --- |
| `catalog/sources.yaml` | 근거 원문, 판, 시행일, 확인일 |
| `catalog/facts.yaml` | 조직 상황 입력 항목 |
| `catalog/conditions.yaml` | 규모·유형 조건 |
| `catalog/obligations.yaml` | 법적 의무 판정 |
| `catalog/frameworks/` | 기준별 조항 목록 |
| `catalog/law/*.json` | 법령 전문. 직접 고치지 말고 `pnpm law:build`로 다시 만듭니다 |
| `catalog/law/roles.yaml` | 점검에 연결하지 않은 조문의 역할 |
| `catalog/law/topics.yaml` | 상황 검토의 주제, 질문, 낱말 |
| `catalog/measures/` | 점검, 개선 방법, 증적, 조항 연결 |

1. 법정 수치에는 조·항·호까지 근거를 적습니다. 법정 수치가 아니면 "이 도구의 권장"이라고 밝힙니다.
2. 조건을 바꾸면 경계값 테스트를 추가합니다(예: 49,999명과 50,000명).
3. ISO 표준 원문이나 KISA 안내서 본문을 붙여 넣지 않습니다. 직접 쓴 표현을 사용합니다.
4. 실제 조직의 데이터, 증적, 개인정보를 올리지 않습니다. 예시는 가상으로 만듭니다.
5. 법이 바뀌면 `pnpm law:build`(poppler 필요) 후 diff를 검토하고, 새 조문의 역할을 정합니다. 역할이 없으면 테스트가 실패합니다.
6. `test/situations-holdout.yaml` 문장에 맞춰 낱말을 조정하지 않습니다.
7. YAML 목록 안의 문장에 쉼표가 있으면 따옴표로 감쌉니다.

```sh
pnpm install
pnpm check   # 타입 검사, 테스트, 빌드
```
