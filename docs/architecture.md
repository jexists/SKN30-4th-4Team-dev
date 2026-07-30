# HomeShield 시스템 구조도

HomeShield는 전·월세 계약서를 분석하고, 임대차 관련 질문에 법령·판례를 근거로 답변하는 웹 서비스다.

## 1. 전체 시스템 구성도

서비스 전체에서 실제로 연결된 시스템만 간단히 표현했다.

```mermaid
flowchart LR
    subgraph clientLayer ["사용자"]
        user["웹 사용자"]
    end

    subgraph awsLayer ["AWS EC2 · Docker Compose"]
        caddy["HTTPS 요청 처리 (Caddy)"]
        frontend["프론트엔드 (React·Nginx)"]
        backend["백엔드 API·AI 오케스트레이션 (FastAPI·LangGraph)"]
    end

    subgraph dataLayer ["데이터·인증"]
        auth["인증 서비스 (Supabase Auth)"]
        database["데이터베이스 (PostgreSQL·pgvector)"]
        storage["파일 저장소 (Supabase Storage)"]
    end

    subgraph externalLayer ["외부 처리"]
        ocr["OCR 워커 (RunPod)"]
        ai["AI 분석 (OpenAI API)"]
        kakaoLogin["카카오 로그인"]
        kakaoMaps["카카오 지도"]
    end

    user -->|"HTTPS"| caddy
    caddy -->|"화면 요청"| frontend
    caddy -->|"API 요청"| backend

    frontend -.->|"회원가입·로그인"| auth
    auth -.->|"소셜 로그인"| kakaoLogin
    frontend -.->|"지도·주소 검색"| kakaoMaps

    backend -->|"데이터 저장·조회"| database
    backend -->|"파일 저장·조회"| storage
    backend -.->|"JWT 검증"| auth
    backend -.->|"OCR·마스킹"| ocr
    backend -.->|"챗봇·위험 분석"| ai

    classDef clientNode fill:#EAF2FF,stroke:#4A78C2,color:#172033,stroke-width:1.5px;
    classDef serverNode fill:#ECF8F1,stroke:#3C8C64,color:#172033,stroke-width:1.5px;
    classDef dataNode fill:#FFF5E8,stroke:#D58A35,color:#172033,stroke-width:1.5px;
    classDef externalNode fill:#F3EEFF,stroke:#8064B3,color:#172033,stroke-width:1.5px;

    class user clientNode;
    class caddy,frontend,backend serverNode;
    class auth,database,storage dataNode;
    class ocr,ai,kakaoLogin,kakaoMaps externalNode;
```

## 2. 클라이언트 시스템 구조도

프론트엔드는 화면, 동작 제어, 서버 통신 영역으로 나뉜다. 화면에서 발생한 요청은 기능별 API 모듈과 공통 API 클라이언트를 거쳐 백엔드로 전달된다.

```mermaid
flowchart LR
    subgraph entryLayer ["앱 진입"]
        bootstrap["앱 시작"]
        router["라우터·앱 레이아웃"]
    end

    subgraph displayLayer ["화면·표시"]
        pageUi["기본 화면·회원 화면"]
        analysisUi["계약서 업로드·위험 보고서"]
        chatUi["AI 채팅·대화 내역"]
        commonUi["공통 UI·알림·오류·지도"]
    end

    subgraph controlLayer ["서비스 제어"]
        authControl["인증·접근 제어"]
        featureControl["분석·채팅·알림 상태 관리"]
        feedbackControl["토스트·오류 상태 관리"]
    end

    subgraph communicationLayer ["서버 통신"]
        domainApi["기능별 API 모듈"]
        httpClient["공통 API 클라이언트"]
        authClient["Supabase 인증 클라이언트"]
        mapLoader["카카오 지도 로더"]
    end

    subgraph connectedLayer ["연결 시스템"]
        backendApi["백엔드 API"]
        supabaseAuth["Supabase 인증"]
        kakaoService["카카오 로그인·지도"]
    end

    bootstrap --> router

    router --> pageUi
    router --> analysisUi
    router --> chatUi
    router --> commonUi

    pageUi --> authControl
    analysisUi --> featureControl
    chatUi --> featureControl
    commonUi --> featureControl

    authControl --> domainApi
    featureControl --> domainApi
    domainApi --> httpClient
    httpClient -->|"HTTPS·JSON·파일"| backendApi
    httpClient --> feedbackControl

    authControl --> authClient
    authClient -.->|"세션·토큰"| supabaseAuth
    supabaseAuth -.->|"소셜 로그인"| kakaoService

    commonUi --> mapLoader
    mapLoader -.->|"지도·주소 검색"| kakaoService

    classDef entryNode fill:#EEF2F7,stroke:#64748B,color:#172033,stroke-width:1.5px;
    classDef displayNode fill:#EAF2FF,stroke:#4A78C2,color:#172033,stroke-width:1.5px;
    classDef controlNode fill:#ECF8F1,stroke:#3C8C64,color:#172033,stroke-width:1.5px;
    classDef communicationNode fill:#FFF5E8,stroke:#D58A35,color:#172033,stroke-width:1.5px;
    classDef connectedNode fill:#F3EEFF,stroke:#8064B3,color:#172033,stroke-width:1.5px;

    class bootstrap,router entryNode;
    class pageUi,analysisUi,chatUi,commonUi displayNode;
    class authControl,featureControl,feedbackControl controlNode;
    class domainApi,httpClient,authClient,mapLoader communicationNode;
    class backendApi,supabaseAuth,kakaoService connectedNode;
```

