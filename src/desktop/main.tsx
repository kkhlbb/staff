import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DesktopWorkspace } from '../pages/DesktopWorkspace'
import '../index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopWorkspace />
  </StrictMode>,
)
