# 🏫 고등학교 수시 합격 데이터베이스 앱 (Highschool Consulting App)

모바일 환경에 최적화된 **애플(Apple) 디자인 스타일**의 고등학교 수시 합격 및 학교 정보 상담 데이터베이스 웹 애플리케이션입니다.

---

## 🌟 주요 기능 및 특징

1. **모바일 최적화 애플(Apple) 스타일 UI/UX**:
   - 둥근 모서리 카드, 파스텔 블루 배지, 부드러운 호버 애니메이션
   - iOS 스타일 바텀 시트 및 성명/휴대폰 뒷자리 4자리 안전 로그인
2. **다채로운 대시보드 (보기 탭)**:
   - 학년도별(2027~2024년) 태그 색상 자동 구분
   - 학교별 종합 카드: 학교명, 구글 시트 직링크, 교과편성표, 전교 학생수, 학교 유형 배지
   - 전교 등수별 수시 합격 사례 및 특별 프로그램 실시간 검색/필터링
3. **완벽한 백엔드 연동**:
   - Google Apps Script (GAS) 구글 시트 DB 연동
   - Vercel Serverless Function (Python REST API) 내장
   - 실시간 시트 데이터 GViz 파싱 및 타임스탬프 자동 보장

---

## 📁 프로젝트 파일 구조

```
├── api/
│   └── index.py            # Vercel 파이썬 서버리스 API 백엔드
├── index.html              # 메인 프론트엔드 HTML
├── app.js                  # 프론트엔드 애플 스타일 통합 데이터/UI 로직
├── style.css               # 보조 CSS 및 애플 애니메이션
├── vercel.json             # Vercel 라우팅 및 파이썬 서빙 설정
├── requirements.txt        # Vercel 배포 시 필요한 파이썬 의존성
├── Code.gs                 # Google Apps Script 백엔드 코드
├── README.md               # 프로젝트 설명서
└── .gitignore              # GitHub 배포 제외 파일 목록
```

---

## 🚀 GitHub 및 Vercel 배포 방법

### 1️⃣ GitHub 업로드
1. [GitHub](https://github.com/) 로그인 후 우측 상단의 `+` -> **New repository** 클릭
2. Repository name 입력 (예: `highschool-consulting-app`) 후 **Create repository** 클릭
3. 생성된 페이지에서 **uploading an existing file** 링크 클릭
4. 본 프로젝트 파일 전체(`index.html`, `app.js`, `style.css`, `vercel.json`, `requirements.txt`, `api/index.py` 등)를 드래그 앤 드롭 후 **Commit changes** 클릭

### 2️⃣ Vercel 무료 웹 배포 (1분 완료)
1. [Vercel](https://vercel.com/) 회원가입 및 로그인 (GitHub 계정 연동)
2. 대시보드 우측 상단 **Add New...** -> **Project** 클릭
3. 방금 생성한 `highschool-consulting-app` GitHub 저장소 옆의 **Import** 버튼 클릭
4. Framework Preset은 **Other** (기본값)로 두고 **Deploy** 버튼 클릭
5. 약 30초 후 나만의 무제한 웹사이트 주소 생성 완료! (예: `https://highschool-consulting-app.vercel.app`)

---

## 💡 개발 및 유지보수
- **구글 시트 연동**: `Code.gs` 파일을 구글 드라이브 앱스크립트 편집기에 적용하여 웹앱 배포
- **프론트엔드/백엔드 최적화**: Vercel의 Serverless Function이 `api/index.py`를 자동으로 서버리스 API로 서빙합니다.
