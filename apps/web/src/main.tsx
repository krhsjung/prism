import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './lib/i18n/I18nProvider.tsx'
import { ThemeProvider } from './lib/theme/ThemeProvider.tsx'

// I18nProvider를 바깥에 둔다 — 인증 확인 중에 뜨는 문구까지 전부 번역 대상이다.
// ThemeProvider는 그보다 더 바깥이다: I18nProvider는 번역을 받기 전까지 아무것도
// 그리지 않으므로, 안쪽에 두면 그 사이에 기기 설정 변경을 놓친다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)
