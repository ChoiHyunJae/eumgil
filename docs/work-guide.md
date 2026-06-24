# 작업 구조 가이드 (이음길)

> 개발 시작 전에 이 문서를 먼저 읽어주세요. "어디서 뭘 보고 어떻게 작업하는지"를 정리한 문서입니다.

## 1. 문서 지도 — 어디에 뭐가 있나

| 파일/위치 | 내용 | 언제 보나 |
|---|---|---|
| **Issue #1** | PRD (전체 기획·기능·규칙의 원본) | 내 기능이 정확히 뭘 해야 하는지 확인할 때 |
| **Issue #2~#15** | 14개 작업 슬라이스 | 내가 맡은 작업 단위 확인 |
| **CONTEXT.md** | 도메인 용어·관계·불변규칙 | 용어 헷갈릴 때, "이건 절대 깨지면 안 되는 규칙" 확인 |
| **docs/adr/** | 주요 설계 결정 기록 | "이거 왜 이렇게 짰지?" 싶을 때 |
| **docs/strategy.md** | 사업화·발표 전략 | 발표 준비할 때 |
| **functions/src/types/** | DB 스키마 (TypeScript 타입) | 데이터 구조 확인 |
| **functions/src/{모듈}/** | 각 모듈의 함수 stub(계약) | 내 모듈 구현할 때 |

**핵심: 구현 디테일은 PRD(Issue #1)가 원본, 용어·규칙은 CONTEXT.md가 원본입니다.** 둘이 충돌하면 물어보세요.

## 2. 작업 단위 — 슬라이스(Issue #2~#15)

각 이슈에는 세 가지가 있습니다:
- **What to build**: 이 슬라이스가 만드는 것
- **Acceptance criteria**: 완료 조건 (이게 다 충족되면 끝)
- **Blocked by**: 먼저 끝나야 하는 슬라이스 (의존성)

작업은 자기가 맡은 이슈의 **Acceptance criteria를 전부 충족**시키는 걸 목표로 합니다. 체크리스트를 하나씩 채운다고 생각하면 됩니다.

## 3. "계약" 기반 병렬 작업 — 가장 중요한 개념

이 프로젝트는 **스키마와 함수 시그니처(계약)를 먼저 다 정해두고**, 각자 자기 모듈을 그 계약 위에서 채우는 방식입니다.

- `functions/src/types/` 에 5개 컬렉션 스키마가 이미 정의됨 (user, archiveItem, escort, escortPair, group)
- `functions/src/{archive,matching,escort,group,admin,user}/` 에 각 모듈의 함수 stub이 이미 있음 (body는 `throw new Error("not implemented")`)

**내가 할 일 = 내 모듈의 stub을 실제 구현으로 채우는 것.**

이 방식의 장점:
- 다른 사람 코드가 완성되길 기다릴 필요 없음. 계약(타입)만 보면 됨.
- 예: escort 담당은 matching이 만든 escort 문서가 "어떻게 생겼는지(타입)"만 알면, matching 실제 코드 없이도 동행 로직을 짤 수 있음.
- 통합할 때 계약이 이미 맞춰져 있어서 충돌이 작음.

**그래서 절대 하면 안 되는 것**: 내 맘대로 스키마(타입) 바꾸기. 타입을 바꿔야 할 것 같으면 **반드시 팀에 공유하고 합의**하세요. 타입은 모두의 계약이라 한 명이 바꾸면 다른 사람 작업이 깨집니다.

## 4. 핵심 비즈니스 로직은 Cloud Functions에

- 모든 핵심 로직(등록·매칭·동행상태·소모임판정)은 **Firebase Cloud Functions의 callable function**에 작성합니다.
- Flutter 앱은 이 function을 **호출만 하는 얇은 클라이언트**입니다. 앱에 비즈니스 로직을 넣지 마세요.
- 이유: 로직이 앱과 백엔드에 흩어지면 관리가 어렵고, 테스트도 한 곳(Functions)에서만 하면 되기 때문.

## 5. 테스트 작성법

- 테스트는 **Firestore 에뮬레이터를 대상으로** callable function의 입력/출력과 Firestore 결과 상태만 검증합니다.
- 내부 헬퍼 함수나 구현 방식은 검증하지 않습니다.
- **본보기 파일**: `functions/test/harness.emulator.test.ts` — 이 패턴을 복사해서 자기 모듈 테스트를 작성하세요.
- 실행: `cd functions && npm test` (Firestore 에뮬레이터가 자동으로 뜨고 그 안에서 테스트 실행됨)
- 외부 API(Google Maps/STT/카카오 알림톡)는 테스트 시 페이크/스텁으로 대체합니다.

## 6. 막힐 때

- **기능 디테일이 모호하면**: Claude Code에서 `/grill-with-docs` (PRD/CONTEXT 기준으로 캐물어줌)
- **구현할 때**: `/implement` 또는 `/tdd` (이슈 읽고 acceptance criteria 기준으로 작업)
- **세션이 길어지면(1~2시간)**: `/handoff` (인계 문서 남기고 새 세션으로)
- **용어·규칙 확인**: CONTEXT.md
- **그래도 모르겠으면**: 팀에 공유 (특히 스키마 변경, 모듈 간 인터페이스 관련은 꼭)

## 7. 시작 체크리스트

- [ ] 내가 맡은 이슈 번호 확인
- [ ] 그 이슈의 What to build / Acceptance criteria 정독
- [ ] Blocked by에 걸린 슬라이스가 머지됐는지 확인 (안 됐으면 그거 먼저)
- [ ] PRD(Issue #1)에서 내 기능 관련 부분 읽기
- [ ] CONTEXT.md에서 관련 용어·불변규칙 확인
- [ ] `functions/src/{내모듈}/`의 stub 확인
- [ ] develop에서 `feature/이름-작업명` 브랜치 따고 시작
