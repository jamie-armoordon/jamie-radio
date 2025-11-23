import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import './utils/consoleFilter' // Filter noisy console errors in dev
import App from './App.tsx'

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