### 클라이언트 구성 요소

| 영역 | 실제 코드 역할 |
| --- | --- |
| 앱 진입 | `main.tsx`, `routes.tsx`, `App.tsx` |
| 화면·표시 | `pages/`, `components/` |
| 서비스 제어 | 인증, 분석, 알림, 사용자 상태를 관리하는 `hooks/`와 상태 Store |
| 서버 통신 | `api/`의 기능별 모듈과 공통 `client.ts` |
| 인증 연결 | Supabase Client, Kakao OAuth |
| 지도 연결 | Kakao Maps SDK Loader |

## 3. 서버 시스템 구조도

백엔드는 API 계층, 서비스 계층, 데이터 접근 계층으로 구분된다. 계약서 분석 Worker는 별도 서버가 아니라 FastAPI 프로세스 안에서 실행되는 백그라운드 Worker다.

```mermaid
flowchart LR
    subgraph entryLayer ["요청 진입"]
        caddy["API 요청 전달 (Caddy)"]
        app["FastAPI 앱·공통 설정"]
        security["JWT 인증 검사"]
    end

    subgraph apiLayer ["API 계층"]
        authApi["인증·회원 API"]
        analysisApi["계약서 분석 API"]
        chatApi["AI 채팅 API"]
        notificationApi["알림·상태 API"]
    end

    subgraph serviceLayer ["서비스 계층"]
        authService["인증·회원 서비스"]
        analysisService["분석 작업·백그라운드 워커"]
        documentService["OCR·계약서 분석 서비스"]
        chatService["LangGraph RAG 채팅 엔진"]
        notificationService["알림 서비스"]
    end

    subgraph accessLayer ["데이터 접근"]
        repository["Repository·ORM"]
        storageAdapter["파일 저장소 연결"]
        vectorSearch["벡터 검색·KURE-v1"]
    end

    subgraph externalLayer ["데이터·외부 시스템"]
        database["Supabase PostgreSQL·pgvector"]
        storage["Supabase Storage"]
        auth["Supabase Auth"]
        ocr["RunPod OCR 워커"]
        ai["OpenAI API"]
    end

    caddy --> app

    app --> authApi
    app --> analysisApi
    app --> chatApi
    app --> notificationApi
    app -.->|"보호 API"| security
    app -.->|"기동 워밍업·그래프 컴파일"| chatService
    security -.->|"JWT 공개키"| auth

    authApi --> authService
    chatApi --> chatService
    chatApi -->|"채팅 기록"| repository
    notificationApi -->|"알림 조회·변경"| repository

    authService --> repository
    authService --> storageAdapter

    analysisApi -->|"작업 등록·조회"| repository
    analysisApi -->|"원본 임시 저장"| storageAdapter
    analysisApi -->|"접수 알림"| notificationService

    app -.->|"백그라운드 시작"| analysisService
    analysisService -->|"작업 선점·결과 저장"| repository
    analysisService -->|"원본 조회·삭제"| storageAdapter
    analysisService -->|"OCR·AI 실행"| documentService
    analysisService -->|"완료·실패 알림"| notificationService

    chatService --> vectorSearch

    notificationService --> repository

    repository -->|"업무 데이터"| database
    vectorSearch -->|"법령·판례 검색"| database
    storageAdapter -->|"파일 저장·조회"| storage

    documentService -.->|"OCR·마스킹"| ocr
    documentService -.->|"위험 분석"| ai
    chatService -.->|"답변 생성"| ai

    classDef entryNode fill:#EEF2F7,stroke:#64748B,color:#172033,stroke-width:1.5px;
    classDef apiNode fill:#EAF2FF,stroke:#4A78C2,color:#172033,stroke-width:1.5px;
    classDef serviceNode fill:#ECF8F1,stroke:#3C8C64,color:#172033,stroke-width:1.5px;
    classDef accessNode fill:#FFF5E8,stroke:#D58A35,color:#172033,stroke-width:1.5px;
    classDef externalNode fill:#F3EEFF,stroke:#8064B3,color:#172033,stroke-width:1.5px;

    class caddy,app,security entryNode;
    class authApi,analysisApi,chatApi,notificationApi apiNode;
    class authService,analysisService,documentService,chatService,notificationService serviceNode;
    class repository,storageAdapter,vectorSearch accessNode;
    class database,storage,auth,ocr,ai externalNode;
```

