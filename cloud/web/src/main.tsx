import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CloudReviewApp } from './ReviewPage'

const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <CloudReviewApp />
    </StrictMode>,
  )
}
