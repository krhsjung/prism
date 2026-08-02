import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './lib/i18n/I18nProvider.tsx'

// I18nProvider를 가장 바깥에 둔다 — 인증 확인 중에 뜨는 문구까지 전부 번역 대상이다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