### 서버 구성 요소

| 영역 | 실제 코드 역할 |
| --- | --- |
| 요청 진입 | Caddy Reverse Proxy, FastAPI 앱, 공통 예외·인증 처리 |
| API 계층 | `api/routes/`의 인증, 회원, 분석, 채팅, 알림 API |
| 서비스 계층 | 사용자 처리, 분석 Worker, OCR Client, LLM 분석, LangGraph RAG, 알림 |
| 데이터 접근 | Repository, SQLAlchemy, psycopg 연결 Pool |
| 파일 저장소 연결 | 분석 원본과 프로필 이미지를 Supabase Storage에 저장 |
| 외부 처리 | RunPod OCR Worker와 OpenAI API 호출 |

## 4. OCR 및 AI 처리 구조도

계약서 분석은 API 요청 안에서 바로 완료되지 않는다. 파일과 작업을 먼저 저장한 뒤, 백그라운드 Worker가 OCR과 AI 분석을 순서대로 실행한다.

```mermaid
flowchart LR
    subgraph clientLayer ["클라이언트"]
        upload["계약서 파일 업로드"]
        resultView["분석 상태·결과 화면"]
    end

    subgraph backendLayer ["백엔드"]
        receive["파일 검사·분석 접수"]
        job["분석 작업 등록"]
        worker["백그라운드 분석 워커"]
        validation["개인정보 마스킹 검증"]
        save["분석 결과·알림 저장"]
    end

    subgraph dataLayer ["데이터 저장"]
        inputStorage["원본 임시 저장소"]
        jobStore["PostgreSQL 분석 작업"]
        resultStore["PostgreSQL 결과·알림"]
    end

    subgraph processingLayer ["외부 처리"]
        ocr["RunPod OCR 워커"]
        ai["OpenAI 위험 분석"]
    end

    upload -->|"PDF·PNG·JPG"| receive
    receive -->|"원본 임시 저장"| inputStorage
    receive -->|"작업 생성"| job
    job -->|"DB 작업 큐"| jobStore
    jobStore -->|"대기 작업 선점"| worker
    inputStorage -->|"원본 읽기"| worker

    worker -.->|"문서 전달"| ocr
    ocr -->|"OCR·마스킹 결과"| validation
    validation -.->|"정제된 텍스트만 전달"| ai
    ai -->|"계약 조건·위험 요소"| save

    save -->|"결과·알림 저장"| resultStore
    resultStore -->|"상태 폴링"| resultView

    classDef clientNode fill:#EAF2FF,stroke:#4A78C2,color:#172033,stroke-width:1.5px;
    classDef backendNode fill:#ECF8F1,stroke:#3C8C64,color:#172033,stroke-width:1.5px;
    classDef dataNode fill:#FFF5E8,stroke:#D58A35,color:#172033,stroke-width:1.5px;
    classDef processingNode fill:#F3EEFF,stroke:#8064B3,color:#172033,stroke-width:1.5px;

    class upload,resultView clientNode;
    class receive,job,worker,validation,save backendNode;
    class inputStorage,jobStore,resultStore dataNode;
    class ocr,ai processingNode;
```

## 5. LangGraph RAG 처리 구조도

LangGraph RAG는 AI 채팅 API가 사용하는 백엔드 내부 구성 요소다. 서버 워밍업 또는 최초 채팅 요청 시 상태 그래프를 조립하고 `MemorySaver` 체크포인터와 함께 컴파일한다. 이후 사용자 질문마다 컴파일된 그래프를 실행한다.

