import { createBrowserRouter } from 'react-router-dom'

import App from './App'
import { RequireAuth } from './components/RequireAuth/RequireAuth'
import { AccountSettings } from './pages/AccountSettings/AccountSettings'
import { AddCard } from './pages/AddCard/AddCard'
import { Analyze } from './pages/Analyze/Analyze'
import { AnalyzeResult } from './pages/AnalyzeResult/AnalyzeResult'
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
      { path: 'analyze', element: <Analyze /> },
      { path: 'analyze/:id', element: <AnalyzeResult /> },
      { path: 'chat', element: <Chat /> },
      { path: 'chat/:id', element: <Chat /> },
      { path: 'login', element: <Login /> },
      { path: 'signup', element: <SignUp /> },
      { path: 'onboarding', element: <Onboarding /> },
      // 로그인이 필요한 화면 — 비로그인이면 /login 으로 이동
      {
        element: <RequireAuth />,
        children: [
          { path: 'mypage', element: <MyPage /> },
          { path: 'account', element: <AccountSettings /> },
          { path: 'account/cards/new', element: <AddCard /> },
          { path: 'risk-report', element: <RiskReport /> },
        ],
      },
      { path: 'terms', element: <Terms /> },
      { path: 'privacy', element: <Privacy /> },
      { path: 'legal-basis', element: <LegalBasis /> },
      { path: 'support', element: <Support /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
