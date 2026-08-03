# SKN30-4th-4Team-dev

> [SKN30-3rd-4Team](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN30-3rd-4Team) 프로젝트를 **고도화**하는 레포지토리입니다.

---

## 📌 프로젝트 소개
전·월세 분쟁 팩트체커 — 계약서를 올리면 위험 조항을 짚어주고, 계약 관련 궁금증은 AI 챗봇이 법률·판례 근거와 함께 답해주는 서비스입니다. (원 프로젝트 주제 계승)

- **계약서 리스크 진단**: 계약서(이미지/PDF)를 업로드하면 OCR로 텍스트를 추출하고, 개인정보(주민등록번호·전화번호·계좌번호 등)를 자동 마스킹한 뒤 LLM이 위험 조항을 분석해 종합 리스크 리포트(안전 점수·위험 등급·조항별 코멘트)로 보여줍니다.
- **AI 법률 상담 챗봇**: 전·월세 분쟁 관련 질문에 RAG(법령·판례·가이드 임베딩 검색) 기반으로 근거를 인용해 답합니다.
- **마이페이지**: 최근 진단·상담 내역 조회, 닉네임·프로필 사진 변경, 알림 설정.
- **알림**: 계약서 분석이 완료되면 배지·토스트·(허용 시) 브라우저 데스크톱 알림으로 안내합니다.

## 🚀 고도화 내용
[SKN30-3rd-4Team](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN30-3rd-4Team) 원 프로젝트(Streamlit 기반 프로토타입) 대비 아래를 새로 설계·구현했습니다.

- **아키텍처 전환**: Streamlit 단일 앱 → React(Vite)+FastAPI 클라이언트/서버 구조, DB를 Supabase Postgres + pgvector 하이브리드(SQLAlchemy ORM)로 전환.
- **인증 체계**: Supabase Auth 기반 이메일·카카오 소셜 로그인, JWT 검증, 약관 동의·회원 탈퇴(Soft Delete) 플로우.
- **계약서 분석 파이프라인**: 업로드 → OCR(로컬 PaddleOCR-VL worker, 개인정보 마스킹) → LLM 분석 → 결과 저장까지, DB를 작업 큐로 쓰는 비동기 분석 잡(`analysis_job`)으로 처리 — 여러 파일을 한 번에 올려도 진행 상황(단계·퍼센트)을 폴링으로 확인할 수 있습니다.
- **실시간성 있는 알림 시스템**: 분석 완료/실패를 DB에 기록하고 폴링으로 배지·토스트·브라우저 알림을 띄우며, 사용자별 알림 수신 여부를 프로필에 저장합니다.
- **RAG 챗봇**: 법령·판례·가이드 문서를 청킹·임베딩해 pgvector에 색인하고, 근거를 인용하는 답변을 생성합니다.
- **표준화된 API·에러 처리**: 모든 응답을 `success/code/message/data/error` 표준 봉투로 통일하고, 프론트는 공통 토스트·오류 모달·`<ErrorState />`로 일관되게 처리합니다.
- **디자인 시스템**: 색상·타이포·spacing·radius 등을 토큰화([`design.md`](design.md))해 화면 전반의 일관성을 유지합니다.
- **테스트·배포 자동화**: pytest(백엔드)·Vitest(프론트엔드) 테스트, Docker Compose 기반 배포, CodeRabbit 자동 코드리뷰, PR/머지 Discord 알림.

## 🛠️ 기술 스택
| 구분 | 기술 |
|------|------|
| Frontend | React, TypeScript, Vite, SCSS |
| Backend | FastAPI, SQLAlchemy, Pydantic |
| AI·OCR | LangGraph, OpenAI, PaddleOCR-VL |
| Database·Auth | Supabase PostgreSQL, pgvector, Supabase Auth |
| Infra | Docker Compose, Nginx, AWS EC2, RunPod, GitHub Actions |

## 📂 폴더 구조
| 폴더 | 설명 |
|------|------|
| `backend/` | 백엔드 (API 서버) |
| `frontend/` | 프론트엔드 (웹) |
| `ocr-worker/` | PaddleOCR-VL 계약서 OCR·마스킹 worker |
| `data/` | 수집한 데이터 |
| `docs/` | 프로젝트 문서 |
| `final/` | 산출물 |

> 📁 자세한 폴더·파일 설명 → **[docs/폴더 파일 구조.md](docs/폴더%20파일%20구조.md)**

## 📖 문서
- 📄 [기획서 (PRD)](docs/PRD.md)
- 🏗️ [아키텍처](docs/architecture.md)
- 🗄️ [ERD](docs/ERD.md)
- 📐 [팀 규칙 (컨벤션)](docs/conventions.md)
- 🗺️ [스캐폴딩 계획 (결정·할 일)](docs/스캐폴딩_계획.md)
- 🗂️ [폴더·파일 구조](docs/폴더%20파일%20구조.md)
- 🔒 [계약서 OCR·개인정보 마스킹](docs/ocr-masking.md)

## 👥 팀원 및 역할 분담