계약서 위험 분석은 이 그래프를 사용하지 않으며, 앞의 OCR 및 AI 처리 흐름에서 별도 서비스로 실행된다.

```mermaid
flowchart LR
    subgraph initializationLayer ["그래프 초기화"]
        warmup["서버 워밍업·지연 로드"]
        graphDefinition["상태 그래프·노드 연결"]
        compiledGraph["컴파일된 LangGraph RAG"]
    end

    subgraph executionLayer ["질문 처리"]
        question["사용자 질문·대화 내역"]
        retrieve["법령·판례 검색"]
        grade["검색 결과 관련도 판단"]
        rewrite["검색 질문 재작성"]
        generate["근거 기반 답변 생성"]
        response["AI 채팅 답변"]
    end

    subgraph retrievalLayer ["검색 기반"]
        embedding["질의 임베딩 (KURE-v1)"]
        vectorDatabase["법률 지식 저장소 (PostgreSQL·pgvector)"]
    end

    subgraph modelLayer ["외부 AI"]
        openai["OpenAI API"]
    end

    warmup --> graphDefinition
    graphDefinition -->|"MemorySaver 적용·compile"| compiledGraph

    question -->|"그래프 실행"| compiledGraph
    compiledGraph --> retrieve
    retrieve -.->|"질의 임베딩"| embedding
    embedding -->|"벡터 유사도 검색"| vectorDatabase
    vectorDatabase -->|"검색 결과"| grade

    grade -->|"근거 충분"| generate
    grade -->|"근거 부족"| rewrite
    rewrite -.->|"질문 재작성"| openai
    rewrite -->|"최대 1회 재검색"| retrieve

    generate -.->|"답변 생성"| openai
    generate --> response

    classDef initializationNode fill:#EEF2F7,stroke:#64748B,color:#172033,stroke-width:1.5px;
    classDef executionNode fill:#ECF8F1,stroke:#3C8C64,color:#172033,stroke-width:1.5px;
    classDef retrievalNode fill:#FFF5E8,stroke:#D58A35,color:#172033,stroke-width:1.5px;
    classDef modelNode fill:#F3EEFF,stroke:#8064B3,color:#172033,stroke-width:1.5px;

    class warmup,graphDefinition,compiledGraph initializationNode;
    class question,retrieve,grade,rewrite,generate,response executionNode;
    class embedding,vectorDatabase retrievalNode;
    class openai modelNode;
```

## 확인된 구성과 제외 항목

| 항목 | 확인 결과 |
| --- | --- |
| AWS EC2 | 운영용 Docker Compose와 배포 문서에서 확인 |
| Docker | Frontend, Backend, OCR Worker Dockerfile과 Compose 설정 확인 |
| Nginx | Frontend 정적 파일 제공과 SPA Routing 설정 확인 |
| RunPod | Backend OCR 주소와 RunPod 전용 이미지 Workflow에서 확인 |
| Database | Supabase PostgreSQL과 pgvector 사용 확인 |
| Storage | Supabase Storage의 분석 원본·프로필 이미지 저장 확인 |
| 인증 | Supabase Auth, JWT 검증, Kakao OAuth 확인 |
| AI | LangGraph RAG 챗봇과 OpenAI API의 질문 재작성·답변 생성·계약서 분석 호출 확인 |
| Redis·Celery | 사용하지 않음. PostgreSQL `analysis_job`이 작업 큐 역할 수행 |
| 정부24·인터넷등기소 | 단순 외부 링크이며 API 연동은 없음 |

## 주요 확인 파일

- [`docker-compose.prod.yml`](../docker-compose.prod.yml)
- [`deploy/Caddyfile`](../deploy/Caddyfile)
- [`frontend/src/routes.tsx`](../frontend/src/routes.tsx)
- [`frontend/src/api/client.ts`](../frontend/src/api/client.ts)
- [`backend/app/main.py`](../backend/app/main.py)
- [`backend/app/api/deps.py`](../backend/app/api/deps.py)
- [`backend/app/services/analysis_jobs/runner.py`](../backend/app/services/analysis_jobs/runner.py)
- [`backend/app/services/document_processing/client.py`](../backend/app/services/document_processing/client.py)
- [`backend/app/agent/graph_rag.py`](../backend/app/agent/graph_rag.py)
