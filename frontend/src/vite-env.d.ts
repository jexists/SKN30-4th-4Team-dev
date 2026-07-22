/// <reference types="vite/client" />

// 실제 사용은 src/config/env.ts 를 통해서만. 여기서는 타입만 선언한다.
interface ImportMetaEnv {
  /** 비우면 vite 프록시(/api → :8000)를 탄다. */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
