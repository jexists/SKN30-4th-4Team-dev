# EC2 배포 런북

프론트·백엔드·OCR 워커 3개 컨테이너를 **EC2 한 대**에 올리고 Caddy 로 HTTPS 를 붙인다.
GPU 가 필요한 PaddleOCR-VL 은 이 단계에서 쓰지 않는다(`OCR_PROVIDER=tesseract`).
GPU 는 나중에 별도 노드(RunPod 등)로 붙이고 `OCR_WORKER_URL` 만 바꾼다.

```
        EC2 1대 (c6i.large)
┌───────────────────────────────────┐
│ caddy   :80/:443  ← 외부에 열리는 유일한 포트
│   ├ /      → frontend (nginx)
│   └ /api/* → backend  :8000
│                 └→ ocr-worker :8100 (내부 전용)
└───────────────────────────────────┘
        ↓                    ↓
    Supabase             OpenAI API
```

---

## 0. 사전 준비

- [ ] **AWS Budgets 알림**을 먼저 만든다(월 $50). 인스턴스를 만들기 **전에** 한다.
- [ ] **도메인 확보.** 없으면 카카오 로그인이 동작하지 않는다(OAuth 리다이렉트가 HTTPS 필요).
- [ ] 리전은 **ap-northeast-2(서울)** 로 고정. Supabase 프로젝트 리전과 맞추면 DB 왕복이 짧다.

## 1. EC2 인스턴스 생성 (콘솔)

| 항목 | 값 | 이유 |
|---|---|---|
| AMI | **Ubuntu Server 24.04 LTS (x86_64)** | **arm64 를 고르면 안 된다.** paddlepaddle 이 aarch64 휠을 제대로 제공하지 않는다 |
| 인스턴스 유형 | **c6i.large** (2 vCPU / 4GB) | t 계열은 버스터블이라 OCR 처럼 CPU 를 오래 쓰는 작업에서 스로틀링·초과요금이 난다 |
| 키 페어 | 새로 생성 후 `.pem` 보관 | 분실하면 접속 불가 |
| 스토리지 | **gp3 50GB** | 기본 8GB 는 도커 이미지만으로 가득 찬다 |
| 네트워크 | 퍼블릭 서브넷, 퍼블릭 IP 자동 할당 | NAT Gateway(월 $43)를 피한다 |

**보안 그룹** — 인바운드 3개만:

| 포트 | 소스 | 용도 |
|---|---|---|
| 22 | **내 IP** | SSH. `0.0.0.0/0` 으로 열지 않는다 |
| 80 | `0.0.0.0/0` | HTTP → Caddy 가 HTTPS 로 리다이렉트 |
| 443 | `0.0.0.0/0` | HTTPS |

> **8000·8100 은 절대 열지 않는다.** OCR 워커에는 인증이 없어서 열면 누구나 계약서를 밀어 넣을 수 있다.

**탄력적 IP(Elastic IP)** 를 할당해 인스턴스에 연결한다. 안 하면 인스턴스를 stop/start 할 때마다
퍼블릭 IP 가 바뀌어 DNS 를 다시 잡아야 한다.

## 2. 서버 기본 세팅

```bash
ssh -i ~/키페어.pem ubuntu@<탄력적IP>
```

### 2-1. swap 4GB — 반드시 먼저

메모리 4GB 인데 백엔드 컨테이너가 임베딩 모델(KURE-v1)로만 2.5GB 를 쓴다. swap 없이
프론트를 빌드하면 node 가 메모리를 못 잡고 빌드가 실패한다.

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h        # Swap 4.0Gi 확인
```

### 2-2. Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit            # 그룹 반영을 위해 재접속
```

재접속 후 `docker ps` 가 sudo 없이 되면 성공.

## 3. 코드와 환경변수

```bash
git clone <저장소 URL> homeshield
cd homeshield
```

> 비공개 저장소면 GitHub **Deploy Key** 를 만들어 등록하는 편이 개인 토큰보다 안전하다.

