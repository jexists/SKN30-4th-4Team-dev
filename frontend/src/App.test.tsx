import { render, screen, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from './App'
import { BRAND } from './config/env'

const DISCLAIMER = /법적 자문을 대신하지 않습니다/

/** App 의 공통 크롬(헤더·푸터) 규칙만 확인하도록 가벼운 자식 라우트로 감싼다. */
function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <App />,
        children: [
          { index: true, element: <p>홈</p> },
          { path: 'chat', element: <p>채팅</p> },
          { path: 'mypage', element: <p>마이페이지</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  )

  return render(<RouterProvider router={router} />)
}

describe('App 레이아웃', () => {
  it('채팅 화면에는 푸터를 붙이지 않는다', () => {
    renderAt('/chat')

    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  })

  it('랜딩은 브랜드를 세운 다크 푸터로 닫는다', () => {
    renderAt('/')

    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText(BRAND.name)).toBeInTheDocument()
    expect(footer).toHaveTextContent(DISCLAIMER)
  })

  it('그 밖의 화면은 브랜드 없는 한 줄 고지 스트립으로 닫는다', () => {
    renderAt('/mypage')

    const footer = screen.getByRole('contentinfo')
    expect(within(footer).queryByText(BRAND.name)).not.toBeInTheDocument()
    expect(footer).toHaveTextContent(DISCLAIMER)
  })
})
