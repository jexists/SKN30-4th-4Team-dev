import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { BRAND_PAGE_TITLE } from './config/env'
import { router } from './routes'
import './styles/main.scss'

// index.html 의 정적 title 은 첫 페인트용 기본값. 브랜드명은 config/env.ts 가 정한다.
document.title = BRAND_PAGE_TITLE

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