**`.env` 3개는 git 에 없으므로 서버에서 직접 만든다.** 여기서 가장 많이 막힌다.

```bash
cp .env.example .env                        # 루트: 프론트 빌드 인자 + SITE_ADDRESS
cp backend/.env.example backend/.env
cp ocr-worker/.env.example ocr-worker/.env
```

| 파일 | 채울 값 |
|---|---|
| `.env` | `SITE_ADDRESS=내도메인`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `backend/.env` | `APP_DB_URL`(Supabase **Transaction pooler :6543**), `INGEST_DATABASE_URL`, `SUPABASE_URL`, `OPENAI_API_KEY` |
| `ocr-worker/.env` | `OCR_PROVIDER=tesseract` (그 외 기본값 그대로) |

`ocr-worker/.env` 의 `OCR_VL_MODEL_DIR` 과 `backend/.env` 의 `OCR_WORKER_URL` 은
`docker-compose.prod.yml` 이 컨테이너 값으로 덮어쓰므로 신경 쓰지 않아도 된다.

## 4. DNS

도메인 관리 화면에서 **A 레코드** 를 탄력적 IP 로 지정한다.

```bash
dig +short 내도메인      # 탄력적 IP 가 나와야 함
```

**전파를 확인한 뒤에 다음 단계로 간다.** DNS 가 안 잡힌 상태로 Caddy 를 띄우면 인증서 발급에
실패하고, 반복하면 Let's Encrypt 발급 한도에 걸린다.

## 5. 기동

메모리가 빠듯하므로 **한 번에 하나씩** 빌드한다(동시에 돌리면 OOM 이 난다).

```bash
docker compose -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml build ocr-worker
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

인증서 발급 로그 확인:

```bash
docker compose -f docker-compose.prod.yml logs caddy | tail -30
```

## 6. Supabase 설정 — 빼먹으면 로그인이 깨진다

대시보드 → **Authentication → URL Configuration**

- **Site URL**: `https://내도메인`
- **Redirect URLs**: `https://내도메인/auth/callback` 추가

프론트가 `${window.location.origin}/auth/callback` 으로 리다이렉트하므로
(`frontend/src/auth/kakaoOAuth.ts`), 운영 도메인이 등록되지 않으면 카카오 로그인이
배포 직후 바로 실패한다. 로컬에서 잘 되던 것이 여기서 처음 깨진다.

## 7. 동작 확인

```bash
curl -s https://내도메인/api/v1/health
curl -s https://내도메인/api/v1/documents/ocr-health
```

브라우저에서 순서대로:

1. `https://내도메인` 접속 (HTTPS 자물쇠 확인)
2. 회원가입 → 로그인
3. 새로고침해도 로그인이 유지되는지
4. 챗봇 대화
5. 계약서 업로드 → 마스킹·분석 결과

## 8. 운영

```bash
# 코드 갱신 후 재배포 (바뀐 서비스만)
git pull
docker compose -f docker-compose.prod.yml up -d --build frontend

# 로그
docker compose -f docker-compose.prod.yml logs -f backend

# 중지 / 완전 정리(볼륨 포함 — 인증서도 지워지므로 주의)
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml down -v
```

## 함정 정리

- **arm64 인스턴스(t4g·c7g)를 고르지 않는다** — paddlepaddle 이 설치되지 않는다.
- **swap 을 먼저 만든다** — 안 하면 프론트 빌드가 OOM 으로 죽는다.
- **DNS 전파 후에 Caddy 를 띄운다** — 인증서 발급 실패가 반복되면 한도에 걸린다.
- **Supabase Redirect URL 등록** — 이걸 빼면 로그인만 안 된다(화면은 멀쩡히 뜬다).
- **프론트는 빌드 시점에 환경변수가 굳는다** — 도메인이 바뀌면 재빌드해야 한다.
- **8000·8100 을 보안그룹에 열지 않는다.**
- 퍼블릭 IPv4 주소는 연결돼 있어도 시간당 과금된다(월 $4 내외).