<div align="center">
  <table>
    <tr>
      <td align="center" width="25%">
        <a href="https://github.com/hikago">
          <img src="https://avatars.githubusercontent.com/hikago?size=160" width="100" alt="김진남 프로필"><br>
          <strong>김진남</strong>
        </a><br><br>
        <img src="https://img.shields.io/badge/RAG_%C2%B7_DevOps-17224A?style=flat-square" alt="RAG · DevOps">
      </td>
      <td align="center" width="25%">
        <a href="https://github.com/dosupdebongu">
          <img src="https://avatars.githubusercontent.com/dosupdebongu?size=160" width="100" alt="정민규 프로필"><br>
          <strong>정민규</strong>
        </a><br><br>
        <img src="https://img.shields.io/badge/OCR_%C2%B7_AI_PIPELINE-17224A?style=flat-square" alt="OCR · AI Pipeline">
      </td>
      <td align="center" width="25%">
        <a href="https://github.com/jexists">
          <img src="https://avatars.githubusercontent.com/jexists?size=160" width="100" alt="정주애 프로필"><br>
          <strong>정주애</strong>
        </a><br><br>
        <img src="https://img.shields.io/badge/PM_%C2%B7_FULL_STACK-17224A?style=flat-square" alt="PM · Full Stack">
      </td>
      <td align="center" width="25%">
        <a href="https://github.com/SEONGBAE0201">
          <img src="https://avatars.githubusercontent.com/SEONGBAE0201?size=160" width="100" alt="천성배 프로필"><br>
          <strong>천성배</strong>
        </a><br><br>
        <img src="https://img.shields.io/badge/FRONTEND_%C2%B7_UI%2FUX-17224A?style=flat-square" alt="Frontend · UI/UX">
      </td>
    </tr>
    <tr>
      <td align="center">
        <sub>팀장<br>RAG 챗봇 개발<br>Docker·EC2 배포</sub>
      </td>
      <td align="center">
        <sub>발표<br>계약서 OCR·분석<br>RunPod 배포</sub>
      </td>
      <td align="center">
        <sub>프로젝트 관리<br>API 설계·연동<br>프론트·백엔드 통합</sub>
      </td>
      <td align="center">
        <sub>주요 페이지 설계<br>UI/UX 디자인<br>스토리보드</sub>
      </td>
    </tr>
  </table>
</div>

## ⚙️ 설치 및 실행
▶ **[시작 가이드 (docs/setup.md)](docs/setup.md)** — 첫 설정·실행 (Mac/Windows)
- 백엔드: [backend/README.md](backend/README.md)
- 프론트엔드: [frontend/README.md](frontend/README.md)
- OCR worker: [ocr-worker/README.md](ocr-worker/README.md)

## 💬 팀원 소감 및 회고

### 김진남
> 4차 프로젝트에서는 3차 때 아쉬웠던 부분들을 실제 기능으로 채워넣는 데 집중했던 것 같습니다. RAG로 법적 근거를 찾아주는 것에서 그치지 않고, 규칙 기반 스코어링으로 사기 위험도를 정량화하는 파이프라인까지 붙이면서 실용적으로 사용할 수 있지않을 까 생각이 듭니다.
처음 접하는 도메인을 두 차수에 걸쳐 다루다 보니 이제야 조금씩 눈에 들어오는 거 같은데, 다음에 비슷한 도메인을 만나면 훨씬 빠르게 접근할 수 있겠다는 자신감도 생겼습니다. 함께 고민해준 팀원들 덕분에 무사히 마무리할 수 있었습니다. 다들 고생하셨습니다. 감사합니다.

### 정민규
> 이번 프로젝트를 통해 AI 모델 연동뿐만 아니라 개인정보 보호와 안정적인 비동기 처리 구조까지 설계하는 경험을 쌓았습니다.
특히 RunPod의 GPU·CUDA 환경과 Serverless 배포 과정에서 많은 시행착오를 겪었지만, 원인을 분석하고 해결하며 실제 배포 환경에 대한 이해를 높일 수 있었습니다.
또한 개인정보 잔존 여부를 재검사하고 외부 AI 호출을 차단하는 과정을 구현하며 서비스의 안전성과 신뢰성의 중요성을 배웠습니다.
팀원들과 문제를 하나씩 해결하며 기술적 완성도와 사용자 가치를 함께 고민할 수 있었던 의미 있는 프로젝트였습니다.

### 정주애
> 3차 프로젝트보다 한 단계 더 발전한 결과물을 만들 수 있어 의미 있었습니다. 백엔드 데이터 처리 과정에서 시행착오도 많았지만, 단순히 API를 연결하는 것 이상의 고민이 필요하다는 점을 배울 수 있었습니다. 팀원들이 각자 맡은 역할을 끝까지 잘 마무리해 준 덕분에 프로젝트를 잘 완성할 수 있었고, 좋은 협업 경험이었습니다.

### 천성배
> 3차에서보다 확실히 프론트엔드와 OCR등 레이아웃 개선, 성능개선이 잘 되어 기뻣었고,
  서로서로 잘 이슈사항을 정리 해결하는 팀웍이 좋았습니다. 감사합니다
