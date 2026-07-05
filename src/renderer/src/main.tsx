import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// Bundled fonts (CSP forbids remote font CDNs): Inter for UI, Newsreader for
// the serif wordmark / editorial accents.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/newsreader/400.css'
import '@fontsource/newsreader/500.css'
import '@fontsource/newsreader/400-italic.css'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
