# --- build ---
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
# Vite 는 빌드 시점에 값을 번들에 굽는다 — 컨테이너 환경변수로는 바꿀 수 없고,
# 주소가 바뀌면 이미지를 다시 빌드해야 한다.
# supabase 두 값이 비면 src/config/env.ts 에서 인증이 비활성화된다(화면은 뜨는데 로그인만 안 됨).
# 카카오맵 키가 비면 지도 대신 핀 대체 화면이 뜬다(선택 값 — 없어도 빌드·화면 정상).
ARG VITE_API_BASE_URL=http://localhost:8000
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_KAKAO_MAP_JS_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_KAKAO_MAP_JS_KEY=$VITE_KAKAO_MAP_JS_KEY
RUN npm run build

# --- serve ---
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
