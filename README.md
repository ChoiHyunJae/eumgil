# eumgil

## 🌿 깃/브랜치 전략 (Git Strategy)

우리 팀은 안정적인 협업을 위해 간소화된 Git Flow를 사용합니다.

- `main` : 최종 배포용 브랜치 (직접 push 금지)
- `develop` : **기본 작업 브랜치** (모든 PR은 이곳을 향합니다)
- `feature/이름-작업명` : 개인별 기능 개발 브랜치

### 작업 순서 (Workflow)

1. `git checkout develop`
2. `git pull origin develop`
3. `git checkout -b feature/이름-작업명`
4. 작업 완료 후 `git add .` & `git commit -m "[Feat] 기능 설명"`
5. `git push origin feature/이름-작업명`
6. GitHub에서 **develop 브랜치로 PR 생성** → 팀원 1명 리뷰 후 Merge

---

### 📝 커밋 컨벤션 (Commit Convention)

| 태그 | 설명 |
|---|---|
| `[Feat]` | 새로운 기능 추가 |
| `[Fix]` | 버그 수정 |
| `[Docs]` | 문서 작성 및 수정 |
| `[Refactor]` | 코드 리팩토링 (기능 변화 없음) |
| `[Test]` | 테스트 코드 작성 |
| `[Chore]` | 빌드 설정, 패키지 추가 등 |

---

### 📁 폴더 구조

\```
ieumgil/
├── backend/
├── frontend/
└── docs/
\```
