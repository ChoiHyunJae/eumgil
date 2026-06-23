# 이음길 (ieumgil)

> 노인이 직접 안내하는 초근거리 지역 연결 플랫폼

![main](https://img.shields.io/badge/main-protected-red)
![develop](https://img.shields.io/badge/develop-default-blue)
![flutter](https://img.shields.io/badge/Flutter-Firebase-cyan)

---

## 브랜치 전략

| 브랜치 | 역할 |
|---|---|
| `main` | 최종 배포용 — 직접 push 금지 |
| `develop` | 기본 작업 브랜치 — 모든 PR은 여기로 |
| `feature/이름-작업명` | 개인 기능 개발 |

---

## 작업 순서

```bash
git checkout develop
git pull origin develop
git checkout -b feature/이름-작업명

# 작업 완료 후
git add .
git commit -m "[Feat] 기능 설명"
git push origin feature/이름-작업명
```

→ GitHub에서 develop으로 PR 생성 후 팀원 1명 리뷰 받고 Merge

---

## 커밋 컨벤션

| 태그 | 설명 |
|---|---|
| `[Feat]` | 새로운 기능 추가 |
| `[Fix]` | 버그 수정 |
| `[Docs]` | 문서 작성 및 수정 |
| `[Refactor]` | 코드 리팩토링 |
| `[Test]` | 테스트 코드 |
| `[Chore]` | 빌드 설정, 패키지 추가 |

---

## 폴더 구조
