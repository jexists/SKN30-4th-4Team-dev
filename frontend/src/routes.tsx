import { createBrowserRouter } from 'react-router-dom'

import App from './App'
import { RequireAuth } from './components/RequireAuth/RequireAuth'
import { Analyze } from './pages/Analyze/Analyze'
import { AnalyzeResult } from './pages/AnalyzeResult/AnalyzeResult'
import { AuthCallback } from './pages/AuthCallback/AuthCallback'
import { Chat } from './pages/Chat/Chat'
import { Home } from './pages/Home/Home'
import { LegalBasis } from './pages/LegalBasis/LegalBasis'
import { Login } from './pages/Login/Login'
import { MyPage } from './pages/MyPage/MyPage'
import { NotFound } from './pages/NotFound/NotFound'
import { Onboarding } from './pages/Onboarding/Onboarding'
import { Privacy } from './pages/Privacy/Privacy'
import { RiskReport } from './pages/RiskReport/RiskReport'
import { SignUp } from './pages/SignUp/SignUp'
import { Support } from './pages/Support/Support'
import { Terms } from './pages/Terms/Terms'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: 'login', element: <Login /> },
      { path: 'signup', element: <SignUp /> },
      { path: 'auth/callback', element: <AuthCallback /> },
      { path: 'onboarding', element: <Onboarding /> },
      { path: 'terms', element: <Terms /> },
      { path: 'privacy', element: <Privacy /> },
      // 로그인이 필요한 화면 — 비로그인이면 /login 으로 이동(로그인 후 원래 위치로 복귀)
      {
        element: <RequireAuth />,
        children: [
          { path: 'analyze', element: <Analyze /> },
          { path: 'analyze/:id', element: <AnalyzeResult /> },
          { path: 'chat/:chatId?', element: <Chat /> },
          { path: 'mypage', element: <MyPage /> },
          { path: 'risk-report', element: <RiskReport /> },
        ],
      },
      { path: 'legal-basis', element: <LegalBasis /> },
      { path: 'support', element: <Support /> },
      // 매칭되지 않는 모든 경로 — 404 (로그인 불필요)
      { path: '*', element: <NotFound /> },
    ],
  },
])
